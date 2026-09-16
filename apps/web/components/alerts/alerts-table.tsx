"use client"

import * as React from "react"
import Link from "next/link"
import { keepPreviousData } from "@tanstack/react-query"
import type {
  ColumnDef,
  ColumnFiltersState,
  PaginationState,
  RowSelectionState,
  SortingState,
} from "@tanstack/react-table"
import { CheckCheckIcon, CheckIcon } from "lucide-react"
import { toast } from "sonner"

import { alertKindLabels, type AlertKind, type AlertStatus } from "@nms/shared"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog"
import {
  DataTable,
  DataTableColumnHeader,
  type DataTableFacet,
} from "@/components/dashboard/data-table"
import {
  SeverityBadge,
  severityLabels,
  severityOrder,
} from "@/components/dashboard/severity-badge"
import { formatDate, formatRelativeTime } from "@/lib/dashboard"
import { buildListQuery, columnFiltersToRecord } from "@/lib/list-query"
import { trpc } from "@/lib/trpc"
import type { RouterOutputs } from "@/lib/trpc"
import { usePermissions } from "@/lib/use-permissions"
import { cn } from "@/lib/utils"

export type AlertRow = RouterOutputs["alerts"]["page"]["items"][number]

const statusTabs = [
  { value: "open", label: "Needs action" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
] as const

type StatusTab = (typeof statusTabs)[number]["value"]

const statusLabels: Record<AlertStatus, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
}

export function AlertStatusBadge({
  status,
  className,
}: {
  status: AlertStatus | string
  className?: string
}) {
  const key = (status in statusLabels ? status : "open") as AlertStatus
  return (
    <Badge
      variant="outline"
      className={cn(
        "whitespace-nowrap",
        key === "open" &&
          "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        key === "acknowledged" &&
          "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
        key === "resolved" && "text-muted-foreground",
        className
      )}
    >
      {statusLabels[key]}
    </Badge>
  )
}

export function kindLabel(kind: string) {
  return alertKindLabels[kind as AlertKind] ?? kind
}

function isStatusTab(value: string | null): value is StatusTab {
  return statusTabs.some((tab) => tab.value === value)
}

