"use client"

import type { Column } from "@tanstack/react-table"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronsUpDownIcon,
  EyeOffIcon,
  XIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
  align = "left",
}: {
  column: Column<TData, TValue>
  title: string
  className?: string
  align?: "left" | "right"
}) {
  if (!column.getCanSort() && !column.getCanHide()) {
    return (
      <div className={cn(align === "right" && "text-right", className)}>
        {title}
      </div>
    )
  }

  const sorted = column.getIsSorted()

  return (
    <div
      className={cn(
        "flex items-center",
        align === "right" && "justify-end",
        className
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 h-8 gap-1 px-2 text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
            aria-label={`Column options for ${title}`}
          >
            <span>{title}</span>
            {sorted === "desc" ? (
              <ArrowDownIcon className="size-3.5" />
            ) : sorted === "asc" ? (
              <ArrowUpIcon className="size-3.5" />
            ) : column.getCanSort() ? (
              <ChevronsUpDownIcon className="size-3.5 opacity-60" />
            ) : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align === "right" ? "end" : "start"}>
          {column.getCanSort() ? (
            <>
              <DropdownMenuItem onClick={() => column.toggleSorting(false)}>
                <ArrowUpIcon className="text-muted-foreground" />
                Sort ascending
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => column.toggleSorting(true)}>
                <ArrowDownIcon className="text-muted-foreground" />
                Sort descending
              </DropdownMenuItem>
              {sorted ? (
                <DropdownMenuItem onClick={() => column.clearSorting()}>
                  <XIcon className="text-muted-foreground" />
                  Clear sort
                </DropdownMenuItem>
              ) : null}
            </>
          ) : null}
          {column.getCanSort() && column.getCanHide() ? (
            <DropdownMenuSeparator />
          ) : null}
          {column.getCanHide() ? (
            <DropdownMenuItem onClick={() => column.toggleVisibility(false)}>
              <EyeOffIcon className="text-muted-foreground" />
              Hide column
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
