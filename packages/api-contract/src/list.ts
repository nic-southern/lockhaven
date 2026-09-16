import { asc, desc, type SQL } from "drizzle-orm"
import type { AnyColumn } from "drizzle-orm"
import { z } from "zod"

export const LIST_MAX_LIMIT = 200
export const LIST_DEFAULT_LIMIT = 50

export const sortSchema = z.object({
  id: z.string().min(1).max(64),
  desc: z.boolean().default(false),
})

export const filterValueSchema = z.union([
  z.string().max(256),
  z.array(z.string().max(256)).max(50),
])

/**
 * Shared list contract for paginated, sortable, filterable procedures.
 *
 * - `cursor` is an opaque token returned from the previous page.
 * - `limit` caps page size; omit it to receive the legacy unpaginated array.
 * - `sort` is applied in order; unknown ids are ignored by the router.
 * - `filters` maps a column id to a value or set of values.
 * - `search` is a free-text term the router applies to its search columns.
 */
export const listQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.number().int().min(1).max(LIST_MAX_LIMIT).optional(),
  sort: z.array(sortSchema).max(4).optional(),
  filters: z.record(z.string().max(64), filterValueSchema).optional(),
  search: z.string().trim().max(200).optional(),
})

export type ListQuery = z.infer<typeof listQuerySchema>
export type ListSort = z.infer<typeof sortSchema>

export type Page<T> = {
  items: T[]
  nextCursor: string | null
  total: number
}

type CursorPayload = { o: number }

export function encodeCursor(offset: number) {
  const payload: CursorPayload = { o: Math.max(0, Math.trunc(offset)) }
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
}

export function decodeCursor(cursor: string | undefined | null) {
  if (!cursor) {
    return 0
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8")
    ) as Partial<CursorPayload>
    const offset = Number(parsed?.o)
    return Number.isFinite(offset) && offset >= 0 ? Math.trunc(offset) : 0
  } catch {
    return 0
  }
}

export type ResolvedListQuery = {
  limit: number
  offset: number
  sort: ListSort[]
  filters: Record<string, string[]>
  search: string
}

/**
 * Normalizes an optional list query into concrete values. Filters are always
 * exposed as string arrays so routers can use `inArray` uniformly.
 */
export function resolveListQuery(
  input: ListQuery | undefined | null,
  options: { defaultLimit?: number; maxLimit?: number } = {}
): ResolvedListQuery {
  const maxLimit = options.maxLimit ?? LIST_MAX_LIMIT
  const defaultLimit = Math.min(
    options.defaultLimit ?? LIST_DEFAULT_LIMIT,
    maxLimit
  )
  const limit = Math.min(input?.limit ?? defaultLimit, maxLimit)
  const filters: Record<string, string[]> = {}

  for (const [key, value] of Object.entries(input?.filters ?? {})) {
    const values = (Array.isArray(value) ? value : [value])
      .map((entry) => entry.trim())
      .filter(Boolean)
    if (values.length > 0) {
      filters[key] = [...new Set(values)]
    }
  }

  return {
    limit,
    offset: decodeCursor(input?.cursor),
    sort: input?.sort ?? [],
    filters,
    search: input?.search?.trim() ?? "",
  }
}

/**
 * Builds a page from rows fetched with `limit + 1` so `nextCursor` can be
 * derived without a second query. `total` should come from a count query.
 */
export function paginate<T>(
  rows: T[],
  query: Pick<ResolvedListQuery, "limit" | "offset">,
  total: number
): Page<T> {
  const hasMore = rows.length > query.limit
  const items = hasMore ? rows.slice(0, query.limit) : rows

  return {
    items,
    nextCursor: hasMore ? encodeCursor(query.offset + query.limit) : null,
    total,
  }
}

/**
 * Applies the requested sort to a whitelist of sortable columns, falling
 * back to `fallback` so ordering is always deterministic.
 */
export function buildOrderBy(
  sort: ListSort[],
  sortable: Record<string, AnyColumn | SQL>,
  fallback: SQL | SQL[]
): SQL[] {
  const clauses: SQL[] = []

  for (const entry of sort) {
    const column = sortable[entry.id]
    if (!column) continue
    clauses.push(entry.desc ? desc(column) : asc(column))
  }

  const fallbackClauses = Array.isArray(fallback) ? fallback : [fallback]
  return clauses.length > 0 ? [...clauses, ...fallbackClauses] : fallbackClauses
}

/** Escapes `%` and `_` so user input is matched literally by `ILIKE`. */
export function likePattern(search: string) {
  const escaped = search.replace(/[\\%_]/g, (match) => `\\${match}`)
  return `%${escaped}%`
}
