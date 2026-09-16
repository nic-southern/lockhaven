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
import { auditRangeStart, auditTimeRanges } from "@/lib/audit"
import { formatBytes, formatDate, formatRelativeTime } from "@/lib/dashboard"
import { downloadTextFile, toCsv } from "@/lib/devices"
import { buildListQuery, columnFiltersToRecord } from "@/lib/list-query"
import { trpc } from "@/lib/trpc"
import type { RouterOutputs } from "@/lib/trpc"
import { cn } from "@/lib/utils"

export type ConnectionRow = RouterOutputs["network"]["page"]["items"][number]

const protocolLabels: Record<string, string> = {
  tcp: "TCP",
  udp: "UDP",
  icmp: "ICMP",
  other: "Other",
}

const verdictLabels: Record<string, string> = {
  accept: "Allowed",
  drop: "Blocked",
}

const directionLabels: Record<string, string> = {
  hub: "To the hub",
  forward: "Through the tunnel",
}

const subjectLabels: Record<string, string> = {
  device: "Devices",
  admin: "Admin clients",
  unknown: "Unrecognized peers",
}

function sourceLabel(row: ConnectionRow) {
  if (row.deviceId) return row.deviceName ?? row.deviceHostname ?? "Device"
  if (row.adminProfileId) {
    return row.adminLabel ?? row.adminUserName ?? row.adminUserEmail ?? "Admin"
  }
  return row.srcIp ?? "Unknown"
}

const csvColumns = [
  { header: "Source", value: sourceLabel },
  {
    header: "Source type",
    value: (row: ConnectionRow) =>
      row.deviceId ? "device" : row.adminProfileId ? "admin" : "unknown",
  },
  { header: "Site", value: (row: ConnectionRow) => row.siteName ?? "" },
  { header: "Destination", value: (row: ConnectionRow) => row.dstIp },
  {
    header: "Port",
    value: (row: ConnectionRow) => (row.dstPort > 0 ? row.dstPort : ""),
  },
  { header: "Protocol", value: (row: ConnectionRow) => row.protocol },
  { header: "Direction", value: (row: ConnectionRow) => row.direction },
  { header: "Verdict", value: (row: ConnectionRow) => row.verdict },
  { header: "Connections", value: (row: ConnectionRow) => row.connections },
  { header: "Bytes", value: (row: ConnectionRow) => row.bytes },
  {
    header: "First seen",
    value: (row: ConnectionRow) => String(row.firstSeenAt),
  },
  {
    header: "Last seen",
    value: (row: ConnectionRow) => String(row.lastSeenAt),
  },
  { header: "Device ID", value: (row: ConnectionRow) => row.deviceId ?? "" },
]

export function VerdictBadge({
  verdict,
  className,
}: {
  verdict: string
  className?: string
}) {
  const blocked = verdict === "drop"
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 whitespace-nowrap",
        blocked
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        className
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          blocked ? "bg-destructive" : "bg-emerald-500"
        )}
        aria-hidden
      />
      {verdictLabels[verdict] ?? verdict}
    </Badge>
  )
}

