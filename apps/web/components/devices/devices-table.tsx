"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { keepPreviousData } from "@tanstack/react-query"
import type {
  ColumnDef,
  PaginationState,
  RowSelectionState,
} from "@tanstack/react-table"
import {
  ArchiveIcon,
  DownloadIcon,
  MapPinIcon,
  MoreHorizontalIcon,
  RouteIcon,
  TagIcon,
} from "lucide-react"
import { toast } from "sonner"
import {
  archiveScopeShowsArchived,
  resolveDeviceArchiveScope,
  type DeviceBulkAction,
} from "@nms/shared"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Toggle } from "@/components/ui/toggle"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { CopyableText } from "@/components/dashboard/copyable-text"
import { CsvImportDialog } from "@/components/dashboard/csv-import-dialog"
import {
  DataTable,
  DataTableColumnHeader,
  DataTableRowActions,
  type DataTableFacet,
} from "@/components/dashboard/data-table"
import {
  BulkActionDialog,
  type BulkActionKind,
} from "@/components/devices/bulk-action-dialog"
import { ConnectivityBadge } from "@/components/devices/connectivity-badge"
import { TagChips } from "@/components/devices/tag-chips"
import { ViewsMenu } from "@/components/devices/views-menu"
import {
  formatDate,
  formatRelativeTime,
  statusLabel,
  statusVariant,
} from "@/lib/dashboard"
import {
  connectivityLabel,
  downloadTextFile,
  osFamilyLabel,
  serviceTypeLabel,
  toCsv,
} from "@/lib/devices"
import { buildListQuery, columnFiltersToRecord } from "@/lib/list-query"
import { useSiteScope } from "@/lib/site-scope"
import type { SavedView, TableViewState } from "@/lib/table-view-state"
import { trpc } from "@/lib/trpc"
import type { RouterOutputs } from "@/lib/trpc"

export type DeviceRow = RouterOutputs["devices"]["page"]["items"][number]

export const DEVICES_DEFAULT_VIEW: TableViewState = {
  sorting: [{ id: "lastSeenAt", desc: true }],
  columnFilters: [],
  search: "",
  columnVisibility: {
    status: false,
    vpnLatestEndpoint: false,
    agentVersion: false,
    behind: false,
    archived: false,
    createdAt: false,
  },
}

export const DEVICES_BUILT_IN_VIEWS: SavedView[] = [
  {
    id: "all",
    name: "All devices",
    builtIn: true,
    state: DEVICES_DEFAULT_VIEW,
  },
  {
    id: "online",
    name: "Online now",
    builtIn: true,
    state: {
      ...DEVICES_DEFAULT_VIEW,
      columnFilters: [{ id: "connectivity", value: ["online"] }],
    },
  },
  {
    id: "attention",
    name: "Needs attention",
    builtIn: true,
    state: {
      ...DEVICES_DEFAULT_VIEW,
      columnFilters: [{ id: "connectivity", value: ["offline", "never"] }],
    },
  },
  {
    id: "revoked",
    name: "Revoked",
    builtIn: true,
    state: {
      ...DEVICES_DEFAULT_VIEW,
      columnFilters: [{ id: "connectivity", value: ["revoked"] }],
    },
  },
  {
    id: "behind",
    name: "Agent behind",
    builtIn: true,
    state: {
      ...DEVICES_DEFAULT_VIEW,
      columnVisibility: {
        ...DEVICES_DEFAULT_VIEW.columnVisibility,
        agentVersion: true,
      },
      columnFilters: [{ id: "behind", value: ["true"] }],
    },
  },
  {
    id: "archived",
    name: "Archived",
    builtIn: true,
    state: {
      ...DEVICES_DEFAULT_VIEW,
      columnFilters: [{ id: "archived", value: ["yes"] }],
    },
  },
]

