"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog"
import { CsvImportDialog } from "@/components/dashboard/csv-import-dialog"
import { CodeBlock } from "@/components/dashboard/code-block"
import {
  DataTable,
  DataTableColumnHeader,
  DataTableRowActions,
} from "@/components/dashboard/data-table"
import { DetailSheet } from "@/components/dashboard/detail-sheet"
import { EmptyState } from "@/components/dashboard/empty-state"
import { FormField } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { SectionCard } from "@/components/dashboard/section-card"
import { SelectField } from "@/components/dashboard/select-field"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { trpc } from "@/lib/trpc"
import type { ColumnDef } from "@tanstack/react-table"

type SiteRow = {
  id: string
  organizationId: string
  organizationName: string
  name: string
  timezone: string | null
  deviceCount: number
  hasSshCredential: boolean
}

export default function SitesPage() {
  const utils = trpc.useUtils()
  const organizationsQuery = trpc.organizations.list.useQuery()
  const sitesQuery = trpc.sites.list.useQuery()
  const devicesQuery = trpc.devices.list.useQuery()
  const [selectedSiteId, setSelectedSiteId] = React.useState("")
  const [mobileDetailOpen, setMobileDetailOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)

  const [createOrganizationId, setCreateOrganizationId] = React.useState("")
  const [createName, setCreateName] = React.useState("")
  const [createTimezone, setCreateTimezone] = React.useState("")
  const [createNotes, setCreateNotes] = React.useState("")
  const [createAddress, setCreateAddress] = React.useState("")
  const [createContactName, setCreateContactName] = React.useState("")
  const [createContactEmail, setCreateContactEmail] = React.useState("")
  const [createContactPhone, setCreateContactPhone] = React.useState("")
  const [editName, setEditName] = React.useState("")
  const [editTimezone, setEditTimezone] = React.useState("")
  const [editNotes, setEditNotes] = React.useState("")
  const [editAddress, setEditAddress] = React.useState("")
  const [editContactName, setEditContactName] = React.useState("")
  const [editContactEmail, setEditContactEmail] = React.useState("")
  const [editContactPhone, setEditContactPhone] = React.useState("")
  const [editWeekdaysOpen, setEditWeekdaysOpen] = React.useState("09:00")
  const [editWeekdaysClose, setEditWeekdaysClose] = React.useState("17:00")
  const [editWeekdaysEnabled, setEditWeekdaysEnabled] = React.useState(false)
  const [editRequireReason, setEditRequireReason] = React.useState(false)
  const [editRequireApproval, setEditRequireApproval] = React.useState(false)
  const [importOpen, setImportOpen] = React.useState(false)
  const [importOrgId, setImportOrgId] = React.useState("")

  const createSite = trpc.sites.create.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.sites.list.invalidate(),
        utils.devices.list.invalidate(),
      ])
      setCreateName("")
      setCreateTimezone("")
      setCreateNotes("")
      setCreateAddress("")
      setCreateContactName("")
      setCreateContactEmail("")
      setCreateContactPhone("")
      toast.success("Site created")
    },
    onError() {
      toast.error("We couldn't create the site.")
    },
  })

  const updateSite = trpc.sites.update.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.sites.list.invalidate(),
        utils.devices.list.invalidate(),
      ])
      toast.success("Site updated")
    },
    onError() {
      toast.error("We couldn't update the site.")
    },
  })

  const deleteSite = trpc.sites.delete.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.sites.list.invalidate(),
        utils.devices.list.invalidate(),
      ])
      setDeleteOpen(false)
      toast.success("Site removed")
    },
    onError() {
      toast.error("We couldn't remove the site.")
    },
  })

  const importCsv = trpc.sites.importCsv.useMutation()

  const sites = React.useMemo(() => sitesQuery.data ?? [], [sitesQuery.data])
  const organizations = React.useMemo(
    () => organizationsQuery.data ?? [],
    [organizationsQuery.data]
  )
  const resolvedImportOrgId = importOrgId || organizations[0]?.id || ""
  const devices = React.useMemo(
    () => devicesQuery.data ?? [],
    [devicesQuery.data]
  )

  React.useEffect(() => {
    if (sites.length === 0) {
      setSelectedSiteId("")
      return
    }

    if (!sites.some((site) => site.id === selectedSiteId)) {
      setSelectedSiteId(sites[0].id)
    }
  }, [selectedSiteId, sites])

  const selectedSite = React.useMemo(
    () => sites.find((site) => site.id === selectedSiteId) ?? null,
    [selectedSiteId, sites]
  )

  const deviceCountBySite = React.useMemo(() => {
    const counts = new Map<string, number>()

    for (const device of devices) {
      if (!device.siteId) continue
      counts.set(device.siteId, (counts.get(device.siteId) ?? 0) + 1)
    }

    return counts
  }, [devices])

  React.useEffect(() => {
    if (selectedSite) {
      setEditName(selectedSite.name)
      setEditTimezone(selectedSite.timezone ?? "")
      setEditNotes(selectedSite.notes ?? "")
      setEditAddress(selectedSite.address ?? "")
      const contact = selectedSite.contacts?.[0]
      setEditContactName(contact?.name ?? "")
      setEditContactEmail(contact?.email ?? "")
      setEditContactPhone(contact?.phone ?? "")
      const weekdays = selectedSite.businessHours?.weekdays
      setEditWeekdaysEnabled(Boolean(weekdays))
      setEditWeekdaysOpen(weekdays?.open ?? "09:00")
      setEditWeekdaysClose(weekdays?.close ?? "17:00")
      setEditRequireReason(Boolean(selectedSite.requireAccessReason))
      setEditRequireApproval(Boolean(selectedSite.requireApproval))
    }
  }, [selectedSite])

  const rows = React.useMemo<SiteRow[]>(
    () =>
      sites.map((site) => ({
        id: site.id,
        organizationId: site.organizationId,
        organizationName:
          organizations.find((entry) => entry.id === site.organizationId)
            ?.name ?? "—",
        name: site.name,
        timezone: site.timezone,
        deviceCount: deviceCountBySite.get(site.id) ?? 0,
        hasSshCredential: site.hasSshCredential,
      })),
    [deviceCountBySite, organizations, sites]
  )

  const openSite = React.useCallback((id: string) => {
    setSelectedSiteId(id)
    setMobileDetailOpen(true)
  }, [])

  const columns = React.useMemo<ColumnDef<SiteRow>[]>(
    () => [
      {
        accessorKey: "name",
        meta: { label: "Name" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Name" />
        ),
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name}</span>
        ),
      },
      {
        accessorKey: "organizationName",
        meta: { label: "Organization" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Organization" />
        ),
      },
      {
        accessorKey: "deviceCount",
        meta: { label: "Devices", align: "right" },
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Devices"
            align="right"
          />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.deviceCount}</span>
        ),
      },
      {
        id: "ssh",
        accessorFn: (row) => (row.hasSshCredential ? "Ready" : "None"),
        meta: { label: "SSH" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="SSH" />
        ),
        cell: ({ row }) =>
          row.original.hasSshCredential ? (
            <Badge variant="secondary">Ready</Badge>
          ) : (
            <Badge variant="outline">None</Badge>
          ),
      },
      {
        accessorKey: "timezone",
        meta: { label: "Timezone" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Timezone" />
        ),
        cell: ({ row }) => row.original.timezone ?? "—",
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        meta: { className: "w-12" },
        cell: ({ row }) => (
          <DataTableRowActions
            label={row.original.name}
            actions={[
              { label: "Edit site", onSelect: () => openSite(row.original.id) },
              {
                label: "Remove site",
                destructive: true,
                separatorBefore: true,
                onSelect: () => {
                  setSelectedSiteId(row.original.id)
                  setDeleteOpen(true)
                },
              },
            ]}
          />
        ),
      },
    ],
    [openSite]
  )

  const organizationFacetOptions = React.useMemo(
    () =>
      organizations.map((organization) => ({
        value: organization.name,
        label: organization.name,
      })),
    [organizations]
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Sites"
        title="Locations"
        description="Create and update sites, then assign devices to the right location."
        actions={
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            Import
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <SectionCard
          className="order-2 lg:order-1"
          title="New site"
          description="Add a location for devices to live under. An SSH key is created automatically."
          collapsibleOnMobile
          contentClassName="flex flex-col gap-4"
        >
          <FormField label="Organization" htmlFor="site-create-organization">
            <SelectField
              id="site-create-organization"
              value={createOrganizationId}
              onValueChange={setCreateOrganizationId}
              placeholder="Choose an organization"
              options={organizations.map((organization) => ({
                value: organization.id,
                label: organization.name,
              }))}
            />
          </FormField>
          <FormField label="Name" htmlFor="site-create-name">
            <Input
              id="site-create-name"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
            />
          </FormField>
          <FormField label="Timezone" htmlFor="site-create-timezone">
            <Input
              id="site-create-timezone"
              value={createTimezone}
              onChange={(event) => setCreateTimezone(event.target.value)}
            />
          </FormField>
          <FormField label="Notes" htmlFor="site-create-notes">
            <Textarea
              id="site-create-notes"
              value={createNotes}
              onChange={(event) => setCreateNotes(event.target.value)}
            />
          </FormField>
          <FormField label="Address" htmlFor="site-create-address">
            <Textarea
              id="site-create-address"
              value={createAddress}
              onChange={(event) => setCreateAddress(event.target.value)}
            />
          </FormField>
          <FormField label="Contact" htmlFor="site-create-contact">
            <Input
              id="site-create-contact"
              value={createContactName}
              onChange={(event) => setCreateContactName(event.target.value)}
              placeholder="Name"
            />
          </FormField>
          <FormField label="Contact email" htmlFor="site-create-email">
            <Input
              id="site-create-email"
              value={createContactEmail}
              onChange={(event) => setCreateContactEmail(event.target.value)}
            />
          </FormField>
          <FormField label="Contact phone" htmlFor="site-create-phone">
            <Input
              id="site-create-phone"
              value={createContactPhone}
              onChange={(event) => setCreateContactPhone(event.target.value)}
            />
          </FormField>
          <Button
            className="w-full sm:w-fit"
            onClick={() => {
              void createSite.mutateAsync({
                organizationId: createOrganizationId,
                name: createName,
                timezone: createTimezone || null,
                notes: createNotes || null,
                address: createAddress || null,
                contacts: createContactName
                  ? [
                      {
                        name: createContactName,
                        email: createContactEmail || null,
                        phone: createContactPhone || null,
                      },
                    ]
                  : [],
              })
            }}
            disabled={
              !createOrganizationId || !createName || createSite.isPending
            }
          >
            Create site
          </Button>
        </SectionCard>

        <Card className="order-1 lg:order-2">
          <CardHeader>
            <CardTitle>Sites</CardTitle>
            <CardDescription>
              Sort, filter, and pick a site to edit it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={columns}
              data={rows}
              isLoading={sitesQuery.isLoading}
              getRowId={(row) => row.id}
              searchPlaceholder="Search sites"
              facets={[
                {
                  columnId: "organizationName",
                  title: "Organization",
                  options: organizationFacetOptions,
                },
                {
                  columnId: "ssh",
                  title: "SSH",
                  options: [
                    { value: "Ready", label: "Ready" },
                    { value: "None", label: "None" },
                  ],
                },
              ]}
              initialSorting={[{ id: "name", desc: false }]}
              onRowClick={(row) => openSite(row.id)}
              isRowActive={(row) => row.id === selectedSiteId}
              emptyTitle="No sites yet"
              emptyDescription="Create a site to start assigning devices to a location."
            />
          </CardContent>
        </Card>
      </div>

      {selectedSite ? (
        <DetailSheet
          open={mobileDetailOpen}
          onOpenChange={setMobileDetailOpen}
          title="Edit site"
          description="Update the selected location or remove it."
          contentClassName="gap-6"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Name" htmlFor="site-edit-name">
              <Input
                id="site-edit-name"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
              />
            </FormField>
            <FormField label="Timezone" htmlFor="site-edit-timezone">
              <Input
                id="site-edit-timezone"
                value={editTimezone}
                onChange={(event) => setEditTimezone(event.target.value)}
              />
            </FormField>
            <FormField
              label="Notes"
              htmlFor="site-edit-notes"
              className="md:col-span-2"
            >
              <Textarea
                id="site-edit-notes"
                value={editNotes}
                onChange={(event) => setEditNotes(event.target.value)}
              />
            </FormField>
            <FormField
              label="Address"
              htmlFor="site-edit-address"
              className="md:col-span-2"
            >
              <Textarea
                id="site-edit-address"
                value={editAddress}
                onChange={(event) => setEditAddress(event.target.value)}
              />
            </FormField>
            <FormField label="Contact" htmlFor="site-edit-contact">
              <Input
                id="site-edit-contact"
                value={editContactName}
                onChange={(event) => setEditContactName(event.target.value)}
              />
            </FormField>
            <FormField label="Contact email" htmlFor="site-edit-email">
              <Input
                id="site-edit-email"
                value={editContactEmail}
                onChange={(event) => setEditContactEmail(event.target.value)}
              />
            </FormField>
            <FormField label="Contact phone" htmlFor="site-edit-phone">
              <Input
                id="site-edit-phone"
                value={editContactPhone}
                onChange={(event) => setEditContactPhone(event.target.value)}
              />
            </FormField>
            <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-3 md:col-span-2">
              <div>
                <p className="text-sm font-medium">Weekday hours</p>
                <p className="text-xs text-muted-foreground">
                  Used later for maintenance windows and reports.
                </p>
              </div>
              <Switch
                checked={editWeekdaysEnabled}
                onCheckedChange={setEditWeekdaysEnabled}
              />
            </div>
            {editWeekdaysEnabled ? (
              <>
                <FormField label="Opens" htmlFor="site-edit-open">
                  <Input
                    id="site-edit-open"
                    type="time"
                    value={editWeekdaysOpen}
                    onChange={(event) =>
                      setEditWeekdaysOpen(event.target.value)
                    }
                  />
                </FormField>
                <FormField label="Closes" htmlFor="site-edit-close">
                  <Input
                    id="site-edit-close"
                    type="time"
                    value={editWeekdaysClose}
                    onChange={(event) =>
                      setEditWeekdaysClose(event.target.value)
                    }
                  />
                </FormField>
              </>
            ) : null}
            <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-3 md:col-span-2">
              <div>
                <p className="text-sm font-medium">Require a reason</p>
                <p className="text-xs text-muted-foreground">
                  People must say why they need access before connecting.
                </p>
              </div>
              <Switch
                checked={editRequireReason}
                onCheckedChange={setEditRequireReason}
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-3 md:col-span-2">
              <div>
                <p className="text-sm font-medium">Require approval</p>
                <p className="text-xs text-muted-foreground">
                  A reviewer must approve access before a session starts.
                </p>
              </div>
              <Switch
                checked={editRequireApproval}
                onCheckedChange={setEditRequireApproval}
              />
            </div>
            <div className="flex flex-wrap gap-3 md:col-span-2">
              <Button
                className="w-full sm:w-auto"
                onClick={() => {
                  void updateSite.mutateAsync({
                    id: selectedSite.id,
                    name: editName,
                    timezone: editTimezone || null,
                    notes: editNotes || null,
                    address: editAddress || null,
                    contacts: editContactName
                      ? [
                          {
                            name: editContactName,
                            email: editContactEmail || null,
                            phone: editContactPhone || null,
                          },
                        ]
                      : [],
                    businessHours: editWeekdaysEnabled
                      ? {
                          weekdays: {
                            open: editWeekdaysOpen,
                            close: editWeekdaysClose,
                          },
                        }
                      : null,
                    requireAccessReason: editRequireReason,
                    requireApproval: editRequireApproval,
                  })
                }}
                disabled={!editName || updateSite.isPending}
              >
                Save changes
              </Button>
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => setDeleteOpen(true)}
                disabled={deleteSite.isPending}
              >
                Remove site
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t pt-6">
            <div>
              <p className="text-sm font-medium">SSH access</p>
              <p className="text-sm text-muted-foreground">
                A key is created with the site. Enrollment installs it on
                devices automatically.
              </p>
            </div>
            {selectedSite.hasSshCredential && selectedSite.sshPublicKey ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Username: {selectedSite.sshUsername ?? "root"}
                </p>
                <CodeBlock
                  label="Public key"
                  value={selectedSite.sshPublicKey}
                />
              </>
            ) : (
              <EmptyState
                title="SSH key pending"
                description="This location does not have an SSH key yet. Create a new site to provision one automatically."
              />
            )}
          </div>
        </DetailSheet>
      ) : null}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Remove site"
        description={
          selectedSite
            ? `Remove ${selectedSite.name}? Devices assigned to it will lose this site.`
            : "Remove this site?"
        }
        confirmLabel="Remove site"
        destructive
        pending={deleteSite.isPending}
        onConfirm={() => {
          if (!selectedSite) return
          void deleteSite.mutateAsync({ id: selectedSite.id })
        }}
      />

      <CsvImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Import sites"
        description="Create sites from a spreadsheet. Existing names are skipped."
        templateName="sites-template.csv"
        templateCsv={[
          "organization,name,timezone,address,contact_name,contact_email,contact_phone,notes",
          "Acme,Warehouse,America/Chicago,1 Main St,Pat,pat@example.com,,Receiving dock",
        ].join("\n")}
        organizations={organizations}
        organizationId={resolvedImportOrgId}
        onOrganizationIdChange={setImportOrgId}
        pending={importCsv.isPending}
        onImport={async (csv) =>
          importCsv.mutateAsync({ organizationId: resolvedImportOrgId, csv })
        }
      />
    </div>
  )
}
