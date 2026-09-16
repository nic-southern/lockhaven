"use client"

import * as React from "react"
import type { Table } from "@tanstack/react-table"
import { SearchIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

import { DataTableFacetedFilter } from "./data-table-faceted-filter"
import { DataTableViewOptions } from "./data-table-view-options"
import type { DataTableFacet } from "./types"

export function DataTableToolbar<TData>({
  table,
  search,
  onSearchChange,
  searchPlaceholder = "Search",
  facets = [],
  actions,
  leading,
  showViewOptions = true,
  className,
}: {
  table: Table<TData>
  search?: string
  onSearchChange?: (value: string) => void
  searchPlaceholder?: string
  facets?: DataTableFacet[]
  actions?: React.ReactNode
  leading?: React.ReactNode
  showViewOptions?: boolean
  className?: string
}) {
  const isFiltered =
    table.getState().columnFilters.length > 0 || Boolean(search)
  const searchable = typeof onSearchChange === "function"

  return (
    <div
      className={cn(
        "flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between",
        className
      )}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {searchable ? (
          <div className="relative w-full sm:max-w-xs">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search ?? ""}
              onChange={(event) => onSearchChange?.(event.target.value)}
              placeholder={searchPlaceholder}
              className="h-9 bg-card/80 pl-9"
              aria-label={searchPlaceholder}
            />
          </div>
        ) : null}
        {leading}
        {facets.map((facet) => {
          const column = table.getColumn(facet.columnId)
          if (!column) return null
          return (
            <DataTableFacetedFilter
              key={facet.columnId}
              column={column}
              title={facet.title}
              options={facet.options}
            />
          )
        })}
        {isFiltered ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 px-2 text-muted-foreground"
            onClick={() => {
              table.resetColumnFilters()
              onSearchChange?.("")
            }}
          >
            Reset
            <XIcon />
          </Button>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {actions}
        {showViewOptions ? <DataTableViewOptions table={table} /> : null}
      </div>
    </div>
  )
}
