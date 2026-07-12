import { cn } from "@/lib/utils"

export function StatStrip({
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
        "grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 lg:grid-cols-4",
        className
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-1 bg-card px-4 py-4">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {item.label}
          </p>
          <div className="text-2xl font-semibold tracking-tight tabular-nums">
            {item.value}
          </div>
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
        "grid gap-3 rounded-xl border bg-muted/20 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4",
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
