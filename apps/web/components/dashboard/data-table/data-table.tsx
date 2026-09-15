"use client"

import * as React from "react"
import {
  type ColumnDef,
  type ColumnFiltersState,
  type OnChangeFn,
  type PaginationState,
  type Row,
  type RowSelectionState,
  type SortingState,
  type Table as TanstackTable,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"

import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { EmptyState } from "@/components/dashboard/empty-state"
import { cn } from "@/lib/utils"

import { DataTablePagination } from "./data-table-pagination"
import { DataTableToolbar } from "./data-table-toolbar"
import type { DataTableFacet } from "./types"

import "./types"

const EMPTY_ROWS: never[] = []

export type DataTableServerState = {
  /** Total rows across all pages, used to compute page count. */
  rowCount: number
  sorting: SortingState
  onSortingChange: OnChangeFn<SortingState>
  columnFilters: ColumnFiltersState
  onColumnFiltersChange: OnChangeFn<ColumnFiltersState>
  pagination: PaginationState
  onPaginationChange: OnChangeFn<PaginationState>
}

export type DataTableProps<TData, TValue> = {
  columns: ColumnDef<TData, TValue>[]
  data: TData[] | undefined
  isLoading?: boolean
  /** Show a lighter loading treatment while refetching with existing rows. */
  isFetching?: boolean
  getRowId?: (row: TData, index: number) => string
  /**
   * Provide to switch to server mode: sorting, filtering, and pagination are
   * driven by the parent and applied by the API.
   */
  server?: DataTableServerState
  /** Free-text search. In client mode this filters across visible columns. */
  search?: string
  onSearchChange?: (value: string) => void
  searchPlaceholder?: string
  facets?: DataTableFacet[]
  /** Toolbar content rendered after the search box. */
  toolbarLeading?: React.ReactNode
  /** Toolbar content rendered on the right, before the column toggle. */
  toolbarActions?: React.ReactNode
  showToolbar?: boolean
  showViewOptions?: boolean
  showPagination?: boolean
  pageSize?: number
  pageSizeOptions?: number[]
  initialSorting?: SortingState
  initialColumnVisibility?: VisibilityState
  /** Provide both to control column visibility from the parent. */
  columnVisibility?: VisibilityState
  onColumnVisibilityChange?: OnChangeFn<VisibilityState>
  enableRowSelection?: boolean
  rowSelection?: RowSelectionState
  onRowSelectionChange?: OnChangeFn<RowSelectionState>
  /** Rendered above the table when at least one row is selected. */
  bulkActions?: (
    rows: Row<TData>[],
    table: TanstackTable<TData>
  ) => React.ReactNode
  onRowClick?: (row: TData) => void
  rowClassName?: (row: TData) => string | undefined
  isRowActive?: (row: TData) => boolean
  emptyTitle?: string
  emptyDescription?: string
  emptyAction?: React.ReactNode
  /** Shown when filters or search return nothing. */
  filteredEmptyTitle?: string
  filteredEmptyDescription?: string
  className?: string
  tableClassName?: string
  /** Optional slot for content between the toolbar and the table. */
  children?: React.ReactNode
}

function normalizeSearch(value: unknown) {
  if (value === null || value === undefined) return ""
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

export function DataTable<TData, TValue>({
  columns,
  data,
  isLoading = false,
  isFetching = false,
  getRowId,
  server,
  search,
  onSearchChange,
  searchPlaceholder,
  facets = [],
  toolbarLeading,
  toolbarActions,
  showToolbar = true,
  showViewOptions = true,
  showPagination = true,
  pageSize = 25,
  pageSizeOptions,
  initialSorting = [],
  initialColumnVisibility = {},
  columnVisibility: controlledColumnVisibility,
  onColumnVisibilityChange,
  enableRowSelection = false,
  rowSelection: controlledRowSelection,
  onRowSelectionChange,
  bulkActions,
  onRowClick,
  rowClassName,
  isRowActive,
  emptyTitle = "Nothing here yet",
  emptyDescription,
  emptyAction,
  filteredEmptyTitle = "No matches",
  filteredEmptyDescription = "Try a different search or clear the filters.",
  className,
  tableClassName,
  children,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting)
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    []
  )
  const [internalColumnVisibility, setInternalColumnVisibility] =
    React.useState<VisibilityState>(initialColumnVisibility)
  const columnVisibility =
    controlledColumnVisibility ?? internalColumnVisibility
  const handleColumnVisibilityChange =
    onColumnVisibilityChange ?? setInternalColumnVisibility
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize,
  })
  const [internalRowSelection, setInternalRowSelection] =
    React.useState<RowSelectionState>({})
  const [internalSearch, setInternalSearch] = React.useState("")

  const isServer = Boolean(server)
  const rowSelection = controlledRowSelection ?? internalRowSelection
  const handleRowSelectionChange =
    onRowSelectionChange ?? setInternalRowSelection
  const searchValue = search ?? internalSearch
  const handleSearchChange = onSearchChange ?? setInternalSearch
  const facetColumnIds = React.useMemo(
    () => new Set(facets.map((facet) => facet.columnId)),
    [facets]
  )

  const resolvedColumns = React.useMemo<ColumnDef<TData, TValue>[]>(() => {
    const base = columns.map((column) => {
      const id =
        column.id ??
        ("accessorKey" in column ? String(column.accessorKey) : undefined)
      if (id && facetColumnIds.has(id) && !column.filterFn) {
        return { ...column, filterFn: "arrIncludesSome" as const }
      }
      return column
    })

    if (!enableRowSelection) {
      return base
    }

    const selectColumn: ColumnDef<TData, TValue> = {
      id: "__select",
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) =>
            table.toggleAllPageRowsSelected(Boolean(value))
          }
          aria-label="Select all rows on this page"
          onClick={(event) => event.stopPropagation()}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(Boolean(value))}
          aria-label="Select row"
          onClick={(event) => event.stopPropagation()}
        />
      ),
      enableSorting: false,
      enableHiding: false,
      size: 40,
      meta: { className: "w-10 pr-0" },
    }

    return [selectColumn, ...base]
  }, [columns, enableRowSelection, facetColumnIds])

  const table = useReactTable<TData>({
    data: data ?? EMPTY_ROWS,
    columns: resolvedColumns,
    getRowId,
    state: {
      sorting: server ? server.sorting : sorting,
      columnFilters: server ? server.columnFilters : columnFilters,
      columnVisibility,
      pagination: server ? server.pagination : pagination,
      rowSelection,
      globalFilter: isServer ? undefined : searchValue,
    },
    enableRowSelection,
    onSortingChange: server ? server.onSortingChange : setSorting,
    onColumnFiltersChange: server
      ? server.onColumnFiltersChange
      : setColumnFilters,
    onColumnVisibilityChange: handleColumnVisibilityChange,
    onPaginationChange: server ? server.onPaginationChange : setPagination,
    onRowSelectionChange: handleRowSelectionChange,
    onGlobalFilterChange: isServer ? undefined : handleSearchChange,
    globalFilterFn: (row, _columnId, filterValue) => {
      const needle = String(filterValue ?? "")
        .trim()
        .toLowerCase()
      if (!needle) return true
      return row
        .getVisibleCells()
        .some((cell) =>
          normalizeSearch(cell.getValue()).toLowerCase().includes(needle)
        )
    },
    manualSorting: isServer,
    manualFiltering: isServer,
    manualPagination: isServer,
    rowCount: server?.rowCount,
    autoResetPageIndex: !isServer,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: isServer ? undefined : getSortedRowModel(),
    getFilteredRowModel: isServer ? undefined : getFilteredRowModel(),
    getPaginationRowModel: isServer ? undefined : getPaginationRowModel(),
    getFacetedRowModel: isServer ? undefined : getFacetedRowModel(),
    getFacetedUniqueValues: isServer ? undefined : getFacetedUniqueValues(),
  })

  const rows = table.getRowModel().rows
  const selectedRows = enableRowSelection
    ? table.getFilteredSelectedRowModel().rows
    : EMPTY_ROWS
  const hasSourceRows = (data?.length ?? 0) > 0 || (server?.rowCount ?? 0) > 0
  const isFiltered =
    Boolean(searchValue) || table.getState().columnFilters.length > 0
  const visibleColumnCount = table.getVisibleLeafColumns().length || 1

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {showToolbar ? (
        <DataTableToolbar
          table={table}
          search={searchValue}
          onSearchChange={handleSearchChange}
          searchPlaceholder={searchPlaceholder}
          facets={facets}
          leading={toolbarLeading}
          actions={toolbarActions}
          showViewOptions={showViewOptions}
        />
      ) : null}
      {children}
      {enableRowSelection && bulkActions && selectedRows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span className="font-medium tabular-nums">
            {selectedRows.length} selected
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {bulkActions(selectedRows, table)}
          </div>
        </div>
      ) : null}
      <div
        className={cn(
          "overflow-hidden rounded-lg border border-border/80 bg-card/60 transition-opacity",
          isFetching && !isLoading && "opacity-70",
          tableClassName
        )}
      >
        <Table>
          <TableHeader className="bg-muted/40">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    colSpan={header.colSpan}
                    className={cn(
                      header.column.columnDef.meta?.className,
                      header.column.columnDef.meta?.align === "right" &&
                        "text-right"
                    )}
                    style={
                      header.column.columnDef.size &&
                      header.column.columnDef.size !== 150
                        ? { width: header.getSize() }
                        : undefined
                    }
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: Math.min(pageSize, 6) }).map((_, index) => (
                <TableRow key={`skeleton-${index}`}>
                  {Array.from({ length: visibleColumnCount }).map(
                    (_, cellIndex) => (
                      <TableCell key={cellIndex}>
                        <Skeleton
                          className="h-4"
                          style={{
                            width: `${55 + ((index * 7 + cellIndex * 13) % 40)}%`,
                          }}
                        />
                      </TableCell>
                    )
                  )}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={visibleColumnCount} className="p-0">
                  {hasSourceRows && isFiltered ? (
                    <EmptyState
                      title={filteredEmptyTitle}
                      description={filteredEmptyDescription}
                      bordered={false}
                    />
                  ) : (
                    <EmptyState
                      title={emptyTitle}
                      description={emptyDescription}
                      action={emptyAction}
                      bordered={false}
                    />
                  )}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const active = isRowActive?.(row.original) ?? false
                return (
                  <TableRow
                    key={row.id}
                    data-state={
                      row.getIsSelected()
                        ? "selected"
                        : active
                          ? "active"
                          : undefined
                    }
                    className={cn(
                      onRowClick && "cursor-pointer",
                      active && "bg-muted/60",
                      rowClassName?.(row.original)
                    )}
                    onClick={
                      onRowClick ? () => onRowClick(row.original) : undefined
                    }
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          cell.column.columnDef.meta?.className,
                          cell.column.columnDef.meta?.align === "right" &&
                            "text-right"
                        )}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
      {showPagination && (hasSourceRows || isServer) ? (
        <DataTablePagination
          table={table}
          pageSizeOptions={pageSizeOptions}
          showSelection={enableRowSelection}
        />
      ) : null}
    </div>
  )
}
