"use client"

import * as React from "react"
import { toast } from "sonner"
import { PlusIcon, Trash2Icon } from "lucide-react"

import { AccessDenied } from "@/components/dashboard/access-denied"
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog"
import { EmptyState } from "@/components/dashboard/empty-state"
import { FormField } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { SectionCard } from "@/components/dashboard/section-card"
import { SelectField } from "@/components/dashboard/select-field"
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
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { trpc } from "@/lib/trpc"
import { usePermissions } from "@/lib/use-permissions"

type ServiceForm = {
  id?: string
  organizationId: string
  name: string
  target: string
}

type AssignForm = {
  serviceId: string
  organizationId: string
  scope: "organization" | "site" | "device"
  siteId: string
  deviceId: string
}

export default function ServicesPage() {
  const { can, isLoading: accessLoading } = usePermissions()
  const canView = can("device:view")
  const canManage = can("organization:admin")
  const utils = trpc.useUtils()

  const organizationsQuery = trpc.organizations.list.useQuery(undefined, {
    enabled: canView,
  })
  const sitesQuery = trpc.sites.list.useQuery(undefined, { enabled: canView })
  const devicesQuery = trpc.devices.list.useQuery(undefined, {
    enabled: canView,
  })
  const servicesQuery = trpc.agentServices.list.useQuery(undefined, {
    enabled: canView,
  })

  const [form, setForm] = React.useState<ServiceForm | null>(null)
  const [assign, setAssign] = React.useState<AssignForm | null>(null)
  const [deleteId, setDeleteId] = React.useState<string | null>(null)
  const [unassignId, setUnassignId] = React.useState<string | null>(null)

  const createService = trpc.agentServices.create.useMutation({
    async onSuccess() {
      await utils.agentServices.list.invalidate()
      setForm(null)
      toast.success("Service saved")
    },
    onError(error) {
      toast.error(error.message || "We couldn't save that service.")
    },
  })
  const updateService = trpc.agentServices.update.useMutation({
    async onSuccess() {
      await utils.agentServices.list.invalidate()
      setForm(null)
      toast.success("Service updated")
    },
    onError(error) {
      toast.error(error.message || "We couldn't update that service.")
    },
  })
  const deleteService = trpc.agentServices.delete.useMutation({
    async onSuccess() {
      await utils.agentServices.list.invalidate()
      setDeleteId(null)
      toast.success("Service removed")
    },
    onError() {
      toast.error("We couldn't remove that service.")
    },
  })
  const assignService = trpc.agentServices.assign.useMutation({
    async onSuccess() {
      await utils.agentServices.list.invalidate()
      setAssign(null)
      toast.success("Service assigned")
    },
    onError(error) {
      toast.error(error.message || "We couldn't assign that service.")
    },
  })
  const unassignService = trpc.agentServices.unassign.useMutation({
    async onSuccess() {
      await utils.agentServices.list.invalidate()
      setUnassignId(null)
      toast.success("Assignment removed")
    },
    onError() {
      toast.error("We couldn't remove that assignment.")
    },
  })

  if (!accessLoading && !canView) {
    return (
      <AccessDenied description="Services are limited to people who can view devices." />
    )
  }

  const organizations = organizationsQuery.data ?? []
  const sites = sitesQuery.data ?? []
  const devices = devicesQuery.data ?? []
  const services = servicesQuery.data ?? []
  const loading = accessLoading || servicesQuery.isLoading

  function submitForm() {
    if (!form) return
    if (form.id) {
      updateService.mutate({
        id: form.id,
        name: form.name.trim(),
        target: form.target.trim(),
      })
      return
    }
    createService.mutate({
      organizationId: form.organizationId,
      name: form.name.trim(),
      target: form.target.trim(),
    })
  }

  function submitAssign() {
    if (!assign) return
    assignService.mutate({
      serviceId: assign.serviceId,
      siteId: assign.scope === "site" ? assign.siteId || null : null,
      deviceId: assign.scope === "device" ? assign.deviceId || null : null,
    })
  }

  function scopeLabel(assignment: {
    scope: "organization" | "site" | "device"
    siteName: string | null
    deviceName: string | null
  }) {
    if (assignment.scope === "device") return assignment.deviceName ?? "Device"
    if (assignment.scope === "site") return assignment.siteName ?? "Site"
    return "Whole organization"
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Operate"
        title="Services"
        description="Choose which services a device may restart."
        actions={
          canManage && organizations[0] ? (
            <Button
              size="sm"
              onClick={() =>
                setForm({
                  organizationId: organizations[0]!.id,
                  name: "",
                  target: "",
                })
              }
            >
              <PlusIcon />
              New service
            </Button>
          ) : null
        }
      />

      {loading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : services.length === 0 ? (
        <SectionCard title="Services">
          <EmptyState
            title="No services yet"
            description={
              canManage
                ? "Add a service, then assign it to an organization, site, or device."
                : "No services have been assigned yet."
            }
          />
        </SectionCard>
      ) : (
        <SectionCard title="Services">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">
                  Name on the device
                </TableHead>
                <TableHead>Assigned to</TableHead>
                {canManage ? <TableHead /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.map((service) => (
                <TableRow key={service.id}>
                  <TableCell className="font-medium">{service.name}</TableCell>
                  <TableCell className="hidden font-mono text-xs md:table-cell">
                    {service.target}
                  </TableCell>
                  <TableCell>
                    {service.assignments.length === 0
                      ? "Not assigned"
                      : service.assignments.map(scopeLabel).join(", ")}
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setForm({
                              id: service.id,
                              organizationId: service.organizationId,
                              name: service.name,
                              target: service.target,
                            })
                          }
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setAssign({
                              serviceId: service.id,
                              organizationId: service.organizationId,
                              scope: "organization",
                              siteId: "",
                              deviceId: "",
                            })
                          }
                        >
                          Assign
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeleteId(service.id)}
                        >
                          <Trash2Icon />
                          <span className="sr-only">Remove</span>
                        </Button>
                      </div>
                      {service.assignments.map((assignment) => (
                        <Button
                          key={assignment.id}
                          size="sm"
                          variant="ghost"
                          onClick={() => setUnassignId(assignment.id)}
                        >
                          Remove {scopeLabel(assignment)}
                        </Button>
                      ))}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
      )}

      <Dialog
        open={form !== null}
        onOpenChange={(open) => !open && setForm(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {form?.id ? "Edit service" : "New service"}
            </DialogTitle>
            <DialogDescription>
              The name on the device must match exactly. It cannot include
              spaces.
            </DialogDescription>
          </DialogHeader>
          {form ? (
            <div className="flex flex-col gap-4">
              {!form.id ? (
                <FormField label="Organization" htmlFor="service-org">
                  <SelectField
                    id="service-org"
                    value={form.organizationId}
                    onValueChange={(value) =>
                      setForm({ ...form, organizationId: value })
                    }
                    options={organizations.map((organization) => ({
                      value: organization.id,
                      label: organization.name,
                    }))}
                  />
                </FormField>
              ) : null}
              <FormField label="Name" htmlFor="service-name">
                <Input
                  id="service-name"
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                />
              </FormField>
              <FormField
                label="Name on the device"
                htmlFor="service-target"
                description="One name, no spaces."
              >
                <Input
                  id="service-target"
                  value={form.target}
                  onChange={(event) =>
                    setForm({ ...form, target: event.target.value })
                  }
                />
              </FormField>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>
              Cancel
            </Button>
            <Button
              onClick={submitForm}
              disabled={createService.isPending || updateService.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={assign !== null}
        onOpenChange={(open) => !open && setAssign(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign service</DialogTitle>
            <DialogDescription>
              Devices in this scope can restart it.
            </DialogDescription>
          </DialogHeader>
          {assign ? (
            <div className="flex flex-col gap-4">
              <FormField label="Scope" htmlFor="service-scope">
                <SelectField
                  id="service-scope"
                  value={assign.scope}
                  onValueChange={(value) =>
                    setAssign({
                      ...assign,
                      scope: value as AssignForm["scope"],
                    })
                  }
                  options={[
                    { value: "organization", label: "Whole organization" },
                    { value: "site", label: "One site" },
                    { value: "device", label: "One device" },
                  ]}
                />
              </FormField>
              {assign.scope === "site" ? (
                <FormField label="Site" htmlFor="service-site">
                  <SelectField
                    id="service-site"
                    value={assign.siteId}
                    onValueChange={(value) =>
                      setAssign({ ...assign, siteId: value })
                    }
                    options={sites
                      .filter(
                        (site) => site.organizationId === assign.organizationId
                      )
                      .map((site) => ({ value: site.id, label: site.name }))}
                  />
                </FormField>
              ) : null}
              {assign.scope === "device" ? (
                <FormField label="Device" htmlFor="service-device">
                  <SelectField
                    id="service-device"
                    value={assign.deviceId}
                    onValueChange={(value) =>
                      setAssign({ ...assign, deviceId: value })
                    }
                    options={devices
                      .filter(
                        (device) =>
                          device.organizationId === assign.organizationId
                      )
                      .map((device) => ({
                        value: device.id,
                        label: device.displayName,
                      }))}
                  />
                </FormField>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssign(null)}>
              Cancel
            </Button>
            <Button onClick={submitAssign} disabled={assignService.isPending}>
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteId !== null}
        title="Remove this service?"
        description="Devices will no longer be able to restart it."
        confirmLabel="Remove"
        onConfirm={() => {
          if (deleteId) deleteService.mutate({ id: deleteId })
        }}
        onOpenChange={(open) => !open && setDeleteId(null)}
      />
      <ConfirmDialog
        open={unassignId !== null}
        title="Remove this assignment?"
        description="The service stays available to assign again."
        confirmLabel="Remove"
        onConfirm={() => {
          if (unassignId) unassignService.mutate({ id: unassignId })
        }}
        onOpenChange={(open) => !open && setUnassignId(null)}
      />
    </div>
  )
}
