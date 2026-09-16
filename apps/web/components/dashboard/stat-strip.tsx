import { cn } from "@/lib/utils"

export function StatStrip({
  items,
  className,
}: {
  items: Array<{
    label: string
    value: React.ReactNode
    hint?: string
  }>
  className?: string
}) {
  return (
    <div className={cn("grid grid-cols-2 gap-3 xl:grid-cols-4", className)}>
      {items.map((item, index) => (
        <div
          key={item.label}
          className="min-w-0 animate-fade-up rounded-xl border border-border/80 bg-card/80 px-3.5 py-3.5 sm:px-4 sm:py-4"
          style={{ animationDelay: `${index * 40}ms` }}
        >
          <p className="truncate text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase sm:text-xs">
            {item.label}
          </p>
          <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
            {item.value}
          </div>
          {item.hint ? (
            <p className="mt-1 text-xs text-muted-foreground">{item.hint}</p>
          ) : null}
        </div>
      ))}
    </div>
  )
}

export function VpnStatusStrip({
  items,
  className,
}: {
  items: Array<{
    label: string
    value: React.ReactNode
  }>
  className?: string
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-3 rounded-xl border border-border/80 bg-muted/20 p-4 text-sm lg:grid-cols-4",
        className
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-col gap-1">
          <p className="text-muted-foreground">{item.label}</p>
          <p className="font-medium break-words">{item.value}</p>
        </div>
      ))}
    </div>
  )
}
