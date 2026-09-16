"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import * as React from "react"
import { toast } from "sonner"
import {
  BellIcon,
  CheckIcon,
  CopyIcon,
  MailIcon,
  PlusIcon,
  RotateCcwIcon,
  Trash2Icon,
  WebhookIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog"
import { EmptyState } from "@/components/dashboard/empty-state"
import { FormField } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { SectionCard } from "@/components/dashboard/section-card"
import { SelectField } from "@/components/dashboard/select-field"
import { Skeleton } from "@/components/ui/skeleton"
import { formatDate, formatRelativeTime } from "@/lib/dashboard"
import { trpc } from "@/lib/trpc"
import {
  alertKindLabels,
  alertKinds,
  auditSeverities,
  type AlertKind,
  type AuditSeverity,
  type NotificationChannelType,
} from "@nms/shared"

type ChannelRow = {
  id: string
  organizationId: string
  name: string
  type: NotificationChannelType
  enabled: boolean
  minSeverity: AuditSeverity
  alertKinds: AlertKind[]
  siteIds: string[]
  addresses: string[]
  url: string | null
  createdAt: Date | string
  updatedAt: Date | string
  webhookSecret?: string
}

const severityLabels: Record<AuditSeverity, string> = {
  info: "Info and above",
  notice: "Notice and above",
  warning: "Warning and above",
  critical: "Critical only",
}

const eventLabels: Record<string, string> = {
  "alert.opened": "Alert opened",
  "alert.resolved": "Alert resolved",
  "alert.escalated": "Alert escalated",
  "access.requested": "Access requested",
  "playbook.requested": "Playbook review",
  "channel.test": "Test",
}

function parseAddresses(value: string) {
  return [
    ...new Set(
      value
        .split(/[\n,;]+/)
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)
    ),
  ]
}

