"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { keepPreviousData } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { toast } from "sonner"
import { PlusIcon } from "lucide-react"

import {
  assetLifecycleStateLabels,
  assetStatusLabels,
  assetStatuses,
  definitionAppliesTo,
  yearsToRetireMonths,
  type AssetStatus,
} from "@nms/shared"

import { AccessDenied } from "@/components/dashboard/access-denied"
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog"
import { CsvImportDialog } from "@/components/dashboard/csv-import-dialog"
import {
  DataTable,
  DataTableColumnHeader,
  DataTableRowActions,
} from "@/components/dashboard/data-table"
import { DetailSheet } from "@/components/dashboard/detail-sheet"
import { EmptyState } from "@/components/dashboard/empty-state"
import { FormField } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { SelectField } from "@/components/dashboard/select-field"
import { StatStrip } from "@/components/dashboard/stat-strip"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { formatDate } from "@/lib/dashboard"
import { trpc } from "@/lib/trpc"
import { usePermissions } from "@/lib/use-permissions"
import type { RouterOutputs } from "@/lib/trpc"
import { OpenAssetTicketDialog } from "@/components/tickets/open-ticket-dialog"

type AssetRow = RouterOutputs["assets"]["page"]["items"][number]

type AssetForm = {
  organizationId: string
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

const emptyForm = (): AssetForm => ({
  organizationId: "",
  siteId: "",
  parentAssetId: "",
  isContainer: false,
  deviceModelId: "",
  tag: "",
  serial: "",
  hostname: "",
  status: "stock",
  purchaseDate: "",
  purchaseCost: "",
  warrantyExpiresOn: "",
  retireAfterYears: "",
  retireOn: "",
  notes: "",
  customFields: {},
})

const assetTemplate = [
  "tag,vendor,model,serial,hostname,site,status,purchase_date,purchase_cost,warranty_expires_on,notes",
  "LH-7K2MPQ,Example,Laser,SN-100,,Main,stock,2026-01-15,240.00,2028-01-15,Spare printer",
].join("\n")

export default function AssetsPage() {
  return (
    <React.Suspense
      fallback={
        <div className="flex flex-col gap-6">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      }
    >
      <AssetsContent />
    </React.Suspense>
  )
}

function AssetsContent() {
  const router = useRouter()
  const { can, isLoading: accessLoading } = usePermissions()
  const canView = can("device:view")
  const canUpdate = can("device:update")
  const utils = trpc.useUtils()

  const [createOpen, setCreateOpen] = React.useState(false)
  const [importOpen, setImportOpen] = React.useState(false)
  const [selectedId, setSelectedId] = React.useState("")
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [ticketOpen, setTicketOpen] = React.useState(false)
  const [form, setForm] = React.useState<AssetForm>(emptyForm)
  const [importOrgId, setImportOrgId] = React.useState("")

  const organizationsQuery = trpc.organizations.list.useQuery(undefined, {
    enabled: canView,
  })
  const sitesQuery = trpc.sites.list.useQuery(undefined, { enabled: canView })
  const pageQuery = trpc.assets.page.useQuery(
    { limit: 200 },
    { enabled: canView, placeholderData: keepPreviousData }
  )

  const organizations = organizationsQuery.data ?? []
  const sites = sitesQuery.data ?? []
  const items = pageQuery.data?.items ?? []
  const resolvedImportOrgId = importOrgId || organizations[0]?.id || ""
  const fieldOrgId = form.organizationId || resolvedImportOrgId
  const customFieldsQuery = trpc.customFields.list.useQuery(
    { organizationId: fieldOrgId },
    { enabled: canView && Boolean(fieldOrgId) }
  )
  const modelsQuery = trpc.deviceModels.list.useQuery(
    { organizationId: fieldOrgId },
    { enabled: canView && Boolean(fieldOrgId) }
  )
  const foldersQuery = trpc.assets.page.useQuery(
    {
      limit: 200,
      filters: { isContainer: ["true"] },
    },
    {
      enabled: canView && createOpen && !form.isContainer,
      placeholderData: keepPreviousData,
    }
  )

  const selected = items.find((item) => item.id === selectedId) ?? null

  const createAsset = trpc.assets.create.useMutation({
    async onSuccess(record) {
      await utils.assets.page.invalidate()
      setCreateOpen(false)
      setForm(emptyForm())
      toast.success(record.isContainer ? "Folder added" : "Asset added")
      router.push(`/assets/${record.id}`)
    },
    onError(error) {
      toast.error(error.message || "We couldn't add the asset.")
    },
  })
  const createFolder = trpc.assets.createFolder.useMutation({
    async onSuccess(record) {
      await utils.assets.page.invalidate()
      setCreateOpen(false)
      setForm(emptyForm())
      toast.success("Folder added")
      router.push(`/assets/${record.id}`)
    },
    onError(error) {
      toast.error(error.message || "We couldn't add the folder.")
    },
  })
  const deleteAsset = trpc.assets.delete.useMutation({
    async onSuccess() {
      await utils.assets.page.invalidate()
      setDeleteOpen(false)
      setSelectedId("")
      toast.success("Asset removed")
    },
    onError() {
      toast.error("We couldn't remove the asset.")
    },
  })
  const importCsv = trpc.assets.importCsv.useMutation()

  const unmanaged = items.filter((item) => !item.managed).length
  const expiring = items.filter(
    (item) => item.warranty === "expiring" || item.warranty === "expired"
  ).length
  const retiredCount = items.filter(
    (item) => item.lifecycle?.showRetired
  ).length
  const dueToRetire = items.filter(
    (item) => item.lifecycle?.state === "due" && !item.lifecycle.showRetired
  ).length

  const columns = React.useMemo<ColumnDef<AssetRow>[]>(
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
              onClick={(event) => event.stopPropagation()}
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
        accessorFn: (row) => row.parentTag ?? (row.isContainer ? "Folder" : ""),
        meta: { label: "Folder" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Folder" />
        ),
        cell: ({ row }) => {
          if (row.original.isContainer) {
            return "Folder"
          }
          if (row.original.parentAssetId && row.original.parentTag) {
            return (
              <Link
                href={`/assets/${row.original.parentAssetId}`}
                className="font-mono text-xs hover:underline"
                onClick={(event) => event.stopPropagation()}
              >
                {row.original.parentTag}
              </Link>
            )
          }
          return "—"
        },
      },
      {
        id: "isContainer",
        accessorFn: (row) => (row.isContainer ? "true" : "false"),
        meta: { label: "Folder", className: "hidden" },
        header: () => null,
        cell: () => null,
        enableHiding: false,
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
        accessorKey: "siteName",
        meta: { label: "Site" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Site" />
        ),
        cell: ({ row }) => row.original.siteName ?? "—",
      },
      {
        id: "presence",
        accessorFn: (row) => (row.managed ? "Managed" : "Unmanaged"),
        meta: { label: "Presence" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Presence" />
        ),
        cell: ({ row }) =>
          row.original.managed ? (
            <div className="flex min-w-0 flex-col">
              <Badge variant="secondary">Managed</Badge>
              {row.original.deviceId ? (
                <Link
                  href={`/devices/${row.original.deviceId}`}
                  className="truncate text-xs text-muted-foreground hover:underline"
                  onClick={(event) => event.stopPropagation()}
                >
                  {row.original.deviceName}
                </Link>
              ) : null}
            </div>
          ) : (
            <Badge variant="outline">Unmanaged</Badge>
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
          if (lifecycle?.showRetired && row.original.status !== "retired") {
            return (
              <div className="flex flex-col gap-1">
                <span>{assetStatusLabels[row.original.status]}</span>
                <Badge variant="outline">Retired</Badge>
              </div>
            )
          }
          if (lifecycle?.state === "due") {
            return (
              <div className="flex flex-col gap-1">
                <span>{assetStatusLabels[row.original.status]}</span>
                <Badge variant="secondary">Due to retire</Badge>
              </div>
            )
          }
          return assetStatusLabels[row.original.status]
        },
      },
      {
        id: "lifecycle",
        accessorFn: (row) => {
          if (row.lifecycle?.showRetired) return "retired"
          if (row.lifecycle?.state === "due") return "due"
          if (row.lifecycle?.state === "in_service") return "in_service"
          return "none"
        },
        meta: { label: "Lifecycle" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Retire" />
        ),
        cell: ({ row }) => {
          const lifecycle = row.original.lifecycle
          if (!lifecycle?.retireOn) return "—"
          const label = formatDate(lifecycle.retireOn)
          if (lifecycle.showRetired) {
            return <span className="text-destructive">{label}</span>
          }
          if (lifecycle.state === "due") {
            return (
              <span className="text-amber-700 dark:text-amber-300">
                {label}
              </span>
            )
          }
          return label
        },
      },
      {
        accessorKey: "warrantyExpiresOn",
        meta: { label: "Warranty" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Warranty" />
        ),
        cell: ({ row }) => {
          if (!row.original.warrantyExpiresOn) return "—"
          const label = formatDate(row.original.warrantyExpiresOn)
          if (row.original.warranty === "expired") {
            return <span className="text-destructive">{label}</span>
          }
          if (row.original.warranty === "expiring") {
            return (
              <span className="text-amber-700 dark:text-amber-300">
                {label}
              </span>
            )
          }
          return label
        },
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        meta: { className: "w-12" },
        cell: ({ row }) => (
          <DataTableRowActions
            label={row.original.tag}
            actions={[
              {
                label: "Open asset",
                onSelect: () => router.push(`/assets/${row.original.id}`),
              },
              ...(canUpdate
                ? [
                    {
                      label: "Open ticket",
                      onSelect: () => {
                        setSelectedId(row.original.id)
                        setTicketOpen(true)
                      },
                    },
                    {
                      label: "Remove asset",
                      destructive: true,
                      separatorBefore: true,
                      onSelect: () => {
                        setSelectedId(row.original.id)
                        setDeleteOpen(true)
                      },
                    },
                  ]
                : []),
            ]}
          />
        ),
      },
    ],
    [canUpdate, router]
  )

  if (accessLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }

  if (!canView) {
    return <AccessDenied />
  }

  function payloadFromForm() {
    const yearsTrimmed = form.retireAfterYears.trim()
    const yearsParsed = yearsTrimmed ? Number(yearsTrimmed) : null
    return {
      organizationId: form.organizationId,
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

  const folderOptions = (foldersQuery.data?.items ?? []).filter(
    (item) => item.isContainer && item.organizationId === form.organizationId
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Assets"
        title="Inventory"
        description="Track hardware that may never come online. Link a device later if one checks in."
        actions={
          canUpdate ? (
            <>
              <Button variant="outline" asChild>
                <Link href="/assets/folders">Folders</Link>
              </Button>
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                Import
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setForm({
                    ...emptyForm(),
                    organizationId: organizations[0]?.id ?? "",
                    isContainer: true,
                    status: "in_service",
                  })
                  setCreateOpen(true)
                }}
              >
                <PlusIcon />
                Add folder
              </Button>
              <Button
                onClick={() => {
                  setForm({
                    ...emptyForm(),
                    organizationId: organizations[0]?.id ?? "",
                  })
                  setCreateOpen(true)
                }}
              >
                <PlusIcon />
                Add asset
              </Button>
            </>
          ) : (
            <Button variant="outline" asChild>
              <Link href="/assets/folders">Folders</Link>
            </Button>
          )
        }
      />

      <StatStrip
        items={[
          { label: "Assets", value: pageQuery.data?.total ?? items.length },
          { label: "Unmanaged", value: unmanaged },
          { label: "Retired", value: retiredCount },
          { label: "Due to retire", value: dueToRetire },
          { label: "Warranty attention", value: expiring },
          {
            label: "Managed",
            value: items.length - unmanaged,
          },
        ]}
      />

      <DataTable
        columns={columns}
        data={items}
        isLoading={pageQuery.isLoading}
        getRowId={(row) => row.id}
        searchPlaceholder="Search assets"
        facets={[
          {
            columnId: "status",
            title: "Status",
            options: assetStatuses.map((status) => ({
              value: status,
              label: assetStatusLabels[status],
            })),
          },
          {
            columnId: "lifecycle",
            title: "Lifecycle",
            options: [
              { value: "retired", label: assetLifecycleStateLabels.retired },
              { value: "due", label: assetLifecycleStateLabels.due },
              {
                value: "in_service",
                label: assetLifecycleStateLabels.in_service,
              },
            ],
          },
          {
            columnId: "isContainer",
            title: "Folder",
            options: [
              { value: "true", label: "Folders" },
              { value: "false", label: "Items only" },
            ],
          },
          {
            columnId: "presence",
            title: "Presence",
            options: [
              { value: "Managed", label: "Managed" },
              { value: "Unmanaged", label: "Unmanaged" },
            ],
          },
        ]}
        initialSorting={[{ id: "tag", desc: false }]}
        onRowClick={(row) => router.push(`/assets/${row.id}`)}
        emptyTitle="No assets yet"
        emptyDescription="Add printers, switches, spares, and other hardware even if they never enroll."
      />

      {items.length === 0 && !pageQuery.isLoading ? (
        <EmptyState
          title="No assets yet"
          description="Assets do not need a tunnel or an enrolled device."
        />
      ) : null}

      <CsvImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Import assets"
        description="Add or update assets by tag. They stay unmanaged until a matching device appears."
        templateName="assets-template.csv"
        templateCsv={assetTemplate}
        organizations={organizations}
        organizationId={resolvedImportOrgId}
        onOrganizationIdChange={setImportOrgId}
        pending={importCsv.isPending}
        onImport={async (csv) =>
          importCsv.mutateAsync({ organizationId: resolvedImportOrgId, csv })
        }
      />

      <DetailSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={form.isContainer ? "New folder" : "New asset"}
        description={
          form.isContainer
            ? "A folder has its own tracking tag and can hold contained items."
            : "Record hardware that may never enroll."
        }
        className="sm:max-w-xl"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Organization" htmlFor="asset-org">
            <SelectField
              id="asset-org"
              value={form.organizationId}
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  organizationId: value,
                  siteId: "",
                  deviceModelId: "",
                  parentAssetId: "",
                }))
              }
              placeholder="Choose an organization"
              options={organizations.map((organization) => ({
                value: organization.id,
                label: organization.name,
              }))}
            />
          </FormField>
          <FormField label="Tracking tag" htmlFor="asset-tag">
            <Input
              id="asset-tag"
              value={form.tag}
              onChange={(event) =>
                setForm((current) => ({ ...current, tag: event.target.value }))
              }
              className="font-mono"
            />
          </FormField>
          <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 sm:col-span-2">
            <div>
              <p className="text-sm font-medium">Folder</p>
              <p className="text-sm text-muted-foreground">
                Hold other assets. Differentiate by tracking tag.
              </p>
            </div>
            <Switch
              checked={form.isContainer}
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
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  serial: event.target.value,
                }))
              }
            />
          </FormField>
          <FormField label="Host name" htmlFor="asset-hostname">
            <Input
              id="asset-hostname"
              value={form.hostname}
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
              options={sites
                .filter(
                  (site) =>
                    !form.organizationId ||
                    site.organizationId === form.organizationId
                )
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
              options={assetStatuses.map((status) => ({
                value: status,
                label: assetStatusLabels[status],
              }))}
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
        <Button
          disabled={
            !form.organizationId ||
            !form.tag ||
            createAsset.isPending ||
            createFolder.isPending
          }
          onClick={() => {
            const payload = payloadFromForm()
            if (payload.isContainer) {
              void createFolder.mutateAsync(payload)
            } else {
              void createAsset.mutateAsync(payload)
            }
          }}
        >
          {form.isContainer ? "Add folder" : "Add asset"}
        </Button>
      </DetailSheet>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Remove this asset?"
        description="The inventory record will be removed. Linked devices stay enrolled."
        confirmLabel="Remove asset"
        destructive
        pending={deleteAsset.isPending}
        onConfirm={() => {
          if (selectedId) void deleteAsset.mutateAsync({ id: selectedId })
        }}
      />

      {selected ? (
        <OpenAssetTicketDialog
          key={selected.id}
          assetId={selected.id}
          assetTag={selected.tag}
          siteName={selected.siteName}
          open={ticketOpen}
          onOpenChange={setTicketOpen}
        />
      ) : null}
    </div>
  )
}
