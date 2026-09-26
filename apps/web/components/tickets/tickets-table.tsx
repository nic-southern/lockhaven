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

import {
  ticketPriorities,
  ticketPriorityLabels,
  ticketStatuses,
  ticketStatusLabels,
  type TicketPriority,
  type TicketStatus,
} from "@nms/shared"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  DataTable,
  DataTableColumnHeader,
  type DataTableFacet,
} from "@/components/dashboard/data-table"
import { formatRelativeTime } from "@/lib/dashboard"
import { buildListQuery, columnFiltersToRecord } from "@/lib/list-query"
import { trpc } from "@/lib/trpc"
import type { RouterOutputs } from "@/lib/trpc"
import { cn } from "@/lib/utils"

export type TicketRow = RouterOutputs["tickets"]["page"]["items"][number]

const statusTabs = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "all", label: "All" },
] as const

type StatusTab = (typeof statusTabs)[number]["value"]

function isStatusTab(value: string | null): value is StatusTab {
  return statusTabs.some((tab) => tab.value === value)
}

export function TicketStatusBadge({
  status,
  className,
}: {
  status: TicketStatus | string
  className?: string
}) {
  const key = (status in ticketStatusLabels ? status : "open") as TicketStatus
  return (
    <Badge
      variant="outline"
      className={cn(
        "whitespace-nowrap",
        key === "open" &&
          "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        key === "in_progress" &&
          "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
        key === "done" && "text-muted-foreground",
        className
      )}
    >
      {ticketStatusLabels[key]}
    </Badge>
  )
}

export function TicketPriorityBadge({
  priority,
  className,
}: {
  priority: TicketPriority | string
  className?: string
}) {
  const key = (
    priority in ticketPriorityLabels ? priority : "medium"
  ) as TicketPriority
  return (
    <Badge
      variant="outline"
      className={cn(
        "whitespace-nowrap",
        key === "critical" &&
          "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
        key === "high" &&
          "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
        key === "medium" &&
          "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        key === "low" && "text-muted-foreground",
        className
      )}
    >
      {ticketPriorityLabels[key]}
    </Badge>
  )
}

export function TicketsTable({
  initialStatus = "open",
  fixedFilters,
  pageSize = 25,
  className,
}: {
  initialStatus?: string | null
  fixedFilters?: Record<string, string[]>
  pageSize?: number
  className?: string
}) {
  const [status, setStatus] = React.useState<StatusTab>(
    isStatusTab(initialStatus) ? initialStatus : "open"
  )
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "updatedAt", desc: true },
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
    if (status !== "all") {
      record.status = [status]
    }
    return { ...record, ...fixedFilters }
  }, [columnFilters, status, fixedFilters])

  const pageQuery = trpc.tickets.page.useQuery(
    buildListQuery({ pagination, sorting, filters, search: debouncedSearch }),
    { placeholderData: keepPreviousData, refetchInterval: 30_000 }
  )
  const total = pageQuery.data?.total ?? 0

  const columns = React.useMemo<ColumnDef<TicketRow>[]>(
    () => [
      {
        id: "title",
        accessorKey: "title",
        meta: { label: "Ticket" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Ticket" />
        ),
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              href={`/tickets/${row.original.id}`}
              className="font-medium text-foreground hover:underline"
            >
              {row.original.title}
            </Link>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {[row.original.siteName, row.original.deviceName]
                .filter(Boolean)
                .join(" · ") || row.original.organizationName}
            </p>
          </div>
        ),
      },
      {
        id: "status",
        accessorKey: "status",
        meta: { label: "Status" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Status" />
        ),
        cell: ({ row }) => <TicketStatusBadge status={row.original.status} />,
        enableColumnFilter: true,
      },
      {
        id: "priority",
        accessorKey: "priority",
        meta: { label: "Priority" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Priority" />
        ),
        cell: ({ row }) => (
          <TicketPriorityBadge priority={row.original.priority} />
        ),
        enableColumnFilter: true,
      },
      {
        id: "updatedAt",
        accessorKey: "updatedAt",
        meta: { label: "Updated" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Updated" />
        ),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-muted-foreground">
            {formatRelativeTime(row.original.updatedAt)}
          </span>
        ),
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        meta: { label: "Actions", align: "right", className: "w-[7rem]" },
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" className="h-8" asChild>
              <Link href={`/tickets/${row.original.id}`}>Open</Link>
            </Button>
          </div>
        ),
      },
    ],
    []
  )

  const facets = React.useMemo<DataTableFacet[]>(
    () => [
      {
        columnId: "priority",
        title: "Priority",
        options: ticketPriorities.map((value) => ({
          value,
          label: ticketPriorityLabels[value],
        })),
      },
      {
        columnId: "status",
        title: "Status",
        options: ticketStatuses.map((value) => ({
          value,
          label: ticketStatusLabels[value],
        })),
      },
    ],
    []
  )

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
      searchPlaceholder="Search tickets"
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
            {statusTabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      }
      facets={facets}
      emptyTitle={
        status === "open"
          ? "No open tickets"
          : status === "in_progress"
            ? "Nothing in progress"
            : status === "done"
              ? "No completed tickets yet"
              : "No tickets yet"
      }
      emptyDescription={
        status === "open"
          ? "Open a ticket from an alert, a device, or create one here."
          : "Tickets move here as they are handled."
      }
      filteredEmptyTitle="No tickets match"
      filteredEmptyDescription="Try another status or clear the filters."
    />
  )
}
