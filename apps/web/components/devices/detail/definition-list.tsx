import * as React from "react"

import { cn } from "@/lib/utils"

export type DefinitionItem = {
  label: string
  value: React.ReactNode
  /** Render the value in a monospace face (ids, addresses, versions). */
  mono?: boolean
}

export function DefinitionList({
  items,
  columns = 2,
  className,
}: {
  items: DefinitionItem[]
  columns?: 1 | 2 | 3
  className?: string
}) {
  return (
    <dl
      className={cn(
        "grid gap-x-6 gap-y-4",
        columns === 1 && "grid-cols-1",
        columns === 2 && "grid-cols-1 sm:grid-cols-2",
        columns === 3 && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
        className
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-col gap-1">
          <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {item.label}
          </dt>
          <dd
            className={cn(
              "min-w-0 text-sm break-words",
              item.mono && "font-mono text-xs"
            )}
          >
            {item.value ?? <span className="text-muted-foreground">—</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}
