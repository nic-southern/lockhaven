"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import * as React from "react"
import { PlusIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { venueFloorLabel, type SiteBusinessHours } from "@nms/shared"

import { Button } from "@/components/ui/button"
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
import { FormField, NativeSelect } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { SelectField } from "@/components/dashboard/select-field"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { timeZoneOptions } from "@/lib/time-zones"
import { trpc } from "@/lib/trpc"
import type { ColumnDef } from "@tanstack/react-table"

type SiteRow = {
  id: string
  organizationId: string
  organizationName: string
  name: string
  timezone: string | null
  hours: "open" | "closed" | "none"
  deviceCount: number
  hasSshCredential: boolean
}

type HolidayDraft = {
  date: string
  closed: boolean
  open: string
  close: string
}

function TimeZoneField({
  id,
  value,
  onChange,
}: {
  id: string
  value: string
  onChange: (value: string) => void
}) {
  const options = timeZoneOptions()
  const extra = value && !options.includes(value) ? [value] : []
  return (
    <NativeSelect
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Not set</option>
      {[...extra, ...options].map((zone) => (
        <option key={zone} value={zone}>
          {zone}
        </option>
      ))}
    </NativeSelect>
  )
}

function DayHoursToggle({
  id,
  label,
  enabled,
  open,
  close,
  onEnabledChange,
  onOpenChange,
  onCloseChange,
}: {
  id: string
  label: string
  enabled: boolean
  open: string
  close: string
  onEnabledChange: (value: boolean) => void
  onOpenChange: (value: string) => void
  onCloseChange: (value: string) => void
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-3 md:col-span-2">
        <div>
          <p className="text-sm font-medium">{label}</p>
        </div>
        <Switch checked={enabled} onCheckedChange={onEnabledChange} />
      </div>
      {enabled ? (
        <>
          <FormField label="Opens" htmlFor={`${id}-open`}>
            <Input
              id={`${id}-open`}
              type="time"
              value={open}
              onChange={(event) => onOpenChange(event.target.value)}
            />
          </FormField>
          <FormField label="Closes" htmlFor={`${id}-close`}>
            <Input
              id={`${id}-close`}
              type="time"
              value={close}
              onChange={(event) => onCloseChange(event.target.value)}
            />
          </FormField>
        </>
      ) : null}
    </>
  )
}

function buildSiteHours(input: {
  weekdaysEnabled: boolean
  weekdaysOpen: string
  weekdaysClose: string
  saturdayEnabled: boolean
  saturdayOpen: string
  saturdayClose: string
  sundayEnabled: boolean
  sundayOpen: string
  sundayClose: string
  holidays: HolidayDraft[]
}): SiteBusinessHours | null {
  const holidays = input.holidays
    .filter((holiday) => holiday.date)
    .map((holiday) =>
      holiday.closed
        ? { date: holiday.date, closed: true as const }
        : {
            date: holiday.date,
            open: holiday.open,
            close: holiday.close,
          }
    )
  const hours: SiteBusinessHours = {
    weekdays: input.weekdaysEnabled
      ? { open: input.weekdaysOpen, close: input.weekdaysClose }
      : null,
    saturday: input.saturdayEnabled
      ? { open: input.saturdayOpen, close: input.saturdayClose }
      : null,
    sunday: input.sundayEnabled
      ? { open: input.sundayOpen, close: input.sundayClose }
      : null,
    ...(holidays.length > 0 ? { holidays } : {}),
  }
  if (
    !hours.weekdays &&
    !hours.saturday &&
    !hours.sunday &&
    !hours.holidays?.length
  ) {
    return null
  }
  return hours
}

export default function SitesPage() {
  const utils = trpc.useUtils()
  const organizationsQuery = trpc.organizations.list.useQuery()
  const sitesQuery = trpc.sites.list.useQuery()
  const devicesQuery = trpc.devices.list.useQuery()
  const [selectedSiteId, setSelectedSiteId] = React.useState("")
  const [detailOpen, setDetailOpen] = React.useState(false)
  const [createOpen, setCreateOpen] = React.useState(false)
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
  const [editWeekdaysOpen, setEditWeekdaysOpen] = React.useState("10:00")
  const [editWeekdaysClose, setEditWeekdaysClose] = React.useState("22:00")
  const [editWeekdaysEnabled, setEditWeekdaysEnabled] = React.useState(false)
  const [editSaturdayOpen, setEditSaturdayOpen] = React.useState("10:00")
  const [editSaturdayClose, setEditSaturdayClose] = React.useState("22:00")
  const [editSaturdayEnabled, setEditSaturdayEnabled] = React.useState(false)
  const [editSundayOpen, setEditSundayOpen] = React.useState("12:00")
  const [editSundayClose, setEditSundayClose] = React.useState("18:00")
  const [editSundayEnabled, setEditSundayEnabled] = React.useState(false)
  const [editHolidays, setEditHolidays] = React.useState<HolidayDraft[]>([])
  const [editRequireReason, setEditRequireReason] = React.useState(false)
  const [editRequireApproval, setEditRequireApproval] = React.useState(false)
  const [importOpen, setImportOpen] = React.useState(false)
  const [importOrgId, setImportOrgId] = React.useState("")

  const createSite = trpc.sites.create.useMutation({
    async onSuccess(result) {
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
      setCreateOpen(false)
      setSelectedSiteId(result.id)
      setDetailOpen(true)
      toast.success("Site created")
    },
    onError(error) {
      toast.error(error.message || "We couldn't create the site.")
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
    onError(error) {
      toast.error(error.message || "We couldn't update the site.")
    },
  })

  const deleteSite = trpc.sites.delete.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.sites.list.invalidate(),
        utils.devices.list.invalidate(),
      ])
      setDeleteOpen(false)
      setDetailOpen(false)
      setSelectedSiteId("")
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
    if (selectedSiteId && !sites.some((site) => site.id === selectedSiteId)) {
      setSelectedSiteId("")
      setDetailOpen(false)
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
      setEditWeekdaysOpen(weekdays?.open ?? "10:00")
      setEditWeekdaysClose(weekdays?.close ?? "22:00")
      const saturday = selectedSite.businessHours?.saturday
      setEditSaturdayEnabled(Boolean(saturday))
      setEditSaturdayOpen(saturday?.open ?? "10:00")
      setEditSaturdayClose(saturday?.close ?? "22:00")
      const sunday = selectedSite.businessHours?.sunday
      setEditSundayEnabled(Boolean(sunday))
      setEditSundayOpen(sunday?.open ?? "12:00")
      setEditSundayClose(sunday?.close ?? "18:00")
      setEditHolidays(
        (selectedSite.businessHours?.holidays ?? []).map((holiday) => ({
          date: holiday.date,
          closed: holiday.closed === true || !holiday.open || !holiday.close,
          open: holiday.open ?? "10:00",
          close: holiday.close ?? "22:00",
        }))
      )
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
        hours: venueFloorLabel({
          hours: site.businessHours,
          timeZone: site.timezone,
        }),
        deviceCount: deviceCountBySite.get(site.id) ?? 0,
        hasSshCredential: site.hasSshCredential,
      })),
    [deviceCountBySite, organizations, sites]
  )

  const openSite = React.useCallback((id: string) => {
    setCreateOpen(false)
    setSelectedSiteId(id)
    setDetailOpen(true)
  }, [])

  const openCreate = React.useCallback(() => {
    setDetailOpen(false)
    setCreateOpen(true)
    setCreateOrganizationId((current) => current || organizations[0]?.id || "")
  }, [organizations])

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
        accessorKey: "hours",
        meta: { label: "Hours" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Hours" />
        ),
        cell: ({ row }) =>
          row.original.hours === "none" ? (
            "—"
          ) : (
            <Badge
              variant={row.original.hours === "open" ? "default" : "outline"}
            >
              {row.original.hours === "open" ? "Open" : "Closed"}
            </Badge>
          ),
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
              { label: "Open site", onSelect: () => openSite(row.original.id) },
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
        description="Add a location, then open it to update details, hours, and access rules."
        actions={
          <>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              Import
            </Button>
            <Button onClick={openCreate}>
              <PlusIcon />
              New site
            </Button>
          </>
        }
      />

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
        isRowActive={(row) => detailOpen && row.id === selectedSiteId}
        emptyTitle="No sites yet"
        emptyDescription="Create a site to start assigning devices to a location."
        emptyAction={
          <Button onClick={openCreate}>
            <PlusIcon />
            New site
          </Button>
        }
      />

      <DetailSheet
        variant="overlay"
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New site"
        description="Add a location for devices to live under. An SSH key is created automatically."
        className="sm:max-w-xl"
        contentClassName="gap-4"
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
          <TimeZoneField
            id="site-create-timezone"
            value={createTimezone}
            onChange={setCreateTimezone}
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
      </DetailSheet>

      {selectedSite ? (
        <DetailSheet
          variant="overlay"
          open={detailOpen}
          onOpenChange={(open) => {
            setDetailOpen(open)
            if (!open && !deleteOpen) {
              setSelectedSiteId("")
            }
          }}
          title={selectedSite.name}
          description="Update this location or remove it."
          className="sm:max-w-2xl"
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
              <TimeZoneField
                id="site-edit-timezone"
                value={editTimezone}
                onChange={setEditTimezone}
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
            <div className="space-y-1 md:col-span-2">
              <p className="text-sm font-medium">Hours</p>
              <p className="text-xs text-muted-foreground">
                When this location is closed, offline alerts stay quiet. Device
                restarts and agent updates wait until close.
              </p>
            </div>
            <DayHoursToggle
              id="site-hours-weekdays"
              label="Weekdays"
              enabled={editWeekdaysEnabled}
              open={editWeekdaysOpen}
              close={editWeekdaysClose}
              onEnabledChange={setEditWeekdaysEnabled}
              onOpenChange={setEditWeekdaysOpen}
              onCloseChange={setEditWeekdaysClose}
            />
            <DayHoursToggle
              id="site-hours-saturday"
              label="Saturday"
              enabled={editSaturdayEnabled}
              open={editSaturdayOpen}
              close={editSaturdayClose}
              onEnabledChange={setEditSaturdayEnabled}
              onOpenChange={setEditSaturdayOpen}
              onCloseChange={setEditSaturdayClose}
            />
            <DayHoursToggle
              id="site-hours-sunday"
              label="Sunday"
              enabled={editSundayEnabled}
              open={editSundayOpen}
              close={editSundayClose}
              onEnabledChange={setEditSundayEnabled}
              onOpenChange={setEditSundayOpen}
              onCloseChange={setEditSundayClose}
            />
            <div className="flex flex-col gap-3 md:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Holidays</p>
                  <p className="text-xs text-muted-foreground">
                    Closed all day, or open on different hours.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setEditHolidays((current) => [
                      ...current,
                      {
                        date: "",
                        closed: true,
                        open: "10:00",
                        close: "22:00",
                      },
                    ])
                  }
                >
                  <PlusIcon />
                  Add date
                </Button>
              </div>
              {editHolidays.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No holidays yet.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {editHolidays.map((holiday, index) => (
                    <div
                      key={`${holiday.date}-${index}`}
                      className="grid gap-3 rounded-lg border p-3 md:grid-cols-2"
                    >
                      <FormField
                        label="Date"
                        htmlFor={`site-holiday-date-${index}`}
                      >
                        <Input
                          id={`site-holiday-date-${index}`}
                          type="date"
                          value={holiday.date}
                          onChange={(event) => {
                            const date = event.target.value
                            setEditHolidays((current) =>
                              current.map((row, rowIndex) =>
                                rowIndex === index ? { ...row, date } : row
                              )
                            )
                          }}
                        />
                      </FormField>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">Closed all day</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={holiday.closed}
                            onCheckedChange={(closed) =>
                              setEditHolidays((current) =>
                                current.map((row, rowIndex) =>
                                  rowIndex === index ? { ...row, closed } : row
                                )
                              )
                            }
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setEditHolidays((current) =>
                                current.filter(
                                  (_row, rowIndex) => rowIndex !== index
                                )
                              )
                            }
                            aria-label="Remove holiday"
                          >
                            <Trash2Icon />
                          </Button>
                        </div>
                      </div>
                      {holiday.closed ? null : (
                        <>
                          <FormField
                            label="Opens"
                            htmlFor={`site-holiday-open-${index}`}
                          >
                            <Input
                              id={`site-holiday-open-${index}`}
                              type="time"
                              value={holiday.open}
                              onChange={(event) => {
                                const open = event.target.value
                                setEditHolidays((current) =>
                                  current.map((row, rowIndex) =>
                                    rowIndex === index ? { ...row, open } : row
                                  )
                                )
                              }}
                            />
                          </FormField>
                          <FormField
                            label="Closes"
                            htmlFor={`site-holiday-close-${index}`}
                          >
                            <Input
                              id={`site-holiday-close-${index}`}
                              type="time"
                              value={holiday.close}
                              onChange={(event) => {
                                const close = event.target.value
                                setEditHolidays((current) =>
                                  current.map((row, rowIndex) =>
                                    rowIndex === index ? { ...row, close } : row
                                  )
                                )
                              }}
                            />
                          </FormField>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
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
                  const hours = buildSiteHours({
                    weekdaysEnabled: editWeekdaysEnabled,
                    weekdaysOpen: editWeekdaysOpen,
                    weekdaysClose: editWeekdaysClose,
                    saturdayEnabled: editSaturdayEnabled,
                    saturdayOpen: editSaturdayOpen,
                    saturdayClose: editSaturdayClose,
                    sundayEnabled: editSundayEnabled,
                    sundayOpen: editSundayOpen,
                    sundayClose: editSundayClose,
                    holidays: editHolidays,
                  })
                  if (hours && !editTimezone) {
                    toast.error("Set a timezone before saving hours.")
                    return
                  }
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
                    businessHours: hours,
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
