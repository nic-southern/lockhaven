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
        "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6",
        className
      )}
    >
      <div className="flex min-w-0 flex-col gap-2">
        {badge ? (
          <p className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
            {badge}
          </p>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-[1.75rem]">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-sm leading-relaxed text-pretty text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          {actions}
        </div>
      ) : null}
    </section>
  )
}
