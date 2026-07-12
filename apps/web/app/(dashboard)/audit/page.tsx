"use client"

import * as React from "react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import { FormField, NativeSelect } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { formatDate, statusLabel } from "@/lib/dashboard"
import { trpc } from "@/lib/trpc"

const detailKeyLabels: Record<string, string> = {
  organizationId: "Organization",
  deviceId: "Device",
  siteId: "Site",
  routePolicyId: "Route policy",
  tokenId: "Token",
  serviceId: "Service",
  serviceType: "Service type",
  displayName: "Display name",
  hostname: "Hostname",
  name: "Name",
  port: "Port",
  enabled: "Enabled",
  revoked: "Revoked",
  siteWide: "Site-wide",
  maxUses: "Max uses",
  expiresAt: "Expires",
  vpnIpv4: "VPN address",
  serviceCount: "Services",
  organization: "Organization",
}

function humanizeDetailKey(key: string) {
  if (detailKeyLabels[key]) {
    return detailKeyLabels[key]
  }

  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase())
}

function shortId(value: string) {
  return value.length > 10 ? `${value.slice(0, 8)}…` : value
}

function isIsoDateLike(value: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)
}

type DetailLookups = {
  organizationNameById: Map<string, string>
  deviceNameById: Map<string, string>
  siteNameById: Map<string, string>
  routePolicyNameById: Map<string, string>
}

function formatDetailValue(
  key: string,
  value: unknown,
  lookups: DetailLookups
) {
  if (value === null || value === undefined || value === "") {
    return "—"
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No"
  }

  if (typeof value === "string") {
    if (key === "organizationId") {
      return lookups.organizationNameById.get(value) ?? shortId(value)
    }
    if (key === "deviceId") {
      return lookups.deviceNameById.get(value) ?? shortId(value)
    }
    if (key === "siteId") {
      return lookups.siteNameById.get(value) ?? shortId(value)
    }
    if (key === "routePolicyId") {
      return lookups.routePolicyNameById.get(value) ?? shortId(value)
    }
    if (key === "serviceType") {
      return statusLabel(value)
    }
    if (key === "tokenId" || key === "serviceId") {
      return shortId(value)
    }
    if (isIsoDateLike(value)) {
      return formatDate(value)
    }

    return value
  }

  return String(value)
}

export default function AuditPage() {
  const auditQuery = trpc.audit.list.useQuery({})
  const organizationsQuery = trpc.organizations.list.useQuery()
  const devicesQuery = trpc.devices.list.useQuery()
  const sitesQuery = trpc.sites.list.useQuery()
  const routePoliciesQuery = trpc.routePolicies.list.useQuery()
  const [organizationId, setOrganizationId] = React.useState("")
  const [deviceId, setDeviceId] = React.useState("")

  const organizations = React.useMemo(
    () => organizationsQuery.data ?? [],
    [organizationsQuery.data]
  )
  const devices = React.useMemo(
    () => devicesQuery.data ?? [],
    [devicesQuery.data]
  )
  const sites = React.useMemo(() => sitesQuery.data ?? [], [sitesQuery.data])
  const routePolicies = React.useMemo(
    () => routePoliciesQuery.data ?? [],
    [routePoliciesQuery.data]
  )

  const lookups = React.useMemo<DetailLookups>(
    () => ({
      organizationNameById: new Map(
        organizations.map((organization) => [
          organization.id,
          organization.name,
        ])
      ),
      deviceNameById: new Map(
        devices.map((device) => [device.id, device.displayName])
      ),
      siteNameById: new Map(sites.map((site) => [site.id, site.name])),
      routePolicyNameById: new Map(
        routePolicies.map((policy) => [policy.id, policy.name])
      ),
    }),
    [organizations, devices, sites, routePolicies]
  )

  const filteredAudit = React.useMemo(() => {
    return (auditQuery.data ?? []).filter((event) => {
      if (organizationId && event.organizationId !== organizationId) {
        return false
      }
      if (deviceId && event.deviceId !== deviceId) {
        return false
      }
      return true
    })
  }, [auditQuery.data, organizationId, deviceId])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Audit"
        title="Activity log"
        description="Review recent operational changes across the workspace."
      />

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>
            Limit the list to a specific organization or device.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <FormField label="Organization" htmlFor="audit-filter-organization">
            <NativeSelect
              id="audit-filter-organization"
              value={organizationId}
              onChange={(event) => setOrganizationId(event.target.value)}
            >
              <option value="">All organizations</option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Device" htmlFor="audit-filter-device">
            <NativeSelect
              id="audit-filter-device"
              value={deviceId}
              onChange={(event) => setDeviceId(event.target.value)}
            >
              <option value="">All devices</option>
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.displayName}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Events</CardTitle>
          <CardDescription>
            Recorded actions for inventory and access changes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>Device</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditQuery.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10">
                      <Skeleton className="h-5 w-40" />
                    </TableCell>
                  </TableRow>
                ) : filteredAudit.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="p-0">
                      <EmptyState
                        title="No events yet"
                        description="Operational changes will show up here as they happen."
                        bordered={false}
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredAudit.map((event) => {
                    const details = Object.entries(event.eventData ?? {})
                    const organizationName = event.organizationId
                      ? (lookups.organizationNameById.get(
                          event.organizationId
                        ) ?? shortId(event.organizationId))
                      : "—"
                    const deviceName = event.deviceId
                      ? (lookups.deviceNameById.get(event.deviceId) ??
                        shortId(event.deviceId))
                      : "—"

                    return (
                      <TableRow key={event.id}>
                        <TableCell className="font-medium">
                          <Badge variant="outline">
                            {statusLabel(event.eventType)}
                          </Badge>
                        </TableCell>
                        <TableCell>{organizationName}</TableCell>
                        <TableCell>{deviceName}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(event.createdAt)}
                        </TableCell>
                        <TableCell>
                          {details.length === 0 ? (
                            <span className="text-sm text-muted-foreground">
                              —
                            </span>
                          ) : (
                            <div className="flex flex-col gap-0.5 text-xs">
                              {details.map(([key, value]) => (
                                <div key={key} className="flex gap-1.5">
                                  <span className="text-muted-foreground">
                                    {humanizeDetailKey(key)}:
                                  </span>
                                  <span className="font-medium break-all">
                                    {formatDetailValue(key, value, lookups)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
