"use client"

import * as React from "react"
import { toast } from "sonner"
import { PlusIcon, Trash2Icon } from "lucide-react"

import {
  agentCollectorTypeLabels,
  agentCollectorTypes,
  type AgentCollectorType,
  type AgentModuleCollectorDraft,
} from "@nms/shared"

import { AccessDenied } from "@/components/dashboard/access-denied"
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog"
import { EmptyState } from "@/components/dashboard/empty-state"
import { FormField } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { SectionCard } from "@/components/dashboard/section-card"
import { SelectField } from "@/components/dashboard/select-field"
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

type CollectorForm = {
  type: AgentCollectorType
  process: string
  path: string
}

type ModuleForm = {
  id?: string
  organizationId: string
  name: string
  collectors: CollectorForm[]
}

type AssignForm = {
  moduleId: string
  organizationId: string
  scope: "organization" | "site" | "device"
  siteId: string
  deviceId: string
}

function emptyCollector(): CollectorForm {
  return { type: "process_running", process: "", path: "" }
}

function emptyForm(organizationId: string): ModuleForm {
  return {
    organizationId,
    name: "",
    collectors: [emptyCollector()],
  }
}

function draftsFromForm(
  collectors: CollectorForm[]
): AgentModuleCollectorDraft[] {
  return collectors.map((collector) => {
    if (collector.type === "process_running") {
      return { type: "process_running", process: collector.process.trim() }
    }
    return { type: collector.type, path: collector.path.trim() }
  })
}

