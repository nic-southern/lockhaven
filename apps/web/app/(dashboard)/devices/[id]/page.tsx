"use client"

import * as React from "react"
import Link from "next/link"
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation"
import { ArrowLeftIcon, TicketIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CopyableText } from "@/components/dashboard/copyable-text"
import { EmptyState } from "@/components/dashboard/empty-state"
import { ConnectivityBadge } from "@/components/devices/connectivity-badge"
import { TagChips } from "@/components/devices/tag-chips"
import { ActivityTab } from "@/components/devices/detail/activity-tab"
import { AgentTab } from "@/components/devices/detail/agent-tab"
import { ConnectTab } from "@/components/devices/detail/connect-tab"
import { NetworkTab } from "@/components/devices/detail/network-tab"
import { OverviewTab } from "@/components/devices/detail/overview-tab"
import { MetricsTab } from "@/components/devices/detail/metrics-tab"
import { ServicesTab } from "@/components/devices/detail/services-tab"
import { SettingsTab } from "@/components/devices/detail/settings-tab"
import { SoftwareTab } from "@/components/devices/detail/software-tab"
import { type DeviceTab, isDeviceTab } from "@/components/devices/detail/shared"
import { OpenDeviceTicketDialog } from "@/components/tickets/open-ticket-dialog"
import { statusLabel, statusVariant, formatRelativeTime } from "@/lib/dashboard"
import { osFamilyLabel } from "@/lib/devices"
import { trpc } from "@/lib/trpc"
import { usePermissions } from "@/lib/use-permissions"

const tabLabels: Record<DeviceTab, string> = {
  overview: "Overview",
  agent: "Agent",
  connect: "Connect",
  services: "Services",
  network: "Network",
  metrics: "Health",
  software: "Software",
  activity: "Activity",
  settings: "Settings",
}

export default function DeviceDetailPage() {
  return (
    <React.Suspense fallback={<DeviceDetailSkeleton />}>
      <DeviceDetail />
    </React.Suspense>
  )
}

function DeviceDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  )
}

