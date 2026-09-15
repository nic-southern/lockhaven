"use client"

import type { RoutePolicyColor, RoutePolicyEntry } from "@nms/shared"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export const policyColorDot: Record<RoutePolicyColor, string> = {
  slate: "bg-slate-400",
  blue: "bg-blue-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  violet: "bg-violet-500",
  rose: "bg-rose-500",
  cyan: "bg-cyan-500",
  orange: "bg-orange-500",
}

export const policyColorLabel: Record<RoutePolicyColor, string> = {
  slate: "Gray",
  blue: "Blue",
  emerald: "Green",
  amber: "Amber",
  violet: "Violet",
  rose: "Rose",
  cyan: "Cyan",
  orange: "Orange",
}

export function PolicyDot({
  color,
  className,
}: {
  color: RoutePolicyColor | null | undefined
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        color ? policyColorDot[color] : "bg-muted-foreground/40",
        className
      )}
    />
  )
}

/** Compact name badge with the policy's color, used across tables. */
export function PolicyBadge({
  name,
  color,
  isDefault,
  className,
}: {
  name: string
  color?: RoutePolicyColor | null
  isDefault?: boolean
  className?: string
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <PolicyDot color={color} />
      <span className="truncate font-medium">{name}</span>
      {isDefault ? (
        <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
          Default
        </Badge>
      ) : null}
    </span>
  )
}

export function RouteChip({
  entry,
  tone = "outline",
  className,
}: {
  entry: RoutePolicyEntry | string
  tone?: "outline" | "secondary" | "destructive"
  className?: string
}) {
  const cidr = typeof entry === "string" ? entry : entry.cidr
  const label = typeof entry === "string" ? null : entry.label
  return (
    <Badge
      variant={tone}
      className={cn("gap-1.5 font-mono text-[11px]", className)}
      title={label ? `${cidr} — ${label}` : cidr}
    >
      {cidr}
      {label ? (
        <span className="font-sans font-normal text-muted-foreground">
          {label}
        </span>
      ) : null}
    </Badge>
  )
}

export function RouteChipList({
  entries,
  max = 4,
  className,
}: {
  entries: Array<RoutePolicyEntry | string>
  max?: number
  className?: string
}) {
  if (entries.length === 0) {
    return <span className="text-sm text-muted-foreground">—</span>
  }
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {entries.slice(0, max).map((entry) => (
        <RouteChip
          key={typeof entry === "string" ? entry : entry.cidr}
          entry={entry}
        />
      ))}
      {entries.length > max ? (
        <Badge variant="secondary" className="text-[11px]">
          +{entries.length - max} more
        </Badge>
      ) : null}
    </div>
  )
}
