import type {
  ColumnFiltersState,
  PaginationState,
  SortingState,
} from "@tanstack/react-table"

/** Browser-safe equivalent of the server cursor encoder (offset based). */
export function encodeOffsetCursor(offset: number) {
  const json = JSON.stringify({ o: Math.max(0, Math.trunc(offset)) })
  const base64 =
    typeof window === "undefined"
      ? Buffer.from(json, "utf8").toString("base64")
      : window.btoa(json)
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** Flattens table column filters into the API `filters` record. */
export function columnFiltersToRecord(filters: ColumnFiltersState) {
  const record: Record<string, string[]> = {}
  for (const filter of filters) {
    const value = filter.value
    if (Array.isArray(value)) {
      const values = value.map(String).filter(Boolean)
      if (values.length > 0) record[filter.id] = values
    } else if (typeof value === "string" && value) {
      record[filter.id] = [value]
    }
  }
  return record
}

/** Builds the list query input for a server-mode DataTable. */
export function buildListQuery({
  pagination,
  sorting,
  filters,
  search,
}: {
  pagination: PaginationState
  sorting: SortingState
  filters: Record<string, string[]>
  search?: string
}) {
  return {
    limit: pagination.pageSize,
    cursor:
      pagination.pageIndex > 0
        ? encodeOffsetCursor(pagination.pageIndex * pagination.pageSize)
        : undefined,
    sort: sorting.map((entry) => ({ id: entry.id, desc: entry.desc })),
    filters,
    search: search?.trim() ? search.trim() : undefined,
  }
}
