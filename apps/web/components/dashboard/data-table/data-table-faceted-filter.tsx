"use client"

import * as React from "react"
import type { Column } from "@tanstack/react-table"
import { CheckIcon, PlusCircleIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

export type FacetOption = {
  label: string
  value: string
  icon?: React.ComponentType<{ className?: string }>
  count?: number
}

/**
 * Multi-select column filter. Works with the table's faceted unique values in
 * client mode; in server mode pass explicit `options` with optional counts.
 */
export function DataTableFacetedFilter<TData, TValue>({
  column,
  title,
  options,
  showCounts = true,
}: {
  column?: Column<TData, TValue>
  title: string
  options: FacetOption[]
  showCounts?: boolean
}) {
  const facets = column?.getFacetedUniqueValues()
  const rawValue = column?.getFilterValue()
  const selectedValues = React.useMemo(
    () =>
      new Set(
        Array.isArray(rawValue)
          ? (rawValue as string[])
          : typeof rawValue === "string" && rawValue
            ? [rawValue]
            : []
      ),
    [rawValue]
  )

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 border-dashed bg-card/80"
        >
          <PlusCircleIcon />
          {title}
          {selectedValues.size > 0 ? (
            <>
              <Separator orientation="vertical" className="mx-1 h-4" />
              <Badge
                variant="secondary"
                className="rounded-sm px-1 font-normal lg:hidden"
              >
                {selectedValues.size}
              </Badge>
              <div className="hidden gap-1 lg:flex">
                {selectedValues.size > 2 ? (
                  <Badge
                    variant="secondary"
                    className="rounded-sm px-1 font-normal"
                  >
                    {selectedValues.size} selected
                  </Badge>
                ) : (
                  options
                    .filter((option) => selectedValues.has(option.value))
                    .map((option) => (
                      <Badge
                        variant="secondary"
                        key={option.value}
                        className="rounded-sm px-1 font-normal"
                      >
                        {option.label}
                      </Badge>
                    ))
                )}
              </div>
            </>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder={title} />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = selectedValues.has(option.value)
                const count = option.count ?? facets?.get(option.value)

                return (
                  <CommandItem
                    key={option.value}
                    onSelect={() => {
                      const next = new Set(selectedValues)
                      if (isSelected) {
                        next.delete(option.value)
                      } else {
                        next.add(option.value)
                      }
                      const filterValues = Array.from(next)
                      column?.setFilterValue(
                        filterValues.length ? filterValues : undefined
                      )
                    }}
                  >
                    <div
                      className={cn(
                        "flex size-4 items-center justify-center rounded-[4px] border border-primary",
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : "opacity-50 [&_svg]:invisible"
                      )}
                    >
                      <CheckIcon className="size-3.5 text-current" />
                    </div>
                    {option.icon ? (
                      <option.icon className="size-4 text-muted-foreground" />
                    ) : null}
                    <span className="truncate">{option.label}</span>
                    {showCounts && typeof count === "number" ? (
                      <span className="ml-auto flex size-4 items-center justify-center font-mono text-xs text-muted-foreground tabular-nums">
                        {count}
                      </span>
                    ) : null}
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {selectedValues.size > 0 ? (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    onSelect={() => column?.setFilterValue(undefined)}
                    className="justify-center text-center"
                  >
                    Clear filters
                  </CommandItem>
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
