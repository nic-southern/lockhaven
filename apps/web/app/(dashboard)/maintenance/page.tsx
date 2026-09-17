"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import * as React from "react"
import { toast } from "sonner"
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"

import { fromZonedTime, isMaintenanceWindowActive } from "@nms/shared"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog"
import { EmptyState } from "@/components/dashboard/empty-state"
import { FormField, NativeSelect } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { SectionCard } from "@/components/dashboard/section-card"
import { SelectField } from "@/components/dashboard/select-field"
import { Skeleton } from "@/components/ui/skeleton"
import { formatDate } from "@/lib/dashboard"
import { timeZoneOptions } from "@/lib/time-zones"
import { trpc } from "@/lib/trpc"
import type { RouterOutputs } from "@/lib/trpc"
import { usePermissions } from "@/lib/use-permissions"

type WindowRow = RouterOutputs["maintenance"]["list"][number]

function toZonedInput(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

function fromZonedInput(value: string, timeZone: string) {
  const [datePart, timePart] = value.split("T")
  if (!datePart || !timePart) return null
  const [year, month, day] = datePart.split("-").map(Number)
  const [hour, minute] = timePart.split(":").map(Number)
  if (
    ![year, month, day, hour, minute].every((entry) => Number.isFinite(entry))
  ) {
    return null
  }
  return fromZonedTime({ year, month, day, hour, minute, second: 0 }, timeZone)
}

function defaultStartInput(timeZone: string) {
  const start = new Date()
  start.setMinutes(0, 0, 0)
  start.setHours(start.getHours() + 1)
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
  return {
    startsAt: toZonedInput(start, timeZone),
    endsAt: toZonedInput(end, timeZone),
  }
}

function WindowFormDialog({
  open,
  onOpenChange,
  window: current,
  organizations,
  sites,
  devices,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  window: WindowRow | null
  organizations: Array<{ id: string; name: string }>
  sites: Array<{ id: string; name: string; organizationId: string }>
  devices: Array<{
    id: string
    displayName: string | null
    hostname: string | null
    organizationId: string
    siteId: string | null
  }>
}) {
  const utils = trpc.useUtils()
  const createWindow = trpc.maintenance.create.useMutation()
  const updateWindow = trpc.maintenance.update.useMutation()
  const editing = Boolean(current)

  const [organizationId, setOrganizationId] = React.useState(
    current?.organizationId ?? organizations[0]?.id ?? ""
  )
  const [siteId, setSiteId] = React.useState(current?.siteId ?? "")
  const [deviceId, setDeviceId] = React.useState(current?.deviceId ?? "")
  const [timeZone, setTimeZone] = React.useState(current?.timeZone ?? "UTC")
  const defaults = defaultStartInput(current?.timeZone ?? "UTC")
  const [startsAt, setStartsAt] = React.useState(
    current
      ? toZonedInput(new Date(current.startsAt), current.timeZone)
      : defaults.startsAt
  )
  const [endsAt, setEndsAt] = React.useState(
    current
      ? toZonedInput(new Date(current.endsAt), current.timeZone)
      : defaults.endsAt
  )
  const [recurrence, setRecurrence] = React.useState<"none" | "weekly">(
    current?.recurrence === "weekly" ? "weekly" : "none"
  )
  const [reason, setReason] = React.useState(current?.reason ?? "")

  React.useEffect(() => {
    if (!open) return
    const zone = current?.timeZone ?? "UTC"
    const next = defaultStartInput(zone)
    setOrganizationId(current?.organizationId ?? organizations[0]?.id ?? "")
    setSiteId(current?.siteId ?? "")
    setDeviceId(current?.deviceId ?? "")
    setTimeZone(zone)
    setStartsAt(
      current ? toZonedInput(new Date(current.startsAt), zone) : next.startsAt
    )
    setEndsAt(
      current ? toZonedInput(new Date(current.endsAt), zone) : next.endsAt
    )
    setRecurrence(current?.recurrence === "weekly" ? "weekly" : "none")
    setReason(current?.reason ?? "")
  }, [open, current, organizations])

  const orgSites = sites.filter(
    (site) => site.organizationId === organizationId
  )
  const orgDevices = devices.filter(
    (device) =>
      device.organizationId === organizationId &&
      (!siteId || device.siteId === siteId)
  )
  const pending = createWindow.isPending || updateWindow.isPending
  const startDate = fromZonedInput(startsAt, timeZone)
  const endDate = fromZonedInput(endsAt, timeZone)
  const canSubmit =
    organizationId &&
    startDate &&
    endDate &&
    endDate.getTime() > startDate.getTime()

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!startDate || !endDate) return
    try {
      const payload = {
        organizationId,
        siteId: siteId || null,
        deviceId: deviceId || null,
        startsAt: startDate,
        endsAt: endDate,
        timeZone,
        recurrence,
        reason: reason.trim(),
      }
      if (editing && current) {
        await updateWindow.mutateAsync({ id: current.id, ...payload })
        toast.success("Maintenance window updated.")
      } else {
        await createWindow.mutateAsync(payload)
        toast.success("Maintenance window created.")
      }
      onOpenChange(false)
      await utils.maintenance.list.invalidate()
    } catch {
      toast.error("We couldn't save that window.")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit maintenance window" : "New maintenance window"}
            </DialogTitle>
            <DialogDescription>
              Alerts that open during this window are held until it ends.
            </DialogDescription>
          </DialogHeader>
          <FormField label="Organization" htmlFor="mw-org">
            <SelectField
              id="mw-org"
              value={organizationId}
              onValueChange={(value) => {
                setOrganizationId(value)
                setSiteId("")
                setDeviceId("")
              }}
              options={organizations.map((organization) => ({
                value: organization.id,
                label: organization.name,
              }))}
            />
          </FormField>
          <FormField
            label="Site"
            htmlFor="mw-site"
            description="Leave empty to cover the whole organization."
          >
            <SelectField
              id="mw-site"
              value={siteId}
              onValueChange={(value) => {
                setSiteId(value)
                setDeviceId("")
              }}
              emptyLabel="Whole organization"
              options={orgSites.map((site) => ({
                value: site.id,
                label: site.name,
              }))}
            />
          </FormField>
          <FormField
            label="Device"
            htmlFor="mw-device"
            description="Leave empty to cover the site or organization."
          >
            <SelectField
              id="mw-device"
              value={deviceId}
              onValueChange={setDeviceId}
              emptyLabel="Every device in this scope"
              options={orgDevices.map((device) => ({
                value: device.id,
                label: device.displayName || device.hostname || "Device",
              }))}
            />
          </FormField>
          <FormField label="Time zone" htmlFor="mw-tz">
            <NativeSelect
              id="mw-tz"
              value={timeZone}
              onChange={(event) => setTimeZone(event.target.value)}
            >
              {timeZoneOptions().map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replaceAll("_", " ")}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Starts" htmlFor="mw-start">
              <Input
                id="mw-start"
                type="datetime-local"
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Ends" htmlFor="mw-end">
              <Input
                id="mw-end"
                type="datetime-local"
                value={endsAt}
                onChange={(event) => setEndsAt(event.target.value)}
                required
              />
            </FormField>
          </div>
          <FormField label="Repeats" htmlFor="mw-recurrence">
            <SelectField
              id="mw-recurrence"
              value={recurrence}
              onValueChange={(value) =>
                setRecurrence(value === "weekly" ? "weekly" : "none")
              }
              options={[
                { value: "none", label: "Does not repeat" },
                { value: "weekly", label: "Every week at this time" },
              ]}
            />
          </FormField>
          <FormField label="Reason" htmlFor="mw-reason">
            <Input
              id="mw-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Planned work"
              maxLength={240}
            />
          </FormField>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !canSubmit}>
              {editing ? "Save window" : "Create window"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function scopeLabel(row: WindowRow) {
  if (row.deviceName || row.deviceHostname) {
    return row.deviceName || row.deviceHostname || "Device"
  }
  if (row.siteName) return row.siteName
  return row.organizationName ?? "Organization"
}

export default function MaintenancePage() {
  const { can } = usePermissions()
  const canManage = can("organization:admin")
  const utils = trpc.useUtils()
  const listQuery = trpc.maintenance.list.useQuery()
  const organizationsQuery = trpc.organizations.list.useQuery(undefined, {
    enabled: canManage,
  })
  const sitesQuery = trpc.sites.list.useQuery(undefined, { enabled: canManage })
  const devicesQuery = trpc.devices.list.useQuery(undefined, {
    enabled: canManage,
  })
  const deleteWindow = trpc.maintenance.delete.useMutation()

  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<WindowRow | null>(null)
  const [deleteId, setDeleteId] = React.useState<string | null>(null)

  const rows = listQuery.data ?? []
  const now = new Date()

  async function handleDelete() {
    if (!deleteId) return
    try {
      await deleteWindow.mutateAsync({ id: deleteId })
      toast.success("Maintenance window removed.")
      setDeleteId(null)
      await utils.maintenance.list.invalidate()
    } catch {
      toast.error("We couldn't remove that window.")
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Alerts"
        title="Maintenance"
        description="Hold new alerts during planned work. They stay quiet until the window ends, then open if the condition is still true. Open and close hours live on each location."
        actions={
          canManage ? (
            <Button
              className="w-full sm:w-auto"
              onClick={() => {
                setEditing(null)
                setFormOpen(true)
              }}
            >
              <PlusIcon />
              Add window
            </Button>
          ) : null
        }
      />

      <SectionCard
        title="Windows"
        description="Organization, site, or device. Weekly windows repeat at the same local time."
        collapsibleOnMobile
        defaultOpenOnMobile
      >
        {listQuery.isLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No maintenance windows"
            description="Add a window when you need to hold alerts during planned work."
            bordered={false}
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((row) => {
              const active = isMaintenanceWindowActive(
                {
                  organizationId: row.organizationId,
                  siteId: row.siteId,
                  deviceId: row.deviceId,
                  startsAt: new Date(row.startsAt),
                  endsAt: new Date(row.endsAt),
                  timeZone: row.timeZone,
                  recurrence: row.recurrence === "weekly" ? "weekly" : "none",
                },
                now
              )
              return (
                <li
                  key={row.id}
                  className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{scopeLabel(row)}</p>
                      {active ? (
                        <Badge
                          variant="outline"
                          className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                        >
                          Active now
                        </Badge>
                      ) : null}
                      {row.recurrence === "weekly" ? (
                        <Badge variant="outline">Weekly</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {formatDate(row.startsAt)} – {formatDate(row.endsAt)} ·{" "}
                      {row.timeZone.replaceAll("_", " ")}
                    </p>
                    {row.reason ? (
                      <p className="mt-1 text-sm">{row.reason}</p>
                    ) : null}
                  </div>
                  {canManage ? (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditing(row)
                          setFormOpen(true)
                        }}
                      >
                        <PencilIcon />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDeleteId(row.id)}
                      >
                        <Trash2Icon />
                        Remove
                      </Button>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </SectionCard>

      {canManage ? (
        <WindowFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          window={editing}
          organizations={organizationsQuery.data ?? []}
          sites={sitesQuery.data ?? []}
          devices={devicesQuery.data ?? []}
        />
      ) : null}
      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null)
        }}
        title="Remove this window?"
        description="Alerts will no longer be held for this period."
        confirmLabel="Remove"
        pending={deleteWindow.isPending}
        onConfirm={() => {
          void handleDelete()
        }}
      />
    </div>
  )
}
