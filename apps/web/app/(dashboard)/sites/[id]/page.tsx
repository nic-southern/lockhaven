"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import type { ColumnDef } from "@tanstack/react-table"
import {
  ArrowLeftIcon,
  DownloadIcon,
  PlusIcon,
  PrinterIcon,
  SettingsIcon,
} from "lucide-react"
import { keepPreviousData } from "@tanstack/react-query"
import { toast } from "sonner"
import type { RowSelectionState } from "@tanstack/react-table"

import {
  assetStatusLabels,
  buildAssetLabelCsvRow,
  DEFAULT_TRACKING_TAG_PREFIX,
  formatAssetLabelCsv,
  suggestAssetTrackingTag,
  type AssetStatus,
} from "@nms/shared"

import { AccessDenied } from "@/components/dashboard/access-denied"
import {
  DataTable,
  DataTableColumnHeader,
} from "@/components/dashboard/data-table"
import { DetailSheet } from "@/components/dashboard/detail-sheet"
import { EmptyState } from "@/components/dashboard/empty-state"
import { FormField } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { SectionCard } from "@/components/dashboard/section-card"
import { SelectField } from "@/components/dashboard/select-field"
import { StatStrip } from "@/components/dashboard/stat-strip"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { ConnectivityBadge } from "@/components/devices/connectivity-badge"
import { formatRelativeTime, statusLabel, statusVariant } from "@/lib/dashboard"
import { downloadTextFile, osFamilyLabel } from "@/lib/devices"
import { trpc } from "@/lib/trpc"
import { usePermissions } from "@/lib/use-permissions"
import type { RouterOutputs } from "@/lib/trpc"

type DeviceRow = RouterOutputs["devices"]["page"]["items"][number]
type AssetRow = RouterOutputs["assets"]["page"]["items"][number]

function formatMoney(value: string | null | undefined) {
  if (!value) return "—"
  const amount = Number(value)
  if (!Number.isFinite(amount)) return value
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  }).format(amount)
}

export default function SiteDetailPage() {
  return (
    <React.Suspense fallback={<SiteDetailSkeleton />}>
      <SiteDetail />
    </React.Suspense>
  )
}

function SiteDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  )
}

