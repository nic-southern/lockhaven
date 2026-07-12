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
        "flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4",
        className
      )}
    >
      <div className="flex min-w-0 flex-col gap-1.5 sm:gap-2">
        {badge ? (
          <Badge variant="outline" className="w-fit">
            {badge}
          </Badge>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-sm text-pretty text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto">
          {actions}
        </div>
      ) : null}
    </section>
  )
}
