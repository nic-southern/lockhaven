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
import { BROWSER_CONNECTION_METHOD } from "@nms/shared"

import { Badge } from "@/components/ui/badge"
import {
  DataTable,
  DataTableColumnHeader,
  type DataTableFacet,
} from "@/components/dashboard/data-table"
import { SelectField } from "@/components/dashboard/select-field"
import { formatDate, formatRelativeTime, statusLabel } from "@/lib/dashboard"
import { serviceTypeLabel } from "@/lib/devices"
import { buildListQuery, columnFiltersToRecord } from "@/lib/list-query"
import { useSiteScope } from "@/lib/site-scope"
import { trpc } from "@/lib/trpc"
import type { RouterOutputs } from "@/lib/trpc"

export type SessionRow = RouterOutputs["sessions"]["page"]["items"][number]

const timeRanges = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "all", label: "All time" },
] as const

function rangeStart(range: string) {
  const now = Date.now()
  switch (range) {
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

const methodLabel: Record<string, string> = {
  [BROWSER_CONNECTION_METHOD]: "Browser",
  "custom-novnc": "Browser",
  native: "Native app",
}

export function SessionsTable({
  variant = "full",
  fixedFilters,
  pageSize = 25,
  defaultRange = "7d",
  className,
}: {
  /** `device` hides the device column for embedding on a device page. */
  variant?: "full" | "device"
  fixedFilters?: Record<string, string[]>
  pageSize?: number
  defaultRange?: (typeof timeRanges)[number]["value"]
  className?: string
}) {
  const { siteId: scopedSiteId } = useSiteScope()
  const showDevice = variant === "full"

  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "startedAt", desc: true },
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
    const start = rangeStart(range)
    if (start) record.from = [start.toISOString()]
    if (scopedSiteId && showDevice) record.siteId = [scopedSiteId]
    for (const [key, values] of Object.entries(fixedFilters ?? {})) {
      record[key] = values
    }
    return record
  }, [columnFilters, range, scopedSiteId, showDevice, fixedFilters])

  const pageQuery = trpc.sessions.page.useQuery(
    buildListQuery({ pagination, sorting, filters, search: debouncedSearch }),
    { placeholderData: keepPreviousData, refetchInterval: 30_000 }
  )

  const columns = React.useMemo<ColumnDef<SessionRow>[]>(() => {
    const defs: ColumnDef<SessionRow>[] = []
    if (showDevice) {
      defs.push({
        id: "deviceName",
        accessorKey: "deviceName",
        meta: { label: "Device", className: "min-w-48" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Device" />
        ),
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <Link
              href={`/devices/${row.original.deviceId}?tab=network`}
              className="truncate font-medium hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              {row.original.deviceName}
            </Link>
            <span className="truncate text-xs text-muted-foreground">
              {row.original.siteName ?? "No site"}
            </span>
          </div>
        ),
      })
    }
    defs.push(
      {
        id: "serviceType",
        accessorKey: "serviceType",
        meta: { label: "Service" },
        header: "Service",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Badge variant="outline">
              {row.original.serviceType
                ? (serviceTypeLabel[row.original.serviceType] ??
                  row.original.serviceType)
                : "Removed"}
            </Badge>
            {row.original.servicePort ? (
              <span className="font-mono text-xs text-muted-foreground">
                :{row.original.servicePort}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: "actorEmail",
        accessorKey: "actorEmail",
        meta: { label: "Started by" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Started by" />
        ),
        cell: ({ row }) =>
          row.original.actorName || row.original.actorEmail ? (
            <div className="flex min-w-0 flex-col">
              <span className="truncate">
                {row.original.actorName ?? row.original.actorEmail}
              </span>
              {row.original.actorName && row.original.actorEmail ? (
                <span className="truncate text-xs text-muted-foreground">
                  {row.original.actorEmail}
                </span>
              ) : null}
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">Unknown</span>
          ),
      },
      {
        id: "connectionMethod",
        accessorKey: "connectionMethod",
        meta: { label: "Method" },
        header: "Method",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm">
            {methodLabel[row.original.connectionMethod] ??
              statusLabel(row.original.connectionMethod)}
          </span>
        ),
      },
      {
        id: "status",
        accessorKey: "status",
        meta: { label: "State" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="State" />
        ),
        cell: ({ row }) =>
          row.original.endedAt ? (
            <Badge variant="outline">Ended</Badge>
          ) : (
            <Badge variant="secondary">
              {statusLabel(row.original.status)}
            </Badge>
          ),
      },
      {
        id: "startedAt",
        accessorKey: "startedAt",
        meta: { label: "Started" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Started" />
        ),
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="text-sm whitespace-nowrap">
              {formatRelativeTime(row.original.startedAt)}
            </span>
            <span className="text-xs whitespace-nowrap text-muted-foreground">
              {formatDate(row.original.startedAt)}
            </span>
          </div>
        ),
      },
      {
        id: "endedAt",
        accessorKey: "endedAt",
        meta: { label: "Ended" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Ended" />
        ),
        cell: ({ row }) =>
          row.original.endedAt ? (
            <span
              className="text-sm whitespace-nowrap text-muted-foreground"
              title={formatDate(row.original.endedAt)}
            >
              {formatRelativeTime(row.original.endedAt)}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          ),
      }
    )
    return defs
  }, [showDevice])

  const facets = React.useMemo<DataTableFacet[]>(
    () => [
      {
        columnId: "serviceType",
        title: "Service",
        options: (["vnc", "rdp", "ssh", "winrm_https"] as const).map(
          (value) => ({ value, label: serviceTypeLabel[value] ?? value })
        ),
      },
      {
        columnId: "connectionMethod",
        title: "Method",
        options: [
          { value: BROWSER_CONNECTION_METHOD, label: "Browser" },
          { value: "native", label: "Native app" },
        ],
      },
    ],
    []
  )

  const total = pageQuery.data?.total ?? 0

  return (
    <DataTable
      className={className}
      columns={columns}
      data={pageQuery.data?.items}
      isLoading={pageQuery.isLoading}
      isFetching={pageQuery.isFetching}
      getRowId={(row) => row.id}
      pageSize={pageSize}
      pageSizeOptions={variant === "device" ? [10, 25, 50] : [25, 50, 100]}
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
        showDevice ? "Search device or person" : "Search by person"
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
          options={timeRanges.map((entry) => ({
            value: entry.value,
            label: entry.label,
          }))}
        />
      }
      facets={facets}
      showViewOptions={showDevice}
      emptyTitle="No sessions yet"
      emptyDescription={
        showDevice
          ? "Remote sessions started from the console will appear here."
          : "No one has connected to this device in the selected range."
      }
      filteredEmptyTitle="No sessions match"
      filteredEmptyDescription="Try a wider time range or clear the filters."
    />
  )
}
