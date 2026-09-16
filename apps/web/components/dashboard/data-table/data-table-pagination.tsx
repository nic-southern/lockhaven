"use client"

import type { Table } from "@tanstack/react-table"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function DataTablePagination<TData>({
  table,
  pageSizeOptions = [10, 25, 50, 100],
  totalLabel,
  showSelection = false,
}: {
  table: Table<TData>
  pageSizeOptions?: number[]
  totalLabel?: string
  showSelection?: boolean
}) {
  const { pageIndex, pageSize } = table.getState().pagination
  const pageCount = table.getPageCount()
  const rowCount = table.getRowCount()
  const selectedCount = showSelection
    ? table.getFilteredSelectedRowModel().rows.length
    : 0
  const start = rowCount === 0 ? 0 : pageIndex * pageSize + 1
  const end = Math.min(rowCount, (pageIndex + 1) * pageSize)

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-1 text-sm text-muted-foreground">
      <div className="flex items-center gap-2 tabular-nums">
        {selectedCount > 0 ? (
          <span>
            {selectedCount} of {rowCount} selected
          </span>
        ) : totalLabel ? (
          <span>{totalLabel}</span>
        ) : rowCount > 0 ? (
          <span>
            {start}–{end} of {rowCount.toLocaleString()}
          </span>
        ) : null}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-3 sm:gap-6">
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline">Rows per page</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => table.setPageSize(Number(value))}
          >
            <SelectTrigger
              size="sm"
              className="h-8 w-[4.5rem] bg-card/80"
              aria-label="Rows per page"
            >
              <SelectValue placeholder={String(pageSize)} />
            </SelectTrigger>
            <SelectContent side="top" position="popper">
              {pageSizeOptions.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1">
          <span className="mr-2 tabular-nums">
            Page {pageCount === 0 ? 1 : pageIndex + 1} of{" "}
            {Math.max(1, pageCount)}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            className="hidden size-8 bg-card/80 lg:flex"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
            aria-label="Go to first page"
          >
            <ChevronsLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            className="size-8 bg-card/80"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label="Go to previous page"
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            className="size-8 bg-card/80"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            aria-label="Go to next page"
          >
            <ChevronRightIcon />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            className="hidden size-8 bg-card/80 lg:flex"
            onClick={() => table.setPageIndex(pageCount - 1)}
            disabled={!table.getCanNextPage()}
            aria-label="Go to last page"
          >
            <ChevronsRightIcon />
          </Button>
        </div>
      </div>
    </div>
  )
}
