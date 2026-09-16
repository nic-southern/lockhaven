"use client"

import type { DeviceConnectivity } from "@nms/shared"

import { StatusIndicator } from "@/components/dashboard/status-indicator"
import { formatRelativeTime } from "@/lib/dashboard"
import { connectivityLabel, connectivityToneMap } from "@/lib/devices"
import { cn } from "@/lib/utils"

export function ConnectivityBadge({
  connectivity,
  lastHandshakeAt,
  showDetail = true,
  className,
}: {
  connectivity: DeviceConnectivity
  lastHandshakeAt?: Date | string | null
  showDetail?: boolean
  className?: string
}) {
  const detail =
    connectivity === "online"
      ? null
      : connectivity === "offline" && lastHandshakeAt
        ? `Last seen ${formatRelativeTime(lastHandshakeAt)}`
        : null

  return (
    <div className={cn("flex min-w-0 flex-col", className)}>
      <StatusIndicator
        tone={connectivityToneMap[connectivity]}
        label={connectivityLabel[connectivity]}
        pulse={connectivity === "online"}
      />
      {showDetail && detail ? (
        <span className="pl-4 text-xs text-muted-foreground">{detail}</span>
      ) : null}
    </div>
  )
}
