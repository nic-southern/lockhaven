"use client"

import * as React from "react"
import { keepPreviousData } from "@tanstack/react-query"
import type {
  ColumnDef,
  ColumnFiltersState,
  PaginationState,
  SortingState,
} from "@tanstack/react-table"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DataTable,
  DataTableColumnHeader,
} from "@/components/dashboard/data-table"
import { AccessDenied } from "@/components/dashboard/access-denied"
import { PageHeader } from "@/components/dashboard/page-header"
import { formatDate, formatRelativeTime } from "@/lib/dashboard"
import { serviceTypeLabel } from "@/lib/devices"
import { buildListQuery, columnFiltersToRecord } from "@/lib/list-query"
import { trpc } from "@/lib/trpc"
import type { RouterOutputs } from "@/lib/trpc"
import { usePermissions } from "@/lib/use-permissions"

type ApprovalRow = RouterOutputs["accessRequests"]["queue"]["items"][number]

export default function ApprovalsPage() {
  const { can, isPlatformAdmin, isLoading } = usePermissions()
  const allowed =
    isPlatformAdmin || can("organization:admin") || can("site:admin")
  const utils = trpc.useUtils()

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

  React.useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedSearch(search), 250)
    return () => window.clearTimeout(handle)
  }, [search])

  const filters = React.useMemo(
    () => columnFiltersToRecord(columnFilters),
    [columnFilters]
  )

  const pageQuery = trpc.accessRequests.queue.useQuery(
    buildListQuery({
      pagination,
      sorting,
      filters,
      search: debouncedSearch,
    }),
    {
      enabled: allowed,
      placeholderData: keepPreviousData,
      refetchInterval: 15_000,
    }
  )

  const decide = trpc.accessRequests.decide.useMutation({
    async onSuccess(_data, variables) {
      toast.success(
        variables.decision === "approved"
          ? "Access approved"
          : "Access declined"
      )
      await utils.accessRequests.queue.invalidate()
    },
    onError() {
      toast.error("We couldn't update that request.")
    },
  })

  const columns = React.useMemo<ColumnDef<ApprovalRow>[]>(
    () => [
      {
        id: "deviceName",
        accessorKey: "deviceName",
        meta: { label: "Device", className: "min-w-48" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Device" />
        ),
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium">
              {row.original.deviceName}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {row.original.siteName}
            </span>
          </div>
        ),
      },
      {
        id: "requesterEmail",
        accessorFn: (row) => row.requesterName ?? row.requesterEmail,
        meta: { label: "Requested by" },
        header: "Requested by",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <span className="truncate">
              {row.original.requesterName ?? row.original.requesterEmail}
            </span>
            {row.original.requesterName && row.original.requesterEmail ? (
              <span className="truncate text-xs text-muted-foreground">
                {row.original.requesterEmail}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: "serviceType",
        accessorKey: "serviceType",
        meta: { label: "Service" },
        header: "Service",
        enableSorting: false,
        cell: ({ row }) => (
          <Badge variant="outline">
            {row.original.serviceType
              ? (serviceTypeLabel[row.original.serviceType] ??
                row.original.serviceType)
              : "Removed"}
          </Badge>
        ),
      },
      {
        id: "reason",
        accessorKey: "reason",
        meta: { label: "Reason", className: "min-w-48" },
        header: "Reason",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.reason ? (
            <span className="line-clamp-2 text-sm">{row.original.reason}</span>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          ),
      },
      {
        id: "createdAt",
        accessorKey: "createdAt",
        meta: { label: "Requested" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Requested" />
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
        id: "expiresAt",
        accessorKey: "expiresAt",
        meta: { label: "Expires" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Expires" />
        ),
        cell: ({ row }) => (
          <span className="text-sm whitespace-nowrap text-muted-foreground">
            {formatRelativeTime(row.original.expiresAt)}
          </span>
        ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        enableHiding: false,
        meta: { className: "w-40 text-right" },
        cell: ({ row }) =>
          row.original.status === "pending" ? (
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={decide.isPending}
                onClick={() =>
                  decide.mutate({ id: row.original.id, decision: "denied" })
                }
              >
                Decline
              </Button>
              <Button
                size="sm"
                disabled={decide.isPending}
                onClick={() =>
                  decide.mutate({ id: row.original.id, decision: "approved" })
                }
              >
                Approve
              </Button>
            </div>
          ) : (
            <Badge variant="outline">{row.original.status}</Badge>
          ),
      },
    ],
    [decide]
  )

  if (!isLoading && !allowed) {
    return (
      <AccessDenied description="Approvals are limited to people who can manage this organization or site." />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Access"
        title="Approvals"
        description="Review session requests before someone connects to a device."
      />
      <DataTable
        columns={columns}
        data={pageQuery.data?.items}
        isLoading={isLoading || pageQuery.isLoading}
        isFetching={pageQuery.isFetching}
        getRowId={(row) => row.id}
        pageSize={25}
        pageSizeOptions={[25, 50, 100]}
        server={{
          rowCount: pageQuery.data?.total ?? 0,
          sorting,
          onSortingChange: (updater) => {
            setSorting(updater)
            setPagination((current) =>
              current.pageIndex === 0 ? current : { ...current, pageIndex: 0 }
            )
          },
          columnFilters,
          onColumnFiltersChange: (updater) => {
            setColumnFilters(updater)
            setPagination((current) =>
              current.pageIndex === 0 ? current : { ...current, pageIndex: 0 }
            )
          },
          pagination,
          onPaginationChange: setPagination,
        }}
        search={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPagination((current) =>
            current.pageIndex === 0 ? current : { ...current, pageIndex: 0 }
          )
        }}
        searchPlaceholder="Search device or person"
        emptyTitle="No requests waiting"
        emptyDescription="When a site requires approval, new session requests appear here."
        filteredEmptyTitle="No requests match"
        filteredEmptyDescription="Try a different search or clear the filters."
      />
    </div>
  )
}
