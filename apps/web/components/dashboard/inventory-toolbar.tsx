import { SearchIcon } from "lucide-react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export function InventoryToolbar({
  search,
  onSearchChange,
  searchPlaceholder = "Search",
  countLabel,
  actions,
  className,
}: {
  search: string
  onSearchChange: (value: string) => void
  searchPlaceholder?: string
  countLabel?: string
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        className
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            className="h-10 bg-card/80 pl-9"
            aria-label={searchPlaceholder}
          />
        </div>
        {countLabel ? (
          <span className="w-fit rounded-md border border-border/80 bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground tabular-nums">
            {countLabel}
          </span>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  )
}
