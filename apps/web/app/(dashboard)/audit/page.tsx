"use client"

import * as React from "react"
import type {
  ColumnDef,
  ColumnFiltersState,
  PaginationState,
  SortingState,
} from "@tanstack/react-table"
import { keepPreviousData } from "@tanstack/react-query"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  DataTable,
  DataTableColumnHeader,
} from "@/components/dashboard/data-table"
import { PageHeader } from "@/components/dashboard/page-header"
import { SelectField } from "@/components/dashboard/select-field"
import { formatDate, formatRelativeTime, statusLabel } from "@/lib/dashboard"
import { buildListQuery, columnFiltersToRecord } from "@/lib/list-query"
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

const timeRanges = [
  { value: "all", label: "All time" },
  { value: "1h", label: "Last hour" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
] as const

function rangeStart(range: string) {
  const now = Date.now()
  switch (range) {
    case "1h":
      return new Date(now - 60 * 60 * 1000)
    case "24h":
      return new Date(now - 24 * 60 * 60 * 1000)
    case "7d":
      return new Date(now - 7 * 24 * 60 * 60 * 1000)
    case "30d":
      return new Date(now - 30 * 24 * 60 * 60 * 1000)
    default:
      return null
  }
}

type AuditRow = {
  id: string
  eventType: string
  actorName: string | null
  actorEmail: string | null
  organizationId: string | null
  organizationName: string | null
  deviceId: string | null
  deviceName: string | null
  eventData: Record<string, unknown>
  createdAt: Date | string
}

export default function AuditPage() {
  const organizationsQuery = trpc.organizations.list.useQuery()
  const devicesQuery = trpc.devices.list.useQuery()
  const sitesQuery = trpc.sites.list.useQuery()
  const routePoliciesQuery = trpc.routePolicies.list.useQuery()
  const eventTypesQuery = trpc.audit.eventTypes.useQuery()

  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "createdAt", desc: true },
  ])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    []
  )
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: 25,
  })
  const [search, setSearch] = React.useState("")
  const [debouncedSearch, setDebouncedSearch] = React.useState("")
  const [range, setRange] = React.useState<string>("all")

  React.useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedSearch(search), 250)
    return () => window.clearTimeout(handle)
  }, [search])

  const resetToFirstPage = React.useCallback(() => {
    setPagination((current) =>
      current.pageIndex === 0 ? current : { ...current, pageIndex: 0 }
    )
  }, [])

  const filters = React.useMemo(() => {
    const record = columnFiltersToRecord(columnFilters)
    const start = rangeStart(range)
    if (start) {
      record.from = [start.toISOString()]
    }
    return record
  }, [columnFilters, range])

  const pageQuery = trpc.audit.page.useQuery(
    buildListQuery({ pagination, sorting, filters, search: debouncedSearch }),
    { placeholderData: keepPreviousData }
  )

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

  const columns = React.useMemo<ColumnDef<AuditRow>[]>(
    () => [
      {
        accessorKey: "eventType",
        meta: { label: "Event" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Event" />
        ),
        cell: ({ row }) => (
          <Badge variant="outline" className="whitespace-nowrap">
            {statusLabel(row.original.eventType)}
          </Badge>
        ),
      },
      {
        accessorKey: "actorName",
        meta: { label: "Actor" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Actor" />
        ),
        cell: ({ row }) =>
          row.original.actorName || row.original.actorEmail ? (
            <div className="flex flex-col">
              <span>{row.original.actorName ?? row.original.actorEmail}</span>
              {row.original.actorName && row.original.actorEmail ? (
                <span className="text-xs text-muted-foreground">
                  {row.original.actorEmail}
                </span>
              ) : null}
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">System</span>
          ),
      },
      {
        id: "organizationId",
        accessorKey: "organizationName",
        meta: { label: "Organization" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Organization" />
        ),
        cell: ({ row }) =>
          row.original.organizationName ??
          (row.original.organizationId
            ? shortId(row.original.organizationId)
            : "—"),
      },
      {
        id: "deviceId",
        accessorKey: "deviceName",
        meta: { label: "Device" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Device" />
        ),
        cell: ({ row }) =>
          row.original.deviceName ??
          (row.original.deviceId ? shortId(row.original.deviceId) : "—"),
      },
      {
        accessorKey: "createdAt",
        meta: { label: "Time" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Time" />
        ),
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="text-sm">
              {formatRelativeTime(row.original.createdAt)}
            </span>
            <span className="text-xs text-muted-foreground">
              {formatDate(row.original.createdAt)}
            </span>
          </div>
        ),
      },
      {
        id: "details",
        enableSorting: false,
        meta: { label: "Details" },
        header: "Details",
        cell: ({ row }) => {
          const details = Object.entries(row.original.eventData ?? {})
          if (details.length === 0) {
            return <span className="text-sm text-muted-foreground">—</span>
          }
          return (
            <div className="flex max-w-md flex-col gap-0.5 text-xs">
              {details.slice(0, 5).map(([key, value]) => (
                <div key={key} className="flex gap-1.5">
                  <span className="text-muted-foreground">
                    {humanizeDetailKey(key)}:
                  </span>
                  <span className="font-medium break-all">
                    {formatDetailValue(key, value, lookups)}
                  </span>
                </div>
              ))}
              {details.length > 5 ? (
                <span className="text-muted-foreground">
                  +{details.length - 5} more
                </span>
              ) : null}
            </div>
          )
        },
      },
    ],
    [lookups]
  )

  const eventTypeOptions = React.useMemo(
    () =>
      (eventTypesQuery.data ?? []).map((eventType) => ({
        value: eventType,
        label: statusLabel(eventType),
      })),
    [eventTypesQuery.data]
  )

  const total = pageQuery.data?.total ?? 0

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Audit"
        title="Activity log"
        description="Review recent operational changes across the workspace."
      />

      <Card>
        <CardHeader>
          <CardTitle>Events</CardTitle>
          <CardDescription>
            {total > 0
              ? `${total.toLocaleString()} recorded ${total === 1 ? "event" : "events"} match the current view.`
              : "Recorded actions for inventory and access changes."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={pageQuery.data?.items}
            isLoading={pageQuery.isLoading}
            isFetching={pageQuery.isFetching}
            getRowId={(row) => row.id}
            server={{
              rowCount: total,
              sorting,
              onSortingChange: (updater) => {
                setSorting(updater)
                resetToFirstPage()
              },
              columnFilters,
              onColumnFiltersChange: (updater) => {
                setColumnFilters(updater)
                resetToFirstPage()
              },
              pagination,
              onPaginationChange: setPagination,
            }}
            search={search}
            onSearchChange={(value) => {
              setSearch(value)
              resetToFirstPage()
            }}
            searchPlaceholder="Search events"
            toolbarLeading={
              <SelectField
                value={range}
                onValueChange={(value) => {
                  setRange(value)
                  resetToFirstPage()
                }}
                size="sm"
                className="h-9 w-40"
                aria-label="Time range"
                options={timeRanges.map((entry) => ({
                  value: entry.value,
                  label: entry.label,
                }))}
              />
            }
            facets={[
              {
                columnId: "eventType",
                title: "Event type",
                options: eventTypeOptions,
              },
              {
                columnId: "organizationId",
                title: "Organization",
                options: organizations.map((organization) => ({
                  value: organization.id,
                  label: organization.name,
                })),
              },
              {
                columnId: "deviceId",
                title: "Device",
                options: devices.map((device) => ({
                  value: device.id,
                  label: device.displayName,
                })),
              },
            ]}
            pageSizeOptions={[25, 50, 100, 200]}
            emptyTitle="No events yet"
            emptyDescription="Operational changes will show up here as they happen."
          />
        </CardContent>
      </Card>
    </div>
  )
}
