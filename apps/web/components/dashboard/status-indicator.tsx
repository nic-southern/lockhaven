import { cn } from "@/lib/utils"
import type { StatusTone } from "@/lib/dashboard"

export type { StatusTone }

const toneClass: Record<StatusTone, string> = {
  online: "bg-emerald-500",
  warning: "bg-amber-500",
  offline: "bg-muted-foreground/45",
  neutral: "bg-muted-foreground/35",
  danger: "bg-destructive",
}

export function StatusIndicator({
  tone = "neutral",
  label,
  pulse = false,
  className,
}: {
  tone?: StatusTone
  label: string
  pulse?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-2 text-sm text-foreground",
        className
      )}
    >
      <span className="relative flex size-2 shrink-0" aria-hidden>
        {pulse ? (
          <span
            className={cn(
              "absolute inline-flex size-full animate-ping rounded-full opacity-55",
              toneClass[tone]
            )}
          />
        ) : null}
        <span
          className={cn(
            "relative inline-flex size-2 rounded-full",
            toneClass[tone]
          )}
        />
      </span>
      <span className="truncate">{label}</span>
    </span>
  )
}
