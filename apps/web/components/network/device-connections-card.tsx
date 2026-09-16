"use client"

import * as React from "react"

import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { SectionCard } from "@/components/dashboard/section-card"
import { ConnectionLogTable } from "@/components/network/connection-log-table"
import { formatBytes } from "@/lib/dashboard"
import { trpc } from "@/lib/trpc"
import { cn } from "@/lib/utils"

const dayOptions = [
  { value: 7, label: "7d" },
  { value: 14, label: "14d" },
  { value: 30, label: "30d" },
] as const

type DayOption = (typeof dayOptions)[number]["value"]

const dayFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
})

const numberFormatter = new Intl.NumberFormat()

/**
 * Per-device connection history: a daily accepted/dropped bar series with
 * totals for the window, followed by the aggregated destination log.
 */
export function DeviceConnectionsCard({ deviceId }: { deviceId: string }) {
  const [days, setDays] = React.useState<DayOption>(14)
  const summaryQuery = trpc.network.deviceSummary.useQuery(
    { deviceId, days },
    { staleTime: 30_000, refetchInterval: 60_000 }
  )
  const summary = summaryQuery.data
  const loading = summaryQuery.isLoading

  const rangeValue = days === 7 ? "7d" : "30d"

  return (
    <SectionCard
      title="Connections"
      description="Where this device has been reaching through the tunnel, and what was blocked."
      contentClassName="p-0"
      actions={
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={String(days)}
          onValueChange={(value) => {
            if (value) setDays(Number(value) as DayOption)
          }}
          aria-label="Time window"
        >
          {dayOptions.map((option) => (
            <ToggleGroupItem
              key={option.value}
              value={String(option.value)}
              className="px-2.5 text-xs"
            >
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      }
    >
      <div className="grid gap-6 border-b px-6 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        {loading || !summary ? (
          <>
            <div className="grid grid-cols-2 gap-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex flex-col gap-1.5">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-6 w-12" />
                </div>
              ))}
            </div>
            <Skeleton className="h-24 w-full" />
          </>
        ) : summary === null ? (
          <p className="text-sm text-muted-foreground lg:col-span-2">
            Connection history isn&apos;t available for this device.
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-4">
              <Stat
                label="Allowed"
                value={numberFormatter.format(summary.totals.accepted)}
                hint="new connections"
              />
              <Stat
                label="Blocked"
                value={numberFormatter.format(summary.totals.dropped)}
                hint={
                  summary.totals.hubDropped > 0
                    ? `${numberFormatter.format(summary.totals.hubDropped)} aimed at the hub`
                    : "none aimed at the hub"
                }
                tone={summary.totals.dropped > 0 ? "warning" : "neutral"}
              />
              <Stat
                label="Transferred"
                value={formatBytes(summary.totals.bytes)}
                hint="in the first packets"
              />
              <Stat
                label="Destinations"
                value={numberFormatter.format(summary.totals.destinations)}
                hint="distinct address and port pairs"
              />
            </dl>
            <ConnectionSparkline series={summary.series} />
          </>
        )}
      </div>

      <div className="px-6 pt-4 pb-2">
        <p className="text-sm font-medium">Destinations</p>
        <p className="text-xs text-muted-foreground">
          Grouped by address and port. Sort by count to see the busiest targets.
        </p>
      </div>
      <ConnectionLogTable
        key={rangeValue}
        variant="device"
        fixedFilters={{ deviceId: [deviceId] }}
        pageSize={10}
        defaultRange={rangeValue}
      />
    </SectionCard>
  )
}

function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string
  value: string
  hint?: string
  tone?: "neutral" | "warning"
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "text-xl font-semibold tracking-tight tabular-nums",
          tone === "warning" && "text-amber-600 dark:text-amber-400"
        )}
      >
        {value}
      </dd>
      {hint ? <dd className="text-xs text-muted-foreground">{hint}</dd> : null}
    </div>
  )
}

type SeriesPoint = {
  day: string | Date
  accepted: number
  dropped: number
  bytes: number
}

/**
 * Stacked daily bars: allowed connections on the bottom, blocked on top.
 * Rendered as plain SVG so it stays lightweight inside a tab.
 */
function ConnectionSparkline({ series }: { series: SeriesPoint[] }) {
  const max = Math.max(
    1,
    ...series.map((point) => point.accepted + point.dropped)
  )
  const height = 96
  const gap = 0.3
  const total = series.reduce(
    (sum, point) => sum + point.accepted + point.dropped,
    0
  )

  if (total === 0) {
    return (
      <div className="flex h-24 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        No connections recorded in this window.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${series.length} ${height}`}
        preserveAspectRatio="none"
        className="h-24 w-full overflow-visible"
        role="img"
        aria-label="Daily connections, allowed and blocked"
      >
        {series.map((point, index) => {
          const acceptedHeight = (point.accepted / max) * height
          const droppedHeight = (point.dropped / max) * height
          const x = index + gap / 2
          const width = 1 - gap
          const label = `${dayFormatter.format(new Date(point.day))}: ${numberFormatter.format(point.accepted)} allowed, ${numberFormatter.format(point.dropped)} blocked`
          return (
            <Tooltip key={String(point.day)}>
              <TooltipTrigger asChild>
                <g className="cursor-default">
                  <rect
                    x={x}
                    y={0}
                    width={width}
                    height={height}
                    className="fill-transparent hover:fill-muted/60"
                  />
                  <rect
                    x={x}
                    y={height - acceptedHeight}
                    width={width}
                    height={acceptedHeight}
                    className="fill-primary/70"
                  />
                  <rect
                    x={x}
                    y={height - acceptedHeight - droppedHeight}
                    width={width}
                    height={droppedHeight}
                    className="fill-amber-500/80"
                  />
                </g>
              </TooltipTrigger>
              <TooltipContent side="top">{label}</TooltipContent>
            </Tooltip>
          )
        })}
      </svg>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{dayFormatter.format(new Date(series[0]!.day))}</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-sm bg-primary/70" />
            Allowed
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-sm bg-amber-500/80" />
            Blocked
          </span>
        </span>
        <span>
          {dayFormatter.format(new Date(series[series.length - 1]!.day))}
        </span>
      </div>
    </div>
  )
}
