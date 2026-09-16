"use client"

import * as React from "react"
import { MoreHorizontalIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export type RowAction = {
  label: string
  icon?: React.ComponentType<{ className?: string }>
  onSelect: () => void
  destructive?: boolean
  disabled?: boolean
  /** Insert a separator above this action. */
  separatorBefore?: boolean
}

export function DataTableRowActions({
  actions,
  label,
  align = "end",
}: {
  actions: RowAction[]
  label?: string
  align?: "start" | "end"
}) {
  if (actions.length === 0) {
    return null
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-8 text-muted-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
          aria-label={label ?? "Open row actions"}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className="w-44"
        onClick={(event) => event.stopPropagation()}
      >
        {label ? (
          <>
            <DropdownMenuLabel className="truncate">{label}</DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {actions.map((action, index) => (
          <React.Fragment key={`${action.label}-${index}`}>
            {action.separatorBefore ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              variant={action.destructive ? "destructive" : "default"}
              disabled={action.disabled}
              onSelect={(event) => {
                event.stopPropagation()
                action.onSelect()
              }}
            >
              {action.icon ? <action.icon /> : null}
              {action.label}
            </DropdownMenuItem>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