export default function ModulesPage() {
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
  const modulesQuery = trpc.agentModules.list.useQuery(undefined, {
    enabled: canView,
  })

  const [form, setForm] = React.useState<ModuleForm | null>(null)
  const [assign, setAssign] = React.useState<AssignForm | null>(null)
  const [deleteId, setDeleteId] = React.useState<string | null>(null)
  const [unassignId, setUnassignId] = React.useState<string | null>(null)

  const createModule = trpc.agentModules.create.useMutation({
    async onSuccess() {
      await utils.agentModules.list.invalidate()
      setForm(null)
      toast.success("Module saved")
    },
    onError(error) {
      toast.error(error.message || "We couldn't save that module.")
    },
  })
  const updateModule = trpc.agentModules.update.useMutation({
    async onSuccess() {
      await utils.agentModules.list.invalidate()
      setForm(null)
      toast.success("Module updated")
    },
    onError(error) {
      toast.error(error.message || "We couldn't update that module.")
    },
  })
  const deleteModule = trpc.agentModules.delete.useMutation({
    async onSuccess() {
      await utils.agentModules.list.invalidate()
      setDeleteId(null)
      toast.success("Module removed")
    },
    onError() {
      toast.error("We couldn't remove that module.")
    },
  })
  const assignModule = trpc.agentModules.assign.useMutation({
    async onSuccess() {
      await utils.agentModules.list.invalidate()
      setAssign(null)
      toast.success("Module assigned")
    },
    onError(error) {
      toast.error(error.message || "We couldn't assign that module.")
    },
  })
  const unassignModule = trpc.agentModules.unassign.useMutation({
    async onSuccess() {
      await utils.agentModules.list.invalidate()
      setUnassignId(null)
      toast.success("Assignment removed")
    },
    onError() {
      toast.error("We couldn't remove that assignment.")
    },
  })

  if (!accessLoading && !canView) {
    return (
      <AccessDenied description="Modules are limited to people who can view devices." />
    )
  }

  const organizations = organizationsQuery.data ?? []
  const sites = sitesQuery.data ?? []
  const devices = devicesQuery.data ?? []
  const modules = modulesQuery.data ?? []
  const loading = accessLoading || modulesQuery.isLoading
  const busy =
    createModule.isPending || updateModule.isPending || assignModule.isPending

  function submitForm() {
    if (!form) return
    const collectors = draftsFromForm(form.collectors)
    if (form.id) {
      updateModule.mutate({
        id: form.id,
        name: form.name.trim(),
        collectors,
      })
      return
    }
    createModule.mutate({
      organizationId: form.organizationId,
      name: form.name.trim(),
      kind: "observations",
      collectors,
    })
  }

  function submitAssign() {
    if (!assign) return
    assignModule.mutate({
      moduleId: assign.moduleId,
      siteId: assign.scope === "site" ? assign.siteId || null : null,
      deviceId: assign.scope === "device" ? assign.deviceId || null : null,
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Operate"
        title="Modules"
        description="Ask enrolled devices to report chosen facts. Modules never run uploaded programs."
        actions={
          canManage && organizations[0] ? (
            <Button
              size="sm"
              onClick={() => setForm(emptyForm(organizations[0]!.id))}
            >
              <PlusIcon />
              New module
            </Button>
          ) : null
        }
      />

      {loading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : modules.length === 0 ? (
        <SectionCard title="Modules">
          <EmptyState
            title="No modules yet"
            description={
              canManage
                ? "Create a module to collect process or file facts from assigned devices."
                : "No modules have been set up yet."
            }
            bordered={false}
          />
        </SectionCard>
      ) : (
        <SectionCard
          title="Modules"
          description="Only organization admins can create or attach modules. Devices report facts on the next check-in."
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Collects</TableHead>
                <TableHead className="hidden sm:table-cell">
                  Assigned to
                </TableHead>
                {canManage ? <TableHead>Manage</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {modules.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="flex min-w-0 flex-col">
                      <span className="font-medium">{item.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {item.kindLabel}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {item.collectors.map((collector) => (
                        <Badge key={collector.id} variant="outline">
                          {agentCollectorTypeLabels[collector.type]}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {item.assignments.length === 0 ? (
                      <span className="text-muted-foreground">
                        Not assigned
                      </span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {item.assignments.map((assignment) => (
                          <div
                            key={assignment.id}
                            className="flex items-center gap-2"
                          >
                            <span>
                              {assignment.scope === "organization"
                                ? "Whole organization"
                                : assignment.scope === "site"
                                  ? assignment.siteName || "Site"
                                  : assignment.deviceName || "Device"}
                            </span>
                            {canManage ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setUnassignId(assignment.id)}
                              >
                                Remove
                              </Button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  {canManage ? (
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setAssign({
                              moduleId: item.id,
                              organizationId: item.organizationId,
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
                          variant="outline"
                          onClick={() =>
                            setForm({
                              id: item.id,
                              organizationId: item.organizationId,
                              name: item.name,
                              collectors: item.collectors.map((collector) => ({
                                type: collector.type,
                                process:
                                  collector.type === "process_running"
                                    ? collector.process
                                    : "",
                                path:
                                  collector.type === "process_running"
                                    ? ""
                                    : collector.path,
                              })),
                            })
                          }
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeleteId(item.id)}
                        >
                          <Trash2Icon />
                          <span className="sr-only">Remove</span>
                        </Button>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
      )}

      <Dialog
        open={Boolean(form)}
        onOpenChange={(open) => !open && setForm(null)}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Edit module" : "New module"}</DialogTitle>
            <DialogDescription>
              Choose facts the agent should read on the device. Uploaded
              programs are not available.
            </DialogDescription>
          </DialogHeader>
          {form ? (
            <div className="flex flex-col gap-4">
              <FormField label="Name" htmlFor="module-name">
                <Input
                  id="module-name"
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                  placeholder="Cabinet facts"
                />
              </FormField>
              {!form.id ? (
                <FormField label="Organization" htmlFor="module-org">
                  <SelectField
                    id="module-org"
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
              {form.collectors.map((collector, index) => (
                <div
                  key={`${collector.type}-${index}`}
                  className="flex flex-col gap-3 rounded-lg border p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <FormField
                      label="Fact"
                      htmlFor={`module-collector-${index}`}
                      className="min-w-0 flex-1"
                    >
                      <SelectField
                        id={`module-collector-${index}`}
                        value={collector.type}
                        onValueChange={(value) => {
                          const next = [...form.collectors]
                          next[index] = {
                            ...collector,
                            type: value as AgentCollectorType,
                          }
                          setForm({ ...form, collectors: next })
                        }}
                        options={agentCollectorTypes.map((type) => ({
                          value: type,
                          label: agentCollectorTypeLabels[type],
                        }))}
                      />
                    </FormField>
                    {form.collectors.length > 1 ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setForm({
                            ...form,
                            collectors: form.collectors.filter(
                              (_, current) => current !== index
                            ),
                          })
                        }
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                  {collector.type === "process_running" ? (
                    <FormField
                      label="Process name"
                      htmlFor={`module-process-${index}`}
                    >
                      <Input
                        id={`module-process-${index}`}
                        value={collector.process}
                        onChange={(event) => {
                          const next = [...form.collectors]
                          next[index] = {
                            ...collector,
                            process: event.target.value,
                          }
                          setForm({ ...form, collectors: next })
                        }}
                        placeholder="Game.exe"
                      />
                    </FormField>
                  ) : (
                    <FormField
                      label="Path"
                      htmlFor={`module-path-${index}`}
                      description="Use a full path on the device."
                    >
                      <Input
                        id={`module-path-${index}`}
                        value={collector.path}
                        onChange={(event) => {
                          const next = [...form.collectors]
                          next[index] = {
                            ...collector,
                            path: event.target.value,
                          }
                          setForm({ ...form, collectors: next })
                        }}
                        placeholder="/opt/game/build.txt"
                      />
                    </FormField>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setForm({
                    ...form,
                    collectors: [...form.collectors, emptyCollector()],
                  })
                }
              >
                Add fact
              </Button>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>
              Cancel
            </Button>
            <Button onClick={submitForm} disabled={busy || !form?.name.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(assign)}
        onOpenChange={(open) => !open && setAssign(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Assign module</DialogTitle>
            <DialogDescription>
              Assigned devices report these facts on the next check-in.
            </DialogDescription>
          </DialogHeader>
          {assign ? (
            <div className="flex flex-col gap-4">
              <FormField label="Scope" htmlFor="module-scope">
                <SelectField
                  id="module-scope"
                  value={assign.scope}
                  onValueChange={(value) =>
                    setAssign({
                      ...assign,
                      scope: value as AssignForm["scope"],
                      siteId: "",
                      deviceId: "",
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
                <FormField label="Site" htmlFor="module-site">
                  <SelectField
                    id="module-site"
                    value={assign.siteId}
                    onValueChange={(value) =>
                      setAssign({ ...assign, siteId: value })
                    }
                    options={sites
                      .filter(
                        (site) => site.organizationId === assign.organizationId
                      )
                      .map((site) => ({
                        value: site.id,
                        label: site.name,
                      }))}
                  />
                </FormField>
              ) : null}
              {assign.scope === "device" ? (
                <FormField label="Device" htmlFor="module-device">
                  <SelectField
                    id="module-device"
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
                        label:
                          device.displayName || device.hostname || "Device",
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
            <Button
              onClick={submitAssign}
              disabled={
                busy ||
                (assign?.scope === "site" && !assign.siteId) ||
                (assign?.scope === "device" && !assign.deviceId)
              }
            >
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteId)}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Remove module?"
        description="Assigned devices will stop reporting these facts."
        confirmLabel="Remove"
        destructive
        pending={deleteModule.isPending}
        onConfirm={() => {
          if (deleteId) deleteModule.mutate({ id: deleteId })
        }}
      />
      <ConfirmDialog
        open={Boolean(unassignId)}
        onOpenChange={(open) => !open && setUnassignId(null)}
        title="Remove assignment?"
        description="That site or device will stop reporting these facts."
        confirmLabel="Remove"
        destructive
        pending={unassignModule.isPending}
        onConfirm={() => {
          if (unassignId) unassignModule.mutate({ id: unassignId })
        }}
      />
    </div>
  )
}
