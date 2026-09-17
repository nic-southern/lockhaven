"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { PlusIcon, Trash2Icon } from "lucide-react"

import {
  alertKindLabels,
  alertKinds,
  playbookActionLabels,
  playbookActions,
  PLAYBOOK_COOLDOWN_MINUTES_DEFAULT,
  type AlertKind,
  type PlaybookAction,
} from "@nms/shared"

import { AccessDenied } from "@/components/dashboard/access-denied"
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog"
import { EmptyState } from "@/components/dashboard/empty-state"
import { FormField } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { SectionCard } from "@/components/dashboard/section-card"
import { SelectField } from "@/components/dashboard/select-field"
import { StatStrip } from "@/components/dashboard/stat-strip"
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
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatRelativeTime } from "@/lib/dashboard"
import { trpc } from "@/lib/trpc"
import { usePermissions } from "@/lib/use-permissions"

type PlaybookForm = {
  id?: string
  organizationId: string
  siteId: string
  name: string
  alertKind: AlertKind
  action: PlaybookAction
  enabled: boolean
  requireApproval: boolean
  cooldownMinutes: string
}

function emptyForm(organizationId: string): PlaybookForm {
  return {
    organizationId,
    siteId: "",
    name: "",
    alertKind: "agent_outdated",
    action: "update",
    enabled: true,
    requireApproval: false,
    cooldownMinutes: String(PLAYBOOK_COOLDOWN_MINUTES_DEFAULT),
  }
}

