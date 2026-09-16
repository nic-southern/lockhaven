"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import {
  ActivityIcon,
  AlertTriangleIcon,
  ArrowRightIcon,
  BellRingIcon,
  WifiIcon,
  WifiOffIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { kindLabel } from "@/components/alerts/alerts-table"
import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { EmptyState } from "@/components/dashboard/empty-state"
import { EnrollDeviceCard } from "@/components/dashboard/enroll-device-card"
import { PageHeader } from "@/components/dashboard/page-header"
import { SectionCard } from "@/components/dashboard/section-card"
import { SeverityBadge } from "@/components/dashboard/severity-badge"
import { StatusIndicator } from "@/components/dashboard/status-indicator"
import { ConnectivityBadge } from "@/components/devices/connectivity-badge"
import {
  DEVICES_DEFAULT_VIEW,
  DevicesTable,
} from "@/components/devices/devices-table"
import { formatDate, formatRelativeTime, statusLabel } from "@/lib/dashboard"
import type { TableViewState } from "@/lib/table-view-state"
import { getApiBaseUrl, trpc } from "@/lib/trpc"
import { usePermissions } from "@/lib/use-permissions"
import { cn } from "@/lib/utils"

type HealthResponse = {
  ok: boolean
  postgres: "ok" | "degraded"
  redis: "ok" | "degraded"
}

const OVERVIEW_DEVICES_VIEW: TableViewState = {
  ...DEVICES_DEFAULT_VIEW,
  columnVisibility: {
    ...DEVICES_DEFAULT_VIEW.columnVisibility,
    tags: false,
    services: false,
  },
}

export default function Page() {
  return (
    <DashboardShell>
      <React.Suspense fallback={<OverviewSkeleton />}>
        <Overview />
      </React.Suspense>
    </DashboardShell>
  )
}

