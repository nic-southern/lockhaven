"use client"

import * as React from "react"
import Link from "next/link"
import { keepPreviousData } from "@tanstack/react-query"
import type {
  ColumnDef,
  ColumnFiltersState,
  PaginationState,
  SortingState,
} from "@tanstack/react-table"

import { Badge } from "@/components/ui/badge"
import {
  DataTable,
  DataTableColumnHeader,
  type DataTableFacet,
} from "@/components/dashboard/data-table"
import { SelectField } from "@/components/dashboard/select-field"
import {
  auditRangeStart,
  auditTimeRanges,
  formatDetailValue,
  humanizeDetailKey,
  shortId,
  type DetailLookups,
} from "@/lib/audit"
import { formatDate, formatRelativeTime, statusLabel } from "@/lib/dashboard"
import { buildListQuery, columnFiltersToRecord } from "@/lib/list-query"
import { trpc } from "@/lib/trpc"
import type { RouterOutputs } from "@/lib/trpc"

export type AuditRow = RouterOutputs["audit"]["page"]["items"][number]

/** Keys that only repeat the row's own columns and add no detail. */
const redundantDetailKeys = new Set(["deviceId"])

export function AuditTable({
  variant = "full",
  fixedFilters,
  pageSize = 25,
  defaultRange = "all",
  className,
}: {
  /** `device` hides organization/device columns for embedding on a device page. */
  variant?: "full" | "device"
  fixedFilters?: Record<string, string[]>
  pageSize?: number
  defaultRange?: (typeof auditTimeRanges)[number]["value"]
  className?: string
}) {
  const full = variant === "full"
  const organizationsQuery = trpc.organizations.list.useQuery(undefined, {
    enabled: full,
  })
  const devicesQuery = trpc.devices.list.useQuery(undefined, { enabled: full })
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
    pageSize,
  })
  const [search, setSearch] = React.useState("")
  const [debouncedSearch, setDebouncedSearch] = React.useState("")
  const [range, setRange] = React.useState<string>(defaultRange)

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
    const start = auditRangeStart(range)
    if (start) record.from = [start.toISOString()]
    for (const [key, values] of Object.entries(fixedFilters ?? {})) {
      record[key] = values
    }
    return record
  }, [columnFilters, range, fixedFilters])

  const pageQuery = trpc.audit.page.useQuery(
    buildListQuery({ pagination, sorting, filters, search: debouncedSearch }),
    { placeholderData: keepPreviousData }
  )

  const total = pageQuery.data?.total ?? 0

  const lookups = React.useMemo<DetailLookups>(
    () => ({
      organizationNameById: new Map(
        (organizationsQuery.data ?? []).map((organization) => [
          organization.id,
          organization.name,
        ])
      ),
      deviceNameById: new Map(
        (devicesQuery.data ?? []).map((device) => [
          device.id,
          device.displayName,
        ])
      ),
      siteNameById: new Map(
        (sitesQuery.data ?? []).map((site) => [site.id, site.name])
      ),
      routePolicyNameById: new Map(
        (routePoliciesQuery.data ?? []).map((policy) => [
          policy.id,
          policy.name,
        ])
      ),
    }),
    [
      organizationsQuery.data,
      devicesQuery.data,
      sitesQuery.data,
      routePoliciesQuery.data,
    ]
  )

  const columns = React.useMemo<ColumnDef<AuditRow>[]>(() => {
    const defs: ColumnDef<AuditRow>[] = [
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
    ]

    if (full) {
      defs.push(
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
            row.original.deviceId ? (
              <Link
                href={`/devices/${row.original.deviceId}?tab=activity`}
                className="hover:underline"
              >
                {row.original.deviceName ?? shortId(row.original.deviceId)}
              </Link>
            ) : (
              "—"
            ),
        }
      )
    }

    defs.push(
      {
        accessorKey: "createdAt",
        meta: { label: "Time" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Time" />
        ),
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="text-sm whitespace-nowrap">
              {formatRelativeTime(row.original.createdAt)}
            </span>
            <span className="text-xs whitespace-nowrap text-muted-foreground">
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
          const details = Object.entries(row.original.eventData ?? {}).filter(
            ([key]) => full || !redundantDetailKeys.has(key)
          )
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
      }
    )

    return defs
  }, [full, lookups])

  const facets = React.useMemo<DataTableFacet[]>(() => {
    const list: DataTableFacet[] = [
      {
        columnId: "eventType",
        title: "Event type",
        options: (eventTypesQuery.data ?? []).map((eventType) => ({
          value: eventType,
          label: statusLabel(eventType),
        })),
      },
    ]
    if (full) {
      list.push(
        {
          columnId: "organizationId",
          title: "Organization",
          options: (organizationsQuery.data ?? []).map((organization) => ({
            value: organization.id,
            label: organization.name,
          })),
        },
        {
          columnId: "deviceId",
          title: "Device",
          options: (devicesQuery.data ?? []).map((device) => ({
            value: device.id,
            label: device.displayName,
          })),
        }
      )
    }
    return list
  }, [full, eventTypesQuery.data, organizationsQuery.data, devicesQuery.data])

  return (
    <DataTable
      className={className}
      columns={columns}
      data={pageQuery.data?.items}
      isLoading={pageQuery.isLoading}
      isFetching={pageQuery.isFetching}
      getRowId={(row) => row.id}
      pageSize={pageSize}
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
          options={auditTimeRanges.map((entry) => ({
            value: entry.value,
            label: entry.label,
          }))}
        />
      }
      facets={facets}
      showViewOptions={full}
      pageSizeOptions={full ? [25, 50, 100, 200] : [10, 25, 50]}
      emptyTitle="No events yet"
      emptyDescription={
        full
          ? "Operational changes will show up here as they happen."
          : "Changes to this device will show up here."
      }
      filteredEmptyTitle="No events match"
      filteredEmptyDescription="Try a wider time range or clear the filters."
    />
  )
}
