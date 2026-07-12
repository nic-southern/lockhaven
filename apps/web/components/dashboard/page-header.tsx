import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export function PageHeader({
  badge,
  title,
  description,
  actions,
  className,
}: {
  badge?: string
  title: string
  description?: string
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        className
      )}
    >
      <div className="flex min-w-0 flex-col gap-2">
        {badge ? (
          <Badge variant="outline" className="w-fit">
            {badge}
          </Badge>
        ) : null}
        <h1 className="text-3xl font-semibold tracking-tight text-balance">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-sm text-pretty text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </section>
  )
}
