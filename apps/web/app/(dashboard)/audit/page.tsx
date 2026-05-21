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
import { formatDate } from "@/lib/dashboard"
import { trpc } from "@/lib/trpc"

export default function AuditPage() {
  const auditQuery = trpc.audit.list.useQuery({})
  const organizationsQuery = trpc.organizations.list.useQuery()
  const devicesQuery = trpc.devices.list.useQuery()
  const [organizationId, setOrganizationId] = React.useState("")
  const [deviceId, setDeviceId] = React.useState("")

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

  const organizations = organizationsQuery.data ?? []
  const devices = devicesQuery.data ?? []

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-2">
        <Badge variant="outline" className="w-fit">
          Audit
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight">Activity log</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Review recent operational changes across the workspace.
        </p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>
            Limit the list to a specific organization or device.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Organization</span>
            <select
              className="h-10 rounded-md border bg-background px-3"
              value={organizationId}
              onChange={(event) => setOrganizationId(event.target.value)}
            >
              <option value="">All organizations</option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Device</span>
            <select
              className="h-10 rounded-md border bg-background px-3"
              value={deviceId}
              onChange={(event) => setDeviceId(event.target.value)}
            >
              <option value="">All devices</option>
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.displayName}
                </option>
              ))}
            </select>
          </label>
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
                    <TableCell
                      colSpan={5}
                      className="py-8 text-center text-muted-foreground"
                    >
                      <Skeleton className="mx-auto h-5 w-40" />
                    </TableCell>
                  </TableRow>
                ) : filteredAudit.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-8 text-center text-muted-foreground"
                    >
                      No events yet
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredAudit.map((event) => {
                    const details = Object.entries(event.eventData ?? {})
                      .map(([key, value]) => `${key}: ${String(value)}`)
                      .join(", ")

                    return (
                      <TableRow key={event.id}>
                        <TableCell className="font-medium">
                          {event.eventType}
                        </TableCell>
                        <TableCell>{event.organizationId ?? "—"}</TableCell>
                        <TableCell>{event.deviceId ?? "—"}</TableCell>
                        <TableCell>{formatDate(event.createdAt)}</TableCell>
                        <TableCell className="max-w-md text-sm break-words text-muted-foreground">
                          {details || "—"}
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