const csvColumns = [
  { header: "Name", value: (row: DeviceRow) => row.displayName },
  { header: "Hostname", value: (row: DeviceRow) => row.hostname },
  { header: "Site", value: (row: DeviceRow) => row.siteName },
  {
    header: "Connectivity",
    value: (row: DeviceRow) => connectivityLabel[row.connectivity],
  },
  {
    header: "Status",
    value: (row: DeviceRow) => statusLabel(row.status),
  },
  {
    header: "Archived",
    value: (row: DeviceRow) => (row.archivedAt ? "Yes" : "No"),
  },
  { header: "OS", value: (row: DeviceRow) => osFamilyLabel(row.osFamily) },
  { header: "OS version", value: (row: DeviceRow) => row.osVersion },
  { header: "Tunnel address", value: (row: DeviceRow) => row.vpnIpv4 },
  { header: "Endpoint", value: (row: DeviceRow) => row.vpnLatestEndpoint },
  { header: "Route policy", value: (row: DeviceRow) => row.vpnRoutePolicyName },
  { header: "Tags", value: (row: DeviceRow) => row.tags },
  {
    header: "Services",
    value: (row: DeviceRow) =>
      row.enabledServiceTypes.map((type) => serviceTypeLabel[type] ?? type),
  },
  { header: "Agent", value: (row: DeviceRow) => row.agentVersion },
  {
    header: "Last handshake",
    value: (row: DeviceRow) => row.vpnLastHandshakeAt,
  },
  { header: "Last seen", value: (row: DeviceRow) => row.lastSeenAt },
  { header: "Enrolled", value: (row: DeviceRow) => row.createdAt },
  { header: "Serial", value: (row: DeviceRow) => row.serialNumber },
  { header: "Asset", value: (row: DeviceRow) => row.assetTag },
  { header: "Notes", value: (row: DeviceRow) => row.notes },
  { header: "Id", value: (row: DeviceRow) => row.id },
]

