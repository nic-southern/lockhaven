"use client"

import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { EmptyState } from "@/components/dashboard/empty-state"
import { SectionCard } from "@/components/dashboard/section-card"
import { formatBytes, formatDate, formatRelativeTime } from "@/lib/dashboard"
import { trpc } from "@/lib/trpc"

import { DefinitionList } from "./definition-list"
import type { DeviceDetail } from "./shared"

function usagePercent(
  used: number | null | undefined,
  total: number | null | undefined
) {
  if (!total || total <= 0 || used == null) return null
  return Math.min(100, Math.max(0, (used / total) * 100))
}

function formatPercent(value: number | null) {
  if (value == null) return "—"
  return `${Math.round(value)}%`
}

function formatLoad(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—"
  return value.toFixed(2)
}

function formatDuration(seconds: number | null | undefined) {
  if (seconds == null) return "—"
  const hours = Math.floor(seconds / 3600)
  const days = Math.floor(hours / 24)
  if (days > 0) {
    const rest = hours % 24
    return rest > 0 ? `${days}d ${rest}h` : `${days}d`
  }
  if (hours > 0) {
    const minutes = Math.floor((seconds % 3600) / 60)
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  }
  const minutes = Math.floor(seconds / 60)
  return minutes > 0 ? `${minutes}m` : `${seconds}s`
}

type DiskRow = {
  mount?: string
  filesystem?: string
  total_bytes?: number
  used_bytes?: number
  available_bytes?: number
}

type NetworkRow = {
  name?: string
  rx_bytes?: number
  tx_bytes?: number
}

export function MetricsTab({ device }: { device: DeviceDetail }) {
  const latestQuery = trpc.telemetry.metricsLatest.useQuery(
    { deviceId: device.id },
    { refetchInterval: 30_000 }
  )
  const samplesQuery = trpc.telemetry.metricsSamples.useQuery(
    { deviceId: device.id, limit: 12 },
    { refetchInterval: 30_000 }
  )

  const latest = latestQuery.data
  const samples = samplesQuery.data ?? []
  const disks = (latest?.disks ?? []) as DiskRow[]
  const network = (latest?.network ?? []) as NetworkRow[]
  const memoryPercent = usagePercent(
    latest?.memoryUsedBytes,
    latest?.memoryTotalBytes
  )

  if (latestQuery.isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    )
  }

  if (!latest) {
    return (
      <EmptyState
        title="No health data yet"
        description="This device hasn't reported memory, disk, or load yet."
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard
          title="Overview"
          description="Latest health snapshot from this device."
          className="lg:col-span-2"
        >
          <DefinitionList
            columns={3}
            items={[
              {
                label: "Reported",
                value: (
                  <span title={formatDate(latest.collectedAt)}>
                    {formatRelativeTime(latest.collectedAt)}
                  </span>
                ),
              },
              {
                label: "Uptime",
                value: formatDuration(latest.uptimeSeconds),
              },
              {
                label: "CPU cores",
                value: latest.cpuCores,
              },
              {
                label: "Load (1 / 5 / 15)",
                value: `${formatLoad(latest.cpuLoad1)} · ${formatLoad(latest.cpuLoad5)} · ${formatLoad(latest.cpuLoad15)}`,
                mono: true,
              },
              {
                label: "Tunnel handshake age",
                value:
                  latest.wgHandshakeAgeSeconds == null
                    ? "—"
                    : formatDuration(latest.wgHandshakeAgeSeconds),
              },
              {
                label: "Restart pending",
                value: latest.rebootRequired ? (
                  <Badge variant="destructive">Yes</Badge>
                ) : (
                  "No"
                ),
              },
            ]}
          />
        </SectionCard>

        <SectionCard title="Memory" description="Used versus total memory.">
          <div className="flex flex-col gap-3">
            <Progress value={memoryPercent ?? 0} />
            <p className="text-sm">
              {formatBytes(latest.memoryUsedBytes)} of{" "}
              {formatBytes(latest.memoryTotalBytes)}{" "}
              <span className="text-muted-foreground">
                ({formatPercent(memoryPercent)})
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              {formatBytes(latest.memoryAvailableBytes)} available
            </p>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Disks"
        description="Space used on each reported mount."
        contentClassName="p-0"
      >
        {disks.length === 0 ? (
          <div className="p-6">
            <p className="text-sm text-muted-foreground">No disks reported.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mount</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Used</TableHead>
                <TableHead>Total</TableHead>
                <TableHead className="w-40">Usage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {disks.map((disk) => {
                const percent = usagePercent(disk.used_bytes, disk.total_bytes)
                return (
                  <TableRow key={disk.mount ?? "disk"}>
                    <TableCell className="font-mono text-xs">
                      {disk.mount ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {disk.filesystem ?? "—"}
                    </TableCell>
                    <TableCell>{formatBytes(disk.used_bytes)}</TableCell>
                    <TableCell>{formatBytes(disk.total_bytes)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Progress value={percent ?? 0} className="min-w-16" />
                        <span className="text-xs text-muted-foreground">
                          {formatPercent(percent)}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      <SectionCard
        title="Network"
        description="Traffic counters reported by this device."
        contentClassName="p-0"
      >
        {network.length === 0 ? (
          <div className="p-6">
            <p className="text-sm text-muted-foreground">
              No network interfaces reported.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Interface</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Sent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {network.map((iface) => (
                <TableRow key={iface.name ?? "iface"}>
                  <TableCell className="font-mono text-xs">
                    {iface.name ?? "—"}
                  </TableCell>
                  <TableCell>{formatBytes(iface.rx_bytes)}</TableCell>
                  <TableCell>{formatBytes(iface.tx_bytes)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      <SectionCard
        title="Recent samples"
        description="Stored snapshots from recent check-ins."
        contentClassName="p-0"
      >
        {samplesQuery.isLoading ? (
          <div className="flex flex-col gap-3 p-6">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : samples.length === 0 ? (
          <div className="p-6">
            <p className="text-sm text-muted-foreground">
              No samples stored yet.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Load 1</TableHead>
                <TableHead>Memory</TableHead>
                <TableHead>Uptime</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {samples.map((sample) => (
                <TableRow key={sample.id}>
                  <TableCell title={formatDate(sample.sampledAt)}>
                    {formatRelativeTime(sample.sampledAt)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {formatLoad(sample.cpuLoad1)}
                  </TableCell>
                  <TableCell>
                    {formatBytes(sample.memoryUsedBytes)} /{" "}
                    {formatBytes(sample.memoryTotalBytes)}
                  </TableCell>
                  <TableCell>{formatDuration(sample.uptimeSeconds)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </div>
  )
}