export function AlertsTable({
  variant = "full",
  fixedFilters,
  initialColumnFilters,
  initialStatus = "open",
  pageSize = 25,
  className,
}: {
  /** `device` hides the device column for embedding on a device page. */
  variant?: "full" | "device"
  fixedFilters?: Record<string, string[]>
  initialColumnFilters?: ColumnFiltersState
  initialStatus?: string | null
  pageSize?: number
  className?: string
}) {
  const full = variant === "full"
  const { can } = usePermissions()
  const canAct = can("device:update")
  const utils = trpc.useUtils()
  const facetsQuery = trpc.alerts.facets.useQuery(undefined, {
    staleTime: 30_000,
  })

  const [status, setStatus] = React.useState<StatusTab>(
    isStatusTab(initialStatus) ? initialStatus : "open"
  )
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "severity", desc: false },
    { id: "lastSeenAt", desc: true },
  ])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    initialColumnFilters ?? []
  )
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize,
  })
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({})
  const [search, setSearch] = React.useState("")
  const [debouncedSearch, setDebouncedSearch] = React.useState("")
  const [pendingResolve, setPendingResolve] = React.useState<string[] | null>(
    null
  )

  React.useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedSearch(search), 250)
    return () => window.clearTimeout(handle)
  }, [search])

  const resetToFirstPage = React.useCallback(() => {
    setPagination((current) =>
      current.pageIndex === 0 ? current : { ...current, pageIndex: 0 }
    )
    setRowSelection({})
  }, [])

  const filters = React.useMemo(() => {
    const record = columnFiltersToRecord(columnFilters)
    if (status !== "all") record.status = [status]
    for (const [key, values] of Object.entries(fixedFilters ?? {})) {
      record[key] = values
    }
    return record
  }, [columnFilters, status, fixedFilters])

  const pageQuery = trpc.alerts.page.useQuery(
    buildListQuery({ pagination, sorting, filters, search: debouncedSearch }),
    { placeholderData: keepPreviousData, refetchInterval: 30_000 }
  )
  const total = pageQuery.data?.total ?? 0

  const invalidate = React.useCallback(async () => {
    await Promise.all([
      utils.alerts.page.invalidate(),
      utils.alerts.summary.invalidate(),
      utils.alerts.facets.invalidate(),
      utils.audit.page.invalidate(),
      utils.audit.facets.invalidate(),
      utils.dashboard.summary.invalidate(),
    ])
  }, [utils])

  const acknowledgeMutation = trpc.alerts.acknowledge.useMutation()
  const resolveMutation = trpc.alerts.resolve.useMutation()
  const busy = acknowledgeMutation.isPending || resolveMutation.isPending

  const acknowledge = React.useCallback(
    async (ids: string[]) => {
      try {
        await Promise.all(
          ids.map((id) => acknowledgeMutation.mutateAsync({ id }))
        )
        toast.success(
          ids.length === 1
            ? "Alert acknowledged."
            : `${ids.length} alerts acknowledged.`
        )
        setRowSelection({})
        await invalidate()
      } catch {
        toast.error("We couldn't acknowledge that alert.")
      }
    },
    [acknowledgeMutation, invalidate]
  )

  async function resolve(ids: string[]) {
    try {
      await Promise.all(ids.map((id) => resolveMutation.mutateAsync({ id })))
      toast.success(
        ids.length === 1 ? "Alert resolved." : `${ids.length} alerts resolved.`
      )
      setPendingResolve(null)
      setRowSelection({})
      await invalidate()
    } catch {
      toast.error("We couldn't resolve that alert.")
    }
  }

  const columns = React.useMemo<ColumnDef<AlertRow>[]>(() => {
    const defs: ColumnDef<AlertRow>[] = [
      {
        accessorKey: "severity",
        meta: { label: "Severity", className: "w-[7.5rem]" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Severity" />
        ),
        cell: ({ row }) => <SeverityBadge severity={row.original.severity} />,
      },
      {
        id: "kind",
        accessorKey: "title",
        meta: { label: "Alert" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Alert" />
        ),
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <span className="font-medium">{row.original.title}</span>
            <span className="text-xs text-muted-foreground">
              {kindLabel(row.original.kind)}
            </span>
          </div>
        ),
      },
    ]

    if (full) {
      defs.push({
        id: "deviceId",
        accessorKey: "deviceName",
        meta: { label: "Device" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Device" />
        ),
        cell: ({ row }) =>
          row.original.deviceId ? (
            <div className="flex min-w-0 flex-col">
              <Link
                href={`/devices/${row.original.deviceId}`}
                className="truncate hover:underline"
                onClick={(event) => event.stopPropagation()}
              >
                {row.original.deviceName ??
                  row.original.deviceHostname ??
                  "Device"}
              </Link>
              <span className="truncate text-xs text-muted-foreground">
                {row.original.siteName ?? row.original.organizationName ?? "—"}
              </span>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">
              {row.original.siteName ??
                row.original.organizationName ??
                "Whole platform"}
            </span>
          ),
      })
    }

    defs.push(
      {
        accessorKey: "occurrences",
        meta: { label: "Times", align: "right" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Times" />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.occurrences.toLocaleString()}
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
              First {formatRelativeTime(row.original.firstSeenAt)}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "status",
        meta: { label: "Status" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Status" />
        ),
        cell: ({ row }) => (
          <div className="flex flex-col gap-0.5">
            <AlertStatusBadge status={row.original.status} />
            {row.original.status === "acknowledged" &&
            (row.original.acknowledgedByName ||
              row.original.acknowledgedByEmail) ? (
              <span className="text-xs text-muted-foreground">
                by{" "}
                {row.original.acknowledgedByName ??
                  row.original.acknowledgedByEmail}
              </span>
            ) : null}
            {row.original.status === "resolved" ? (
              <span className="text-xs text-muted-foreground">
                {row.original.resolvedByName ??
                  row.original.resolvedByEmail ??
                  "Cleared automatically"}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        meta: { label: "Actions", align: "right", className: "w-[11rem]" },
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => {
          if (!canAct || row.original.status === "resolved") return null
          return (
            <div
              className="flex justify-end gap-1.5"
              onClick={(event) => event.stopPropagation()}
            >
              {row.original.status === "open" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8"
                  disabled={busy}
                  onClick={() => void acknowledge([row.original.id])}
                >
                  <CheckIcon />
                  Acknowledge
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                disabled={busy}
                onClick={() => setPendingResolve([row.original.id])}
              >
                <CheckCheckIcon />
                Resolve
              </Button>
            </div>
          )
        },
      },
      // Filter-only column so the site facet has a target.
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
  }, [full, canAct, busy, acknowledge])

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
        columnId: "kind",
        title: "Type",
        options: (data?.kind ?? []).map((entry) => ({
          value: entry.value,
          label: entry.label,
          count: entry.count,
        })),
      },
    ]
    if (full) {
      list.push({
        columnId: "siteId",
        title: "Site",
        options: (data?.siteId ?? []).map((entry) => ({
          value: entry.value,
          label: entry.label,
          count: entry.count,
        })),
      })
    }
    return list
  }, [full, facetsQuery.data])

  const statusCounts = React.useMemo(() => {
    const map = new Map(
      (facetsQuery.data?.status ?? []).map((entry) => [
        entry.value,
        entry.count,
      ])
    )
    return {
      open: map.get("open") ?? 0,
      acknowledged: map.get("acknowledged") ?? 0,
      resolved: map.get("resolved") ?? 0,
    }
  }, [facetsQuery.data])

  return (
    <>
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
        searchPlaceholder="Search alerts"
        toolbarLeading={
          <Tabs
            value={status}
            onValueChange={(value) => {
              if (!isStatusTab(value)) return
              setStatus(value)
              resetToFirstPage()
            }}
          >
            <TabsList className="h-9">
              {statusTabs.map((tab) => {
                const count =
                  tab.value === "all"
                    ? null
                    : statusCounts[tab.value as keyof typeof statusCounts]
                return (
                  <TabsTrigger key={tab.value} value={tab.value}>
                    {tab.label}
                    {count ? (
                      <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground tabular-nums">
                        {count}
                      </span>
                    ) : null}
                  </TabsTrigger>
                )
              })}
            </TabsList>
          </Tabs>
        }
        facets={facets}
        enableRowSelection={canAct}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        bulkActions={(rows) => {
          const actionable = rows.filter(
            (row) => row.original.status !== "resolved"
          )
          const openIds = actionable
            .filter((row) => row.original.status === "open")
            .map((row) => row.original.id)
          const ids = actionable.map((row) => row.original.id)
          return (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || openIds.length === 0}
                onClick={() => void acknowledge(openIds)}
              >
                <CheckIcon />
                Acknowledge
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || ids.length === 0}
                onClick={() => setPendingResolve(ids)}
              >
                <CheckCheckIcon />
                Resolve
              </Button>
            </>
          )
        }}
        renderExpanded={(row) => <AlertDetails row={row} />}
        showViewOptions={full}
        initialColumnVisibility={{ siteId: false }}
        pageSizeOptions={full ? [25, 50, 100] : [10, 25, 50]}
        emptyTitle={
          status === "open"
            ? "Nothing needs attention"
            : status === "acknowledged"
              ? "No acknowledged alerts"
              : status === "resolved"
                ? "No resolved alerts yet"
                : "No alerts yet"
        }
        emptyDescription={
          status === "open"
            ? "New alerts open here when a device goes quiet, changes address, flaps, or probes the hub."
            : "Alerts move here as they are handled."
        }
        filteredEmptyTitle="No alerts match"
        filteredEmptyDescription="Try another status or clear the filters."
      />
      <ConfirmDialog
        open={pendingResolve !== null}
        onOpenChange={(open) => {
          if (!open) setPendingResolve(null)
        }}
        title={
          pendingResolve && pendingResolve.length > 1
            ? `Resolve ${pendingResolve.length} alerts?`
            : "Resolve this alert?"
        }
        description="Resolved alerts leave the action list. If the condition comes back, a new alert opens automatically."
        confirmLabel="Resolve"
        pending={busy}
        onConfirm={() => {
          if (pendingResolve) void resolve(pendingResolve)
        }}
      />
    </>
  )
}

