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
import { DownloadIcon } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DataTable,
  DataTableColumnHeader,
  type DataTableFacet,
} from "@/components/dashboard/data-table"
import { SelectField } from "@/components/dashboard/select-field"
import {
  SeverityBadge,
  severityLabels,
  severityOrder,
} from "@/components/dashboard/severity-badge"
import {
  auditRangeStart,
  auditTimeRanges,
  formatDetailValue,
  humanizeDetailKey,
  shortId,
  type DetailLookups,
} from "@/lib/audit"
import { formatDate, formatRelativeTime, statusLabel } from "@/lib/dashboard"
import { downloadTextFile, toCsv } from "@/lib/devices"
import { buildListQuery, columnFiltersToRecord } from "@/lib/list-query"
import { trpc } from "@/lib/trpc"
import type { RouterOutputs } from "@/lib/trpc"

export type AuditRow = RouterOutputs["audit"]["page"]["items"][number]

/** Keys that only repeat the row's own columns and add no detail. */
const redundantDetailKeys = new Set(["deviceId"])

const csvColumns = [
  { header: "Time", value: (row: AuditRow) => String(row.createdAt) },
  { header: "Event", value: (row: AuditRow) => row.eventType },
  { header: "Severity", value: (row: AuditRow) => row.severity },
  {
    header: "Actor",
    value: (row: AuditRow) => row.actorName ?? row.actorEmail ?? "System",
  },
  { header: "Actor email", value: (row: AuditRow) => row.actorEmail ?? "" },
  { header: "Actor IP", value: (row: AuditRow) => row.actorIp ?? "" },
  {
    header: "Organization",
    value: (row: AuditRow) => row.organizationName ?? "",
  },
  { header: "Site", value: (row: AuditRow) => row.siteName ?? "" },
  { header: "Device", value: (row: AuditRow) => row.deviceName ?? "" },
  { header: "Device ID", value: (row: AuditRow) => row.deviceId ?? "" },
  {
    header: "Details",
    value: (row: AuditRow) => JSON.stringify(row.eventData ?? {}),
  },
  { header: "Event ID", value: (row: AuditRow) => row.id },
]

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
  const utils = trpc.useUtils()
  const organizationsQuery = trpc.organizations.list.useQuery(undefined, {
    enabled: full,
  })
  const devicesQuery = trpc.devices.list.useQuery(undefined, { enabled: full })
  const sitesQuery = trpc.sites.list.useQuery()
  const routePoliciesQuery = trpc.routePolicies.list.useQuery()
  const facetsQuery = trpc.audit.facets.useQuery(undefined, {
    staleTime: 60_000,
  })

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
  const [exporting, setExporting] = React.useState(false)

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

  async function exportCsv() {
    setExporting(true)
    try {
      const result = await utils.audit.export.fetch({
        sort: sorting.map((entry) => ({ id: entry.id, desc: entry.desc })),
        filters,
        search: debouncedSearch || undefined,
      })
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")
      downloadTextFile(`activity-${stamp}.csv`, toCsv(result.rows, csvColumns))
      toast.success(
        result.truncated
          ? `Exported the first ${result.rows.length} events. Narrow the filters to export the rest.`
          : `Exported ${result.rows.length} ${result.rows.length === 1 ? "event" : "events"}.`
      )
    } catch {
      toast.error("We couldn't export the activity log.")
    } finally {
      setExporting(false)
    }
  }

  const columns = React.useMemo<ColumnDef<AuditRow>[]>(() => {
    const defs: ColumnDef<AuditRow>[] = [
      {
        accessorKey: "severity",
        meta: { label: "Severity", className: "w-[7.5rem]" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Severity" />
        ),
        cell: ({ row }) => <SeverityBadge severity={row.original.severity} />,
      },
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
        id: "actorUserId",
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
          id: "siteId",
          accessorKey: "siteName",
          meta: { label: "Site" },
          header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Site" />
          ),
          cell: ({ row }) => row.original.siteName ?? "—",
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
                onClick={(event) => event.stopPropagation()}
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
              {details.slice(0, 3).map(([key, value]) => (
                <div key={key} className="flex gap-1.5">
                  <span className="text-muted-foreground">
                    {humanizeDetailKey(key)}:
                  </span>
                  <span className="font-medium break-all">
                    {formatDetailValue(key, value, lookups)}
                  </span>
                </div>
              ))}
              {details.length > 3 ? (
                <span className="text-muted-foreground">
                  +{details.length - 3} more
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
    const data = facetsQuery.data
    const severityCounts = new Map(
      (data?.severity ?? []).map((entry) => [entry.value, entry.count])
    )
    const list: DataTableFacet[] = [
      {
        columnId: "severity",
        title: "Severity",
        options: severityOrder.map((severity) => ({
          value: severity,
          label: severityLabels[severity],
          count: severityCounts.get(severity),
        })),
      },
      {
        columnId: "eventType",
        title: "Event type",
        options: (data?.eventType ?? []).map((entry) => ({
          value: entry.value,
          label: statusLabel(entry.value),
          count: entry.count,
        })),
      },
      {
        columnId: "actorUserId",
        title: "Actor",
        options: (data?.actorUserId ?? []).map((entry) => ({
          value: entry.value,
          label: entry.label,
          count: entry.count,
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
          columnId: "siteId",
          title: "Site",
          options: (data?.siteId ?? []).map((entry) => ({
            value: entry.value,
            label: entry.label,
            count: entry.count,
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
  }, [full, facetsQuery.data, organizationsQuery.data, devicesQuery.data])

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
      toolbarActions={
        <Button
          variant="outline"
          size="sm"
          className="h-9"
          disabled={exporting || total === 0}
          onClick={() => void exportCsv()}
        >
          <DownloadIcon />
          {exporting ? "Exporting…" : "Export CSV"}
        </Button>
      }
      facets={facets}
      renderExpanded={(row) => <AuditEventDetails row={row} full={full} />}
      showViewOptions={full}
      initialColumnVisibility={full ? { organizationId: false } : undefined}
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

function AuditEventDetails({ row, full }: { row: AuditRow; full: boolean }) {
  const eventData = row.eventData ?? {}
  const hasData = Object.keys(eventData).length > 0
  const facts: Array<{ label: string; value: React.ReactNode }> = [
    { label: "Recorded", value: formatDate(row.createdAt) },
    {
      label: "Actor",
      value: row.actorName ?? row.actorEmail ?? "System",
    },
    { label: "Address", value: row.actorIp ?? "—" },
    {
      label: "Client",
      value: row.userAgent ? (
        <span className="break-all" title={row.userAgent}>
          {row.userAgent}
        </span>
      ) : (
        "—"
      ),
    },
  ]
  if (full) {
    facts.push(
      { label: "Organization", value: row.organizationName ?? "—" },
      { label: "Site", value: row.siteName ?? "—" },
      {
        label: "Device",
        value: row.deviceId ? (
          <Link
            href={`/devices/${row.deviceId}`}
            className="hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {row.deviceName ?? shortId(row.deviceId)}
          </Link>
        ) : (
          "—"
        ),
      }
    )
  }
  facts.push({
    label: "Event ID",
    value: <span className="font-mono text-xs">{row.id}</span>,
  })

  return (
    <div
      className="grid gap-4 px-4 py-4 text-sm lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
      onClick={(event) => event.stopPropagation()}
    >
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
        {facts.map((fact) => (
          <React.Fragment key={fact.label}>
            <dt className="text-xs text-muted-foreground">{fact.label}</dt>
            <dd className="min-w-0 text-xs">{fact.value}</dd>
          </React.Fragment>
        ))}
      </dl>
      <div className="min-w-0">
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">
          Details
        </p>
        {hasData ? (
          <pre className="max-h-72 overflow-auto rounded-lg border bg-background/60 p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
            {JSON.stringify(eventData, null, 2)}
          </pre>
        ) : (
          <p className="text-xs text-muted-foreground">
            Nothing more was recorded for this event.
          </p>
        )}
      </div>
    </div>
  )
}
