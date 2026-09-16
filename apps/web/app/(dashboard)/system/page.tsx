"use client"

import * as React from "react"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { AccessDenied } from "@/components/dashboard/access-denied"
import { PageHeader } from "@/components/dashboard/page-header"
import { SectionCard } from "@/components/dashboard/section-card"
import { StatStrip } from "@/components/dashboard/stat-strip"
import { StatusIndicator } from "@/components/dashboard/status-indicator"
import {
  formatBytes,
  formatDate,
  formatRelativeTime,
  statusLabel,
} from "@/lib/dashboard"
import { trpc } from "@/lib/trpc"
import { usePermissions } from "@/lib/use-permissions"
import { cn } from "@/lib/utils"

const jobLabels: Record<string, string> = {
  "reconcile-vpn": "Tunnel peers",
  "refresh-services": "Service checks",
  "refresh-sessions": "Session refresh",
  "flow-ingest": "Connection log",
  notify: "Notifications",
  "rollup-connections": "Connection summaries",
  "prune-history": "History retention",
}

function formatAge(ms: number | null | undefined) {
  if (ms == null) return "—"
  if (ms < 1_000) return "just now"
  if (ms < 60_000) return `${Math.round(ms / 1_000)}s`
  if (ms < 60 * 60 * 1000) return `${Math.round(ms / 60_000)}m`
  const hours = Math.round(ms / 3_600_000)
  return `${hours}h`
}

function imageLabel(value: string | null) {
  if (!value) return "—"
  const parts = value.split("/")
  return parts[parts.length - 1] ?? value
}

