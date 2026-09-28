"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { keepPreviousData } from "@tanstack/react-query"
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table"
import { ArrowLeftIcon, DownloadIcon, PrinterIcon } from "lucide-react"
import { toast } from "sonner"

import {
  assetStatusLabels,
  assetStatuses,
  buildAssetLabelCsvRow,
  definitionAppliesTo,
  formatAssetLabelCsv,
  retireMonthsToYears,
  yearsToRetireMonths,
  type AssetStatus,
} from "@nms/shared"

import { AccessDenied } from "@/components/dashboard/access-denied"
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog"
import {
  DataTable,
  DataTableColumnHeader,
} from "@/components/dashboard/data-table"
import { EmptyState } from "@/components/dashboard/empty-state"
import { FormField } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { SectionCard } from "@/components/dashboard/section-card"
import { SelectField } from "@/components/dashboard/select-field"
import { OpenAssetTicketDialog } from "@/components/tickets/open-ticket-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { downloadTextFile } from "@/lib/devices"
import { trpc } from "@/lib/trpc"
import type { RouterOutputs } from "@/lib/trpc"
import { usePermissions } from "@/lib/use-permissions"

type AssetDetail = NonNullable<RouterOutputs["assets"]["byId"]>
type AssetChild = RouterOutputs["assets"]["children"][number]
type AssetSearchHit = RouterOutputs["assets"]["page"]["items"][number]

type AssetForm = {
  siteId: string
  parentAssetId: string
  isContainer: boolean
  deviceModelId: string
  tag: string
  serial: string
  hostname: string
  status: AssetStatus
  purchaseDate: string
  purchaseCost: string
  warrantyExpiresOn: string
  retireAfterYears: string
  retireOn: string
  notes: string
  customFields: Record<string, string>
}

function formFromAsset(asset: AssetDetail): AssetForm {
  const years = retireMonthsToYears(asset.retireAfterMonths)
  return {
    siteId: asset.siteId ?? "",
    parentAssetId: asset.parentAssetId ?? "",
    isContainer: Boolean(asset.isContainer),
    deviceModelId: asset.deviceModelId ?? "",
    tag: asset.tag,
    serial: asset.serial ?? "",
    hostname: asset.hostname ?? "",
    status: asset.status,
    purchaseDate: asset.purchaseDate ?? "",
    purchaseCost: asset.purchaseCost ?? "",
    warrantyExpiresOn: asset.warrantyExpiresOn ?? "",
    retireAfterYears: years == null ? "" : String(years),
    retireOn: asset.retireOn ?? "",
    notes: asset.notes ?? "",
    customFields: Object.fromEntries(
      Object.entries(asset.customFields ?? {}).map(([key, value]) => [
        key,
        value == null ? "" : String(value),
      ])
    ),
  }
}

export default function AssetDetailPage() {
  return (
    <React.Suspense fallback={<AssetDetailSkeleton />}>
      <AssetDetail />
    </React.Suspense>
  )
}

function AssetDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  )
}

function AssetDetail() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { can, isLoading: permissionsLoading } = usePermissions()
  const canView = can("device:view")
  const canUpdate = can("device:update")
  const assetId = params.id
  const utils = trpc.useUtils()

  const assetQuery = trpc.assets.byId.useQuery(
    { id: assetId },
    { enabled: canView && Boolean(assetId) }
  )

  if (permissionsLoading || assetQuery.isLoading) {
    return <AssetDetailSkeleton />
  }
  if (!canView) {
    return <AccessDenied />
  }
  if (assetQuery.isError || !assetQuery.data) {
    return (
      <EmptyState
        title="Asset not found"
        description="It may have been removed, or you may not have access."
        action={
          <Button variant="outline" asChild>
            <Link href="/assets">Back to assets</Link>
          </Button>
        }
      />
    )
  }

  return (
    <AssetEditor
      key={assetQuery.data.id}
      asset={assetQuery.data}
      canUpdate={canUpdate}
      onDeleted={() => router.push("/assets")}
      invalidate={() =>
        Promise.all([
          utils.assets.byId.invalidate({ id: assetId }),
          utils.assets.page.invalidate(),
          utils.assets.children.invalidate(),
          utils.devices.list.invalidate(),
        ])
      }
    />
  )
}