function ChannelFormDialog({
  open,
  onOpenChange,
  organizationId,
  sites,
  channel,
  onCreatedSecret,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: string
  sites: Array<{ id: string; name: string }>
  channel: ChannelRow | null
  onCreatedSecret?: (secret: string) => void
}) {
  const utils = trpc.useUtils()
  const createChannel = trpc.notifications.createChannel.useMutation()
  const updateChannel = trpc.notifications.updateChannel.useMutation()
  const editing = Boolean(channel)

  const [name, setName] = React.useState("")
  const [type, setType] = React.useState<NotificationChannelType>("email")
  const [addresses, setAddresses] = React.useState("")
  const [url, setUrl] = React.useState("")
  const [minSeverity, setMinSeverity] = React.useState<AuditSeverity>("warning")
  const [selectedKinds, setSelectedKinds] = React.useState<AlertKind[]>([])
  const [selectedSites, setSelectedSites] = React.useState<string[]>([])
  const [enabled, setEnabled] = React.useState(true)
  const [rotateSecret, setRotateSecret] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setName(channel?.name ?? "")
    setType(channel?.type ?? "email")
    setAddresses((channel?.addresses ?? []).join("\n"))
    setUrl(channel?.url ?? "")
    setMinSeverity(channel?.minSeverity ?? "warning")
    setSelectedKinds(channel?.alertKinds ?? [])
    setSelectedSites(channel?.siteIds ?? [])
    setEnabled(channel?.enabled ?? true)
    setRotateSecret(false)
  }, [open, channel])

  const pending = createChannel.isPending || updateChannel.isPending
  const parsedAddresses = parseAddresses(addresses)
  const canSubmit =
    name.trim().length > 0 &&
    (type === "email" ? parsedAddresses.length > 0 : url.trim().length > 0)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    try {
      if (editing && channel) {
        const updated = await updateChannel.mutateAsync({
          id: channel.id,
          name: name.trim(),
          enabled,
          minSeverity,
          alertKinds: selectedKinds,
          siteIds: selectedSites,
          addresses: channel.type === "email" ? parsedAddresses : undefined,
          url: channel.type === "webhook" ? url.trim() : undefined,
          rotateSecret: channel.type === "webhook" ? rotateSecret : undefined,
        })
        toast.success("Channel updated")
        if (updated.webhookSecret) {
          onCreatedSecret?.(updated.webhookSecret)
        }
      } else if (type === "email") {
        await createChannel.mutateAsync({
          organizationId,
          name: name.trim(),
          type: "email",
          enabled,
          minSeverity,
          alertKinds: selectedKinds,
          siteIds: selectedSites,
          addresses: parsedAddresses,
        })
        toast.success("Channel added")
      } else {
        const created = await createChannel.mutateAsync({
          organizationId,
          name: name.trim(),
          type: "webhook",
          enabled,
          minSeverity,
          alertKinds: selectedKinds,
          siteIds: selectedSites,
          url: url.trim(),
        })
        toast.success("Channel added")
        if (created.webhookSecret) {
          onCreatedSecret?.(created.webhookSecret)
        }
      }
      await Promise.all([
        utils.notifications.channels.invalidate(),
        utils.notifications.deliveries.invalidate(),
      ])
      onOpenChange(false)
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "We couldn't save this channel."
      )
    }
  }

  function toggleKind(kind: AlertKind, next: boolean) {
    setSelectedKinds((current) =>
      next ? [...current, kind] : current.filter((item) => item !== kind)
    )
  }

  function toggleSite(siteId: string, next: boolean) {
    setSelectedSites((current) =>
      next ? [...current, siteId] : current.filter((item) => item !== siteId)
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <form className="flex flex-col gap-5" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit channel" : "Add channel"}
            </DialogTitle>
            <DialogDescription>
              Choose who should hear about alerts for this organization, and
              how.
            </DialogDescription>
          </DialogHeader>

          <FormField label="Name" htmlFor="channel-name">
            <Input
              id="channel-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="On-call inbox"
              required
            />
          </FormField>

          {editing ? null : (
            <FormField label="Type">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={type === "email" ? "default" : "outline"}
                  onClick={() => setType("email")}
                >
                  <MailIcon />
                  Email
                </Button>
                <Button
                  type="button"
                  variant={type === "webhook" ? "default" : "outline"}
                  onClick={() => setType("webhook")}
                >
                  <WebhookIcon />
                  Webhook
                </Button>
              </div>
            </FormField>
          )}

          {type === "email" ? (
            <FormField
              label="Recipients"
              htmlFor="channel-addresses"
              description="One address per line."
            >
              <Textarea
                id="channel-addresses"
                value={addresses}
                onChange={(event) => setAddresses(event.target.value)}
                rows={4}
                required={!editing || channel?.type === "email"}
              />
            </FormField>
          ) : (
            <>
              <FormField label="Destination URL" htmlFor="channel-url">
                <Input
                  id="channel-url"
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://"
                  required
                />
              </FormField>
              {editing ? (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={rotateSecret}
                    onCheckedChange={(next) => setRotateSecret(Boolean(next))}
                  />
                  Create a new signing secret
                </label>
              ) : null}
            </>
          )}

          <FormField label="Minimum severity" htmlFor="channel-severity">
            <SelectField
              id="channel-severity"
              value={minSeverity}
              onValueChange={(value) => setMinSeverity(value as AuditSeverity)}
              options={auditSeverities.map((severity) => ({
                value: severity,
                label: severityLabels[severity],
              }))}
            />
          </FormField>

          <div className="flex flex-col gap-3 rounded-lg border border-border/80 p-3">
            <div>
              <p className="text-sm font-medium">Alert types</p>
              <p className="text-xs text-muted-foreground">
                Leave all unchecked to include every type.
              </p>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {alertKinds.map((kind) => (
                <li key={kind}>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selectedKinds.includes(kind)}
                      onCheckedChange={(next) =>
                        toggleKind(kind, Boolean(next))
                      }
                    />
                    {alertKindLabels[kind]}
                  </label>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-border/80 p-3">
            <div>
              <p className="text-sm font-medium">Sites</p>
              <p className="text-xs text-muted-foreground">
                Leave all unchecked to include every site.
              </p>
            </div>
            {sites.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This organization has no sites yet.
              </p>
            ) : (
              <ul className="flex max-h-40 flex-col gap-2 overflow-y-auto">
                {sites.map((site) => (
                  <li key={site.id}>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={selectedSites.includes(site.id)}
                        onCheckedChange={(next) =>
                          toggleSite(site.id, Boolean(next))
                        }
                      />
                      {site.name}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Channel is on</span>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              aria-label="Channel is on"
            />
          </label>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || pending}>
              {pending ? "Saving…" : editing ? "Save changes" : "Add channel"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function NotificationsSettingsPage() {
  const utils = trpc.useUtils()
  const organizationsQuery = trpc.organizations.list.useQuery()
  const sitesQuery = trpc.sites.list.useQuery()
  const organizations = organizationsQuery.data ?? []
  const [organizationId, setOrganizationId] = React.useState("")
  const selectedOrganizationId = organizationId || organizations[0]?.id || ""

  const channelsQuery = trpc.notifications.channels.useQuery(
    { organizationId: selectedOrganizationId },
    { enabled: Boolean(selectedOrganizationId) }
  )
  const deliveriesQuery = trpc.notifications.deliveries.useQuery(
    { organizationId: selectedOrganizationId, limit: 50 },
    { enabled: Boolean(selectedOrganizationId) }
  )

  const sendTest = trpc.notifications.sendTest.useMutation()
  const retryDelivery = trpc.notifications.retryDelivery.useMutation()
  const deleteChannel = trpc.notifications.deleteChannel.useMutation()

  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<ChannelRow | null>(null)
  const [deleteId, setDeleteId] = React.useState<string | null>(null)
  const [revealedSecret, setRevealedSecret] = React.useState<string | null>(
    null
  )
  const [copied, setCopied] = React.useState(false)

  const orgSites = (sitesQuery.data ?? []).filter(
    (site) => site.organizationId === selectedOrganizationId
  )
  const channels = (channelsQuery.data ?? []) as ChannelRow[]
  const deliveries = deliveriesQuery.data?.items ?? []

  async function handleSendTest(id: string) {
    try {
      await sendTest.mutateAsync({ id })
      toast.success("Test sent")
      await utils.notifications.deliveries.invalidate()
    } catch {
      toast.error("We couldn't send the test.")
      await utils.notifications.deliveries.invalidate()
    }
  }

  async function handleRetry(id: string) {
    try {
      await retryDelivery.mutateAsync({ id })
      toast.success("Queued to send again")
      await utils.notifications.deliveries.invalidate()
    } catch {
      toast.error("We couldn't retry that delivery.")
    }
  }

  async function handleDelete() {
    if (!deleteId) return
    try {
      await deleteChannel.mutateAsync({ id: deleteId })
      toast.success("Channel removed")
      setDeleteId(null)
      await Promise.all([
        utils.notifications.channels.invalidate(),
        utils.notifications.deliveries.invalidate(),
      ])
    } catch {
      toast.error("We couldn't remove that channel.")
    }
  }

  async function copySecret() {
    if (!revealedSecret) return
    try {
      await navigator.clipboard.writeText(revealedSecret)
      setCopied(true)
      toast.success("Signing secret copied")
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      toast.error("Couldn't copy")
    }
  }

  if (organizationsQuery.isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    )
  }

  if (organizations.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          badge="Settings"
          title="Notifications"
          description="Send alert messages to an inbox or a signed destination."
        />
        <EmptyState
          title="No organization yet"
          description="Create an organization before adding notification channels."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Settings"
        title="Notifications"
        description="Choose how this organization hears about alerts. Messages go to an inbox or a signed destination you control."
        actions={
          <Button
            className="w-full sm:w-auto"
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
            disabled={!selectedOrganizationId}
          >
            <PlusIcon />
            Add channel
          </Button>
        }
      />

      {organizations.length > 1 ? (
        <FormField label="Organization" htmlFor="notifications-org">
          <SelectField
            id="notifications-org"
            value={selectedOrganizationId}
            onValueChange={setOrganizationId}
            options={organizations.map((organization) => ({
              value: organization.id,
              label: organization.name,
            }))}
          />
        </FormField>
      ) : null}

      <SectionCard
        title="Channels"
        description="Each channel can filter by severity, alert type, and site."
        collapsibleOnMobile
        defaultOpenOnMobile
      >
        {channelsQuery.isLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : channels.length === 0 ? (
          <EmptyState
            title="No channels yet"
            description="Add an email or webhook channel to start sending alert messages."
            bordered={false}
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border/70">
            {channels.map((channel) => (
              <li
                key={channel.id}
                className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{channel.name}</p>
                    <Badge variant="outline">
                      {channel.type === "email" ? "Email" : "Webhook"}
                    </Badge>
                    {channel.enabled ? null : (
                      <Badge variant="secondary">Off</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {channel.type === "email"
                      ? channel.addresses.join(", ")
                      : channel.url}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {severityLabels[channel.minSeverity]}
                    {channel.alertKinds.length > 0
                      ? ` · ${channel.alertKinds
                          .map((kind) => alertKindLabels[kind])
                          .join(", ")}`
                      : " · All alert types"}
                    {channel.siteIds.length > 0
                      ? ` · ${channel.siteIds.length} site${
                          channel.siteIds.length === 1 ? "" : "s"
                        }`
                      : " · All sites"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleSendTest(channel.id)}
                    disabled={sendTest.isPending}
                  >
                    <BellIcon />
                    Send test
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditing(channel)
                      setFormOpen(true)
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDeleteId(channel.id)}
                  >
                    <Trash2Icon />
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Delivery log"
        description="Recent messages from this organization. Failed deliveries can be sent again."
        collapsibleOnMobile
      >
        {deliveriesQuery.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : deliveries.length === 0 ? (
          <EmptyState
            title="No deliveries yet"
            description="When an alert opens or is resolved, matching channels appear here."
            bordered={false}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b border-border/70">
                  <th className="py-2 pr-3 font-medium">When</th>
                  <th className="py-2 pr-3 font-medium">Channel</th>
                  <th className="py-2 pr-3 font-medium">Event</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Attempts</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {deliveries.map((delivery) => (
                  <tr
                    key={delivery.id}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="py-2.5 pr-3 align-top">
                      <div>{formatDate(delivery.createdAt)}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatRelativeTime(delivery.createdAt)}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 align-top">
                      {delivery.channelName}
                    </td>
                    <td className="py-2.5 pr-3 align-top">
                      {eventLabels[delivery.event] ?? delivery.event}
                    </td>
                    <td className="py-2.5 pr-3 align-top">
                      <Badge
                        variant={
                          delivery.status === "sent"
                            ? "default"
                            : delivery.status === "failed"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {delivery.status === "pending"
                          ? "Queued"
                          : delivery.status === "sending"
                            ? "Sending"
                            : delivery.status === "sent"
                              ? "Sent"
                              : "Failed"}
                      </Badge>
                      {delivery.lastResponse ? (
                        <p className="mt-1 max-w-xs truncate text-xs text-muted-foreground">
                          {delivery.lastResponse}
                        </p>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-3 align-top">
                      {delivery.attempts}
                    </td>
                    <td className="py-2.5 align-top">
                      {delivery.status === "failed" ||
                      delivery.status === "pending" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRetry(delivery.id)}
                          disabled={retryDelivery.isPending}
                        >
                          <RotateCcwIcon />
                          Retry
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <ChannelFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        organizationId={selectedOrganizationId}
        sites={orgSites}
        channel={editing}
        onCreatedSecret={setRevealedSecret}
      />

      <ConfirmDialog
        open={Boolean(deleteId)}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null)
        }}
        title="Remove this channel?"
        description="Queued messages for this channel will be dropped. This cannot be undone."
        confirmLabel="Remove"
        destructive
        pending={deleteChannel.isPending}
        onConfirm={handleDelete}
      />

      <Dialog
        open={Boolean(revealedSecret)}
        onOpenChange={(open) => {
          if (!open) {
            setRevealedSecret(null)
            setCopied(false)
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Signing secret</DialogTitle>
            <DialogDescription>
              Copy this secret now. It is shown once and used to verify incoming
              messages at your destination.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-border/80 bg-muted/40 p-3">
            <p className="font-mono text-xs break-all">{revealedSecret}</p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRevealedSecret(null)
                setCopied(false)
              }}
            >
              Done
            </Button>
            <Button onClick={copySecret}>
              {copied ? <CheckIcon /> : <CopyIcon />}
              Copy secret
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
