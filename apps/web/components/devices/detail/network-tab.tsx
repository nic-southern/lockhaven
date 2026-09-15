"use client"

import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CopyableText } from "@/components/dashboard/copyable-text"
import { SectionCard } from "@/components/dashboard/section-card"
import { ConnectivityBadge } from "@/components/devices/connectivity-badge"
import { SessionsTable } from "@/components/sessions/sessions-table"
import { formatBytes, formatDate, formatRelativeTime } from "@/lib/dashboard"
import { usePermissions } from "@/lib/use-permissions"

import { DefinitionList } from "./definition-list"
import type { DeviceDetail } from "./shared"

export function NetworkTab({ device }: { device: DeviceDetail }) {
  const { can } = usePermissions()
  const identity = device.vpnIdentity
  const routes = device.routePolicy?.routes ?? []

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

        <SectionCard
          title="Effective routes"
          description="Networks this device can reach through the tunnel."
          actions={
            device.routePolicy && can("organization:admin") ? (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/route-policies">Manage</Link>
              </Button>
            ) : null
          }
        >
          {device.routePolicy ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Policy</span>
                <Badge variant="secondary" className="font-normal">
                  {device.routePolicy.name}
                </Badge>
              </div>
              {routes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  This policy doesn&apos;t publish any routes.
                </p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {routes.map((route) => (
                    <li key={route}>
                      <Badge variant="outline" className="font-mono text-xs">
                        {route}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No route policy assigned. The device only reaches the tunnel
              itself.
            </p>
          )}
        </SectionCard>
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
