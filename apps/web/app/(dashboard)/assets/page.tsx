"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { keepPreviousData } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { toast } from "sonner"
import { PlusIcon } from "lucide-react"

import {
  assetStatusLabels,
  assetStatuses,
  definitionAppliesTo,
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
  tag: string
  vendor: string
  model: string
  serial: string
  hostname: string
  status: AssetStatus
  purchaseDate: string
  purchaseCost: string
  warrantyExpiresOn: string
  notes: string
  customFields: Record<string, string>
}

const emptyForm = (): AssetForm => ({
  organizationId: "",
  siteId: "",
  tag: "",
  vendor: "",
  model: "",
  serial: "",
  hostname: "",
  status: "stock",
  purchaseDate: "",
  purchaseCost: "",
  warrantyExpiresOn: "",
  notes: "",
  customFields: {},
})

const assetTemplate = [
  "tag,vendor,model,serial,hostname,site,status,purchase_date,purchase_cost,warranty_expires_on,notes",
  "PRN-1,Example,Laser,SN-100,,Main,stock,2026-01-15,240.00,2028-01-15,Spare printer",
].join("\n")

function formFromAsset(asset: AssetRow): AssetForm {
  return {
    organizationId: asset.organizationId,
    siteId: asset.siteId ?? "",
    tag: asset.tag,
    vendor: asset.vendor ?? "",
    model: asset.model ?? "",
    serial: asset.serial ?? "",
    hostname: asset.hostname ?? "",
    status: asset.status,
    purchaseDate: asset.purchaseDate ?? "",
    purchaseCost: asset.purchaseCost ?? "",
    warrantyExpiresOn: asset.warrantyExpiresOn ?? "",
    notes: asset.notes ?? "",
    customFields: Object.fromEntries(
      Object.entries(asset.customFields ?? {}).map(([key, value]) => [
        key,
        value == null ? "" : String(value),
      ])
    ),
  }
}

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
  const { can, isLoading: accessLoading } = usePermissions()
  const searchParams = useSearchParams()
  const requestedId = searchParams.get("id") ?? ""
  const canView = can("device:view")
  const canUpdate = can("device:update")
  const utils = trpc.useUtils()

  const [createOpen, setCreateOpen] = React.useState(false)
  const [importOpen, setImportOpen] = React.useState(false)
  const [selectedId, setSelectedId] = React.useState("")
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [ticketOpen, setTicketOpen] = React.useState(false)
  const [form, setForm] = React.useState<AssetForm>(emptyForm)
  const [linkDeviceId, setLinkDeviceId] = React.useState("")
  const [importOrgId, setImportOrgId] = React.useState("")

  const organizationsQuery = trpc.organizations.list.useQuery(undefined, {
    enabled: canView,
  })
  const sitesQuery = trpc.sites.list.useQuery(undefined, { enabled: canView })
  const devicesQuery = trpc.devices.list.useQuery(undefined, {
    enabled: canUpdate,
  })
  const pageQuery = trpc.assets.page.useQuery(
    { limit: 200 },
    { enabled: canView, placeholderData: keepPreviousData }
  )

  const organizations = organizationsQuery.data ?? []
  const sites = sitesQuery.data ?? []
  const devices = devicesQuery.data ?? []
  const items = pageQuery.data?.items ?? []
  const resolvedImportOrgId = importOrgId || organizations[0]?.id || ""
  const fieldOrgId = form.organizationId || resolvedImportOrgId
  const customFieldsQuery = trpc.customFields.list.useQuery(
    { organizationId: fieldOrgId },
    { enabled: canView && Boolean(fieldOrgId) }
  )

  const selected = items.find((item) => item.id === selectedId) ?? null
  const [formAssetId, setFormAssetId] = React.useState("")
  const [openedFromQuery, setOpenedFromQuery] = React.useState("")
  if (selected && selected.id !== formAssetId) {
    setFormAssetId(selected.id)
    setForm(formFromAsset(selected))
    setLinkDeviceId(selected.deviceId ?? "")
  }
  if (
    requestedId &&
    requestedId !== openedFromQuery &&
    items.some((item) => item.id === requestedId)
  ) {
    setOpenedFromQuery(requestedId)
    setSelectedId(requestedId)
    setMobileOpen(true)
  }

  const createAsset = trpc.assets.create.useMutation({
    async onSuccess() {
      await utils.assets.page.invalidate()
      setCreateOpen(false)
      setForm(emptyForm())
      toast.success("Asset added")
    },
    onError(error) {
      toast.error(error.message || "We couldn't add the asset.")
    },
  })
  const updateAsset = trpc.assets.update.useMutation({
    async onSuccess() {
      await utils.assets.page.invalidate()
      toast.success("Asset updated")
    },
    onError(error) {
      toast.error(error.message || "We couldn't update the asset.")
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
  const linkDevice = trpc.assets.linkDevice.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.assets.page.invalidate(),
        utils.devices.list.invalidate(),
      ])
      toast.success("Device linked")
    },
    onError(error) {
      toast.error(error.message || "We couldn't link that device.")
    },
  })
  const unlinkDevice = trpc.assets.unlinkDevice.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.assets.page.invalidate(),
        utils.devices.list.invalidate(),
      ])
      setLinkDeviceId("")
      toast.success("Device unlinked")
    },
    onError() {
      toast.error("We couldn't unlink that device.")
    },
  })
  const importCsv = trpc.assets.importCsv.useMutation()

  const unmanaged = items.filter((item) => !item.managed).length
  const expiring = items.filter(
    (item) => item.warranty === "expiring" || item.warranty === "expired"
  ).length

  const columns = React.useMemo<ColumnDef<AssetRow>[]>(
    () => [
      {
        accessorKey: "tag",
        meta: { label: "Tag" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Tag" />
        ),
        cell: ({ row }) => (
          <span className="font-medium">{row.original.tag}</span>
        ),
      },
      {
        accessorKey: "vendor",
        meta: { label: "Vendor" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Vendor" />
        ),
        cell: ({ row }) => row.original.vendor ?? "—",
      },
      {
        accessorKey: "model",
        meta: { label: "Model" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Model" />
        ),
        cell: ({ row }) => row.original.model ?? "—",
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
        cell: ({ row }) => assetStatusLabels[row.original.status],
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
                label: "Edit asset",
                onSelect: () => {
                  setSelectedId(row.original.id)
                  setMobileOpen(true)
                },
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
    [canUpdate]
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
    return {
      organizationId: form.organizationId,
      siteId: form.siteId || null,
      tag: form.tag,
      vendor: form.vendor || null,
      model: form.model || null,
      serial: form.serial || null,
      hostname: form.hostname || null,
      status: form.status,
      purchaseDate: form.purchaseDate || null,
      purchaseCost: form.purchaseCost || null,
      warrantyExpiresOn: form.warrantyExpiresOn || null,
      notes: form.notes || null,
      customFields: form.customFields,
    }
  }

  const formFields = (
    <div className="grid gap-4 sm:grid-cols-2">
      {!selected ? (
        <FormField label="Organization" htmlFor="asset-org">
          <SelectField
            id="asset-org"
            value={form.organizationId}
            onValueChange={(value) =>
              setForm((current) => ({
                ...current,
                organizationId: value,
                siteId: "",
              }))
            }
            placeholder="Choose an organization"
            options={organizations.map((organization) => ({
              value: organization.id,
              label: organization.name,
            }))}
          />
        </FormField>
      ) : null}
      <FormField label="Tag" htmlFor="asset-tag">
        <Input
          id="asset-tag"
          value={form.tag}
          onChange={(event) =>
            setForm((current) => ({ ...current, tag: event.target.value }))
          }
        />
      </FormField>
      <FormField label="Vendor" htmlFor="asset-vendor">
        <Input
          id="asset-vendor"
          value={form.vendor}
          onChange={(event) =>
            setForm((current) => ({ ...current, vendor: event.target.value }))
          }
        />
      </FormField>
      <FormField label="Model" htmlFor="asset-model">
        <Input
          id="asset-model"
          value={form.model}
          onChange={(event) =>
            setForm((current) => ({ ...current, model: event.target.value }))
          }
        />
      </FormField>
      <FormField label="Serial" htmlFor="asset-serial">
        <Input
          id="asset-serial"
          value={form.serial}
          onChange={(event) =>
            setForm((current) => ({ ...current, serial: event.target.value }))
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
      <FormField label="Purchase date" htmlFor="asset-purchased">
        <Input
          id="asset-purchased"
          type="date"
          value={form.purchaseDate}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              purchaseDate: event.target.value,
            }))
          }
        />
      </FormField>
      <FormField label="Cost" htmlFor="asset-cost">
        <Input
          id="asset-cost"
          inputMode="decimal"
          value={form.purchaseCost}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              purchaseCost: event.target.value,
            }))
          }
        />
      </FormField>
      <FormField label="Warranty ends" htmlFor="asset-warranty">
        <Input
          id="asset-warranty"
          type="date"
          value={form.warrantyExpiresOn}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              warrantyExpiresOn: event.target.value,
            }))
          }
        />
      </FormField>
      <FormField label="Notes" htmlFor="asset-notes" className="sm:col-span-2">
        <Textarea
          id="asset-notes"
          value={form.notes}
          onChange={(event) =>
            setForm((current) => ({ ...current, notes: event.target.value }))
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
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                Import
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
          ) : null
        }
      />

      <StatStrip
        items={[
          { label: "Assets", value: pageQuery.data?.total ?? items.length },
          { label: "Unmanaged", value: unmanaged },
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
            columnId: "presence",
            title: "Presence",
            options: [
              { value: "Managed", label: "Managed" },
              { value: "Unmanaged", label: "Unmanaged" },
            ],
          },
        ]}
        initialSorting={[{ id: "tag", desc: false }]}
        onRowClick={(row) => {
          setSelectedId(row.id)
          setMobileOpen(true)
        }}
        isRowActive={(row) => row.id === selectedId}
        emptyTitle="No assets yet"
        emptyDescription="Add printers, switches, spares, and other hardware even if they never enroll."
      />

      {items.length === 0 && !pageQuery.isLoading ? (
        <EmptyState
          title="No assets yet"
          description="Assets do not need a tunnel or an enrolled device."
        />
      ) : null}

      {selected ? (
        <DetailSheet
          open={mobileOpen}
          onOpenChange={setMobileOpen}
          title={selected.tag}
          description="Financial and physical record. Unmanaged means nothing has checked in against this asset."
        >
          {formFields}
          {canUpdate ? (
            <div className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <SelectField
                  value={linkDeviceId}
                  onValueChange={setLinkDeviceId}
                  placeholder="Link a device"
                  emptyLabel="Not linked"
                  options={devices
                    .filter(
                      (device) =>
                        device.organizationId === selected.organizationId &&
                        (!device.assetId || device.assetId === selected.id)
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
                        id: selected.id,
                        deviceId: linkDeviceId,
                      })
                    }
                  >
                    Link
                  </Button>
                  {selected.deviceId ? (
                    <Button
                      variant="ghost"
                      disabled={unlinkDevice.isPending}
                      onClick={() =>
                        void unlinkDevice.mutateAsync({ id: selected.id })
                      }
                    >
                      Unlink
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setTicketOpen(true)}>
                  Open ticket
                </Button>
                <Button
                  disabled={!form.tag || updateAsset.isPending}
                  onClick={() =>
                    void updateAsset.mutateAsync({
                      id: selected.id,
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
            </div>
          ) : null}
        </DetailSheet>
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

      {createOpen ? (
        <DetailSheet
          open={createOpen}
          onOpenChange={setCreateOpen}
          title="New asset"
          description="Record hardware that may never enroll."
        >
          {formFields}
          <Button
            disabled={
              !form.organizationId || !form.tag || createAsset.isPending
            }
            onClick={() => void createAsset.mutateAsync(payloadFromForm())}
          >
            Add asset
          </Button>
        </DetailSheet>
      ) : null}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Remove this asset?"
        description="The financial record will be removed. Linked devices stay in inventory."
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
