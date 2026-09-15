"use client"

import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { CopyableText } from "@/components/dashboard/copyable-text"
import { SectionCard } from "@/components/dashboard/section-card"
import { ConnectivityBadge } from "@/components/devices/connectivity-badge"
import { PolicyBadge, RouteChip } from "@/components/route-policies/policy-chip"
import { SessionsTable } from "@/components/sessions/sessions-table"
import { formatBytes, formatDate, formatRelativeTime } from "@/lib/dashboard"
import { trpc } from "@/lib/trpc"
import { usePermissions } from "@/lib/use-permissions"

import { DefinitionList } from "./definition-list"
import type { DeviceDetail } from "./shared"

export function NetworkTab({ device }: { device: DeviceDetail }) {
  const { can } = usePermissions()
  const identity = device.vpnIdentity

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard
          title="Tunnel peer"
          description="How this device is attached to the private network."
          className="lg:col-span-2"
        >
          {identity ? (
            <DefinitionList
              columns={3}
              items={[
                {
                  label: "Connectivity",
                  value: (
                    <ConnectivityBadge
                      connectivity={device.connectivity}
                      lastHandshakeAt={identity.lastHandshakeAt}
                    />
                  ),
                },
                {
                  label: "Last handshake",
                  value: identity.lastHandshakeAt ? (
                    <span title={formatDate(identity.lastHandshakeAt)}>
                      {formatRelativeTime(identity.lastHandshakeAt)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Never</span>
                  ),
                },
                {
                  label: "Peer enabled",
                  value: identity.revokedAt ? (
                    <Badge variant="destructive">
                      Revoked {formatRelativeTime(identity.revokedAt)}
                    </Badge>
                  ) : identity.serverPeerEnabled ? (
                    <Badge variant="secondary">Yes</Badge>
                  ) : (
                    <Badge variant="outline">No</Badge>
                  ),
                },
                {
                  label: "Tunnel address",
                  value: (
                    <CopyableText
                      value={String(identity.vpnIpv4)}
                      className="text-xs"
                    />
                  ),
                },
                {
                  label: "Public endpoint",
                  value: identity.latestEndpoint ? (
                    <CopyableText
                      value={identity.latestEndpoint}
                      className="text-xs"
                    />
                  ) : null,
                },
                {
                  label: "Traffic",
                  value: `${formatBytes(identity.rxBytes)} received · ${formatBytes(identity.txBytes)} sent`,
                },
                {
                  label: "Public key",
                  value: (
                    <CopyableText
                      value={identity.wireguardPublicKey}
                      className="text-xs"
                    />
                  ),
                },
                {
                  label: "Peer created",
                  value: formatDate(identity.createdAt),
                },
              ]}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              This device hasn&apos;t finished enrolling, so it has no tunnel
              peer yet.
            </p>
          )}
        </SectionCard>

        <EffectiveRoutesCard
          device={device}
          canManage={can("organization:admin")}
        />
      </div>

      <SectionCard
        title="Session history"
        description="Remote sessions opened to this device."
        contentClassName="pt-0"
      >
        <SessionsTable
          variant="device"
          fixedFilters={{ deviceId: [device.id] }}
          pageSize={10}
          defaultRange="30d"
        />
      </SectionCard>
    </div>
  )
}

/**
 * Exactly what the tunnel publishes to the device: the concentrator address
 * first, then the assigned policy's networks with their labels.
 */
function EffectiveRoutesCard({
  device,
  canManage,
}: {
  device: DeviceDetail
  canManage: boolean
}) {
  const routesQuery = trpc.devices.effectiveRoutes.useQuery(
    { id: device.id },
    { staleTime: 30_000 }
  )
  const data = routesQuery.data

  return (
    <SectionCard
      title="Effective routes"
      description="Networks this device can reach through the tunnel."
      actions={
        canManage ? (
          <Button variant="ghost" size="sm" asChild>
            <Link href="/route-policies">Manage</Link>
          </Button>
        ) : null
      }
    >
      {routesQuery.isLoading || !data ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-6 w-full" />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Tunnel
            </p>
            {data.tunnelRoute ? (
              <RouteChip
                entry={{ cidr: data.tunnelRoute, label: "Concentrator" }}
                tone="secondary"
                className="w-fit"
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Tunnel address not published yet.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Policy
              {data.policy ? (
                <PolicyBadge
                  name={data.policy.name}
                  color={data.policy.color}
                  className="text-xs font-normal tracking-normal normal-case"
                />
              ) : null}
            </div>
            {!data.policy ? (
              <p className="text-sm text-muted-foreground">
                No route policy assigned. The device only reaches the tunnel
                itself.
              </p>
            ) : data.policy.entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This policy doesn&apos;t publish any routes.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {data.policy.entries.map((entry) => (
                  <li key={entry.cidr}>
                    <RouteChip entry={entry} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {data.revoked ? (
            <p className="text-xs text-destructive">
              Tunnel access is revoked, so none of these routes are reachable
              right now.
            </p>
          ) : null}
        </div>
      )}
    </SectionCard>
  )
}