function AssetEditor({
  asset,
  canUpdate,
  onDeleted,
  invalidate,
}: {
  asset: AssetDetail
  canUpdate: boolean
  onDeleted: () => void
  invalidate: () => Promise<unknown>
}) {
  const router = useRouter()
  const [form, setForm] = React.useState(() => formFromAsset(asset))
  const [linkDeviceId, setLinkDeviceId] = React.useState(asset.deviceId ?? "")
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [ticketOpen, setTicketOpen] = React.useState(false)
  const [addQuery, setAddQuery] = React.useState("")
  const [debouncedAddQuery, setDebouncedAddQuery] = React.useState("")
  const [newChildTag, setNewChildTag] = React.useState("")
  const [newChildSerial, setNewChildSerial] = React.useState("")
  const [newChildModelId, setNewChildModelId] = React.useState("")
  const [addNewOpen, setAddNewOpen] = React.useState(false)
  const [childRowSelection, setChildRowSelection] =
    React.useState<RowSelectionState>({})

  React.useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedAddQuery(addQuery.trim())
    }, 250)
    return () => window.clearTimeout(handle)
  }, [addQuery])

  const sitesQuery = trpc.sites.list.useQuery(undefined, { enabled: true })
  const devicesQuery = trpc.devices.list.useQuery(undefined, {
    enabled: canUpdate,
  })
  const modelsQuery = trpc.deviceModels.list.useQuery(
    { organizationId: asset.organizationId },
    { enabled: Boolean(asset.organizationId) }
  )
  const customFieldsQuery = trpc.customFields.list.useQuery(
    { organizationId: asset.organizationId },
    { enabled: Boolean(asset.organizationId) }
  )
  const foldersQuery = trpc.assets.page.useQuery(
    {
      limit: 200,
      filters: { isContainer: ["true"] },
    },
    { enabled: !form.isContainer, placeholderData: keepPreviousData }
  )
  const childrenQuery = trpc.assets.children.useQuery(
    { parentAssetId: asset.id },
    { enabled: form.isContainer || Boolean(asset.isContainer) }
  )
  const searchQuery = trpc.assets.page.useQuery(
    {
      limit: 20,
      search: debouncedAddQuery,
      filters: { isContainer: ["false"] },
    },
    {
      enabled:
        canUpdate &&
        Boolean(asset.isContainer) &&
        debouncedAddQuery.length >= 1,
      placeholderData: keepPreviousData,
    }
  )

  const updateAsset = trpc.assets.update.useMutation({
    async onSuccess() {
      await invalidate()
      toast.success("Asset updated")
    },
    onError(error) {
      toast.error(error.message || "We couldn't update the asset.")
    },
  })
  const deleteAsset = trpc.assets.delete.useMutation({
    async onSuccess() {
      await invalidate()
      setDeleteOpen(false)
      toast.success("Asset removed")
      onDeleted()
    },
    onError() {
      toast.error("We couldn't remove the asset.")
    },
  })
  const linkDevice = trpc.assets.linkDevice.useMutation({
    async onSuccess() {
      await invalidate()
      toast.success("Device linked")
    },
    onError(error) {
      toast.error(error.message || "We couldn't link that device.")
    },
  })
  const unlinkDevice = trpc.assets.unlinkDevice.useMutation({
    async onSuccess() {
      await invalidate()
      setLinkDeviceId("")
      toast.success("Device unlinked")
    },
    onError() {
      toast.error("We couldn't unlink that device.")
    },
  })
  const addChild = trpc.assets.addChild.useMutation({
    async onSuccess() {
      await invalidate()
      setAddQuery("")
      setChildRowSelection({})
      toast.success("Item added to folder")
    },
    onError(error) {
      toast.error(error.message || "We couldn't add that item.")
    },
  })
  const removeChild = trpc.assets.removeChild.useMutation({
    async onSuccess() {
      await invalidate()
      setChildRowSelection({})
      toast.success("Item removed from folder")
    },
    onError(error) {
      toast.error(error.message || "We couldn't remove that item.")
    },
  })
  const createAsset = trpc.assets.create.useMutation({
    async onSuccess() {
      await invalidate()
      setAddNewOpen(false)
      setNewChildTag("")
      setNewChildSerial("")
      setNewChildModelId("")
      setChildRowSelection({})
      toast.success("Item added to folder")
    },
    onError(error) {
      toast.error(error.message || "We couldn't add the asset.")
    },
  })

  const sites = sitesQuery.data ?? []
  const devices = devicesQuery.data ?? []
  const folderOptions = (foldersQuery.data?.items ?? []).filter(
    (item) =>
      item.isContainer &&
      item.organizationId === asset.organizationId &&
      item.id !== asset.id
  )
  const childIds = new Set((childrenQuery.data ?? []).map((child) => child.id))
  const searchHits = (searchQuery.data?.items ?? []).filter(
    (item): item is AssetSearchHit =>
      item.organizationId === asset.organizationId &&
      item.id !== asset.id &&
      !item.isContainer &&
      !childIds.has(item.id)
  )

  function payloadFromForm() {
    const yearsTrimmed = form.retireAfterYears.trim()
    const yearsParsed = yearsTrimmed ? Number(yearsTrimmed) : null
    return {
      organizationId: asset.organizationId,
      siteId: form.siteId || null,
      parentAssetId: form.isContainer ? null : form.parentAssetId || null,
      isContainer: form.isContainer,
      deviceModelId: form.deviceModelId || null,
      tag: form.tag,
      serial: form.serial || null,
      hostname: form.hostname || null,
      status: form.status,
      purchaseDate: form.purchaseDate || null,
      purchaseCost: form.purchaseCost || null,
      warrantyExpiresOn: form.warrantyExpiresOn || null,
      retireAfterMonths: yearsToRetireMonths(
        yearsParsed != null && Number.isFinite(yearsParsed) ? yearsParsed : null
      ),
      retireOn: form.retireOn || null,
      notes: form.notes || null,
      customFields: form.customFields,
    }
  }

  function exportLabels(
    scope: "folder" | "contents" | "all" | "selected",
    selectedIds?: string[]
  ) {
    const rows: NonNullable<ReturnType<typeof buildAssetLabelCsvRow>>[] = []
    const push = (item: {
      tag: string
      serial: string | null
      siteName: string | null
      organizationName: string | null
    }) => {
      const row = buildAssetLabelCsvRow({
        tag: item.tag,
        serial: item.serial,
        siteName: item.siteName,
        companyName: item.organizationName,
      })
      if (row) rows.push(row)
    }
    if (scope === "folder" || scope === "all") {
      push(asset)
    }
    if (scope === "contents" || scope === "all") {
      for (const child of childrenQuery.data ?? []) {
        push(child)
      }
    }
    if (scope === "selected") {
      const selected = new Set(selectedIds ?? [])
      for (const child of childrenQuery.data ?? []) {
        if (selected.has(child.id)) push(child)
      }
    }
    if (rows.length === 0) {
      toast.error("No labels to export.")
      return
    }
    const stamp = new Date().toISOString().slice(0, 10)
    const slug = asset.tag
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
    downloadTextFile(
      `asset-labels-${slug || "folder"}-${stamp}.csv`,
      formatAssetLabelCsv(rows)
    )
    toast.success(
      `Exported ${rows.length} ${rows.length === 1 ? "label" : "labels"}`
    )
  }

  const children = childrenQuery.data ?? []
  const labelIds = React.useMemo(() => {
    const ids = [asset.id]
    for (const child of childrenQuery.data ?? []) ids.push(child.id)
    return ids
  }, [asset.id, childrenQuery.data])

  const childColumns = React.useMemo<ColumnDef<AssetChild>[]>(
    () => [
      {
        accessorKey: "tag",
        meta: { label: "Tracking tag" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Tracking tag" />
        ),
        cell: ({ row }) => (
          <Link
            href={`/assets/${row.original.id}`}
            className="font-mono text-sm font-medium hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {row.original.tag}
          </Link>
        ),
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
        accessorKey: "hostname",
        meta: { label: "Host name" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Host name" />
        ),
        cell: ({ row }) => row.original.hostname ?? "—",
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        meta: { className: "w-24" },
        cell: ({ row }) =>
          canUpdate ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={removeChild.isPending}
              onClick={(event) => {
                event.stopPropagation()
                void removeChild.mutateAsync({
                  childAssetId: row.original.id,
                })
              }}
            >
              Remove
            </Button>
          ) : null,
      },
    ],
    [canUpdate, removeChild]
  )

  const selectedModel = (modelsQuery.data ?? []).find(
    (model) => model.id === form.deviceModelId
  )
  const modelRetireYears = retireMonthsToYears(
    selectedModel?.retireAfterMonths ?? null
  )
  const lifecycle = asset.lifecycle
  const purchaseHint =
    !form.purchaseDate && lifecycle?.purchaseDateSource === "model"
      ? `From model: ${lifecycle.purchaseDate}`
      : null
  const retireAfterHint =
    !form.retireAfterYears && modelRetireYears != null
      ? `From model: ${modelRetireYears} year${modelRetireYears === 1 ? "" : "s"}`
      : null
  const retireOnHint =
    lifecycle?.retireOn &&
    lifecycle.retireOnSource === "computed" &&
    !form.retireOn
      ? `Computed: ${lifecycle.retireOn}`
      : null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href={asset.isContainer ? "/assets/folders" : "/assets"}>
            <ArrowLeftIcon />
            {asset.isContainer ? "Folders" : "Assets"}
          </Link>
        </Button>
      </div>

      <PageHeader
        badge={asset.isContainer ? "Folder" : "Asset"}
        title={asset.tag}
        description={
          asset.isContainer
            ? "Contained assets inherit this folder’s site. Print or export tracking tags for the folder and its contents."
            : "Tracking tag, placement, and inventory details."
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {asset.isContainer ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => exportLabels("all")}
                  disabled={childrenQuery.isLoading}
                >
                  <DownloadIcon />
                  Export labels
                </Button>
                <Button variant="outline" asChild>
                  <Link href={`/assets/labels?ids=${labelIds.join(",")}`}>
                    <PrinterIcon />
                    Print labels
                  </Link>
                </Button>
              </>
            ) : (
              <Button variant="outline" asChild>
                <Link href={`/assets/labels?ids=${asset.id}`}>
                  <PrinterIcon />
                  Print label
                </Link>
              </Button>
            )}
            {canUpdate ? (
              <Button variant="outline" onClick={() => setTicketOpen(true)}>
                Open ticket
              </Button>
            ) : null}
          </div>
        }
      />

      {asset.isContainer || form.isContainer ? (
        <>
          <SectionCard
            title={
              children.length === 1
                ? "Contents (1 item)"
                : `Contents (${children.length} items)`
            }
            description="Assets inside this folder. Select rows to print or export a subset. Export labels downloads CSV for the local print helper."
            contentClassName="gap-4"
            actions={
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportLabels("folder")}
                >
                  <DownloadIcon />
                  Export folder label
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportLabels("contents")}
                  disabled={children.length === 0}
                >
                  <DownloadIcon />
                  Export contents
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportLabels("all")}
                >
                  <DownloadIcon />
                  Export all
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/assets/labels?ids=${labelIds.join(",")}`}>
                    <PrinterIcon />
                    Print labels
                  </Link>
                </Button>
              </div>
            }
          >
            {childrenQuery.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : children.length === 0 ? (
              <EmptyState
                title="No items yet"
                description="Search for an existing asset below, or add a new one to this folder."
                bordered={false}
              />
            ) : (
              <DataTable
                columns={childColumns}
                data={children}
                getRowId={(row) => row.id}
                searchPlaceholder="Search contents"
                initialSorting={[{ id: "tag", desc: false }]}
                onRowClick={(row) => router.push(`/assets/${row.id}`)}
                enableRowSelection
                rowSelection={childRowSelection}
                onRowSelectionChange={setChildRowSelection}
                emptyTitle="No items yet"
                emptyDescription="Add assets to this folder to track them together."
                bulkActions={(selected) => {
                  const ids = selected.map((row) => row.original.id)
                  return (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => exportLabels("selected", ids)}
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
            )}
          </SectionCard>

          {canUpdate ? (
            <SectionCard
              title="Add to folder"
              description="Search by tracking tag, serial, or host name."
            >
              <div className="flex flex-col gap-4">
                <FormField label="Search existing" htmlFor="folder-add-search">
                  <Input
                    id="folder-add-search"
                    value={addQuery}
                    onChange={(event) => setAddQuery(event.target.value)}
                    placeholder="Tracking tag, serial, or host name"
                    className="font-mono"
                  />
                </FormField>
                {debouncedAddQuery.length >= 1 ? (
                  searchHits.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {searchQuery.isFetching
                        ? "Searching…"
                        : "No matching assets."}
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {searchHits.map((hit) => (
                        <li
                          key={hit.id}
                          className="flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <p className="font-mono text-sm">{hit.tag}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {[hit.serial, hit.hostname, hit.siteName]
                                .filter(Boolean)
                                .join(" · ") || "—"}
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={addChild.isPending}
                            onClick={() =>
                              void addChild.mutateAsync({
                                parentAssetId: asset.id,
                                childAssetId: hit.id,
                              })
                            }
                          >
                            Add
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Type to find an asset to place in this folder.
                  </p>
                )}

                {addNewOpen ? (
                  <div className="grid gap-3 border-t pt-4 sm:grid-cols-2">
                    <FormField label="Tracking tag" htmlFor="child-tag">
                      <Input
                        id="child-tag"
                        value={newChildTag}
                        onChange={(event) => setNewChildTag(event.target.value)}
                        className="font-mono"
                      />
                    </FormField>
                    <FormField label="Serial" htmlFor="child-serial">
                      <Input
                        id="child-serial"
                        value={newChildSerial}
                        onChange={(event) =>
                          setNewChildSerial(event.target.value)
                        }
                        className="font-mono"
                      />
                    </FormField>
                    <FormField
                      label="Device model"
                      htmlFor="child-model"
                      className="sm:col-span-2"
                    >
                      <SelectField
                        id="child-model"
                        value={newChildModelId}
                        onValueChange={setNewChildModelId}
                        placeholder="Choose a model"
                        emptyLabel="Not assigned"
                        options={(modelsQuery.data ?? []).map((model) => ({
                          value: model.id,
                          label: model.label,
                        }))}
                      />
                    </FormField>
                    <div className="flex flex-wrap gap-2 sm:col-span-2">
                      <Button
                        disabled={!newChildTag.trim() || createAsset.isPending}
                        onClick={() =>
                          void createAsset.mutateAsync({
                            organizationId: asset.organizationId,
                            siteId: asset.siteId,
                            parentAssetId: asset.id,
                            deviceModelId: newChildModelId || null,
                            tag: newChildTag.trim(),
                            serial: newChildSerial.trim() || null,
                            status: "in_service",
                          })
                        }
                      >
                        Add new
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => setAddNewOpen(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="outline" onClick={() => setAddNewOpen(true)}>
                    Add new asset
                  </Button>
                )}
              </div>
            </SectionCard>
          ) : null}
        </>
      ) : null}

      <SectionCard
        title="Details"
        description={
          asset.isContainer
            ? "Changing the site moves contained items and the linked device with this folder."
            : "Edit placement and identity for this asset."
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Tracking tag" htmlFor="asset-tag">
            <Input
              id="asset-tag"
              value={form.tag}
              disabled={!canUpdate}
              onChange={(event) =>
                setForm((current) => ({ ...current, tag: event.target.value }))
              }
              className="font-mono"
            />
          </FormField>
          <FormField label="Organization">
            <Input value={asset.organizationName ?? "—"} disabled />
          </FormField>
          <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 sm:col-span-2">
            <div>
              <p className="text-sm font-medium">Folder</p>
              <p className="text-sm text-muted-foreground">
                Folders hold other assets. Differentiate them by tracking tag.
              </p>
            </div>
            <Switch
              checked={form.isContainer}
              disabled={!canUpdate}
              onCheckedChange={(checked) =>
                setForm((current) => ({
                  ...current,
                  isContainer: checked,
                  parentAssetId: checked ? "" : current.parentAssetId,
                }))
              }
            />
          </div>
          {!form.isContainer ? (
            <FormField label="Inside folder" htmlFor="asset-parent">
              <SelectField
                id="asset-parent"
                value={form.parentAssetId}
                onValueChange={(value) =>
                  setForm((current) => ({ ...current, parentAssetId: value }))
                }
                placeholder="Standalone"
                emptyLabel="Standalone"
                disabled={!canUpdate}
                options={folderOptions.map((folder) => ({
                  value: folder.id,
                  label: folder.tag,
                }))}
              />
            </FormField>
          ) : null}
          <FormField label="Device model" htmlFor="asset-device-model">
            <SelectField
              id="asset-device-model"
              value={form.deviceModelId}
              onValueChange={(value) =>
                setForm((current) => ({ ...current, deviceModelId: value }))
              }
              placeholder="Choose a model"
              emptyLabel="Not assigned"
              disabled={!canUpdate}
              options={(modelsQuery.data ?? []).map((model) => ({
                value: model.id,
                label: model.label,
              }))}
            />
          </FormField>
          <FormField label="Serial" htmlFor="asset-serial">
            <Input
              id="asset-serial"
              value={form.serial}
              disabled={!canUpdate}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  serial: event.target.value,
                }))
              }
              className="font-mono"
            />
          </FormField>
          <FormField label="Host name" htmlFor="asset-hostname">
            <Input
              id="asset-hostname"
              value={form.hostname}
              disabled={!canUpdate}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  hostname: event.target.value,
                }))
              }
            />
          </FormField>
          <FormField label="Site" htmlFor="asset-site">
            <SelectField
              id="asset-site"
              value={form.siteId}
              onValueChange={(value) =>
                setForm((current) => ({ ...current, siteId: value }))
              }
              placeholder="No site"
              emptyLabel="No site"
              disabled={!canUpdate}
              options={sites
                .filter((site) => site.organizationId === asset.organizationId)
                .map((site) => ({ value: site.id, label: site.name }))}
            />
          </FormField>
          <FormField label="Status" htmlFor="asset-status">
            <SelectField
              id="asset-status"
              value={form.status}
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  status: value as AssetStatus,
                }))
              }
              disabled={!canUpdate}
              options={assetStatuses.map((status) => ({
                value: status,
                label: assetStatusLabels[status],
              }))}
            />
          </FormField>
          <FormField label="Purchase date" htmlFor="asset-purchased">
            <Input
              id="asset-purchased"
              type="date"
              value={form.purchaseDate}
              disabled={!canUpdate}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  purchaseDate: event.target.value,
                }))
              }
            />
            {purchaseHint ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {purchaseHint}
              </p>
            ) : null}
          </FormField>
          <FormField label="Cost" htmlFor="asset-cost">
            <Input
              id="asset-cost"
              inputMode="decimal"
              value={form.purchaseCost}
              disabled={!canUpdate}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  purchaseCost: event.target.value,
                }))
              }
            />
          </FormField>
          <FormField label="Retire after (years)" htmlFor="asset-retire-years">
            <Input
              id="asset-retire-years"
              inputMode="decimal"
              value={form.retireAfterYears}
              disabled={!canUpdate}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  retireAfterYears: event.target.value,
                }))
              }
              placeholder={
                modelRetireYears != null ? String(modelRetireYears) : ""
              }
            />
            {retireAfterHint ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {retireAfterHint}
              </p>
            ) : null}
          </FormField>
          <FormField label="Retire on" htmlFor="asset-retire-on">
            <Input
              id="asset-retire-on"
              type="date"
              value={form.retireOn}
              disabled={!canUpdate}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  retireOn: event.target.value,
                }))
              }
            />
            {retireOnHint ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {retireOnHint}
              </p>
            ) : null}
          </FormField>
          <FormField label="Warranty ends" htmlFor="asset-warranty">
            <Input
              id="asset-warranty"
              type="date"
              value={form.warrantyExpiresOn}
              disabled={!canUpdate}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  warrantyExpiresOn: event.target.value,
                }))
              }
            />
          </FormField>
          <FormField
            label="Notes"
            htmlFor="asset-notes"
            className="sm:col-span-2"
          >
            <Textarea
              id="asset-notes"
              value={form.notes}
              disabled={!canUpdate}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
            />
          </FormField>
          {(customFieldsQuery.data ?? [])
            .filter((field) => definitionAppliesTo(field.appliesTo, "asset"))
            .map((field) => (
              <FormField
                key={field.id}
                label={field.label}
                htmlFor={`asset-field-${field.key}`}
              >
                <Input
                  id={`asset-field-${field.key}`}
                  value={form.customFields[field.key] ?? ""}
                  disabled={!canUpdate}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      customFields: {
                        ...current.customFields,
                        [field.key]: event.target.value,
                      },
                    }))
                  }
                />
              </FormField>
            ))}
        </div>

        {canUpdate ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              disabled={!form.tag.trim() || updateAsset.isPending}
              onClick={() =>
                void updateAsset.mutateAsync({
                  id: asset.id,
                  ...payloadFromForm(),
                })
              }
            >
              Save changes
            </Button>
            <Button
              variant="outline"
              className="text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              Remove
            </Button>
          </div>
        ) : null}
      </SectionCard>

      {canUpdate ? (
        <SectionCard
          title="Linked device"
          description="Optional VPN device linked to this asset."
        >
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <SelectField
              value={linkDeviceId}
              onValueChange={setLinkDeviceId}
              placeholder="Link a device"
              emptyLabel="Not linked"
              options={devices
                .filter(
                  (device) =>
                    device.organizationId === asset.organizationId &&
                    (!device.assetId || device.assetId === asset.id)
                )
                .map((device) => ({
                  value: device.id,
                  label: device.displayName,
                }))}
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={!linkDeviceId || linkDevice.isPending}
                onClick={() =>
                  void linkDevice.mutateAsync({
                    id: asset.id,
                    deviceId: linkDeviceId,
                  })
                }
              >
                Link
              </Button>
              {asset.deviceId ? (
                <Button
                  variant="ghost"
                  disabled={unlinkDevice.isPending}
                  onClick={() =>
                    void unlinkDevice.mutateAsync({ id: asset.id })
                  }
                >
                  Unlink
                </Button>
              ) : null}
            </div>
          </div>
          {asset.deviceId ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Linked to{" "}
              <Link
                href={`/devices/${asset.deviceId}`}
                className="hover:underline"
              >
                {asset.deviceName ?? "device"}
              </Link>
            </p>
          ) : null}
        </SectionCard>
      ) : null}

      {asset.parentAssetId && asset.parentTag ? (
        <p className="text-sm text-muted-foreground">
          Inside folder{" "}
          <Link
            href={`/assets/${asset.parentAssetId}`}
            className="font-mono hover:underline"
          >
            {asset.parentTag}
          </Link>
        </p>
      ) : null}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Remove this asset?"
        description="The inventory record will be removed. Linked devices stay enrolled."
        confirmLabel="Remove asset"
        destructive
        pending={deleteAsset.isPending}
        onConfirm={() => {
          void deleteAsset.mutateAsync({ id: asset.id })
        }}
      />

      <OpenAssetTicketDialog
        key={asset.id}
        assetId={asset.id}
        assetTag={asset.tag}
        siteName={asset.siteName}
        open={ticketOpen}
        onOpenChange={setTicketOpen}
      />
    </div>
  )
}