export function ConnectionLogTable({
  variant = "full",
  fixedFilters,
  pageSize = 25,
  defaultRange = "24h",
  className,
}: {
  /** `device` hides the source column for embedding on a device page. */
  variant?: "full" | "device"
  fixedFilters?: Record<string, string[]>
  pageSize?: number
  defaultRange?: (typeof auditTimeRanges)[number]["value"]
  className?: string
}) {
  const full = variant === "full"
  const utils = trpc.useUtils()
  const facetsQuery = trpc.network.facets.useQuery(undefined, {
    enabled: full,
    staleTime: 60_000,
  })

  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "lastSeenAt", desc: true },
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

  const pageQuery = trpc.network.page.useQuery(
    buildListQuery({ pagination, sorting, filters, search: debouncedSearch }),
    { placeholderData: keepPreviousData, refetchInterval: 30_000 }
  )
  const total = pageQuery.data?.total ?? 0

  async function exportCsv() {
    setExporting(true)
    try {
      const result = await utils.network.export.fetch({
        sort: sorting.map((entry) => ({ id: entry.id, desc: entry.desc })),
        filters,
        search: debouncedSearch || undefined,
      })
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")
      downloadTextFile(
        `connections-${stamp}.csv`,
        toCsv(result.rows, csvColumns)
      )
      toast.success(
        result.truncated
          ? `Exported the first ${result.rows.length} rows. Narrow the filters to export the rest.`
          : `Exported ${result.rows.length} ${result.rows.length === 1 ? "row" : "rows"}.`
      )
    } catch {
      toast.error("We couldn't export the connection log.")
    } finally {
      setExporting(false)
    }
  }

  const columns = React.useMemo<ColumnDef<ConnectionRow>[]>(() => {
    const defs: ColumnDef<ConnectionRow>[] = []

    if (full) {
      defs.push({
        id: "deviceId",
        accessorFn: sourceLabel,
        meta: { label: "Source" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Source" />
        ),
        cell: ({ row }) => {
          const entry = row.original
          if (entry.deviceId) {
            return (
              <div className="flex min-w-0 flex-col">
                <Link
                  href={`/devices/${entry.deviceId}?tab=network`}
                  className="truncate font-medium hover:underline"
                >
                  {sourceLabel(entry)}
                </Link>
                <span className="truncate text-xs text-muted-foreground">
                  {entry.siteName ?? entry.deviceHostname ?? "—"}
                </span>
              </div>
            )
          }
          if (entry.adminProfileId) {
            return (
              <div className="flex min-w-0 flex-col">
                <span className="flex items-center gap-1.5 truncate font-medium">
                  {sourceLabel(entry)}
                  <Badge variant="secondary" className="text-[10px]">
                    Admin
                  </Badge>
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {entry.adminUserEmail ?? "Admin client"}
                </span>
              </div>
            )
          }
          return (
            <div className="flex min-w-0 flex-col">
              <span className="font-mono text-sm">{entry.srcIp ?? "—"}</span>
              <span className="text-xs text-muted-foreground">
                Unrecognized peer
              </span>
            </div>
          )
        },
      })
    }

    defs.push(
      {
        accessorKey: "dstIp",
        meta: { label: "Destination" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Destination" />
        ),
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <span className="font-mono text-sm">
              {row.original.dstIp}
              {row.original.dstPort > 0 ? (
                <span className="text-muted-foreground">
                  :{row.original.dstPort}
                </span>
              ) : null}
            </span>
            <span className="text-xs text-muted-foreground">
              {protocolLabels[row.original.protocol] ?? row.original.protocol}
              {" · "}
              {directionLabels[row.original.direction] ??
                row.original.direction}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "verdict",
        meta: { label: "Verdict", className: "w-[7rem]" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Verdict" />
        ),
        cell: ({ row }) => <VerdictBadge verdict={row.original.verdict} />,
      },
      {
        accessorKey: "connections",
        meta: { label: "Connections", align: "right" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Connections" />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.connections.toLocaleString()}
          </span>
        ),
      },
      {
        accessorKey: "bytes",
        meta: { label: "Data", align: "right" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Data" />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground tabular-nums">
            {row.original.bytes > 0 ? formatBytes(row.original.bytes) : "—"}
          </span>
        ),
      },
      {
        accessorKey: "lastSeenAt",
        meta: { label: "Last seen" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Last seen" />
        ),
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="text-sm whitespace-nowrap">
              {formatRelativeTime(row.original.lastSeenAt)}
            </span>
            <span className="text-xs whitespace-nowrap text-muted-foreground">
              {formatDate(row.original.lastSeenAt)}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "firstSeenAt",
        meta: { label: "First seen" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="First seen" />
        ),
        cell: ({ row }) => (
          <span className="text-sm whitespace-nowrap text-muted-foreground">
            {formatDate(row.original.firstSeenAt)}
          </span>
        ),
      },
      // Filter-only columns; never rendered but give the facets a target.
      {
        id: "protocol",
        accessorKey: "protocol",
        meta: { label: "Protocol" },
        header: "Protocol",
        enableHiding: false,
        cell: () => null,
      },
      {
        id: "direction",
        accessorKey: "direction",
        meta: { label: "Direction" },
        header: "Direction",
        enableHiding: false,
        cell: () => null,
      },
      {
        id: "subject",
        accessorFn: (row) =>
          row.deviceId ? "device" : row.adminProfileId ? "admin" : "unknown",
        meta: { label: "Source type" },
        header: "Source type",
        enableHiding: false,
        cell: () => null,
      },
      {
        id: "siteId",
        accessorKey: "siteName",
        meta: { label: "Site" },
        header: "Site",
        enableHiding: false,
        cell: () => null,
      }
    )

    return defs
  }, [full])

  const facets = React.useMemo<DataTableFacet[]>(() => {
    const data = facetsQuery.data
    const list: DataTableFacet[] = [
      {
        columnId: "verdict",
        title: "Verdict",
        options: ["accept", "drop"].map((value) => ({
          value,
          label: verdictLabels[value],
          count: data?.verdict.find((entry) => entry.value === value)?.count,
        })),
      },
      {
        columnId: "protocol",
        title: "Protocol",
        options: (data?.protocol ?? []).map((entry) => ({
          value: entry.value,
          label: protocolLabels[entry.value] ?? entry.value,
          count: entry.count,
        })),
      },
      {
        columnId: "direction",
        title: "Direction",
        options: ["hub", "forward"].map((value) => ({
          value,
          label: directionLabels[value],
          count: data?.direction.find((entry) => entry.value === value)?.count,
        })),
      },
    ]
    if (full) {
      list.push(
        {
          columnId: "subject",
          title: "Source type",
          options: ["device", "admin", "unknown"].map((value) => ({
            value,
            label: subjectLabels[value],
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
          options: (data?.deviceId ?? []).map((entry) => ({
            value: entry.value,
            label: entry.label,
            count: entry.count,
          })),
        }
      )
    }
    return list
  }, [full, facetsQuery.data])

  return (
    <DataTable
      className={className}
      columns={columns}
      data={pageQuery.data?.items}
      isLoading={pageQuery.isLoading}
      isFetching={pageQuery.isFetching}
      getRowId={(row) =>
        `${row.subjectKey}|${row.direction}|${row.verdict}|${row.protocol}|${row.dstIp}|${row.dstPort}`
      }
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
      searchPlaceholder={
        full ? "Search devices or addresses" : "Search addresses"
      }
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
      showViewOptions={full}
      initialColumnVisibility={{
        firstSeenAt: false,
        protocol: false,
        direction: false,
        subject: false,
        siteId: false,
      }}
      pageSizeOptions={full ? [25, 50, 100, 200] : [10, 25, 50]}
      emptyTitle="No connections recorded"
      emptyDescription={
        full
          ? "New connections through the tunnel will appear here within a minute of being made."
          : "Connections from this device will appear here within a minute of being made."
      }
      filteredEmptyTitle="No connections match"
      filteredEmptyDescription="Try a wider time range or clear the filters."
    />
  )
}