function AlertDetails({ row }: { row: AlertRow }) {
  const detail = row.detail ?? {}
  const entries = Object.entries(detail)
  const timeline: Array<{ label: string; value: React.ReactNode }> = [
    { label: "First seen", value: formatDate(row.firstSeenAt) },
    {
      label: "Last seen",
      value: `${formatDate(row.lastSeenAt)} · ${row.occurrences.toLocaleString()} ${row.occurrences === 1 ? "time" : "times"}`,
    },
  ]
  if (row.acknowledgedAt) {
    timeline.push({
      label: "Acknowledged",
      value: `${formatDate(row.acknowledgedAt)}${
        row.acknowledgedByName || row.acknowledgedByEmail
          ? ` by ${row.acknowledgedByName ?? row.acknowledgedByEmail}`
          : ""
      }`,
    })
  }
  if (row.resolvedAt) {
    timeline.push({
      label: "Resolved",
      value: `${formatDate(row.resolvedAt)}${
        row.resolvedByName || row.resolvedByEmail
          ? ` by ${row.resolvedByName ?? row.resolvedByEmail}`
          : " automatically"
      }`,
    })
  }
  if (row.organizationName) {
    timeline.push({ label: "Organization", value: row.organizationName })
  }
  timeline.push({
    label: "Alert ID",
    value: <span className="font-mono text-xs">{row.id}</span>,
  })

  return (
    <div
      className="grid gap-4 px-4 py-4 text-sm lg:grid-cols-2"
      onClick={(event) => event.stopPropagation()}
    >
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
        {timeline.map((entry) => (
          <React.Fragment key={entry.label}>
            <dt className="text-xs text-muted-foreground">{entry.label}</dt>
            <dd className="min-w-0 text-xs">{entry.value}</dd>
          </React.Fragment>
        ))}
      </dl>
      <div className="min-w-0">
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">
          What was observed
        </p>
        {entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No extra detail was recorded.
          </p>
        ) : (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-lg border bg-background/60 p-3">
            {entries.map(([key, value]) => (
              <React.Fragment key={key}>
                <dt className="text-xs text-muted-foreground">
                  {humanizeKey(key)}
                </dt>
                <dd className="min-w-0 text-xs break-words">
                  {Array.isArray(value)
                    ? value.map(String).join(", ")
                    : typeof value === "object" && value !== null
                      ? JSON.stringify(value)
                      : String(value)}
                </dd>
              </React.Fragment>
            ))}
          </dl>
        )}
      </div>
    </div>
  )
}

function humanizeKey(key: string) {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
