import type { AuditSeverity } from "@nms/shared"

import { cn } from "@/lib/utils"

export const severityLabels: Record<AuditSeverity, string> = {
  info: "Info",
  notice: "Notice",
  warning: "Warning",
  critical: "Critical",
}

/** Display order from most to least urgent. */
export const severityOrder: AuditSeverity[] = [
  "critical",
  "warning",
  "notice",
  "info",
]

const severityClasses: Record<AuditSeverity, string> = {
  info: "border-border bg-background text-muted-foreground",
  notice: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  warning:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  critical: "border-destructive/30 bg-destructive/10 text-destructive",
}

const severityDotClasses: Record<AuditSeverity, string> = {
  info: "bg-muted-foreground/60",
  notice: "bg-sky-500",
  warning: "bg-amber-500",
  critical: "bg-destructive",
}

export function SeverityBadge({
  severity,
  className,
  compact = false,
}: {
  severity: AuditSeverity | string | null | undefined
  className?: string
  /** Dot only, for dense rows. */
  compact?: boolean
}) {
  const key = (
    severity && severity in severityLabels ? severity : "info"
  ) as AuditSeverity

  if (compact) {
    return (
      <span
        className={cn(
          "inline-block size-2 rounded-full",
          severityDotClasses[key],
          className
        )}
        role="img"
        aria-label={severityLabels[key]}
        title={severityLabels[key]}
      />
    )
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        severityClasses[key],
        className
      )}
    >
      <span
        className={cn("size-1.5 rounded-full", severityDotClasses[key])}
        aria-hidden
      />
      {severityLabels[key]}
    </span>
  )
}
