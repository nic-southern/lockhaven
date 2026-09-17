"use client"

import * as React from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { CopyableText } from "@/components/dashboard/copyable-text"
import { EmptyState } from "@/components/dashboard/empty-state"
import { SectionCard } from "@/components/dashboard/section-card"
import { StatusIndicator } from "@/components/dashboard/status-indicator"
import { ConnectivityBadge } from "@/components/devices/connectivity-badge"
import { TagChips, TagEditor } from "@/components/devices/tag-chips"
import {
  formatBytes,
  formatDate,
  formatRelativeTime,
  statusLabel,
  statusVariant,
} from "@/lib/dashboard"
import { osFamilyLabel, serviceTypeLabel } from "@/lib/devices"
import { trpc } from "@/lib/trpc"
import { usePermissions } from "@/lib/use-permissions"

import { DefinitionList } from "./definition-list"
import {
  type DeviceDetail,
  type DeviceTab,
  useInvalidateDevice,
} from "./shared"

function healthTone(status: string) {
  if (status === "online") return "online" as const
  if (status === "offline") return "offline" as const
  return "neutral" as const
}

export function OverviewTab({
  device,
  onNavigate,
}: {
  device: DeviceDetail
  onNavigate: (tab: DeviceTab) => void
}) {
  const { can } = usePermissions()
  const canUpdate = can("device:update")
  const canViewAudit = can("audit:view")
  const invalidate = useInvalidateDevice(device.id)

  const facetsQuery = trpc.devices.facets.useQuery(undefined, {
    staleTime: 60_000,
    enabled: canUpdate,
  })
  const activityQuery = trpc.audit.page.useQuery(
    {
      limit: 5,
      filters: { deviceId: [device.id] },
      sort: [{ id: "createdAt", desc: true }],
    },
    { enabled: canViewAudit }
  )

  const [tags, setTags] = React.useState<string[]>(device.tags)
  const [tagsBaseline, setTagsBaseline] = React.useState(device.tags)
  if (tagsBaseline !== device.tags) {
    // Server data changed (save, refetch); drop local edits in favor of it.
    setTagsBaseline(device.tags)
    setTags(device.tags)
  }
  const tagsDirty =
    tags.length !== device.tags.length ||
    tags.some((tag, index) => tag !== device.tags[index])

  const setTagsMutation = trpc.devices.setTags.useMutation({
    async onSuccess() {
      await invalidate()
      toast.success("Tags updated")
    },
    onError() {
      toast.error("We couldn't update the tags.")
    },
  })

  const identity = device.vpnIdentity
  const enabledServices = device.services.filter((service) => service.enabled)

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-6 lg:col-span-2">
        <SectionCard
          title="Identity"
          description="What this device reports about itself."
        >
          <DefinitionList
            columns={3}
            items={[
              { label: "Display name", value: device.displayName },
              { label: "Host name", value: device.hostname, mono: true },
              {
                label: "Site",
                value: device.siteName ?? (
                  <span className="text-muted-foreground">No site</span>
                ),
              },
              {
                label: "Operating system",
                value: (
                  <span>
                    {osFamilyLabel(device.osFamily)}
                    {device.osVersion ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · {device.osVersion}
                      </span>
                    ) : null}
                  </span>
                ),
              },
              { label: "Architecture", value: device.architecture, mono: true },
              {
                label: "Serial number",
                value: device.serialNumber,
                mono: true,
              },
              {
                label: "Asset",
                value: device.assetTag ? (
                  <span>{device.assetTag}</span>
                ) : (
                  <span className="text-muted-foreground">Not linked</span>
                ),
              },
              {
                label: "Notes",
                value: device.notes ? (
                  <span className="whitespace-pre-wrap">{device.notes}</span>
                ) : (
                  <span className="text-muted-foreground">None</span>
                ),
              },
              {
                label: "Agent version",
                value: device.agentVersion ? (
                  <button
                    type="button"
                    className="font-mono text-xs hover:underline"
                    onClick={() => onNavigate("agent")}
                  >
                    {device.agentVersion}
                  </button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-2 h-auto px-2 py-0"
                    onClick={() => onNavigate("agent")}
                  >
                    Install agent
                  </Button>
                ),
              },
              {
                label: "Status",
                value: (
                  <Badge variant={statusVariant[device.status] ?? "secondary"}>
                    {statusLabel(device.status)}
                  </Badge>
                ),
              },
              {
                label: "Archive",
                value: device.archivedAt ? (
                  <span title={formatDate(device.archivedAt)}>
                    Archived · {formatRelativeTime(device.archivedAt)}
                  </span>
                ) : (
                  "In service"
                ),
              },
              {
                label: "Enrolled",
                value: (
                  <span title={formatDate(device.enrolledAt)}>
                    {formatRelativeTime(device.enrolledAt)}
                  </span>
                ),
              },
              {
                label: "Device id",
                value: <CopyableText value={device.id} className="text-xs" />,
              },
            ]}
          />
        </SectionCard>

        <SectionCard
          title="Tunnel"
          description="Private connectivity between this device and the network."
          actions={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onNavigate("network")}
            >
              Network details
            </Button>
          }
        >
          <DefinitionList
            columns={3}
            items={[
              {
                label: "Connectivity",
                value: (
                  <ConnectivityBadge
                    connectivity={device.connectivity}
                    lastHandshakeAt={identity?.lastHandshakeAt}
                  />
                ),
              },
              {
                label: "Last handshake",
                value: identity?.lastHandshakeAt ? (
                  <span title={formatDate(identity.lastHandshakeAt)}>
                    {formatRelativeTime(identity.lastHandshakeAt)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Never</span>
                ),
              },
              {
                label: "Tunnel address",
                value: (
                  <CopyableText
                    value={identity?.vpnIpv4 ? String(identity.vpnIpv4) : null}
                    className="text-xs"
                  />
                ),
              },
              {
                label: "Public endpoint",
                value: identity?.latestEndpoint,
                mono: true,
              },
              {
                label: "Route policy",
                value: device.routePolicy ? (
                  <Badge variant="secondary" className="font-normal">
                    {device.routePolicy.name}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">No policy</span>
                ),
              },
              {
                label: "Traffic",
                value: identity
                  ? `${formatBytes(identity.rxBytes)} in · ${formatBytes(identity.txBytes)} out`
                  : null,
              },
            ]}
          />
        </SectionCard>

        {canViewAudit ? (
          <SectionCard
            title="Recent activity"
            description="Latest recorded changes for this device."
            actions={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onNavigate("activity")}
              >
                View all
              </Button>
            }
            contentClassName="p-0"
          >
            {activityQuery.isLoading ? (
              <div className="flex flex-col gap-3 p-6">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : !activityQuery.data || activityQuery.data.items.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="No activity yet"
                  description="Changes to this device will show up here."
                  bordered={false}
                />
              </div>
            ) : (
              <ul className="divide-y">
                {activityQuery.data.items.map((event) => (
                  <li
                    key={event.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 text-sm"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Badge variant="outline" className="whitespace-nowrap">
                        {statusLabel(event.eventType)}
                      </Badge>
                      <span className="truncate text-muted-foreground">
                        {event.actorName ?? event.actorEmail ?? "System"}
                      </span>
                    </div>
                    <span
                      className="text-xs text-muted-foreground"
                      title={formatDate(event.createdAt)}
                    >
                      {formatRelativeTime(event.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        ) : null}
      </div>

      <div className="flex flex-col gap-6">
        <SectionCard
          title="Tags"
          description={
            canUpdate
              ? "Group devices for filters, saved views, and bulk actions."
              : "Labels applied to this device."
          }
        >
          {canUpdate ? (
            <div className="flex flex-col gap-3">
              <TagEditor
                id="device-tags"
                value={tags}
                onChange={setTags}
                suggestions={
                  facetsQuery.data?.tags.map((entry) => entry.value) ?? []
                }
                disabled={setTagsMutation.isPending}
              />
              {tagsDirty ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      setTagsMutation.mutate({ id: device.id, tags })
                    }
                    disabled={setTagsMutation.isPending}
                  >
                    Save tags
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setTags(device.tags)}
                    disabled={setTagsMutation.isPending}
                  >
                    Cancel
                  </Button>
                </div>
              ) : null}
            </div>
          ) : device.tags.length > 0 ? (
            <TagChips tags={device.tags} max={20} />
          ) : (
            <p className="text-sm text-muted-foreground">No tags yet.</p>
          )}
        </SectionCard>

        <SectionCard
          title="Services"
          description="Remote access endpoints published for this device."
          actions={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onNavigate("services")}
            >
              Manage
            </Button>
          }
        >
          {device.services.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No services yet. Add one from the Services tab.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {device.services.map((service) => (
                <li
                  key={service.id}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="font-medium">
                      {serviceTypeLabel[service.serviceType] ??
                        service.serviceType}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {service.protocol}/{service.port}
                    </span>
                  </div>
                  {service.enabled ? (
                    <StatusIndicator
                      tone={healthTone(service.healthStatus)}
                      label={statusLabel(service.healthStatus)}
                      pulse={service.healthStatus === "online"}
                    />
                  ) : (
                    <Badge variant="outline">Disabled</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
          {enabledServices.length > 0 ? (
            <Button
              className="mt-4 w-full"
              variant="outline"
              size="sm"
              onClick={() => onNavigate("connect")}
            >
              Connect
            </Button>
          ) : null}
        </SectionCard>
      </div>
    </div>
  )
}
