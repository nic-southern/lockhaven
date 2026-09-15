"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { keepPreviousData } from "@tanstack/react-query"
import type {
  ColumnDef,
  ColumnFiltersState,
  PaginationState,
  SortingState,
} from "@tanstack/react-table"

import { Badge } from "@/components/ui/badge"
import { CopyableText } from "@/components/dashboard/copyable-text"
import {
  DataTable,
  DataTableColumnHeader,
  DataTableRowActions,
  type DataTableFacet,
} from "@/components/dashboard/data-table"
import { StatusIndicator } from "@/components/dashboard/status-indicator"
import { formatDate, formatRelativeTime, statusLabel } from "@/lib/dashboard"
import { serviceTypeLabel } from "@/lib/devices"
import { buildListQuery, columnFiltersToRecord } from "@/lib/list-query"
import { preferredConnectionMethod } from "@/lib/remote-launch"
import { useSiteScope } from "@/lib/site-scope"
import { trpc } from "@/lib/trpc"
import type { RouterOutputs } from "@/lib/trpc"
import { useAdminVpnConnected } from "@/lib/use-admin-vpn-connected"
import { usePermissions } from "@/lib/use-permissions"
import { useRemoteLaunch } from "@/lib/use-remote-launch"

export type ServiceRow =
  RouterOutputs["managementServices"]["page"]["items"][number]

function healthTone(status: string) {
  if (status === "online") return "online" as const
  if (status === "offline") return "offline" as const
  return "neutral" as const
}

function launchPermission(serviceType: string) {
  switch (serviceType) {
    case "vnc":
      return "device:start_vnc" as const
    case "rdp":
      return "device:start_rdp" as const
    case "ssh":
      return "device:start_ssh" as const
    default:
      return null
  }
}