function SiteDetail() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const siteId = params.id
  const { can, isLoading: permissionsLoading } = usePermissions()
  const canViewDevices = can("device:view")
  const canUpdateAssets = can("device:update")
  const canViewValue = can("audit:view")
  const canManageSite = can("site:admin") || can("organization:admin")
  const utils = trpc.useUtils()

  const sitesQuery = trpc.sites.list.useQuery(undefined, {
    enabled: !permissionsLoading,
  })
  const site = (sitesQuery.data ?? []).find((entry) => entry.id === siteId)

  const devicesQuery = trpc.devices.page.useQuery(
    {
      limit: 200,
      filters: { siteId: [siteId] },
    },
    {
      enabled: canViewDevices && Boolean(siteId),
      placeholderData: keepPreviousData,
      refetchInterval: 30_000,
    }
  )
  const assetsQuery = trpc.assets.page.useQuery(
    {
      limit: 200,
      filters: { siteId: [siteId] },
    },
    {
      enabled: canViewDevices && Boolean(siteId),
      placeholderData: keepPreviousData,
    }
  )
  const installedValueQuery = trpc.reports.installedValue.useQuery(
    { siteId },
    {
      enabled: canViewValue && Boolean(siteId),
    }
  )
  const modelsQuery = trpc.deviceModels.list.useQuery(
    { organizationId: site?.organizationId ?? "" },
    {
      enabled:
        canUpdateAssets && Boolean(site?.organizationId) && Boolean(siteId),
    }
  )
  const organizationsQuery = trpc.organizations.list.useQuery(undefined, {
    enabled: canUpdateAssets && Boolean(siteId),
  })

  const [addOpen, setAddOpen] = React.useState(false)
  const [serial, setSerial] = React.useState("")
  const [tag, setTag] = React.useState("")
  const [hostname, setHostname] = React.useState("")
  const [deviceModelId, setDeviceModelId] = React.useState("")
  const [parentAssetId, setParentAssetId] = React.useState("")
  const [tagTouched, setTagTouched] = React.useState(false)
  const [assetRowSelection, setAssetRowSelection] =
    React.useState<RowSelectionState>({})

  const devices = devicesQuery.data?.items ?? []
  const assets = assetsQuery.data?.items ?? []
  const siteFolders = assets.filter((asset) => asset.isContainer)
  const trackingTagPrefix =
    (organizationsQuery.data ?? []).find(
      (organization) => organization.id === site?.organizationId
    )?.trackingTagPrefix ?? DEFAULT_TRACKING_TAG_PREFIX

  const createAsset = trpc.assets.create.useMutation({
    async onSuccess(created) {
      await Promise.all([
        utils.assets.page.invalidate(),
        utils.reports.installedValue.invalidate({ siteId }),
      ])
      setAddOpen(false)
      setSerial("")
      setTag("")
      setHostname("")
      setDeviceModelId("")
      setParentAssetId("")
      setTagTouched(false)
      setAssetRowSelection({})
      toast.success("Asset added", {
        action: {
          label: "Print label",
          onClick: () => router.push(`/assets/labels?ids=${created.id}`),
        },
      })
    },
    onError(error) {
      toast.error(error.message || "We couldn't add the asset.")
    },
  })

  function openAddAsset() {
    const suggested = suggestAssetTrackingTag({
      deviceId: siteId,
      serialNumber: "",
      attempt: assets.length,
      prefix: trackingTagPrefix,
    })
    setSerial("")
    setTag(suggested)
    setHostname("")
    setDeviceModelId("")
    setParentAssetId("")
    setTagTouched(false)
    setAddOpen(true)
  }

  function onSerialChange(value: string) {
    setSerial(value)
    if (!tagTouched) {
      setTag(
        suggestAssetTrackingTag({
          deviceId: siteId,
          serialNumber: value.trim() || null,
          attempt: assets.length,
          prefix: trackingTagPrefix,
        })
      )
    }
  }

  function exportLabelCsv(selectedIds?: string[]) {
    const selected =
      selectedIds && selectedIds.length > 0
        ? assets.filter((asset) => selectedIds.includes(asset.id))
        : assets
    const rows = selected
      .map((asset) =>
        buildAssetLabelCsvRow({
          tag: asset.tag,
          serial: asset.serial,
          siteName: asset.siteName ?? site?.name ?? null,
          companyName: asset.organizationName ?? null,
        })
      )
      .filter((row): row is NonNullable<typeof row> => row != null)
    if (rows.length === 0) {
      toast.error("No labels to export.")
      return
    }
    const stamp = new Date().toISOString().slice(0, 10)
    const siteSlug = (site?.name ?? "site")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
    downloadTextFile(
      `asset-labels-${siteSlug || "site"}-${stamp}.csv`,
      formatAssetLabelCsv(rows)
    )
    toast.success(
      `Exported ${rows.length} ${rows.length === 1 ? "label" : "labels"}`
    )
  }

  async function submitAddAsset() {
    if (!site) return
    const trimmedTag = tag.trim()
    if (!trimmedTag) return
    await createAsset.mutateAsync({
      organizationId: site.organizationId,
      siteId: site.id,
      parentAssetId: parentAssetId || null,
      deviceModelId: deviceModelId || null,
      tag: trimmedTag,
      serial: serial.trim() || null,
      hostname: hostname.trim() || null,
      status: "in_service" satisfies AssetStatus,
    })
  }

  const deviceColumns = React.useMemo<ColumnDef<DeviceRow>[]>(
    () => [
      {
        accessorKey: "displayName",
        meta: { label: "Device" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Device" />
        ),
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <Link
              href={`/devices/${row.original.id}`}
              className="truncate font-medium hover:underline"
            >
              {row.original.displayName}
            </Link>
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
        accessorFn: (row) => row.connectivity,
        meta: { label: "Connectivity" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Connectivity" />
        ),
        cell: ({ row }) => (
          <ConnectivityBadge
            connectivity={row.original.connectivity}
            lastHandshakeAt={row.original.vpnLastHandshakeAt}
            showDetail={false}
          />
        ),
      },
      {
        accessorKey: "osFamily",
        meta: { label: "OS" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="OS" />
        ),
        cell: ({ row }) => osFamilyLabel(row.original.osFamily),
      },
      {
        accessorKey: "status",
        meta: { label: "Status" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Status" />
        ),
        cell: ({ row }) => (
          <Badge variant={statusVariant[row.original.status] ?? "secondary"}>
            {statusLabel(row.original.status)}
          </Badge>
        ),
      },
      {
        id: "asset",
        accessorFn: (row) => row.assetTag ?? "",
        meta: { label: "Tracking tag" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Tracking tag" />
        ),
        cell: ({ row }) =>
          row.original.assetTag && row.original.assetId ? (
            <Link
              href={`/assets?id=${row.original.assetId}`}
              className="font-mono text-xs hover:underline"
            >
              {row.original.assetTag}
            </Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "lastSeenAt",
        meta: { label: "Last seen" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Last seen" />
        ),
        cell: ({ row }) =>
          row.original.lastSeenAt
            ? formatRelativeTime(row.original.lastSeenAt)
            : "—",
      },
    ],
    []
  )

  const assetColumns = React.useMemo<ColumnDef<AssetRow>[]>(
    () => [
      {
        accessorKey: "tag",
        meta: { label: "Tracking tag" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Tracking tag" />
        ),
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col gap-1">
            <Link
              href={`/assets/${row.original.id}`}
              className="font-mono text-sm font-medium hover:underline"
            >
              {row.original.tag}
            </Link>
            {row.original.isContainer ? (
              <Badge variant="outline">Folder</Badge>
            ) : null}
          </div>
        ),
      },
      {
        id: "folder",
        accessorFn: (row) => row.parentTag ?? "",
        meta: { label: "Folder" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Folder" />
        ),
        cell: ({ row }) =>
          row.original.parentAssetId && row.original.parentTag ? (
            <Link
              href={`/assets/${row.original.parentAssetId}`}
              className="font-mono text-xs hover:underline"
            >
              {row.original.parentTag}
            </Link>
          ) : row.original.isContainer ? (
            "Folder"
          ) : (
            "—"
          ),
      },
      {
        id: "deviceModel",
        accessorFn: (row) => row.deviceModelName ?? row.model ?? "",
        meta: { label: "Device model" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Device model" />
        ),
        cell: ({ row }) =>
          row.original.deviceModelName ??
          ([row.original.vendor, row.original.model]
            .filter(Boolean)
            .join(" ") ||
            "—"),
      },
      {
        accessorKey: "serial",
        meta: { label: "Serial" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Serial" />
        ),
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {row.original.serial ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "status",
        meta: { label: "Status" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Status" />
        ),
        cell: ({ row }) => {
          const lifecycle = row.original.lifecycle
          if (lifecycle?.showRetired) {
            return (
              <div className="flex flex-wrap items-center gap-1">
                <Badge variant="secondary">
                  {assetStatusLabels[row.original.status as AssetStatus]}
                </Badge>
                {row.original.status !== "retired" ? (
                  <Badge variant="outline">Retired</Badge>
                ) : null}
              </div>
            )
          }
          if (lifecycle?.state === "due") {
            return (
              <div className="flex flex-wrap items-center gap-1">
                <Badge variant="secondary">
                  {assetStatusLabels[row.original.status as AssetStatus]}
                </Badge>
                <Badge variant="outline">Due to retire</Badge>
              </div>
            )
          }
          return (
            <Badge variant="secondary">
              {assetStatusLabels[row.original.status as AssetStatus]}
            </Badge>
          )
        },
      },
      {
        id: "device",
        accessorFn: (row) => row.deviceName ?? "",
        meta: { label: "Device" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Device" />
        ),
        cell: ({ row }) =>
          row.original.deviceId ? (
            <Link
              href={`/devices/${row.original.deviceId}`}
              className="hover:underline"
            >
              {row.original.deviceName}
            </Link>
          ) : (
            <span className="text-muted-foreground">Not linked</span>
          ),
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        meta: { className: "w-12" },
        cell: ({ row }) => (
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/assets/labels?ids=${row.original.id}`}>
              <PrinterIcon />
              <span className="sr-only">Print label</span>
            </Link>
          </Button>
        ),
      },
    ],
    []
  )

  if (permissionsLoading || sitesQuery.isLoading) {
    return <SiteDetailSkeleton />
  }

  if (!canViewDevices && !canManageSite && !canViewValue) {
    return <AccessDenied />
  }

  if (!site) {
    return (
      <div className="flex flex-col gap-6">
        <Button variant="ghost" size="sm" className="w-fit" asChild>
          <Link href="/sites">
            <ArrowLeftIcon />
            All sites
          </Link>
        </Button>
        <Card>
          <CardContent className="py-8">
            <EmptyState
              title="Site not found"
              description="It may have been removed, or you may not have access to it."
              bordered={false}
              action={
                <Button asChild>
                  <Link href="/sites">Back to sites</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 w-fit text-muted-foreground"
          asChild
        >
          <Link href="/sites">
            <ArrowLeftIcon />
            All sites
          </Link>
        </Button>

        <PageHeader
          title={site.name}
          description={[
            site.timezone?.replaceAll("_", " "),
            `${devices.length} device${devices.length === 1 ? "" : "s"}`,
            `${assets.length} asset${assets.length === 1 ? "" : "s"}`,
          ]
            .filter(Boolean)
            .join(" · ")}
          actions={
            canManageSite ? (
              <Button
                variant="outline"
                onClick={() =>
                  router.push(`/sites?edit=${encodeURIComponent(site.id)}`)
                }
              >
                <SettingsIcon />
                Site settings
              </Button>
            ) : null
          }
        />
      </div>

      {canViewValue ? (
        <SectionCard
          title="Installed value"
          description="Replacement value of linked in-service assets at this site. Assets with no cost set are left out of the totals."
          contentClassName="gap-4"
          actions={
            <Button variant="outline" size="sm" asChild>
              <Link
                href={`/reports?tab=value&siteId=${encodeURIComponent(site.id)}`}
              >
                Open report
              </Link>
            </Button>
          }
        >
          {installedValueQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <>
              <StatStrip
                items={[
                  {
                    label: "In service (linked)",
                    value: installedValueQuery.data?.inServiceLinkedCount ?? 0,
                  },
                  {
                    label: "Replacement value",
                    value: formatMoney(
                      installedValueQuery.data?.totalInstalledValue
                    ),
                  },
                  {
                    label: "Purchase value",
                    value: formatMoney(
                      installedValueQuery.data?.totalPurchaseValue
                    ),
                  },
                  {
                    label: "No cost set",
                    value: installedValueQuery.data?.noCostCount ?? 0,
                    hint:
                      (installedValueQuery.data?.noCostCount ?? 0) > 0
                        ? "Excluded from dollar totals"
                        : undefined,
                  },
                ]}
              />
              {(installedValueQuery.data?.noCostCount ?? 0) > 0 ? (
                <p className="text-sm text-muted-foreground">
                  Set purchase or replacement cost on the device model under
                  Settings → Device models so these assets count toward
                  installed value.
                </p>
              ) : null}
            </>
          )}
        </SectionCard>
      ) : null}

      {canViewDevices ? (
        <SectionCard
          title="Devices"
          description="Devices assigned to this location."
          contentClassName="gap-4"
        >
          <DataTable
            columns={deviceColumns}
            data={devices}
            isLoading={devicesQuery.isLoading}
            getRowId={(row) => row.id}
            searchPlaceholder="Search devices"
            initialSorting={[{ id: "displayName", desc: false }]}
            onRowClick={(row) => router.push(`/devices/${row.id}`)}
            emptyTitle="No devices at this site"
            emptyDescription="Assign a device to this location from its settings, or enroll one here."
          />
        </SectionCard>
      ) : null}

      {canViewDevices ? (
        <SectionCard
          title="Assets"
          description="Assets linked to this location, including tracking tags from the agent."
          contentClassName="gap-4"
          actions={
            <div className="flex flex-wrap gap-2">
              {canUpdateAssets ? (
                <Button size="sm" onClick={openAddAsset}>
                  <PlusIcon />
                  Add asset
                </Button>
              ) : null}
              {assets.length > 0 ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => exportLabelCsv()}
                  >
                    <DownloadIcon />
                    Export labels
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <Link
                      href={`/assets/labels?ids=${assets.map((asset) => asset.id).join(",")}`}
                    >
                      <PrinterIcon />
                      Print labels
                    </Link>
                  </Button>
                </>
              ) : null}
            </div>
          }
        >
          {assetsQuery.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : assets.length === 0 ? (
            <EmptyState
              title="No assets at this site"
              description="Add an asset with its serial to start a tracking tag, or wait for a device at this site to create one on check-in."
              bordered={false}
              action={
                canUpdateAssets ? (
                  <Button onClick={openAddAsset}>
                    <PlusIcon />
                    Add asset
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                For tape labels on Linux, export here, then use the{" "}
                <a
                  href="/install/print-asset-labels.sh"
                  download="print-asset-labels.sh"
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  print helper
                </a>
                . Setup steps live under{" "}
                <Link
                  href="/settings/labels"
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  Settings → Labels
                </Link>
                .
              </p>
              <DataTable
                columns={assetColumns}
                data={assets}
                getRowId={(row) => row.id}
                searchPlaceholder="Search assets"
                initialSorting={[{ id: "tag", desc: false }]}
                onRowClick={(row) => router.push(`/assets?id=${row.id}`)}
                emptyTitle="No assets at this site"
                emptyDescription="Assets show up here when they are linked to this location."
                enableRowSelection
                rowSelection={assetRowSelection}
                onRowSelectionChange={setAssetRowSelection}
                bulkActions={(selected) => {
                  const ids = selected.map((row) => row.original.id)
                  return (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => exportLabelCsv(ids)}
                      >
                        <DownloadIcon />
                        Export labels
                      </Button>
                      <Button size="sm" variant="outline" asChild>
                        <Link href={`/assets/labels?ids=${ids.join(",")}`}>
                          <PrinterIcon />
                          Print labels
                        </Link>
                      </Button>
                    </>
                  )
                }}
              />
            </>
          )}
        </SectionCard>
      ) : null}

      <DetailSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add asset"
        description="Record hardware at this site, then print its tracking tag."
        className="sm:max-w-lg"
      >
        <div className="grid gap-4">
          <FormField label="Serial" htmlFor="site-asset-serial">
            <Input
              id="site-asset-serial"
              value={serial}
              onChange={(event) => onSerialChange(event.target.value)}
              placeholder="Chassis or sticker serial"
              autoFocus
            />
          </FormField>
          <FormField label="Tracking tag" htmlFor="site-asset-tag">
            <Input
              id="site-asset-tag"
              value={tag}
              onChange={(event) => {
                setTagTouched(true)
                setTag(event.target.value)
              }}
              className="font-mono"
              placeholder={`${trackingTagPrefix}-…`}
            />
          </FormField>
          <FormField label="Host name" htmlFor="site-asset-hostname">
            <Input
              id="site-asset-hostname"
              value={hostname}
              onChange={(event) => setHostname(event.target.value)}
              placeholder="Optional"
            />
          </FormField>
          <FormField label="Device model" htmlFor="site-asset-model">
            <SelectField
              id="site-asset-model"
              value={deviceModelId}
              onValueChange={setDeviceModelId}
              placeholder="Optional"
              emptyLabel="None"
              options={(modelsQuery.data ?? []).map((model) => ({
                value: model.id,
                label: model.manufacturer
                  ? `${model.name} · ${model.manufacturer} ${model.model}`
                  : `${model.name} · ${model.model}`,
              }))}
            />
          </FormField>
          <FormField label="Inside folder" htmlFor="site-asset-folder">
            <SelectField
              id="site-asset-folder"
              value={parentAssetId}
              onValueChange={setParentAssetId}
              placeholder="Standalone"
              emptyLabel="Standalone"
              options={siteFolders.map((folder) => ({
                value: folder.id,
                label: folder.tag,
              }))}
            />
          </FormField>
          <Button
            disabled={!tag.trim() || createAsset.isPending}
            onClick={() => void submitAddAsset()}
          >
            Add asset
          </Button>
        </div>
      </DetailSheet>
    </div>
  )
}