function DeviceDetail() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { can, isLoading: permissionsLoading } = usePermissions()
  const deviceId = params.id
  const [ticketOpen, setTicketOpen] = React.useState(false)

  const requestedTab = searchParams.get("tab")
  const tab: DeviceTab = isDeviceTab(requestedTab) ? requestedTab : "overview"

  const setTab = React.useCallback(
    (next: string) => {
      if (!isDeviceTab(next)) return
      const nextParams = new URLSearchParams(searchParams.toString())
      if (next === "overview") {
        nextParams.delete("tab")
      } else {
        nextParams.set("tab", next)
      }
      const query = nextParams.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      })
    },
    [router, pathname, searchParams]
  )

  const deviceQuery = trpc.devices.byId.useQuery(
    { id: deviceId },
    { enabled: Boolean(deviceId), refetchInterval: 30_000 }
  )
  const device = deviceQuery.data

  const visibleTabs = React.useMemo<DeviceTab[]>(() => {
    const tabs: DeviceTab[] = [
      "overview",
      "agent",
      "connect",
      "services",
      "network",
      "metrics",
      "software",
    ]
    if (permissionsLoading || can("audit:view")) tabs.push("activity")
    if (
      permissionsLoading ||
      can("device:update") ||
      can("device:revoke_vpn") ||
      can("device:delete")
    ) {
      tabs.push("settings")
    }
    return tabs
  }, [can, permissionsLoading])

  const activeTab: DeviceTab = visibleTabs.includes(tab) ? tab : "overview"

  if (deviceQuery.isLoading) {
    return <DeviceDetailSkeleton />
  }

  if (!device) {
    return (
      <div className="flex flex-col gap-6">
        <Button variant="ghost" size="sm" className="w-fit" asChild>
          <Link href="/devices">
            <ArrowLeftIcon />
            All devices
          </Link>
        </Button>
        <Card>
          <CardContent className="py-8">
            <EmptyState
              title="Device not found"
              description="It may have been removed, or you may not have access to it."
              bordered={false}
              action={
                <Button asChild>
                  <Link href="/devices">Back to devices</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 w-fit text-muted-foreground"
          asChild
        >
          <Link href="/devices">
            <ArrowLeftIcon />
            All devices
          </Link>
        </Button>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="truncate text-2xl font-semibold tracking-tight">
                {device.displayName}
              </h1>
              <ConnectivityBadge
                connectivity={device.connectivity}
                lastHandshakeAt={device.vpnIdentity?.lastHandshakeAt}
                showDetail={false}
              />
              <Badge variant={statusVariant[device.status] ?? "secondary"}>
                {statusLabel(device.status)}
              </Badge>
              {device.archivedAt ? (
                <Badge variant="outline">Archived</Badge>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {device.hostname && device.hostname !== device.displayName ? (
                <span className="font-mono text-xs">{device.hostname}</span>
              ) : null}
              <span>{device.siteName ?? "No site"}</span>
              <span aria-hidden>·</span>
              <span>{osFamilyLabel(device.osFamily)}</span>
              {device.vpnIdentity?.vpnIpv4 ? (
                <>
                  <span aria-hidden>·</span>
                  <CopyableText
                    value={String(device.vpnIdentity.vpnIpv4)}
                    className="text-xs"
                  />
                </>
              ) : null}
              {device.assetTag ? (
                <>
                  <span aria-hidden>·</span>
                  <Link href="/assets" className="hover:underline">
                    Asset {device.assetTag}
                  </Link>
                </>
              ) : null}
            </div>
            {device.lastTouched ? (
              <p className="text-xs text-muted-foreground">
                Last touched by{" "}
                {device.lastTouched.name || device.lastTouched.email} ·{" "}
                {formatRelativeTime(device.lastTouched.at)}
              </p>
            ) : null}
            {device.tags.length > 0 ? (
              <TagChips
                tags={device.tags}
                max={6}
                onClick={(tag) =>
                  router.push(`/devices?f.tags=${encodeURIComponent(tag)}`)
                }
              />
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            {can("device:update") ? (
              <Button variant="outline" onClick={() => setTicketOpen(true)}>
                <TicketIcon />
                Open ticket
              </Button>
            ) : null}
            {activeTab !== "connect" ? (
              <Button onClick={() => setTab("connect")}>Connect</Button>
            ) : null}
            {activeTab !== "agent" && !device.agentVersion ? (
              <Button variant="outline" onClick={() => setTab("agent")}>
                Install agent
              </Button>
            ) : null}
            {visibleTabs.includes("settings") && activeTab !== "settings" ? (
              <Button variant="outline" onClick={() => setTab("settings")}>
                Settings
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setTab} className="gap-6">
        <TabsList
          variant="line"
          className="w-max min-w-full justify-start border-b"
        >
          {visibleTabs.map((entry) => (
            <TabsTrigger key={entry} value={entry} className="flex-none px-3">
              {tabLabels[entry]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div key={activeTab}>
        {activeTab === "overview" ? (
          <OverviewTab device={device} onNavigate={setTab} />
        ) : activeTab === "agent" ? (
          <AgentTab device={device} />
        ) : activeTab === "connect" ? (
          <ConnectTab device={device} onNavigate={setTab} />
        ) : activeTab === "services" ? (
          <ServicesTab device={device} />
        ) : activeTab === "network" ? (
          <NetworkTab device={device} />
        ) : activeTab === "metrics" ? (
          <MetricsTab device={device} />
        ) : activeTab === "software" ? (
          <SoftwareTab device={device} />
        ) : activeTab === "activity" ? (
          <ActivityTab device={device} />
        ) : (
          <SettingsTab device={device} />
        )}
      </div>

      {can("device:update") ? (
        <OpenDeviceTicketDialog
          key={device.id}
          deviceId={device.id}
          deviceName={device.displayName}
          siteName={device.siteName}
          open={ticketOpen}
          onOpenChange={setTicketOpen}
        />
      ) : null}
    </div>
  )
}
