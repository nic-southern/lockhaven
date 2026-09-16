import type {
  ColumnFiltersState,
  SortingState,
  VisibilityState,
} from "@tanstack/react-table"

/** The part of a table's state worth sharing in a link or saving as a view. */
export type TableViewState = {
  sorting: SortingState
  columnFilters: ColumnFiltersState
  search: string
  columnVisibility: VisibilityState
}

export type SavedView = {
  id: string
  name: string
  state: TableViewState
  /** Built-in views ship with the product and cannot be deleted. */
  builtIn?: boolean
}

export const EMPTY_VIEW_STATE: TableViewState = {
  sorting: [],
  columnFilters: [],
  search: "",
  columnVisibility: {},
}

/**
 * Serializes table state to query params:
 *   q=search  sort=col:desc,col2:asc  f.status=a,b  hide=colA,colB
 */
export function viewStateToParams(
  state: TableViewState,
  defaults: TableViewState = EMPTY_VIEW_STATE
) {
  const params = new URLSearchParams()
  if (state.search) params.set("q", state.search)

  const sort = state.sorting
    .map((entry) => `${entry.id}:${entry.desc ? "desc" : "asc"}`)
    .join(",")
  const defaultSort = defaults.sorting
    .map((entry) => `${entry.id}:${entry.desc ? "desc" : "asc"}`)
    .join(",")
  if (sort && sort !== defaultSort) params.set("sort", sort)

  for (const filter of state.columnFilters) {
    const values = Array.isArray(filter.value)
      ? filter.value.map(String).filter(Boolean)
      : filter.value
        ? [String(filter.value)]
        : []
    if (values.length > 0) params.set(`f.${filter.id}`, values.join(","))
  }

  const hidden = Object.entries(state.columnVisibility)
    .filter(([, visible]) => visible === false)
    .map(([id]) => id)
    .sort()
  const defaultHidden = Object.entries(defaults.columnVisibility)
    .filter(([, visible]) => visible === false)
    .map(([id]) => id)
    .sort()
  if (hidden.join(",") !== defaultHidden.join(",")) {
    params.set("hide", hidden.join(","))
  }

  return params
}

export function paramsToViewState(
  params: URLSearchParams,
  defaults: TableViewState = EMPTY_VIEW_STATE
): TableViewState {
  const search = params.get("q") ?? ""

  const sortParam = params.get("sort")
  const sorting: SortingState = sortParam
    ? sortParam
        .split(",")
        .map((entry) => {
          const [id, direction] = entry.split(":")
          return id ? { id, desc: direction === "desc" } : null
        })
        .filter((entry): entry is { id: string; desc: boolean } =>
          Boolean(entry)
        )
    : defaults.sorting

  const columnFilters: ColumnFiltersState = []
  for (const [key, value] of params.entries()) {
    if (!key.startsWith("f.")) continue
    const values = value.split(",").filter(Boolean)
    if (values.length > 0) {
      columnFilters.push({ id: key.slice(2), value: values })
    }
  }

  const hideParam = params.get("hide")
  const columnVisibility: VisibilityState =
    hideParam === null
      ? defaults.columnVisibility
      : Object.fromEntries(
          hideParam
            .split(",")
            .filter(Boolean)
            .map((id) => [id, false])
        )

  return { search, sorting, columnFilters, columnVisibility }
}

export function viewStatesEqual(a: TableViewState, b: TableViewState) {
  return viewStateToParams(a).toString() === viewStateToParams(b).toString()
}