export function DevicesTable({
  view,
  onViewChange,
  variant = "full",
  pageSize = 25,
  fixedFilters,
  className,
}: {
  view: TableViewState
  /**
   * Receives a partial patch (or a full replacement when applying a saved
   * view). Parents merge against their latest state so back-to-back updates
   * such as "reset filters" + "clear search" never clobber each other.
   */
  onViewChange: (patch: Partial<TableViewState>) => void
  /** `compact` drops selection, views, and secondary columns for embedding. */
  variant?: "full" | "compact"
  pageSize?: number
  /** Filters always applied on top of the user's own (e.g. a site). */
  fixedFilters?: Record<string, string[]>
  className?: string
}) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const { siteId: scopedSiteId } = useSiteScope()
  const meQuery = trpc.access.me.useQuery()
  const permissions = meQuery.data?.permissions ?? []
  const can = (permission: string) => permissions.includes(permission as never)
  const canUpdate = can("device:update")
  const canRevoke = can("device:revoke_vpn")
  const canDelete = can("device:delete")
  const compact = variant === "compact"
  const [importOpen, setImportOpen] = React.useState(false)
  const [importOrgId, setImportOrgId] = React.useState("")
  const organizationsQuery = trpc.organizations.list.useQuery(undefined, {
    enabled: canUpdate && !compact,
  })
  const organizations = organizationsQuery.data ?? []
  const resolvedImportOrgId = importOrgId || organizations[0]?.id || ""
  const importCsv = trpc.devices.importCsv.useMutation({
    async onSuccess() {
      await utils.devices.page.invalidate()
    },
  })

  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize,
  })
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({})
  // Local input updates immediately; URL + query wait for debounce so typing
  // stays responsive (same pattern as alerts/sessions tables).
  const [search, setSearch] = React.useState(view.search)
  const [debouncedSearch, setDebouncedSearch] = React.useState(view.search)
  const [syncedViewSearch, setSyncedViewSearch] = React.useState(view.search)
  const [bulkAction, setBulkAction] = React.useState<BulkActionKind | null>(
    null
  )
  const [bulkIds, setBulkIds] = React.useState<string[]>([])

  // Reset local search when the URL / saved view changes underneath us.
  // If view.search matches debouncedSearch, this is an echo of our own write —
  // keep any newer draft still in the input.
  if (view.search !== syncedViewSearch) {
    setSyncedViewSearch(view.search)
    if (view.search !== debouncedSearch) {
      setSearch(view.search)
      setDebouncedSearch(view.search)
    }
  }

  React.useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedSearch(search), 250)
    return () => window.clearTimeout(handle)
  }, [search])

  React.useEffect(() => {
    if (debouncedSearch === view.search) return
    onViewChange({ search: debouncedSearch })
  }, [debouncedSearch, view.search, onViewChange])

  const resetToFirstPage = React.useCallback(() => {
    setPagination((current) =>
      current.pageIndex === 0 ? current : { ...current, pageIndex: 0 }
    )
  }, [])

  const filters = React.useMemo(() => {
    const record = columnFiltersToRecord(view.columnFilters)
    if (scopedSiteId) record.siteId = [scopedSiteId]
    for (const [key, values] of Object.entries(fixedFilters ?? {})) {
      record[key] = values
    }
    return record
  }, [view.columnFilters, scopedSiteId, fixedFilters])

  const listQuery = React.useMemo(
    () =>
      buildListQuery({
        pagination,
        sorting: view.sorting,
        filters,
        search: debouncedSearch,
      }),
    [pagination, view.sorting, filters, debouncedSearch]
  )

  const pageQuery = trpc.devices.page.useQuery(listQuery, {
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  })
  // Archived devices stay hidden until asked for. The choice rides along as
  // the `archived` column filter so it lands in the URL and in saved views.
  const archiveScope = resolveDeviceArchiveScope(filters.archived)
  const showingArchived = archiveScopeShowsArchived(archiveScope)
  const facetsQuery = trpc.devices.facets.useQuery(
    filters.archived ? { archived: filters.archived } : undefined,
    { staleTime: 30_000 }
  )
  const sitesQuery = trpc.sites.list.useQuery(undefined, { enabled: !compact })
  const routePoliciesQuery = trpc.routePolicies.list.useQuery(undefined, {
    enabled: !compact,
  })

  const invalidate = React.useCallback(async () => {
    await Promise.all([
      utils.devices.page.invalidate(),
      utils.devices.facets.invalidate(),
      utils.devices.list.invalidate(),
      utils.dashboard.summary.invalidate(),
    ])
  }, [utils])

  const bulkMutation = trpc.devices.bulk.useMutation({
    async onSuccess(result, variables) {
      await invalidate()
      setRowSelection({})
      setBulkAction(null)
      const verb =
        variables.action === "delete"
          ? "removed"
          : variables.action === "revoke_vpn"
            ? "revoked"
            : variables.action === "archive"
              ? "archived"
              : variables.action === "unarchive"
                ? "returned to service"
                : "updated"
      toast.success(
        result.skipped > 0
          ? `${result.updated} ${verb}, ${result.skipped} skipped (no access)`
          : `${result.updated} ${result.updated === 1 ? "device" : "devices"} ${verb}`
      )
    },
    onError(error) {
      toast.error(error.message || "We couldn't apply that change.")
    },
  })

  const facets = React.useMemo<DataTableFacet[]>(() => {
    const data = facetsQuery.data
    if (!data) return []
    const list: DataTableFacet[] = [
      {
        columnId: "connectivity",
        title: "Connectivity",
        options: (["online", "offline", "never", "revoked"] as const).map(
          (value) => ({
            value,
            label: connectivityLabel[value],
            count: data.connectivity.find((entry) => entry.value === value)
              ?.count,
          })
        ),
      },
    ]
    if (data.behind.some((entry) => entry.count > 0)) {
      list.splice(1, 0, {
        columnId: "behind",
        title: "Agent",
        options: [
          {
            value: "true",
            label: "Behind",
            count: data.behind.find((entry) => entry.value === "true")?.count,
          },
          {
            value: "false",
            label: "Up to date",
            count: data.behind.find((entry) => entry.value === "false")?.count,
          },
        ],
      })
    }
    if (!scopedSiteId && data.siteId.length > 1) {
      list.push({
        columnId: "siteId",
        title: "Site",
        options: data.siteId.map((entry) => ({
          value: entry.value,
          label: entry.label,
          count: entry.count,
        })),
      })
    }
    if (data.osFamily.length > 0) {
      list.push({
        columnId: "osFamily",
        title: "OS",
        options: data.osFamily.map((entry) => ({
          value: entry.value === "unknown" ? "unknown" : entry.value,
          label: osFamilyLabel(entry.value === "unknown" ? null : entry.value),
          count: entry.count,
        })),
      })
    }
    if (data.tags.length > 0) {
      list.push({
        columnId: "tags",
        title: "Tags",
        options: data.tags.map((entry) => ({
          value: entry.value,
          label: entry.value,
          count: entry.count,
        })),
      })
    }
    if (!compact) {
      list.push({
        columnId: "routePolicyId",
        title: "Route policy",
        options: data.routePolicyId.map((entry) => ({
          value: entry.value,
          label: entry.label,
          count: entry.count,
        })),
      })
      list.push({
        columnId: "status",
        title: "Status",
        options: data.status.map((entry) => ({
          value: entry.value,
          label: statusLabel(entry.value),
          count: entry.count,
        })),
      })
      if (data.agentVersion.length > 1) {
        list.push({
          columnId: "agentVersion",
          title: "Agent",
          options: data.agentVersion.map((entry) => ({
            value: entry.value,
            label: entry.value === "unknown" ? "Unknown" : entry.value,
            count: entry.count,
          })),
        })
      }
    }
    return list
  }, [facetsQuery.data, scopedSiteId, compact])

  const addTagFilter = React.useCallback(
    (tag: string) => {
      const existing = view.columnFilters.find((entry) => entry.id === "tags")
      const values = Array.isArray(existing?.value)
        ? (existing.value as string[])
        : []
      if (values.includes(tag)) return
      onViewChange({
        columnFilters: [
          ...view.columnFilters.filter((entry) => entry.id !== "tags"),
          { id: "tags", value: [...values, tag] },
        ],
      })
      resetToFirstPage()
    },
    [view, onViewChange, resetToFirstPage]
  )

  const openBulk = React.useCallback(
    (action: BulkActionKind, ids: string[]) => {
      setBulkIds(ids)
      setBulkAction(action)
    },
    []
  )

  const archivedCount = facetsQuery.data?.archived.find(
    (entry) => entry.value === "yes"
  )?.count

  const setShowArchived = React.useCallback(
    (show: boolean) => {
      onViewChange({
        columnFilters: [
          ...view.columnFilters.filter((entry) => entry.id !== "archived"),
          ...(show ? [{ id: "archived", value: ["all"] }] : []),
        ],
      })
      resetToFirstPage()
    },
    [view.columnFilters, onViewChange, resetToFirstPage]
  )

  const columns = React.useMemo<ColumnDef<DeviceRow>[]>(() => {
    const defs: ColumnDef<DeviceRow>[] = [
      {
        id: "displayName",
        accessorKey: "displayName",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Device" />
        ),
        meta: { label: "Device", className: "min-w-52" },
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium">
                {row.original.displayName}
              </span>
              {row.original.archivedAt ? (
                <Badge
                  variant="outline"
                  className="gap-1 font-normal text-muted-foreground"
                  title={`Archived ${formatDate(row.original.archivedAt)}`}
                >
                  <ArchiveIcon className="size-3" aria-hidden="true" />
                  Archived
                </Badge>
              ) : null}
            </span>
            {row.original.hostname &&
            row.original.hostname !== row.original.displayName ? (
              <span className="truncate font-mono text-xs text-muted-foreground">
                {row.original.hostname}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: "connectivity",
        accessorKey: "connectivity",
        header: "Connectivity",
        meta: { label: "Connectivity", className: "min-w-36" },
        enableSorting: false,
        cell: ({ row }) => (
          <ConnectivityBadge
            connectivity={row.original.connectivity}
            lastHandshakeAt={row.original.vpnLastHandshakeAt}
            showDetail={!compact}
          />
        ),
      },
      {
        id: "siteName",
        accessorKey: "siteName",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Site" />
        ),
        meta: { label: "Site" },
        cell: ({ row }) =>
          row.original.siteName ?? (
            <span className="text-muted-foreground">No site</span>
          ),
      },
      {
        id: "siteId",
        accessorKey: "siteId",
        header: "Site id",
        meta: { label: "Site id", className: "hidden" },
        enableHiding: false,
        enableSorting: false,
        cell: () => null,
      },
      {
        id: "osFamily",
        accessorKey: "osFamily",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="OS" />
        ),
        meta: { label: "OS" },
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <span>{osFamilyLabel(row.original.osFamily)}</span>
            {row.original.osVersion ? (
              <span className="truncate text-xs text-muted-foreground">
                {row.original.osVersion}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: "vpnIpv4",
        accessorKey: "vpnIpv4",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Address" />
        ),
        meta: { label: "Tunnel address" },
        cell: ({ row }) => (
          <CopyableText
            value={row.original.vpnIpv4 ? String(row.original.vpnIpv4) : null}
            className="text-xs"
          />
        ),
      },
      {
        id: "vpnLatestEndpoint",
        accessorKey: "vpnLatestEndpoint",
        header: "Endpoint",
        meta: { label: "Endpoint" },
        enableSorting: false,
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.vpnLatestEndpoint ?? "—"}
          </span>
        ),
      },
      {
        id: "routePolicyId",
        accessorKey: "vpnRoutePolicyId",
        header: "Policy",
        meta: { label: "Route policy" },
        enableSorting: false,
        cell: ({ row }) =>
          row.original.vpnRoutePolicyName ? (
            <Badge variant="secondary" className="font-normal">
              {row.original.vpnRoutePolicyName}
            </Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "tags",
        accessorKey: "tags",
        header: "Tags",
        meta: { label: "Tags", className: "min-w-40" },
        enableSorting: false,
        cell: ({ row }) => (
          <TagChips
            tags={row.original.tags}
            max={compact ? 2 : 3}
            onClick={addTagFilter}
          />
        ),
      },
      {
        id: "services",
        accessorKey: "enabledServiceTypes",
        header: "Services",
        meta: { label: "Services" },
        enableSorting: false,
        cell: ({ row }) => {
          const types = row.original.enabledServiceTypes
          if (types.length === 0) {
            return <span className="text-muted-foreground">—</span>
          }
          return (
            <div className="flex flex-wrap gap-1">
              {types.map((type) => (
                <Badge key={type} variant="outline" className="text-[11px]">
                  {serviceTypeLabel[type] ?? type}
                </Badge>
              ))}
            </div>
          )
        },
      },
      {
        id: "status",
        accessorKey: "status",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Status" />
        ),
        meta: { label: "Status" },
        cell: ({ row }) => (
          <Badge variant={statusVariant[row.original.status] ?? "secondary"}>
            {statusLabel(row.original.status)}
          </Badge>
        ),
      },
      {
        id: "agentVersion",
        accessorKey: "agentVersion",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Agent" />
        ),
        meta: { label: "Agent version" },
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {row.original.agentVersion ?? "—"}
          </span>
        ),
      },
      {
        id: "behind",
        accessorFn: () => "",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Agent freshness" />
        ),
        meta: { label: "Agent freshness" },
        enableHiding: true,
      },
      {
        id: "archived",
        accessorFn: (row) => (row.archivedAt ? "yes" : "no"),
        header: "Archived",
        meta: { label: "Archived", className: "hidden" },
        enableHiding: false,
        enableSorting: false,
        cell: () => null,
      },
      {
        id: "lastSeenAt",
        accessorKey: "lastSeenAt",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Last seen" />
        ),
        meta: { label: "Last seen" },
        cell: ({ row }) => {
          const value =
            row.original.vpnLastHandshakeAt ?? row.original.lastSeenAt
          return (
            <span
              className="text-sm whitespace-nowrap text-muted-foreground"
              title={value ? formatDate(value) : undefined}
            >
              {formatRelativeTime(value)}
            </span>
          )
        },
      },
      {
        id: "createdAt",
        accessorKey: "createdAt",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Enrolled" />
        ),
        meta: { label: "Enrolled" },
        cell: ({ row }) => (
          <span className="text-sm whitespace-nowrap text-muted-foreground">
            {formatDate(row.original.createdAt)}
          </span>
        ),
      },
    ]

    if (!compact) {
      defs.push({
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        enableHiding: false,
        meta: { className: "w-12 text-right" },
        cell: ({ row }) => (
          <DataTableRowActions
            label={`Actions for ${row.original.displayName}`}
            actions={[
              {
                label: "Open",
                onSelect: () => router.push(`/devices/${row.original.id}`),
              },
              ...(canUpdate
                ? [
                    {
                      label: "Move to site…",
                      icon: MapPinIcon,
                      separatorBefore: true,
                      onSelect: () =>
                        openBulk("assign_site", [row.original.id]),
                    },
                    {
                      label: "Route policy…",
                      icon: RouteIcon,
                      onSelect: () =>
                        openBulk("assign_route_policy", [row.original.id]),
                    },
                    {
                      label: "Add tags…",
                      icon: TagIcon,
                      onSelect: () => openBulk("add_tags", [row.original.id]),
                    },
                    {
                      label: row.original.archivedAt
                        ? "Return to service"
                        : "Archive device",
                      onSelect: () =>
                        openBulk(
                          row.original.archivedAt ? "unarchive" : "archive",
                          [row.original.id]
                        ),
                    },
                  ]
                : []),
              ...(canRevoke && row.original.connectivity !== "revoked"
                ? [
                    {
                      label: "Revoke tunnel access",
                      destructive: true,
                      separatorBefore: true,
                      onSelect: () => openBulk("revoke_vpn", [row.original.id]),
                    },
                  ]
                : []),
              ...(canDelete
                ? [
                    {
                      label: "Remove from inventory",
                      destructive: true,
                      separatorBefore: !canRevoke,
                      onSelect: () => openBulk("delete", [row.original.id]),
                    },
                  ]
                : []),
            ]}
          />
        ),
      })
    }

    return defs
  }, [compact, addTagFilter, router, canUpdate, canRevoke, canDelete, openBulk])

  const total = pageQuery.data?.total ?? 0
  const rows = pageQuery.data?.items

  async function exportCsv(ids?: string[]) {
    try {
      const result = await utils.devices.export.fetch({
        sort: listQuery.sort,
        filters: ids ? { ...filters, id: ids } : filters,
        search: listQuery.search,
      })
      const selected = ids
        ? result.rows.filter((row) => ids.includes(row.id))
        : result.rows
      const stamp = new Date().toISOString().slice(0, 10)
      downloadTextFile(`devices-${stamp}.csv`, toCsv(selected, csvColumns))
      toast.success(
        result.truncated
          ? `Exported the first ${selected.length} devices`
          : `Exported ${selected.length} ${selected.length === 1 ? "device" : "devices"}`
      )
    } catch {
      toast.error("We couldn't export the list.")
    }
  }

  const tagSuggestions = React.useMemo(
    () => facetsQuery.data?.tags.map((entry) => entry.value) ?? [],
    [facetsQuery.data]
  )

  const compactVisibility = React.useMemo(
    () =>
      compact
        ? {
            ...view.columnVisibility,
            vpnLatestEndpoint: false,
            routePolicyId: false,
            agentVersion: false,
            behind: false,
            archived: false,
            createdAt: false,
            status: false,
            osFamily: false,
          }
        : view.columnVisibility,
    [compact, view.columnVisibility]
  )

  return (
    <>
      <DataTable
        className={className}
        columns={columns}
        data={rows}
        isLoading={pageQuery.isLoading}
        isFetching={pageQuery.isFetching}
        getRowId={(row) => row.id}
        pageSize={pageSize}
        pageSizeOptions={compact ? [10, 25] : [25, 50, 100, 200]}
        server={{
          rowCount: total,
          sorting: view.sorting,
          onSortingChange: (updater) => {
            const next =
              typeof updater === "function" ? updater(view.sorting) : updater
            onViewChange({ sorting: next })
            resetToFirstPage()
          },
          columnFilters: view.columnFilters,
          onColumnFiltersChange: (updater) => {
            const next =
              typeof updater === "function"
                ? updater(view.columnFilters)
                : updater
            onViewChange({ columnFilters: next })
            resetToFirstPage()
          },
          pagination,
          onPaginationChange: setPagination,
        }}
        columnVisibility={compactVisibility}
        onColumnVisibilityChange={(updater) => {
          const next =
            typeof updater === "function"
              ? updater(view.columnVisibility)
              : updater
          onViewChange({ columnVisibility: next })
        }}
        search={search}
        onSearchChange={(value) => {
          setSearch(value)
          resetToFirstPage()
        }}
        searchPlaceholder="Search name, host, address, tag"
        facets={facets}
        showViewOptions={!compact}
        toolbarLeading={
          compact ? null : (
            <>
              <ViewsMenu
                storageKey="devices"
                builtIns={DEVICES_BUILT_IN_VIEWS}
                current={view}
                onApply={(state) => {
                  onViewChange(state)
                  resetToFirstPage()
                }}
              />
              <Toggle
                variant="outline"
                size="sm"
                className="h-9 px-3 text-muted-foreground aria-pressed:text-foreground"
                pressed={showingArchived}
                onPressedChange={setShowArchived}
                aria-label={
                  showingArchived
                    ? "Hide archived devices"
                    : "Show archived devices"
                }
              >
                <ArchiveIcon data-icon="inline-start" />
                Show archived
                {archivedCount ? (
                  <span className="text-muted-foreground tabular-nums">
                    {archivedCount.toLocaleString()}
                  </span>
                ) : null}
              </Toggle>
            </>
          )
        }
        toolbarActions={
          compact ? null : (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => void exportCsv()}
                disabled={total === 0}
              >
                <DownloadIcon />
                Export
              </Button>
              {canUpdate ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={() => setImportOpen(true)}
                >
                  Import
                </Button>
              ) : null}
            </>
          )
        }
        enableRowSelection={!compact && canUpdate}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        bulkActions={(selected) => {
          const ids = selected.map((row) => row.original.id)
          return (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openBulk("assign_site", ids)}
              >
                <MapPinIcon />
                Site
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openBulk("assign_route_policy", ids)}
              >
                <RouteIcon />
                Policy
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openBulk("add_tags", ids)}
              >
                <TagIcon />
                Tag
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void exportCsv(ids)}
              >
                <DownloadIcon />
                Export
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" aria-label="More actions">
                    <MoreHorizontalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => openBulk("remove_tags", ids)}
                  >
                    Remove tags…
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => openBulk("archive", ids)}>
                    Archive
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => openBulk("unarchive", ids)}>
                    Return to service
                  </DropdownMenuItem>
                  {canRevoke || canDelete ? <DropdownMenuSeparator /> : null}
                  {canRevoke ? (
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => openBulk("revoke_vpn", ids)}
                    >
                      Revoke tunnel access
                    </DropdownMenuItem>
                  ) : null}
                  {canDelete ? (
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => openBulk("delete", ids)}
                    >
                      Remove from inventory
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )
        }}
        onRowClick={(row) => router.push(`/devices/${row.id}`)}
        rowClassName={(row) =>
          row.archivedAt ? "text-muted-foreground" : undefined
        }
        emptyTitle="No devices yet"
        emptyDescription="Enroll a device from the Overview page to see it here."
        filteredEmptyTitle="No devices match"
        filteredEmptyDescription="Try a different search or clear the filters."
      />

      <BulkActionDialog
        action={bulkAction}
        count={bulkIds.length}
        sites={sitesQuery.data ?? []}
        routePolicies={routePoliciesQuery.data ?? []}
        tagSuggestions={tagSuggestions}
        pending={bulkMutation.isPending}
        onClose={() => setBulkAction(null)}
        onConfirm={(payload) => {
          bulkMutation.mutate({
            ...payload,
            ids: bulkIds,
          } as DeviceBulkAction)
        }}
      />

      <CsvImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Update devices"
        description="Match rows by id, serial, or host name. Existing devices are updated; new ones are not created."
        templateName="devices-template.csv"
        templateCsv={[
          "id,serial,hostname,display_name,tags,site,notes,asset_tag",
          ",SN-100,front-desk,Front desk,office,Main,Keep nearby,PRN-1",
        ].join("\n")}
        organizations={organizationsQuery.data ?? []}
        organizationId={resolvedImportOrgId}
        onOrganizationIdChange={setImportOrgId}
        pending={importCsv.isPending}
        onImport={async (csv) =>
          importCsv.mutateAsync({
            organizationId: resolvedImportOrgId,
            csv,
          })
        }
      />
    </>
  )
}
