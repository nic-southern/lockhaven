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
import { CheckCheckIcon, CheckIcon, ClockIcon, TicketIcon } from "lucide-react"
import { toast } from "sonner"

import {
  alertKindLabels,
  isAlertSnoozed,
  type AlertKind,
  type AlertStatus,
} from "@nms/shared"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
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
  { value: "snoozed", label: "Snoozed" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
] as const

type StatusTab = (typeof statusTabs)[number]["value"]

const statusLabels: Record<AlertStatus, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  suppressed: "Held",
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
        key === "suppressed" &&
          "border-stone-500/30 bg-stone-500/10 text-muted-foreground",
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
  const [untilAlertId, setUntilAlertId] = React.useState<string | null>(null)
  const [untilValue, setUntilValue] = React.useState("")

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
    if (status === "snoozed") {
      record.snoozed = ["yes"]
    } else if (status !== "all") {
      record.status = [status]
      if (status === "open") record.snoozed = ["no"]
    }
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
  const snoozeMutation = trpc.alerts.snooze.useMutation()
  const busy =
    acknowledgeMutation.isPending ||
    resolveMutation.isPending ||
    snoozeMutation.isPending

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

  const snooze = React.useCallback(
    async (
      ids: string[],
      input: { hours?: 1 | 8 | 24; until?: Date; clear?: boolean }
    ) => {
      try {
        await Promise.all(
          ids.map((id) => snoozeMutation.mutateAsync({ id, ...input }))
        )
        toast.success(
          input.clear
            ? ids.length === 1
              ? "Snooze cleared."
              : `${ids.length} snoozes cleared.`
            : ids.length === 1
              ? "Alert snoozed."
              : `${ids.length} alerts snoozed.`
        )
        setUntilAlertId(null)
        setRowSelection({})
        await invalidate()
      } catch {
        toast.error("We couldn't snooze that alert.")
      }
    },
    [snoozeMutation, invalidate]
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
          ) : row.original.assetId ? (
            <div className="flex min-w-0 flex-col">
              <Link
                href={`/assets?id=${row.original.assetId}`}
                className="truncate hover:underline"
                onClick={(event) => event.stopPropagation()}
              >
                {row.original.assetTag ?? "Asset"}
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
        cell: ({ row }) => {
          const snoozed = isAlertSnoozed(
            row.original.snoozedUntil
              ? new Date(row.original.snoozedUntil)
              : null,
            new Date()
          )
          return (
            <div className="flex flex-col gap-0.5">
              {snoozed ? (
                <Badge
                  variant="outline"
                  className="border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300"
                >
                  Snoozed
                </Badge>
              ) : (
                <AlertStatusBadge status={row.original.status} />
              )}
              {snoozed && row.original.snoozedUntil ? (
                <span className="text-xs text-muted-foreground">
                  until {formatRelativeTime(row.original.snoozedUntil)}
                </span>
              ) : null}
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
          )
        },
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        meta: { label: "Actions", align: "right", className: "w-[14rem]" },
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => {
          if (!canAct || row.original.status === "resolved") return null
          const snoozed = isAlertSnoozed(
            row.original.snoozedUntil
              ? new Date(row.original.snoozedUntil)
              : null,
            new Date()
          )
          return (
            <div
              className="flex justify-end gap-1.5"
              onClick={(event) => event.stopPropagation()}
            >
              {row.original.status === "open" && !snoozed ? (
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8"
                    disabled={busy}
                  >
                    <ClockIcon />
                    Snooze
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => void snooze([row.original.id], { hours: 1 })}
                  >
                    1 hour
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => void snooze([row.original.id], { hours: 8 })}
                  >
                    8 hours
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      void snooze([row.original.id], { hours: 24 })
                    }
                  >
                    24 hours
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setUntilAlertId(row.original.id)}
                  >
                    Until a date
                  </DropdownMenuItem>
                  {snoozed ? (
                    <DropdownMenuItem
                      onClick={() =>
                        void snooze([row.original.id], { clear: true })
                      }
                    >
                      Clear snooze
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
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
      {
        id: "siteId",
        accessorKey: "siteName",
        meta: { label: "Site" },
        header: "Site",
        enableHiding: false,
        cell: () => null,
      },
      {
        id: "snoozed",
        accessorFn: (row) =>
          isAlertSnoozed(
            row.snoozedUntil ? new Date(row.snoozedUntil) : null,
            new Date()
          )
            ? "yes"
            : "no",
        meta: { label: "Snoozed" },
        header: "Snoozed",
        enableHiding: false,
        cell: () => null,
      }
    )

    return defs
  }, [full, canAct, busy, acknowledge, snooze])

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
    list.push({
      columnId: "snoozed",
      title: "Snoozed",
      options: [
        {
          value: "yes",
          label: "Snoozed",
          count: data?.snoozed,
        },
        { value: "no", label: "Not snoozed" },
      ],
    })
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
      snoozed: facetsQuery.data?.snoozed ?? 0,
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
            .filter(
              (row) =>
                row.original.status === "open" &&
                !isAlertSnoozed(
                  row.original.snoozedUntil
                    ? new Date(row.original.snoozedUntil)
                    : null,
                  new Date()
                )
            )
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || ids.length === 0}
                  >
                    <ClockIcon />
                    Snooze
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => void snooze(ids, { hours: 1 })}
                  >
                    1 hour
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => void snooze(ids, { hours: 8 })}
                  >
                    8 hours
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => void snooze(ids, { hours: 24 })}
                  >
                    24 hours
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
        initialColumnVisibility={{ siteId: false, snoozed: false }}
        pageSizeOptions={full ? [25, 50, 100] : [10, 25, 50]}
        emptyTitle={
          status === "open"
            ? "Nothing needs attention"
            : status === "acknowledged"
              ? "No acknowledged alerts"
              : status === "snoozed"
                ? "No snoozed alerts"
                : status === "resolved"
                  ? "No resolved alerts yet"
                  : "No alerts yet"
        }
        emptyDescription={
          status === "open"
            ? "New alerts open here when a device goes quiet, changes address, flaps, or probes the hub."
            : status === "snoozed"
              ? "Snoozed alerts return here when the snooze ends."
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
      <Dialog
        open={untilAlertId !== null}
        onOpenChange={(open) => {
          if (!open) setUntilAlertId(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Snooze until</DialogTitle>
            <DialogDescription>
              The alert stays off the action list until this time.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="datetime-local"
            value={untilValue}
            onChange={(event) => setUntilValue(event.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setUntilAlertId(null)}>
              Cancel
            </Button>
            <Button
              disabled={!untilValue || busy}
              onClick={() => {
                if (!untilAlertId || !untilValue) return
                void snooze([untilAlertId], { until: new Date(untilValue) })
              }}
            >
              Snooze
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function AlertDetails({ row }: { row: AlertRow }) {
  const { can } = usePermissions()
  const canAct = can("device:update")
  const createFromAlert = trpc.tickets.createFromAlert.useMutation()
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
  if (row.snoozedUntil) {
    timeline.push({
      label: "Snoozed until",
      value: `${formatDate(row.snoozedUntil)}${
        row.snoozedByName || row.snoozedByEmail
          ? ` by ${row.snoozedByName ?? row.snoozedByEmail}`
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

  async function openTicket() {
    try {
      const result = await createFromAlert.mutateAsync({ alertId: row.id })
      toast.success(
        result.created ? "Ticket opened" : "A ticket is already open"
      )
      if (result.id) {
        window.location.assign(`/tickets/${result.id}`)
      }
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "We couldn't open a ticket. Try again in a moment."
      )
    }
  }

  return (
    <div
      className="grid gap-4 px-4 py-4 text-sm lg:grid-cols-2"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex flex-col gap-3">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
          {timeline.map((entry) => (
            <React.Fragment key={entry.label}>
              <dt className="text-xs text-muted-foreground">{entry.label}</dt>
              <dd className="min-w-0 text-xs">{entry.value}</dd>
            </React.Fragment>
          ))}
        </dl>
        {canAct ? (
          <div>
            <Button
              size="sm"
              variant="outline"
              disabled={createFromAlert.isPending}
              onClick={() => void openTicket()}
            >
              <TicketIcon />
              {createFromAlert.isPending ? "Opening…" : "Open ticket"}
            </Button>
          </div>
        ) : null}
      </div>
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