export default function PlaybooksPage() {
  const { can, isLoading: accessLoading } = usePermissions()
  const canView = can("device:view")
  const canManage = can("organization:admin")
  const utils = trpc.useUtils()

  const organizationsQuery = trpc.organizations.list.useQuery(undefined, {
    enabled: canView,
  })
  const sitesQuery = trpc.sites.list.useQuery(undefined, { enabled: canView })
  const overviewQuery = trpc.playbooks.overview.useQuery(undefined, {
    enabled: canView,
  })
  const playbooksQuery = trpc.playbooks.list.useQuery(undefined, {
    enabled: canView,
  })
  const runsQuery = trpc.playbooks.runs.useQuery(
    { limit: 50 },
    { enabled: canView, refetchInterval: 15_000 }
  )

  const [form, setForm] = React.useState<PlaybookForm | null>(null)
  const [deleteId, setDeleteId] = React.useState<string | null>(null)

  const createPlaybook = trpc.playbooks.create.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.playbooks.list.invalidate(),
        utils.playbooks.overview.invalidate(),
      ])
      setForm(null)
      toast.success("Playbook saved")
    },
    onError(error) {
      toast.error(error.message || "We couldn't save that playbook.")
    },
  })
  const updatePlaybook = trpc.playbooks.update.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.playbooks.list.invalidate(),
        utils.playbooks.overview.invalidate(),
      ])
      setForm(null)
      toast.success("Playbook updated")
    },
    onError(error) {
      toast.error(error.message || "We couldn't update that playbook.")
    },
  })
  const deletePlaybook = trpc.playbooks.delete.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.playbooks.list.invalidate(),
        utils.playbooks.overview.invalidate(),
        utils.playbooks.runs.invalidate(),
      ])
      setDeleteId(null)
      toast.success("Playbook removed")
    },
    onError() {
      toast.error("We couldn't remove that playbook.")
    },
  })

  if (!accessLoading && !canView) {
    return (
      <AccessDenied description="Playbooks are limited to people who can view devices." />
    )
  }

  const organizations = organizationsQuery.data ?? []
  const sites = sitesQuery.data ?? []
  const formSites = form
    ? sites.filter((site) => site.organizationId === form.organizationId)
    : []
  const loading =
    accessLoading || playbooksQuery.isLoading || overviewQuery.isLoading
  const busy = createPlaybook.isPending || updatePlaybook.isPending

  function submitForm() {
    if (!form) return
    const cooldown = Number(form.cooldownMinutes)
    if (!Number.isInteger(cooldown) || cooldown < 0) {
      toast.error("Cooldown must be a whole number of minutes.")
      return
    }
    const input = {
      organizationId: form.organizationId,
      siteId: form.siteId ? form.siteId : null,
      name: form.name.trim(),
      alertKind: form.alertKind,
      action: form.action,
      enabled: form.enabled,
      requireApproval: form.requireApproval,
      cooldownMinutes: cooldown,
    }
    if (form.id) {
      updatePlaybook.mutate({ id: form.id, ...input })
      return
    }
    createPlaybook.mutate(input)
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Operate"
        title="Playbooks"
        description="Map an alert to an allowed device action. Reboot and agent update wait until the location is closed when hours are set. Playbooks never run custom scripts."
        actions={
          canManage && organizations[0] ? (
            <Button
              size="sm"
              onClick={() => setForm(emptyForm(organizations[0]!.id))}
            >
              <PlusIcon />
              New playbook
            </Button>
          ) : null
        }
      />

      {loading ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : (
        <>
          <StatStrip
            items={[
              {
                label: "Playbooks",
                value: overviewQuery.data?.playbookCount ?? 0,
              },
              {
                label: "On",
                value: overviewQuery.data?.enabledCount ?? 0,
              },
              {
                label: "Needs review",
                value: overviewQuery.data?.pendingApprovalCount ?? 0,
              },
              {
                label: "Queued",
                value: overviewQuery.data?.queuedCount ?? 0,
              },
            ]}
          />

          <SectionCard
            title="Playbooks"
            description="When a matching alert opens, Lockhaven queues one allowed action on the device."
          >
            {(playbooksQuery.data?.length ?? 0) === 0 ? (
              <EmptyState
                title="No playbooks yet"
                description={
                  canManage
                    ? "Create a playbook to restart or update a device when a specific alert opens."
                    : "No playbooks have been set up yet."
                }
                bordered={false}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Alert</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead className="hidden sm:table-cell">
                      Scope
                    </TableHead>
                    <TableHead className="hidden md:table-cell">
                      Approval
                    </TableHead>
                    {canManage ? <TableHead>Manage</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {playbooksQuery.data?.map((playbook) => (
                    <TableRow key={playbook.id}>
                      <TableCell>
                        <div className="flex min-w-0 flex-col">
                          <span className="font-medium">{playbook.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {playbook.enabled ? "On" : "Off"}
                            {` · ${playbook.cooldownMinutes} min cooldown`}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>{playbook.alertKindLabel}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{playbook.actionLabel}</Badge>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {playbook.siteName ?? "All sites"}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {playbook.requireApproval ? "Required" : "Automatic"}
                      </TableCell>
                      {canManage ? (
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setForm({
                                  id: playbook.id,
                                  organizationId: playbook.organizationId,
                                  siteId: playbook.siteId ?? "",
                                  name: playbook.name,
                                  alertKind: playbook.alertKind,
                                  action: playbook.action,
                                  enabled: playbook.enabled,
                                  requireApproval: playbook.requireApproval,
                                  cooldownMinutes: String(
                                    playbook.cooldownMinutes
                                  ),
                                })
                              }
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setDeleteId(playbook.id)}
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
            )}
          </SectionCard>

          <SectionCard
            title="Recent runs"
            description="Each alert is handled once. Allowed actions wait for the next check-in."
            actions={
              can("organization:admin") || can("site:admin") ? (
                <Button asChild variant="ghost" size="sm">
                  <Link href="/approvals">Approvals</Link>
                </Button>
              ) : null
            }
          >
            {(runsQuery.data?.length ?? 0) === 0 ? (
              <EmptyState
                title="No runs yet"
                description="Runs appear here when an alert matches a playbook."
                bordered={false}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Playbook</TableHead>
                    <TableHead className="hidden sm:table-cell">
                      Device
                    </TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runsQuery.data?.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell className="text-sm whitespace-nowrap text-muted-foreground">
                        {formatRelativeTime(run.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate">{run.playbookName}</span>
                          <span className="truncate text-xs text-muted-foreground">
                            {run.alertTitle}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {run.deviceId ? (
                          <Link
                            href={`/devices/${run.deviceId}`}
                            className="hover:underline"
                          >
                            {run.deviceName ?? "Device"}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>{run.actionLabel}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge
                            variant={
                              run.status === "queued" ||
                              run.status === "pending_approval"
                                ? "default"
                                : "outline"
                            }
                          >
                            {run.statusLabel}
                          </Badge>
                          {run.skipReasonLabel ? (
                            <span className="text-xs text-muted-foreground">
                              {run.skipReasonLabel}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </>
      )}

      <Dialog
        open={Boolean(form)}
        onOpenChange={(open) => !open && setForm(null)}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {form?.id ? "Edit playbook" : "New playbook"}
            </DialogTitle>
            <DialogDescription>
              Choose an alert and one allowed action. Custom scripts are not
              available.
            </DialogDescription>
          </DialogHeader>
          {form ? (
            <div className="flex flex-col gap-4">
              <FormField label="Name" htmlFor="playbook-name">
                <Input
                  id="playbook-name"
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                  placeholder="Restart outdated agents"
                />
              </FormField>
              <FormField label="Organization" htmlFor="playbook-org">
                <SelectField
                  id="playbook-org"
                  value={form.organizationId}
                  onValueChange={(value) =>
                    setForm({ ...form, organizationId: value, siteId: "" })
                  }
                  options={organizations.map((organization) => ({
                    value: organization.id,
                    label: organization.name,
                  }))}
                />
              </FormField>
              <FormField
                label="Site"
                htmlFor="playbook-site"
                description="Leave empty to apply across the organization."
              >
                <SelectField
                  id="playbook-site"
                  value={form.siteId}
                  onValueChange={(value) => setForm({ ...form, siteId: value })}
                  emptyLabel="All sites"
                  options={formSites.map((site) => ({
                    value: site.id,
                    label: site.name,
                  }))}
                />
              </FormField>
              <FormField label="Alert" htmlFor="playbook-alert">
                <SelectField
                  id="playbook-alert"
                  value={form.alertKind}
                  onValueChange={(value) =>
                    setForm({ ...form, alertKind: value as AlertKind })
                  }
                  options={alertKinds.map((kind) => ({
                    value: kind,
                    label: alertKindLabels[kind],
                  }))}
                />
              </FormField>
              <FormField
                label="Action"
                htmlFor="playbook-action"
                description="Only restart device, restart agent, or update agent."
              >
                <SelectField
                  id="playbook-action"
                  value={form.action}
                  onValueChange={(value) =>
                    setForm({ ...form, action: value as PlaybookAction })
                  }
                  options={playbookActions.map((action) => ({
                    value: action,
                    label: playbookActionLabels[action],
                  }))}
                />
              </FormField>
              <FormField
                label="Cooldown (minutes)"
                htmlFor="playbook-cooldown"
                description="Wait this long before acting on the same device again."
              >
                <Input
                  id="playbook-cooldown"
                  type="number"
                  min={0}
                  max={10080}
                  value={form.cooldownMinutes}
                  onChange={(event) =>
                    setForm({ ...form, cooldownMinutes: event.target.value })
                  }
                />
              </FormField>
              <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium">Require approval</span>
                  <span className="text-xs text-muted-foreground">
                    Send to Approvals before the action is queued.
                  </span>
                </div>
                <Switch
                  checked={form.requireApproval}
                  onCheckedChange={(checked) =>
                    setForm({ ...form, requireApproval: checked })
                  }
                />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium">On</span>
                  <span className="text-xs text-muted-foreground">
                    Turn off to stop matching new alerts.
                  </span>
                </div>
                <Switch
                  checked={form.enabled}
                  onCheckedChange={(checked) =>
                    setForm({ ...form, enabled: checked })
                  }
                />
              </div>
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

      <ConfirmDialog
        open={Boolean(deleteId)}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Remove this playbook?"
        description="Open alerts will no longer queue an action from this playbook."
        confirmLabel="Remove"
        destructive
        pending={deletePlaybook.isPending}
        onConfirm={() => {
          if (deleteId) deletePlaybook.mutate({ id: deleteId })
        }}
      />
    </div>
  )
}
