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

  const hasActions = Boolean(actions) || showViewOptions
  const hasFilters = Boolean(leading) || facets.length > 0 || isFiltered

  // Phones: search and actions share the first row, filters swipe on a second
  // row. Wide screens: search, filters, and actions sit on one row.
  return (
    <div
      className={cn("flex flex-wrap items-center gap-2 lg:gap-3", className)}
    >
      {searchable ? (
        <div className="relative order-1 min-w-0 flex-1 basis-28 sm:w-72 sm:flex-none sm:basis-auto">
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
      {hasFilters ? (
        <div
          className={cn(
            "order-3 scrollbar-none flex min-w-0 basis-full items-center gap-2 overflow-x-auto [&>*]:shrink-0",
            // A tab strip placed here scrolls with the row, not inside it.
            "[&_[data-slot=tabs-list-scroller]]:max-w-none [&_[data-slot=tabs-list-scroller]]:overflow-visible [&_[data-slot=tabs-list-scroller]]:[mask-image:none]",
            "sm:flex-wrap sm:overflow-visible",
            "lg:order-2 lg:flex-1 lg:basis-0",
            !searchable && "order-1 flex-1 basis-auto"
          )}
        >
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
              className="h-9 shrink-0 px-2 text-muted-foreground"
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
      ) : null}
      {hasActions ? (
        <div className="order-2 ml-auto flex shrink-0 items-center gap-2 lg:order-3">
          {actions}
          {showViewOptions ? <DataTableViewOptions table={table} /> : null}
        </div>
      ) : null}
    </div>
  )
}