function OverviewSkeleton() {
  return (
    <div className="flex w-full flex-col gap-8">
      <Skeleton className="h-10 w-72" />
      <Skeleton className="h-28 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  )
}

function Metric({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
  href,
  loading,
}: {
  label: string
  value: number | undefined
  hint?: string
  icon: React.ComponentType<{ className?: string }>
  tone?: "neutral" | "online" | "warning" | "danger" | "offline"
  href?: string
  loading: boolean
}) {
  const body = (
    <div className="flex h-full flex-col gap-2 rounded-xl border border-border/80 bg-card p-3.5 transition-colors group-hover:bg-muted/40 sm:gap-3 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-medium tracking-wide text-muted-foreground uppercase sm:text-xs">
          {label}
        </span>
        <Icon
          className={cn(
            "size-4 shrink-0",
            tone === "online" && "text-emerald-500",
            tone === "warning" && "text-amber-500",
            tone === "danger" && "text-red-500",
            tone === "offline" && "text-muted-foreground",
            tone === "neutral" && "text-muted-foreground"
          )}
        />
      </div>
      {loading ? (
        <Skeleton className="h-8 w-16" />
      ) : (
        <span className="text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">
          {value ?? 0}
        </span>
      )}
      {hint && !loading ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  )
  return href ? (
    <Link href={href} className="group block h-full">
      {body}
    </Link>
  ) : (
    body
  )
}

function Overview() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { can, uiScope, isPlatformAdmin } = usePermissions()
  const canEnroll = can("device:enroll")
  const canViewAudit = can("audit:view")

  const enrollmentOpen = searchParams.get("enroll") === "1"
  const setEnrollmentOpen = (open: boolean) => {
    const params = new URLSearchParams(searchParams.toString())
    if (open) params.set("enroll", "1")
    else params.delete("enroll")
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    })
  }

  const [devicesView, setDevicesView] = React.useState(OVERVIEW_DEVICES_VIEW)

  const summaryQuery = trpc.dashboard.summary.useQuery(undefined, {
    refetchInterval: 30_000,
  })
  const alertsQuery = trpc.alerts.summary.useQuery(undefined, {
    refetchInterval: 30_000,
  })
  const alertSummary = alertsQuery.data
  const healthQuery = useQuery<HealthResponse>({
    queryKey: ["api-health"],
    queryFn: async () => {
      const response = await fetch(`${getApiBaseUrl()}/api/health`, {
        credentials: "include",
      })
      return (await response.json()) as HealthResponse
    },
    refetchInterval: 15_000,
  })

  const summary = summaryQuery.data
  const loading = summaryQuery.isLoading
  const devices = summary?.devices

  return (
    <div className="flex w-full flex-col gap-8">
      <PageHeader
        badge="Overview"
        title="Your private network at a glance"
        description="Connectivity, attention items, and recent activity across every device you can see."
        actions={
          <>
            {canEnroll ? (
              <Button
                className="flex-1 sm:flex-none"
                onClick={() => setEnrollmentOpen(!enrollmentOpen)}
              >
                {enrollmentOpen ? "Hide enrollment" : "Add device"}
              </Button>
            ) : null}
            {uiScope === "admin" && canEnroll ? (
              <Button variant="outline" className="flex-1 sm:flex-none" asChild>
                <Link href="/enrollment-tokens">Manage tokens</Link>
              </Button>
            ) : null}
          </>
        }
      />

      {enrollmentOpen && canEnroll ? (
        <EnrollDeviceCard onClose={() => setEnrollmentOpen(false)} />
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5 [&>*:last-child]:col-span-2 lg:[&>*:last-child]:col-span-1">
        <Metric
          label="Online now"
          value={devices?.online}
          hint={devices ? `of ${devices.total} enrolled` : undefined}
          icon={WifiIcon}
          tone="online"
          href="/devices?f.connectivity=online"
          loading={loading}
        />
        <Metric
          label="Offline"
          value={devices ? devices.offline + devices.never : undefined}
          hint={
            devices
              ? devices.never > 0
                ? `${devices.never} never connected`
                : "All have connected at least once"
              : undefined
          }
          icon={WifiOffIcon}
          tone="offline"
          href="/devices?f.connectivity=offline%2Cnever"
          loading={loading}
        />
        <Metric
          label="Needs attention"
          value={devices?.needsAttention}
          hint={
            devices
              ? devices.needsAttention === 0
                ? "Everything is reachable"
                : "Unreachable or a service is down"
              : undefined
          }
          icon={AlertTriangleIcon}
          tone={devices && devices.needsAttention > 0 ? "warning" : "neutral"}
          loading={loading}
        />
        <Metric
          label="Open alerts"
          value={alertSummary?.open}
          hint={
            alertSummary
              ? alertSummary.critical > 0
                ? `${alertSummary.critical} critical`
                : alertSummary.acknowledged > 0
                  ? `${alertSummary.acknowledged} acknowledged`
                  : "Nothing waiting on you"
              : undefined
          }
          icon={BellRingIcon}
          tone={
            alertSummary && alertSummary.critical > 0
              ? "danger"
              : alertSummary && alertSummary.open > 0
                ? "warning"
                : "neutral"
          }
          href="/alerts"
          loading={alertsQuery.isLoading}
        />
        <Metric
          label="Sessions · 24h"
          value={summary?.sessions.last24h}
          hint={
            summary
              ? summary.sessions.active > 0
                ? `${summary.sessions.active} still open`
                : "None open right now"
              : undefined
          }
          icon={ActivityIcon}
          href="/connections"
          loading={loading}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="Needs attention"
          description="Open alerts, then devices that are unreachable or have a service down."
          contentClassName="p-0"
          actions={
            <Button variant="ghost" size="sm" asChild>
              <Link
                href={
                  alertSummary && alertSummary.open > 0
                    ? "/alerts"
                    : "/devices?f.connectivity=offline%2Cnever"
                }
              >
                View all
                <ArrowRightIcon />
              </Link>
            </Button>
          }
        >
          {loading || alertsQuery.isLoading ? (
            <div className="flex flex-col gap-3 p-6">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          ) : (!summary || summary.attention.length === 0) &&
            (!alertSummary || alertSummary.items.length === 0) ? (
            <div className="p-6">
              <EmptyState
                title="All clear"
                description="No open alerts, and every enrolled device is reachable."
                bordered={false}
              />
            </div>
          ) : (
            <ul className="divide-y">
              {alertSummary?.items.map((alert) => (
                <li key={alert.id}>
                  <Link
                    href={
                      alert.deviceId
                        ? `/devices/${alert.deviceId}?tab=network`
                        : `/alerts?f.kind=${encodeURIComponent(alert.kind)}`
                    }
                    className="flex items-center justify-between gap-3 px-6 py-3 text-sm transition-colors hover:bg-muted/40"
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <SeverityBadge severity={alert.severity} compact />
                        <span className="line-clamp-2 font-medium sm:line-clamp-1">
                          {alert.title}
                        </span>
                      </div>
                      <span className="truncate text-xs text-muted-foreground">
                        {kindLabel(alert.kind)}
                        {alert.deviceName ? ` · ${alert.deviceName}` : ""}
                        {alert.siteName ? ` · ${alert.siteName}` : ""}
                        {alert.occurrences > 1
                          ? ` · ${alert.occurrences} times`
                          : ""}
                      </span>
                    </div>
                    <span
                      className="shrink-0 text-xs text-muted-foreground"
                      title={formatDate(alert.lastSeenAt)}
                    >
                      {formatRelativeTime(alert.lastSeenAt)}
                    </span>
                  </Link>
                </li>
              ))}
              {summary?.attention.map((device) => (
                <li key={device.id}>
                  <Link
                    href={`/devices/${device.id}`}
                    className="flex items-center justify-between gap-3 px-6 py-3 text-sm transition-colors hover:bg-muted/40"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">
                        {device.displayName}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {device.siteName ?? "No site"}
                        {device.offlineServices > 0
                          ? ` · ${device.offlineServices} ${device.offlineServices === 1 ? "service" : "services"} down`
                          : ""}
                      </span>
                    </div>
                    <ConnectivityBadge
                      connectivity={device.connectivity}
                      lastHandshakeAt={device.lastHandshakeAt}
                      className="items-end text-right"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Recent activity"
          description="Latest recorded changes across your devices and access."
          contentClassName="p-0"
          actions={
            canViewAudit ? (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/activity">
                  Activity log
                  <ArrowRightIcon />
                </Link>
              </Button>
            ) : null
          }
        >
          {loading ? (
            <div className="flex flex-col gap-3 p-6">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          ) : !summary || summary.activity.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No activity yet"
                description="Changes will show up here as they happen."
                bordered={false}
              />
            </div>
          ) : (
            <ul className="divide-y">
              {summary.activity.map((event) => (
                <li
                  key={event.id}
                  className="flex items-center justify-between gap-3 px-6 py-3 text-sm"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <Badge
                        variant="outline"
                        className="shrink-0 whitespace-nowrap"
                      >
                        {statusLabel(event.eventType)}
                      </Badge>
                      {event.deviceId ? (
                        <Link
                          href={`/devices/${event.deviceId}?tab=activity`}
                          className="truncate hover:underline"
                        >
                          {event.deviceName ?? "Device"}
                        </Link>
                      ) : null}
                    </div>
                    <span className="truncate text-xs text-muted-foreground">
                      {event.actorName ?? event.actorEmail ?? "System"}
                    </span>
                  </div>
                  <span
                    className="shrink-0 text-xs text-muted-foreground"
                    title={formatDate(event.createdAt)}
                  >
                    {formatRelativeTime(event.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold tracking-tight">Devices</h2>
            <p className="text-sm text-muted-foreground">
              Most recently seen first. Open the full list to filter, tag, and
              act in bulk.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/devices">
              All devices
              <ArrowRightIcon />
            </Link>
          </Button>
        </div>
        <DevicesTable
          variant="compact"
          pageSize={10}
          view={devicesView}
          onViewChange={(patch) =>
            setDevicesView((current) => ({ ...current, ...patch }))
          }
        />
      </section>

      <footer className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t pt-4 text-xs text-muted-foreground">
        <span className="font-medium">Control plane</span>
        <StatusIndicator
          tone={
            healthQuery.isLoading
              ? "neutral"
              : healthQuery.data?.postgres === "ok"
                ? "online"
                : "danger"
          }
          label={`Directory ${healthQuery.isLoading ? "checking" : statusLabel(healthQuery.data?.postgres ?? "down")}`}
          className="text-xs"
        />
        <StatusIndicator
          tone={
            healthQuery.isLoading
              ? "neutral"
              : healthQuery.data?.ok
                ? "online"
                : "danger"
          }
          label={`Background jobs ${
            healthQuery.isLoading
              ? "checking"
              : healthQuery.data?.ok
                ? "healthy"
                : "behind"
          }`}
          className="text-xs"
        />
        {summary ? (
          <span className="ml-auto">
            {summary.organizations}{" "}
            {summary.organizations === 1 ? "organization" : "organizations"} ·{" "}
            {summary.sites} {summary.sites === 1 ? "site" : "sites"} · updated{" "}
            {formatRelativeTime(summary.generatedAt)}
          </span>
        ) : null}
        {isPlatformAdmin ? (
          <Link
            href="/system"
            className="underline-offset-2 hover:text-foreground hover:underline"
          >
            System
          </Link>
        ) : null}
      </footer>
    </div>
  )
}