export default function SystemPage() {
  const { isPlatformAdmin, isLoading: accessLoading } = usePermissions()
  const statusQuery = trpc.system.status.useQuery(undefined, {
    enabled: isPlatformAdmin,
    refetchInterval: 15_000,
  })

  if (!accessLoading && !isPlatformAdmin) {
    return (
      <AccessDenied description="System status is limited to platform administrators." />
    )
  }

  const data = statusQuery.data
  const health = data?.health
  const loading = accessLoading || statusQuery.isLoading
  const jobsBehind = Boolean(
    health &&
    (health.staleJobNames.length > 0 ||
      health.queue.lying ||
      health.redis !== "ok")
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="System"
        title="Hub health"
        description="Background jobs, waiting work, and how much history we are keeping."
      />

      {loading ? (
        <>
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </>
      ) : health ? (
        <>
          {!health.ok ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
              Background work is behind. A job has been silent for more than
              five minutes, or waiting work is overdue.
            </div>
          ) : null}

          <StatStrip
            className="xl:grid-cols-4"
            items={[
              {
                label: "Hub",
                value: (
                  <StatusIndicator
                    tone={health.ok ? "online" : "danger"}
                    label={health.ok ? "Healthy" : "Needs attention"}
                  />
                ),
              },
              {
                label: "Directory",
                value: statusLabel(health.postgres),
              },
              {
                label: "Background jobs",
                value: (
                  <StatusIndicator
                    tone={jobsBehind ? "danger" : "online"}
                    label={jobsBehind ? "Behind" : "Healthy"}
                  />
                ),
              },
              {
                label: "Waiting",
                value: health.queue.waiting,
                hint:
                  health.queue.oldestWaitingAgeMs != null
                    ? `Oldest ${formatAge(health.queue.oldestWaitingAgeMs)}`
                    : "None waiting",
              },
            ]}
          />

          <SectionCard
            title="Jobs"
            description="Each scheduled task and how recently it finished."
            contentClassName="overflow-x-auto"
          >
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead>
                <tr className="border-b text-xs tracking-wide text-muted-foreground uppercase">
                  <th className="py-2 pr-3 font-medium">Job</th>
                  <th className="py-2 pr-3 font-medium">State</th>
                  <th className="py-2 pr-3 font-medium">Last finished</th>
                  <th className="py-2 pr-3 font-medium">Runtime</th>
                  <th className="py-2 font-medium">Age</th>
                </tr>
              </thead>
              <tbody>
                {health.jobs.map((job) => (
                  <tr key={job.name} className="border-b last:border-0">
                    <td className="py-2.5 pr-3">
                      <div className="flex flex-col">
                        <span className="font-medium">
                          {jobLabels[job.name] ?? statusLabel(job.name)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {job.name}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3">
                      {job.stale ? (
                        <Badge variant="destructive">Behind</Badge>
                      ) : (
                        <Badge variant="secondary">On time</Badge>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex flex-col">
                        <span>{formatRelativeTime(job.lastCompletedAt)}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(job.lastCompletedAt)}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground tabular-nums">
                      {job.durationMs == null ? "—" : `${job.durationMs}ms`}
                    </td>
                    <td
                      className={cn(
                        "py-2.5 tabular-nums",
                        job.stale && "text-destructive"
                      )}
                    >
                      {formatAge(job.ageMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SectionCard>

          <div className="grid gap-6 lg:grid-cols-2">
            <SectionCard
              title="Queue"
              description="Work waiting to run. A growing wait is how a backlog hides."
            >
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">Waiting</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums">
                    {health.queue.waiting}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">In progress</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums">
                    {health.queue.active}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Scheduled</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums">
                    {health.queue.delayed}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Oldest wait</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums">
                    {formatAge(health.queue.oldestWaitingAgeMs)}
                  </dd>
                </div>
              </dl>
            </SectionCard>

            <SectionCard
              title="Connection log"
              description="How recently the hub ingested connection records."
            >
              <p className="text-sm">
                {health.flowLog.missing
                  ? "No connection log has been seen yet."
                  : `Last write ${formatAge(health.flowLog.ageMs)} ago.`}
              </p>
            </SectionCard>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <SectionCard
              title="Versions"
              description="Images this hub is running."
            >
              <dl className="flex flex-col gap-3 text-sm">
                <div className="flex flex-col gap-0.5">
                  <dt className="text-muted-foreground">Console</dt>
                  <dd className="font-mono text-xs break-all">
                    {imageLabel(data?.images.console ?? null)}
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-muted-foreground">Worker</dt>
                  <dd className="font-mono text-xs break-all">
                    {imageLabel(data?.images.worker ?? null)}
                  </dd>
                </div>
              </dl>
            </SectionCard>

            <SectionCard
              title="Storage"
              description="How large the control plane and session gateway data are."
            >
              <dl className="flex flex-col gap-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Control plane</dt>
                  <dd className="tabular-nums">
                    {formatBytes(data?.databases.controlPlaneBytes)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Session gateway</dt>
                  <dd className="tabular-nums">
                    {formatBytes(data?.databases.sessionGatewayBytes)}
                  </dd>
                </div>
              </dl>
            </SectionCard>
          </div>

          <SectionCard
            title="Retention"
            description="How much history is stored, and the keep window for each."
            contentClassName="overflow-x-auto"
          >
            <table className="w-full min-w-[28rem] text-left text-sm">
              <thead>
                <tr className="border-b text-xs tracking-wide text-muted-foreground uppercase">
                  <th className="py-2 pr-3 font-medium">History</th>
                  <th className="py-2 pr-3 font-medium">Records</th>
                  <th className="py-2 pr-3 font-medium">Oldest</th>
                  <th className="py-2 font-medium">Keep</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["Peer samples", data?.retention.peerSamples],
                    ["Connection history", data?.retention.connectionHistory],
                    ["Daily summaries", data?.retention.dailySummaries],
                    ["Session recordings", data?.retention.sessionRecordings],
                  ] as const
                ).map(([label, row]) => (
                  <tr key={label} className="border-b last:border-0">
                    <td className="py-2.5 pr-3 font-medium">{label}</td>
                    <td className="py-2.5 pr-3 tabular-nums">
                      {row?.count ?? 0}
                    </td>
                    <td className="py-2.5 pr-3">
                      {formatRelativeTime(row?.oldestAt)}
                    </td>
                    <td className="py-2.5 text-muted-foreground tabular-nums">
                      {row?.keepDays ?? "—"} days
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SectionCard>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t load hub status.{" "}
          <Link href="/" className="underline underline-offset-2">
            Back to overview
          </Link>
        </p>
      )}
    </div>
  )
}
