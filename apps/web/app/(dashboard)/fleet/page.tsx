"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { PlusIcon, Trash2Icon } from "lucide-react"

import {
  agentChannelLabels,
  agentChannels,
  agentCommandKindLabels,
  agentCommandKinds,
  agentReleasePlatformLabels,
  agentReleasePlatforms,
  type AgentChannel,
  type AgentCommandKind,
  type AgentReleasePlatform,
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
import { Textarea } from "@/components/ui/textarea"
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
import { osFamilyLabel } from "@/lib/devices"

type ReleaseForm = {
  id?: string
  platform: AgentReleasePlatform
  version: string
  channel: AgentChannel
  downloadUrl: string
  sha256: string
  notes: string
}

const emptyRelease = (): ReleaseForm => ({
  platform: "linux",
  version: "",
  channel: "stable",
  downloadUrl: "",
  sha256: "",
  notes: "",
})

const commandHelp: Record<AgentCommandKind, string> = {
  reboot: "The device will restart. It will be unreachable for a short time.",
  restart: "The agent on this device will restart.",
  update:
    "The device will install the published agent version for its channel.",
}

export default function FleetPage() {
  const { can, isPlatformAdmin, isLoading: accessLoading } = usePermissions()
  const canView = can("device:view")
  const canUpdate = can("device:update")
  const canManageOrg = can("organization:admin")
  const canManageSite = can("site:admin")

  const utils = trpc.useUtils()
  const overviewQuery = trpc.fleet.overview.useQuery(undefined, {
    enabled: canView,
    refetchInterval: 30_000,
  })
  const releasesQuery = trpc.fleet.releases.useQuery(undefined, {
    enabled: canView,
  })
  const devicesQuery = trpc.fleet.devices.useQuery(undefined, {
    enabled: canView,
    refetchInterval: 30_000,
  })

  const [releaseForm, setReleaseForm] = React.useState<ReleaseForm | null>(null)
  const [deleteReleaseId, setDeleteReleaseId] = React.useState<string | null>(
    null
  )
  const [pendingAction, setPendingAction] = React.useState<{
    deviceId: string
    deviceName: string
    kind: AgentCommandKind
  } | null>(null)

  const createRelease = trpc.fleet.createRelease.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.fleet.releases.invalidate(),
        utils.fleet.overview.invalidate(),
        utils.fleet.devices.invalidate(),
      ])
      setReleaseForm(null)
      toast.success("Release saved")
    },
    onError(error) {
      toast.error(error.message || "We couldn't save that release.")
    },
  })
  const updateRelease = trpc.fleet.updateRelease.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.fleet.releases.invalidate(),
        utils.fleet.overview.invalidate(),
        utils.fleet.devices.invalidate(),
      ])
      setReleaseForm(null)
      toast.success("Release updated")
    },
    onError(error) {
      toast.error(error.message || "We couldn't update that release.")
    },
  })
  const deleteRelease = trpc.fleet.deleteRelease.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.fleet.releases.invalidate(),
        utils.fleet.overview.invalidate(),
        utils.fleet.devices.invalidate(),
      ])
      setDeleteReleaseId(null)
      toast.success("Release removed")
    },
    onError() {
      toast.error("We couldn't remove that release.")
    },
  })
  const setOrganizationChannel = trpc.fleet.setOrganizationChannel.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.fleet.overview.invalidate(),
        utils.fleet.devices.invalidate(),
        utils.devices.facets.invalidate(),
      ])
      toast.success("Channel updated")
    },
    onError() {
      toast.error("We couldn't update that channel.")
    },
  })
  const setSiteChannel = trpc.fleet.setSiteChannel.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.fleet.overview.invalidate(),
        utils.fleet.devices.invalidate(),
        utils.devices.facets.invalidate(),
      ])
      toast.success("Channel updated")
    },
    onError() {
      toast.error("We couldn't update that channel.")
    },
  })
  const enqueueCommand = trpc.fleet.enqueueCommand.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.fleet.overview.invalidate(),
        utils.fleet.devices.invalidate(),
      ])
      setPendingAction(null)
      toast.success("Action queued. It will run on the next check-in.")
    },
    onError(error) {
      toast.error(error.message || "We couldn't queue that action.")
    },
  })

  if (!accessLoading && !canView) {
    return (
      <AccessDenied description="Fleet is limited to people who can view devices." />
    )
  }

  const overview = overviewQuery.data
  const loading = accessLoading || overviewQuery.isLoading
  const releaseBusy = createRelease.isPending || updateRelease.isPending

  function submitRelease() {
    if (!releaseForm) return
    const input = {
      platform: releaseForm.platform,
      version: releaseForm.version.trim(),
      channel: releaseForm.channel,
      downloadUrl: releaseForm.downloadUrl.trim(),
      sha256: releaseForm.sha256.trim(),
      notes: releaseForm.notes.trim() || null,
    }
    if (releaseForm.id) {
      updateRelease.mutate({ id: releaseForm.id, ...input })
      return
    }
    createRelease.mutate(input)
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Fleet"
        title="Agent fleet"
        description="See which agent versions are running, publish releases, and send allowed actions to devices."
        actions={
          isPlatformAdmin ? (
            <Button size="sm" onClick={() => setReleaseForm(emptyRelease())}>
              <PlusIcon />
              New release
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
                label: "Devices",
                value: overview?.deviceCount ?? 0,
              },
              {
                label: "Reporting a version",
                value: overview?.reportingCount ?? 0,
              },
              {
                label: "Behind",
                value: overview?.behindCount ?? 0,
                hint:
                  overview && overview.behindCount > 0
                    ? "Older than the published release for their channel"
                    : undefined,
              },
              {
                label: "Waiting actions",
                value: overview?.pendingCommandCount ?? 0,
              },
            ]}
          />

          <SectionCard
            title="Versions"
            description="How many devices report each agent version."
          >
            {(overview?.versions.length ?? 0) === 0 ? (
              <EmptyState
                title="No versions yet"
                description="Versions appear after devices check in."
                bordered={false}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Version</TableHead>
                    <TableHead className="text-right">Devices</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overview?.versions.map((row) => (
                    <TableRow key={row.version}>
                      <TableCell className="font-mono text-sm">
                        {row.version}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.count}
                      </TableCell>
                      <TableCell>
                        {row.behind ? (
                          <Badge variant="destructive">Behind</Badge>
                        ) : (
                          <Badge>Current</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>

          <SectionCard
            title="Devices"
            description="Send an allowed action. It runs the next time the device checks in."
            actions={
              <Button asChild variant="ghost" size="sm">
                <Link href="/devices?f.behind=true">Behind on Devices</Link>
              </Button>
            }
          >
            {(devicesQuery.data?.length ?? 0) === 0 ? (
              <EmptyState
                title="No devices yet"
                description="Enrolled devices will appear here with their agent version."
                bordered={false}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Device</TableHead>
                    <TableHead className="hidden sm:table-cell">
                      Channel
                    </TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead className="hidden md:table-cell">
                      Target
                    </TableHead>
                    {canUpdate ? <TableHead>Actions</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {devicesQuery.data?.map((device) => (
                    <TableRow key={device.id}>
                      <TableCell>
                        <Link
                          href={`/devices/${device.id}`}
                          className="font-medium hover:underline"
                        >
                          {device.displayName}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {device.siteName ?? "No site"}
                          {device.osFamily
                            ? ` · ${osFamilyLabel(device.osFamily)}`
                            : ""}
                        </p>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {agentChannelLabels[device.channel]}
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs">
                          {device.agentVersion ?? "—"}
                        </span>
                        {device.behind ? (
                          <Badge variant="destructive" className="ml-2">
                            Behind
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs md:table-cell">
                        {device.desiredVersion ?? "—"}
                      </TableCell>
                      {canUpdate ? (
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {agentCommandKinds.map((kind) => (
                              <Button
                                key={kind}
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setPendingAction({
                                    deviceId: device.id,
                                    deviceName: device.displayName,
                                    kind,
                                  })
                                }
                              >
                                {agentCommandKindLabels[kind]}
                              </Button>
                            ))}
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
            title="Releases"
            description="Published agent builds that devices can install."
          >
            {(releasesQuery.data?.length ?? 0) === 0 ? (
              <EmptyState
                title="No releases yet"
                description={
                  isPlatformAdmin
                    ? "Publish a version to set the target for each channel."
                    : "No agent versions have been published yet."
                }
                bordered={false}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Version</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead className="hidden sm:table-cell">
                      Platform
                    </TableHead>
                    <TableHead className="hidden lg:table-cell">
                      Download
                    </TableHead>
                    {isPlatformAdmin ? <TableHead /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {releasesQuery.data?.map((release) => (
                    <TableRow key={release.id}>
                      <TableCell className="font-mono text-sm">
                        {release.version}
                      </TableCell>
                      <TableCell>
                        {agentChannelLabels[release.channel]}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {agentReleasePlatformLabels[release.platform]}
                      </TableCell>
                      <TableCell className="hidden max-w-[16rem] truncate text-xs lg:table-cell">
                        {release.downloadUrl}
                      </TableCell>
                      {isPlatformAdmin ? (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setReleaseForm({
                                  id: release.id,
                                  platform: release.platform,
                                  version: release.version,
                                  channel: release.channel,
                                  downloadUrl: release.downloadUrl,
                                  sha256: release.sha256,
                                  notes: release.notes ?? "",
                                })
                              }
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setDeleteReleaseId(release.id)}
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

          {canManageOrg || canManageSite ? (
            <SectionCard
              title="Channels"
              description="Choose which published line each organization and site follows. A site setting overrides the organization."
            >
              <div className="grid gap-6 lg:grid-cols-2">
                {canManageOrg ? (
                  <div className="flex flex-col gap-3">
                    <p className="text-sm font-medium">Organizations</p>
                    {(overview?.channels.length ?? 0) === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No organizations yet.
                      </p>
                    ) : (
                      overview?.channels.map((row) => (
                        <FormField
                          key={row.organizationId}
                          label={row.organizationName}
                          htmlFor={`org-channel-${row.organizationId}`}
                        >
                          <SelectField
                            id={`org-channel-${row.organizationId}`}
                            value={row.channel}
                            onValueChange={(value) =>
                              setOrganizationChannel.mutate({
                                organizationId: row.organizationId,
                                channel: value as AgentChannel,
                              })
                            }
                            options={agentChannels.map((channel) => ({
                              value: channel,
                              label: agentChannelLabels[channel],
                            }))}
                          />
                        </FormField>
                      ))
                    )}
                  </div>
                ) : null}
                {canManageSite ? (
                  <div className="flex flex-col gap-3">
                    <p className="text-sm font-medium">Sites</p>
                    {(overview?.sites.length ?? 0) === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No sites yet.
                      </p>
                    ) : (
                      overview?.sites.map((row) => (
                        <FormField
                          key={row.id}
                          label={`${row.name} · ${row.organizationName}`}
                          htmlFor={`site-channel-${row.id}`}
                          description={
                            row.channel
                              ? undefined
                              : `Follows ${agentChannelLabels[row.effectiveChannel]}`
                          }
                        >
                          <SelectField
                            id={`site-channel-${row.id}`}
                            value={row.channel ?? ""}
                            emptyLabel="Follow organization"
                            onValueChange={(value) =>
                              setSiteChannel.mutate({
                                siteId: row.id,
                                channel: value ? (value as AgentChannel) : null,
                              })
                            }
                            options={agentChannels.map((channel) => ({
                              value: channel,
                              label: agentChannelLabels[channel],
                            }))}
                          />
                        </FormField>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            </SectionCard>
          ) : null}
        </>
      )}

      <Dialog
        open={Boolean(releaseForm)}
        onOpenChange={(open) => {
          if (!open) setReleaseForm(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {releaseForm?.id ? "Edit release" : "New release"}
            </DialogTitle>
            <DialogDescription>
              Devices on this channel will be offered this version.
            </DialogDescription>
          </DialogHeader>
          {releaseForm ? (
            <div className="flex flex-col gap-4">
              <FormField label="Version" htmlFor="release-version">
                <Input
                  id="release-version"
                  value={releaseForm.version}
                  onChange={(event) =>
                    setReleaseForm({
                      ...releaseForm,
                      version: event.target.value,
                    })
                  }
                  placeholder="1.2.0"
                />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Channel" htmlFor="release-channel">
                  <SelectField
                    id="release-channel"
                    value={releaseForm.channel}
                    onValueChange={(value) =>
                      setReleaseForm({
                        ...releaseForm,
                        channel: value as AgentChannel,
                      })
                    }
                    options={agentChannels.map((channel) => ({
                      value: channel,
                      label: agentChannelLabels[channel],
                    }))}
                  />
                </FormField>
                <FormField label="Platform" htmlFor="release-platform">
                  <SelectField
                    id="release-platform"
                    value={releaseForm.platform}
                    onValueChange={(value) =>
                      setReleaseForm({
                        ...releaseForm,
                        platform: value as AgentReleasePlatform,
                      })
                    }
                    options={agentReleasePlatforms.map((platform) => ({
                      value: platform,
                      label: agentReleasePlatformLabels[platform],
                    }))}
                  />
                </FormField>
              </div>
              <FormField label="Download link" htmlFor="release-url">
                <Input
                  id="release-url"
                  value={releaseForm.downloadUrl}
                  onChange={(event) =>
                    setReleaseForm({
                      ...releaseForm,
                      downloadUrl: event.target.value,
                    })
                  }
                  placeholder="https://"
                />
              </FormField>
              <FormField
                label="Checksum"
                htmlFor="release-sha"
                description="Checksum of the download."
              >
                <Input
                  id="release-sha"
                  value={releaseForm.sha256}
                  onChange={(event) =>
                    setReleaseForm({
                      ...releaseForm,
                      sha256: event.target.value,
                    })
                  }
                  className="font-mono text-xs"
                />
              </FormField>
              <FormField label="Notes" htmlFor="release-notes">
                <Textarea
                  id="release-notes"
                  value={releaseForm.notes}
                  onChange={(event) =>
                    setReleaseForm({
                      ...releaseForm,
                      notes: event.target.value,
                    })
                  }
                  rows={3}
                />
              </FormField>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReleaseForm(null)}>
              Cancel
            </Button>
            <Button onClick={submitRelease} disabled={releaseBusy}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteReleaseId)}
        onOpenChange={(open) => {
          if (!open) setDeleteReleaseId(null)
        }}
        title="Remove this release?"
        description="Devices will no longer be offered this version."
        confirmLabel="Remove"
        destructive
        pending={deleteRelease.isPending}
        onConfirm={() => {
          if (deleteReleaseId) deleteRelease.mutate({ id: deleteReleaseId })
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingAction)}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null)
        }}
        title={
          pendingAction
            ? `${agentCommandKindLabels[pendingAction.kind]} for ${pendingAction.deviceName}?`
            : "Send this action?"
        }
        description={pendingAction ? commandHelp[pendingAction.kind] : ""}
        confirmLabel="Queue action"
        pending={enqueueCommand.isPending}
        onConfirm={() => {
          if (!pendingAction) return
          enqueueCommand.mutate({
            deviceId: pendingAction.deviceId,
            kind: pendingAction.kind,
          })
        }}
      />
    </div>
  )
}
