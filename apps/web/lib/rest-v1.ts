import { TRPCError } from "@trpc/server"

const LIST_MAX_LIMIT = 200

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type RestV1Caller = {
  devices: {
    page: (input?: Record<string, unknown>) => Promise<unknown>
    byId: (input: { id: string }) => Promise<unknown>
  }
  sites: {
    list: () => Promise<unknown>
  }
  enrollmentTokens: {
    list: () => Promise<unknown>
    create: (input: unknown) => Promise<unknown>
  }
  alerts: {
    page: (input?: Record<string, unknown>) => Promise<unknown>
    acknowledge: (input: { id: string }) => Promise<unknown>
    resolve: (input: { id: string; note?: string }) => Promise<unknown>
  }
  sessions: {
    page: (input?: Record<string, unknown>) => Promise<unknown>
  }
  audit: {
    page: (input?: Record<string, unknown>) => Promise<unknown>
  }
  assets: {
    page: (input?: Record<string, unknown>) => Promise<unknown>
    byId: (input: { id: string }) => Promise<unknown>
  }
}

export type RestV1Result = {
  status: number
  body: unknown
}

function isUuid(value: string) {
  return UUID_PATTERN.test(value)
}

function listQueryFromSearch(searchParams: URLSearchParams) {
  const limitRaw = searchParams.get("limit")
  const limit = limitRaw ? Number(limitRaw) : undefined
  const cursor = searchParams.get("cursor") ?? undefined
  const search = searchParams.get("search") ?? undefined
  const query: Record<string, unknown> = {}
  if (
    typeof limit === "number" &&
    Number.isInteger(limit) &&
    limit >= 1 &&
    limit <= LIST_MAX_LIMIT
  ) {
    query.limit = limit
  }
  if (cursor) query.cursor = cursor
  if (search) query.search = search
  return query
}

function publicSite(row: Record<string, unknown>) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    timezone: row.timezone ?? null,
    notes: row.notes ?? null,
    createdAt: row.createdAt,
  }
}

function publicEnrollmentToken(row: Record<string, unknown>) {
  const rest = { ...row }
  delete rest.tokenHash
  delete rest.tokenCiphertext
  delete rest.tokenIv
  delete rest.tokenAuthTag
  return rest
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function httpStatusForTrpcCode(code: string) {
  switch (code) {
    case "UNAUTHORIZED":
      return 401
    case "FORBIDDEN":
      return 403
    case "NOT_FOUND":
      return 404
    case "CONFLICT":
      return 409
    case "TOO_MANY_REQUESTS":
      return 429
    case "BAD_REQUEST":
    case "PARSE_ERROR":
    case "PAYLOAD_TOO_LARGE":
    case "UNPROCESSABLE_CONTENT":
      return 400
    default:
      return 500
  }
}

export function restErrorFromUnknown(error: unknown): RestV1Result {
  if (error instanceof TRPCError) {
    const status = httpStatusForTrpcCode(error.code)
    const message =
      status >= 500
        ? "Something went wrong."
        : error.message || "Request failed"
    return { status, body: { error: message } }
  }
  return { status: 500, body: { error: "Something went wrong." } }
}

export async function dispatchRestV1(options: {
  method: string
  path: string[]
  searchParams: URLSearchParams
  body: unknown
  caller: RestV1Caller
}): Promise<RestV1Result> {
  const method = options.method.toUpperCase()
  const path = options.path.filter(Boolean)

  if (method === "GET" && path.length === 1 && path[0] === "devices") {
    const page = await options.caller.devices.page(
      listQueryFromSearch(options.searchParams)
    )
    return { status: 200, body: page }
  }

  if (
    method === "GET" &&
    path.length === 2 &&
    path[0] === "devices" &&
    path[1] &&
    isUuid(path[1])
  ) {
    const device = await options.caller.devices.byId({ id: path[1] })
    if (!device) {
      return { status: 404, body: { error: "Device not found." } }
    }
    return { status: 200, body: device }
  }

  if (method === "GET" && path.length === 1 && path[0] === "sites") {
    const rows = await options.caller.sites.list()
    const items = Array.isArray(rows)
      ? rows.map((row) => publicSite(jsonObject(row) ?? {}))
      : []
    return { status: 200, body: { items } }
  }

  if (
    method === "GET" &&
    path.length === 1 &&
    path[0] === "enrollment-tokens"
  ) {
    const rows = await options.caller.enrollmentTokens.list()
    const items = Array.isArray(rows)
      ? rows.map((row) => publicEnrollmentToken(jsonObject(row) ?? {}))
      : []
    return { status: 200, body: { items } }
  }

  if (
    method === "POST" &&
    path.length === 1 &&
    path[0] === "enrollment-tokens"
  ) {
    const created = jsonObject(
      await options.caller.enrollmentTokens.create(options.body ?? {})
    )
    if (!created) {
      return { status: 201, body: created }
    }
    const enrollmentToken = jsonObject(created.enrollmentToken)
    return {
      status: 201,
      body: {
        token: created.token,
        enrollmentToken: enrollmentToken
          ? publicEnrollmentToken(enrollmentToken)
          : created.enrollmentToken,
      },
    }
  }

  if (method === "GET" && path.length === 1 && path[0] === "alerts") {
    const page = await options.caller.alerts.page(
      listQueryFromSearch(options.searchParams)
    )
    return { status: 200, body: page }
  }

  if (
    method === "POST" &&
    path.length === 3 &&
    path[0] === "alerts" &&
    path[1] &&
    isUuid(path[1]) &&
    path[2] === "ack"
  ) {
    const result = await options.caller.alerts.acknowledge({ id: path[1] })
    return { status: 200, body: result }
  }

  if (
    method === "POST" &&
    path.length === 3 &&
    path[0] === "alerts" &&
    path[1] &&
    isUuid(path[1]) &&
    path[2] === "resolve"
  ) {
    const body = jsonObject(options.body)
    const note =
      typeof body?.note === "string" && body.note.trim()
        ? body.note.trim()
        : undefined
    const result = await options.caller.alerts.resolve({
      id: path[1],
      note,
    })
    return { status: 200, body: result }
  }

  if (method === "GET" && path.length === 1 && path[0] === "sessions") {
    const page = await options.caller.sessions.page(
      listQueryFromSearch(options.searchParams)
    )
    return { status: 200, body: page }
  }

  if (method === "GET" && path.length === 1 && path[0] === "activity") {
    const page = await options.caller.audit.page(
      listQueryFromSearch(options.searchParams)
    )
    return { status: 200, body: page }
  }

  if (method === "GET" && path.length === 1 && path[0] === "assets") {
    const page = await options.caller.assets.page(
      listQueryFromSearch(options.searchParams)
    )
    return { status: 200, body: page }
  }

  if (
    method === "GET" &&
    path.length === 2 &&
    path[0] === "assets" &&
    path[1] &&
    isUuid(path[1])
  ) {
    const asset = await options.caller.assets.byId({ id: path[1] })
    if (!asset) {
      return { status: 404, body: { error: "Asset not found." } }
    }
    return { status: 200, body: asset }
  }

  return { status: 404, body: { error: "Not found." } }
}
