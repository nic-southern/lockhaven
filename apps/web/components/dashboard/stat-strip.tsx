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
    <div className={cn("grid gap-3 sm:grid-cols-2 xl:grid-cols-4", className)}>
      {items.map((item, index) => (
        <div
          key={item.label}
          className="animate-fade-up rounded-xl border border-border/80 bg-card/80 px-4 py-4"
          style={{ animationDelay: `${index * 40}ms` }}
        >
          <p className="text-xs font-medium tracking-[0.06em] text-muted-foreground uppercase">
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
        "grid gap-3 rounded-xl border border-border/80 bg-muted/20 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4",
        className
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-1">
          <p className="text-muted-foreground">{item.label}</p>
          <p className="font-medium">{item.value}</p>
        </div>
      ))}
    </div>
  )
}
