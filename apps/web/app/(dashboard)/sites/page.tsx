"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import * as React from "react"
import { PlusIcon } from "lucide-react"
import { toast } from "sonner"

import type { ColumnDef } from "@tanstack/react-table"
import {
  AFTER_HOURS_DEFAULT_STEPS,
  afterHoursStepLabels,
  hasConfiguredSiteHours,
  isValidTimeZone,
  playbookActions,
  sanitizeAfterHoursSteps,
  siteOpenLabel,
  siteOpenState,
  type PlaybookAction,
  type SiteBusinessHours,
  type SiteHoliday,
} from "@nms/shared"

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
import { FormField } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { SelectField } from "@/components/dashboard/select-field"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { formatRelativeTime } from "@/lib/dashboard"
import { trpc } from "@/lib/trpc"

type SiteRow = {
  id: string
  organizationId: string
  organizationName: string
  name: string
  timezone: string | null
  hoursLabel: string
  deviceCount: number
  hasSshCredential: boolean
}

type DayHours = {
  enabled: boolean
  open: string
  close: string
}

function timeZoneOptions() {
  if (typeof Intl !== "undefined" && "supportedValuesOf" in Intl) {
    return Intl.supportedValuesOf("timeZone")
  }
  return [
    "UTC",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Phoenix",
    "Europe/London",
  ]
}

function defaultDayHours(): DayHours {
  return { enabled: false, open: "10:00", close: "22:00" }
}

function dayHoursFromWindow(
  window: { open: string; close: string } | null | undefined
): DayHours {
  if (!window?.open || !window.close) return defaultDayHours()
  return { enabled: true, open: window.open, close: window.close }
}

function windowFromDay(day: DayHours) {
  if (!day.enabled) return null
  return { open: day.open, close: day.close }
}

function businessHoursFromForm(
  weekdays: DayHours,
  saturday: DayHours,
  sunday: DayHours,
  holidays: SiteHoliday[]
): SiteBusinessHours | null {
  const hours: SiteBusinessHours = {
    weekdays: windowFromDay(weekdays),
    saturday: windowFromDay(saturday),
    sunday: windowFromDay(sunday),
    holidays: holidays.filter((holiday) => holiday.date),
  }
  if (
    !hours.weekdays &&
    !hours.saturday &&
    !hours.sunday &&
    (hours.holidays?.length ?? 0) === 0
  ) {
    return null
  }
  return hours
}

type StepSlots = [string, string, string]

function stepSlotsFromSteps(steps: readonly string[] | null | undefined) {
  const clean = sanitizeAfterHoursSteps(steps ?? AFTER_HOURS_DEFAULT_STEPS)
  return [clean[0] ?? "", clean[1] ?? "", clean[2] ?? ""] as StepSlots
}

function stepsFromSlots(slots: StepSlots): PlaybookAction[] {
  return sanitizeAfterHoursSteps(slots.filter(Boolean))
}