export function ServicesTable({ className }: { className?: string }) {
  const router = useRouter()
  const { can } = usePermissions()
  const { connected: adminVpnConnected } = useAdminVpnConnected()
  const { siteId: scopedSiteId } = useSiteScope()
  const launch = useRemoteLaunch()
  const sitesQuery = trpc.sites.list.useQuery()

  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "deviceName", desc: false },
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

  const resetToFirstPage = React.useCallback(() => {
    setPagination((current) =>
      current.pageIndex === 0 ? current : { ...current, pageIndex: 0 }
    )
  }, [])

  const filters = React.useMemo(() => {
    const record = columnFiltersToRecord(columnFilters)
    if (scopedSiteId) record.siteId = [scopedSiteId]
    return record
  }, [columnFilters, scopedSiteId])

  const pageQuery = trpc.managementServices.page.useQuery(
    buildListQuery({ pagination, sorting, filters, search: debouncedSearch }),
    { placeholderData: keepPreviousData, refetchInterval: 30_000 }
  )

  const columns = React.useMemo<ColumnDef<ServiceRow>[]>(
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
            <Link
              href={`/devices/${row.original.deviceId}?tab=services`}
              className="truncate font-medium hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              {row.original.deviceName}
            </Link>
            {row.original.deviceHostname &&
            row.original.deviceHostname !== row.original.deviceName ? (
              <span className="truncate font-mono text-xs text-muted-foreground">
                {row.original.deviceHostname}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: "siteId",
        accessorKey: "siteName",
        meta: { label: "Site" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Site" />
        ),
        cell: ({ row }) =>
          row.original.siteName ?? (
            <span className="text-muted-foreground">No site</span>
          ),
      },
      {
        id: "serviceType",
        accessorKey: "serviceType",
        meta: { label: "Service" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Service" />
        ),
        cell: ({ row }) => (
          <Badge variant="outline">
            {serviceTypeLabel[row.original.serviceType] ??
              row.original.serviceType}
          </Badge>
        ),
      },
      {
        id: "port",
        accessorKey: "port",
        meta: { label: "Endpoint" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Endpoint" />
        ),
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <CopyableText value={row.original.vpnIpv4} className="text-xs" />
            <span className="font-mono text-xs text-muted-foreground">
              :{row.original.port}
            </span>
          </div>
        ),
      },
      {
        id: "enabled",
        accessorKey: "enabled",
        meta: { label: "Enabled" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Enabled" />
        ),
        cell: ({ row }) =>
          row.original.enabled ? (
            <Badge variant="secondary">Enabled</Badge>
          ) : (
            <Badge variant="outline">Disabled</Badge>
          ),
      },
      {
        id: "healthStatus",
        accessorKey: "healthStatus",
        meta: { label: "Health" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Health" />
        ),
        cell: ({ row }) =>
          row.original.enabled ? (
            <StatusIndicator
              tone={healthTone(row.original.healthStatus)}
              label={statusLabel(row.original.healthStatus)}
              pulse={row.original.healthStatus === "online"}
            />
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          ),
      },
      {
        id: "credential",
        accessorKey: "hasSavedPassword",
        meta: { label: "Credential" },
        header: "Credential",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.serviceType === "winrm_https" ? (
            <span className="text-sm text-muted-foreground">—</span>
          ) : (
            <span className="text-sm">
              {row.original.hasSavedPassword ? "Saved" : "Prompt"}
            </span>
          ),
      },
      {
        id: "lastCheckedAt",
        accessorKey: "lastCheckedAt",
        meta: { label: "Last checked" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Last checked" />
        ),
        cell: ({ row }) => (
          <span
            className="text-sm whitespace-nowrap text-muted-foreground"
            title={
              row.original.lastCheckedAt
                ? formatDate(row.original.lastCheckedAt)
                : undefined
            }
          >
            {formatRelativeTime(row.original.lastCheckedAt)}
          </span>
        ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        enableHiding: false,
        meta: { className: "w-12 text-right" },
        cell: ({ row }) => {
          const permission = launchPermission(row.original.serviceType)
          const canLaunch =
            permission !== null && can(permission) && row.original.enabled
          return (
            <DataTableRowActions
              label={`${serviceTypeLabel[row.original.serviceType] ?? row.original.serviceType} on ${row.original.deviceName}`}
              actions={[
                ...(canLaunch
                  ? [
                      {
                        label: "Connect",
                        onSelect: () =>
                          launch.mutate({
                            deviceId: row.original.deviceId,
                            serviceId: row.original.id,
                            connectionMethod: preferredConnectionMethod({
                              vpnConnected: adminVpnConnected,
                              serviceType: row.original.serviceType,
                            }),
                          }),
                      },
                    ]
                  : []),
                {
                  label: "Open device",
                  separatorBefore: canLaunch,
                  onSelect: () =>
                    router.push(
                      `/devices/${row.original.deviceId}?tab=services`
                    ),
                },
              ]}
            />
          )
        },
      },
    ],
    [can, adminVpnConnected, launch, router]
  )

  const facets = React.useMemo<DataTableFacet[]>(() => {
    const list: DataTableFacet[] = [
      {
        columnId: "serviceType",
        title: "Service",
        options: (["vnc", "rdp", "ssh", "winrm_https"] as const).map(
          (value) => ({ value, label: serviceTypeLabel[value] ?? value })
        ),
      },
      {
        columnId: "healthStatus",
        title: "Health",
        options: [
          { value: "online", label: "Online" },
          { value: "offline", label: "Offline" },
          { value: "unknown", label: "Unknown" },
        ],
      },
      {
        columnId: "enabled",
        title: "Enabled",
        options: [
          { value: "true", label: "Enabled" },
          { value: "false", label: "Disabled" },
        ],
      },
    ]
    if (!scopedSiteId && (sitesQuery.data?.length ?? 0) > 1) {
      list.push({
        columnId: "siteId",
        title: "Site",
        options: (sitesQuery.data ?? []).map((site) => ({
          value: site.id,
          label: site.name,
        })),
      })
    }
    return list
  }, [scopedSiteId, sitesQuery.data])

  const total = pageQuery.data?.total ?? 0

  return (
    <DataTable
      className={className}
      columns={columns}
      data={pageQuery.data?.items}
      isLoading={pageQuery.isLoading}
      isFetching={pageQuery.isFetching}
      getRowId={(row) => row.id}
      pageSize={25}
      pageSizeOptions={[25, 50, 100]}
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
      searchPlaceholder="Search device or site"
      facets={facets}
      onRowClick={(row) => router.push(`/devices/${row.deviceId}?tab=services`)}
      emptyTitle="No services published"
      emptyDescription="Publish VNC, RDP, or SSH on a device to see it here."
      filteredEmptyTitle="No services match"
      filteredEmptyDescription="Try a different search or clear the filters."
    />
  )
}