function AfterHoursFields({
  enabled,
  onEnabledChange,
  slots,
  onSlotsChange,
  requireApproval,
  onRequireApprovalChange,
  hoursConfigured,
}: {
  enabled: boolean
  onEnabledChange: (next: boolean) => void
  slots: StepSlots
  onSlotsChange: (next: StepSlots) => void
  requireApproval: boolean
  onRequireApprovalChange: (next: boolean) => void
  hoursConfigured: boolean
}) {
  const stepOptions = playbookActions.map((action) => ({
    value: action,
    label: afterHoursStepLabels[action],
  }))
  return (
    <div className="flex flex-col gap-3 rounded-lg border px-3 py-3 md:col-span-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Run after close</p>
          <p className="text-xs text-muted-foreground">
            When this location closes for the day, run the steps below on every
            device that is online. Devices that are archived or already offline
            are left alone.
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={onEnabledChange}
          disabled={!hoursConfigured && !enabled}
        />
      </div>
      {!hoursConfigured ? (
        <p className="text-xs text-muted-foreground">
          Set open and close hours first.
        </p>
      ) : null}
      {enabled ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {slots.map((slot, index) => (
              <FormField
                key={index}
                label={`Step ${index + 1}`}
                htmlFor={`site-after-hours-step-${index + 1}`}
              >
                <SelectField
                  id={`site-after-hours-step-${index + 1}`}
                  value={slot}
                  onValueChange={(value) => {
                    const next = [...slots] as StepSlots
                    next[index] = value
                    onSlotsChange(next)
                  }}
                  emptyLabel={index === 0 ? undefined : "None"}
                  placeholder="Choose a step"
                  options={stepOptions.map((option) => ({
                    ...option,
                    disabled: slots.some(
                      (other, otherIndex) =>
                        otherIndex !== index && other === option.value
                    ),
                  }))}
                />
              </FormField>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Steps run in order. Only restart device, restart agent, and update
            agent are available; custom scripts are not.
          </p>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Require approval</p>
              <p className="text-xs text-muted-foreground">
                Each night&apos;s run waits in Approvals until someone approves
                it.
              </p>
            </div>
            <Switch
              checked={requireApproval}
              onCheckedChange={onRequireApprovalChange}
            />
          </div>
        </>
      ) : null}
    </div>
  )
}

function AfterHoursRunList({ siteId }: { siteId: string }) {
  const runsQuery = trpc.afterHours.runs.useQuery(
    { siteId, limit: 5 },
    { refetchInterval: 30_000 }
  )
  const runs = runsQuery.data ?? []
  if (runs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No after-hours runs yet. The first one starts the next time this
        location closes.
      </p>
    )
  }
  return (
    <ul className="flex flex-col divide-y text-sm">
      {runs.map((run) => (
        <li
          key={run.id}
          className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
        >
          <div className="min-w-0">
            <p className="truncate">{run.stepsLabel}</p>
            <p className="truncate text-xs text-muted-foreground">
              {formatRelativeTime(run.createdAt)}
              {` · ${run.queuedDeviceCount} queued`}
              {run.skippedDeviceCount > 0
                ? ` · ${run.skippedDeviceCount} skipped`
                : ""}
            </p>
          </div>
          <Badge
            variant={
              run.status === "queued" || run.status === "pending_approval"
                ? "default"
                : "outline"
            }
          >
            {run.statusLabel}
          </Badge>
        </li>
      ))}
    </ul>
  )
}

function HoursDayFields({
  id,
  label,
  description,
  value,
  onChange,
}: {
  id: string
  label: string
  description: string
  value: DayHours
  onChange: (next: DayHours) => void
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-3 md:col-span-2">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Switch
          checked={value.enabled}
          onCheckedChange={(enabled) => onChange({ ...value, enabled })}
        />
      </div>
      {value.enabled ? (
        <>
          <FormField label="Opens" htmlFor={`${id}-open`}>
            <Input
              id={`${id}-open`}
              type="time"
              value={value.open}
              onChange={(event) =>
                onChange({ ...value, open: event.target.value })
              }
            />
          </FormField>
          <FormField label="Closes" htmlFor={`${id}-close`}>
            <Input
              id={`${id}-close`}
              type="time"
              value={value.close}
              onChange={(event) =>
                onChange({ ...value, close: event.target.value })
              }
            />
          </FormField>
        </>
      ) : null}
    </>
  )
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
  const [editWeekdays, setEditWeekdays] =
    React.useState<DayHours>(defaultDayHours)
  const [editSaturday, setEditSaturday] =
    React.useState<DayHours>(defaultDayHours)
  const [editSunday, setEditSunday] = React.useState<DayHours>(defaultDayHours)
  const [editHolidays, setEditHolidays] = React.useState<SiteHoliday[]>([])
  const [holidayDate, setHolidayDate] = React.useState("")
  const [holidayName, setHolidayName] = React.useState("")
  const [holidayClosed, setHolidayClosed] = React.useState(true)
  const [holidayOpen, setHolidayOpen] = React.useState("10:00")
  const [holidayClose, setHolidayClose] = React.useState("16:00")
  const [editRequireReason, setEditRequireReason] = React.useState(false)
  const [editRequireApproval, setEditRequireApproval] = React.useState(false)
  const [editAfterHoursEnabled, setEditAfterHoursEnabled] =
    React.useState(false)
  const [editAfterHoursSlots, setEditAfterHoursSlots] =
    React.useState<StepSlots>(() => stepSlotsFromSteps(null))
  const [editAfterHoursApproval, setEditAfterHoursApproval] =
    React.useState(false)
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
      const hours = selectedSite.businessHours
      setEditWeekdays(dayHoursFromWindow(hours?.weekdays))
      setEditSaturday(dayHoursFromWindow(hours?.saturday))
      setEditSunday(dayHoursFromWindow(hours?.sunday))
      setEditHolidays(hours?.holidays ?? [])
      setHolidayDate("")
      setHolidayName("")
      setHolidayClosed(true)
      setHolidayOpen("10:00")
      setHolidayClose("16:00")
      setEditRequireReason(Boolean(selectedSite.requireAccessReason))
      setEditRequireApproval(Boolean(selectedSite.requireApproval))
      setEditAfterHoursEnabled(Boolean(selectedSite.afterHoursEnabled))
      setEditAfterHoursSlots(stepSlotsFromSteps(selectedSite.afterHoursSteps))
      setEditAfterHoursApproval(Boolean(selectedSite.afterHoursRequireApproval))
    }
  }, [selectedSite])

  const editHoursConfigured = hasConfiguredSiteHours(
    businessHoursFromForm(editWeekdays, editSaturday, editSunday, editHolidays)
  )

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
        hoursLabel: siteOpenLabel(
          siteOpenState(
            {
              timezone: site.timezone,
              businessHours: site.businessHours,
            },
            new Date()
          )
        ),
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
        accessorKey: "hoursLabel",
        meta: { label: "Hours" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Hours" />
        ),
        cell: ({ row }) => {
          const label = row.original.hoursLabel
          if (label === "Hours not set") {
            return <span className="text-muted-foreground">—</span>
          }
          return (
            <Badge variant={label === "Open" ? "secondary" : "outline"}>
              {label}
            </Badge>
          )
        },
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
        description="Add a location, then open it to set hours, holidays, and access rules."
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
        <FormField
          label="Timezone"
          htmlFor="site-create-timezone"
          description="Used for open and close hours."
        >
          <SelectField
            id="site-create-timezone"
            value={createTimezone}
            onValueChange={setCreateTimezone}
            placeholder="Choose a timezone"
            emptyLabel="Not set"
            options={timeZoneOptions().map((zone) => ({
              value: zone,
              label: zone.replaceAll("_", " "),
            }))}
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
          className="sm:max-w-xl"
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
            <FormField
              label="Timezone"
              htmlFor="site-edit-timezone"
              description="Hours and holidays use this timezone."
            >
              <SelectField
                id="site-edit-timezone"
                value={editTimezone}
                onValueChange={setEditTimezone}
                placeholder="Choose a timezone"
                emptyLabel="Not set"
                options={timeZoneOptions().map((zone) => ({
                  value: zone,
                  label: zone.replaceAll("_", " "),
                }))}
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
            <HoursDayFields
              id="site-edit-weekdays"
              label="Weekday hours"
              description="Monday through Friday. Close after midnight for late nights."
              value={editWeekdays}
              onChange={setEditWeekdays}
            />
            <HoursDayFields
              id="site-edit-saturday"
              label="Saturday hours"
              description="Leave off if the site is closed."
              value={editSaturday}
              onChange={setEditSaturday}
            />
            <HoursDayFields
              id="site-edit-sunday"
              label="Sunday hours"
              description="Leave off if the site is closed."
              value={editSunday}
              onChange={setEditSunday}
            />
            <div className="flex flex-col gap-3 rounded-lg border px-3 py-3 md:col-span-2">
              <div>
                <p className="text-sm font-medium">Holidays</p>
                <p className="text-xs text-muted-foreground">
                  Closed all day, or set special hours for that date.
                </p>
              </div>
              {editHolidays.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {editHolidays.map((holiday) => (
                    <li
                      key={holiday.date}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span>
                        {holiday.date}
                        {holiday.name ? ` · ${holiday.name}` : ""}
                        {holiday.closed || !holiday.open || !holiday.close
                          ? " · Closed all day"
                          : ` · ${holiday.open}–${holiday.close}`}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setEditHolidays((current) =>
                            current.filter(
                              (entry) => entry.date !== holiday.date
                            )
                          )
                        }
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No holidays yet.
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
                <Input
                  type="date"
                  aria-label="Holiday date"
                  value={holidayDate}
                  onChange={(event) => setHolidayDate(event.target.value)}
                />
                <Input
                  aria-label="Holiday name"
                  placeholder="Name"
                  value={holidayName}
                  onChange={(event) => setHolidayName(event.target.value)}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">Closed all day</p>
                <Switch
                  checked={holidayClosed}
                  onCheckedChange={setHolidayClosed}
                />
              </div>
              {holidayClosed ? null : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label="Opens" htmlFor="site-holiday-open">
                    <Input
                      id="site-holiday-open"
                      type="time"
                      value={holidayOpen}
                      onChange={(event) => setHolidayOpen(event.target.value)}
                    />
                  </FormField>
                  <FormField label="Closes" htmlFor="site-holiday-close">
                    <Input
                      id="site-holiday-close"
                      type="time"
                      value={holidayClose}
                      onChange={(event) => setHolidayClose(event.target.value)}
                    />
                  </FormField>
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                className="w-fit"
                onClick={() => {
                  if (!holidayDate) return
                  setEditHolidays((current) => {
                    const next = current.filter(
                      (entry) => entry.date !== holidayDate
                    )
                    next.push({
                      date: holidayDate,
                      name: holidayName.trim() || null,
                      closed: holidayClosed || undefined,
                      open: holidayClosed ? undefined : holidayOpen,
                      close: holidayClosed ? undefined : holidayClose,
                    })
                    next.sort((left, right) =>
                      left.date.localeCompare(right.date)
                    )
                    return next
                  })
                  setHolidayDate("")
                  setHolidayName("")
                  setHolidayClosed(true)
                }}
                disabled={!holidayDate}
              >
                Add
              </Button>
            </div>
            <p className="text-sm text-muted-foreground md:col-span-2">
              When this location is closed, offline alerts stay quiet. Device
              restarts and agent updates wait until close.
            </p>
            <AfterHoursFields
              enabled={editAfterHoursEnabled}
              onEnabledChange={setEditAfterHoursEnabled}
              slots={editAfterHoursSlots}
              onSlotsChange={setEditAfterHoursSlots}
              requireApproval={editAfterHoursApproval}
              onRequireApprovalChange={setEditAfterHoursApproval}
              hoursConfigured={editHoursConfigured}
            />
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
                  const businessHours = businessHoursFromForm(
                    editWeekdays,
                    editSaturday,
                    editSunday,
                    editHolidays
                  )
                  if (
                    hasConfiguredSiteHours(businessHours) &&
                    (!editTimezone.trim() ||
                      !isValidTimeZone(editTimezone.trim()))
                  ) {
                    toast.error("Set a timezone before saving site hours.")
                    return
                  }
                  const afterHoursSteps = stepsFromSlots(editAfterHoursSlots)
                  if (editAfterHoursEnabled) {
                    if (!hasConfiguredSiteHours(businessHours)) {
                      toast.error(
                        "Set open and close hours before turning on after-hours runs."
                      )
                      return
                    }
                    if (afterHoursSteps.length === 0) {
                      toast.error(
                        "Choose at least one step to run after close."
                      )
                      return
                    }
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
                    businessHours,
                    requireAccessReason: editRequireReason,
                    requireApproval: editRequireApproval,
                    afterHoursEnabled: editAfterHoursEnabled,
                    afterHoursSteps:
                      afterHoursSteps.length > 0
                        ? afterHoursSteps
                        : [...AFTER_HOURS_DEFAULT_STEPS],
                    afterHoursRequireApproval: editAfterHoursApproval,
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
              <p className="text-sm font-medium">After-hours runs</p>
              <p className="text-sm text-muted-foreground">
                Each close starts one run. Devices pick up their steps at the
                next check-in.
              </p>
            </div>
            <AfterHoursRunList siteId={selectedSite.id} />
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
