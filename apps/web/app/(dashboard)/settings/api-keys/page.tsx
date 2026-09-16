"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import * as React from "react"
import { toast } from "sonner"
import { CheckIcon, CopyIcon, KeySquareIcon, PlusIcon } from "lucide-react"

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
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog"
import { EmptyState } from "@/components/dashboard/empty-state"
import { FormField } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { SectionCard } from "@/components/dashboard/section-card"
import { SelectField } from "@/components/dashboard/select-field"
import { Skeleton } from "@/components/ui/skeleton"
import { formatDate, formatRelativeTime } from "@/lib/dashboard"
import { trpc } from "@/lib/trpc"
import { usePermissions } from "@/lib/use-permissions"
import { permissions, type Permission } from "@nms/shared"

const permissionLabels: Record<Permission, string> = {
  "device:view": "View devices",
  "device:create": "Create devices",
  "device:update": "Update devices",
  "device:delete": "Remove devices",
  "device:enroll": "Enroll devices",
  "device:revoke_vpn": "Revoke device access",
  "device:start_vnc": "Start screen sessions",
  "device:start_rdp": "Start desktop sessions",
  "device:start_ssh": "Start terminal sessions",
  "credential:reveal": "Reveal credentials",
  "organization:admin": "Manage organization",
  "site:admin": "Manage sites",
  "user:manage": "Manage users",
  "audit:view": "View activity",
  "vpn:admin_profile": "Manage admin access",
}

const expiryPresets = [
  { value: "never", label: "No expiration" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "365d", label: "1 year" },
] as const

function expiryFromPreset(value: string) {
  if (value === "never") return null
  const days = Number(value.replace("d", ""))
  if (!Number.isFinite(days) || days <= 0) return null
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
}

function isApiKeyExpired(expiresAt: Date | string | null | undefined) {
  if (!expiresAt) return false
  return new Date(expiresAt).getTime() <= Date.now()
}

type ApiKeyRow = {
  id: string
  name: string
  prefix: string
  organizationId: string | null
  organizationName: string | null
  permissions: Permission[]
  expiresAt: Date | string | null
  revokedAt: Date | string | null
  lastUsedAt: Date | string | null
  createdAt: Date | string
}

function CreateKeyDialog({
  open,
  onOpenChange,
  organizations,
  grantable,
  isPlatformAdmin,
  defaultOrganizationId,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizations: Array<{ id: string; name: string }>
  grantable: Permission[]
  isPlatformAdmin: boolean
  defaultOrganizationId: string
  onCreated: (secret: string) => void
}) {
  const createKey = trpc.apiKeys.create.useMutation()
  const [name, setName] = React.useState("")
  const [scope, setScope] = React.useState<"org" | "platform">("org")
  const [organizationId, setOrganizationId] = React.useState("")
  const [selected, setSelected] = React.useState<Permission[]>([])
  const [expiry, setExpiry] = React.useState<string>("never")

  React.useEffect(() => {
    if (!open) return
    setName("")
    setScope("org")
    setOrganizationId(defaultOrganizationId)
    setSelected([])
    setExpiry("never")
  }, [open, defaultOrganizationId])

  const pending = createKey.isPending
  const canSubmit =
    name.trim().length > 0 &&
    selected.length > 0 &&
    (scope === "platform" || Boolean(organizationId))

  function togglePermission(permission: Permission, checked: boolean) {
    setSelected((current) =>
      checked
        ? [...current, permission]
        : current.filter((entry) => entry !== permission)
    )
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    try {
      const created = await createKey.mutateAsync({
        name: name.trim(),
        organizationId: scope === "platform" ? null : organizationId,
        permissions: selected,
        expiresAt: expiryFromPreset(expiry),
      })
      toast.success("Key created")
      onOpenChange(false)
      onCreated(created.key)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't create the key."
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create an API key</DialogTitle>
          <DialogDescription>
            Choose a name, where it can be used, and the access it should have.
            The secret is shown once.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <FormField label="Name" htmlFor="api-key-name">
            <Input
              id="api-key-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              required
            />
          </FormField>
          {isPlatformAdmin ? (
            <FormField label="Scope">
              <SelectField
                value={scope}
                onValueChange={(value) =>
                  setScope(value === "platform" ? "platform" : "org")
                }
                options={[
                  { value: "org", label: "One organization" },
                  { value: "platform", label: "All organizations" },
                ]}
              />
            </FormField>
          ) : null}
          {scope === "org" ? (
            <FormField label="Organization">
              <SelectField
                value={organizationId}
                onValueChange={setOrganizationId}
                options={organizations.map((organization) => ({
                  value: organization.id,
                  label: organization.name,
                }))}
                placeholder="Choose an organization"
              />
            </FormField>
          ) : null}
          <FormField
            label="Access"
            description="A key can only grant access you already have."
          >
            <ul className="flex max-h-52 flex-col gap-2 overflow-y-auto rounded-md border border-border/80 p-3">
              {grantable.map((permission) => (
                <li key={permission}>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selected.includes(permission)}
                      onCheckedChange={(next) =>
                        togglePermission(permission, Boolean(next))
                      }
                    />
                    {permissionLabels[permission]}
                  </label>
                </li>
              ))}
            </ul>
          </FormField>
          <FormField label="Expires">
            <SelectField
              value={expiry}
              onValueChange={setExpiry}
              options={expiryPresets.map((preset) => ({
                value: preset.value,
                label: preset.label,
              }))}
            />
          </FormField>
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
              {pending ? "Creating…" : "Create key"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function ApiKeysSettingsPage() {
  const utils = trpc.useUtils()
  const { can, isPlatformAdmin, isLoading: accessLoading } = usePermissions()
  const canManage = can("organization:admin") || isPlatformAdmin
  const organizationsQuery = trpc.organizations.list.useQuery(undefined, {
    enabled: canManage,
  })
  const organizations = React.useMemo(
    () => organizationsQuery.data ?? [],
    [organizationsQuery.data]
  )
  const [organizationId, setOrganizationId] = React.useState("")
  const [formOpen, setFormOpen] = React.useState(false)
  const [revokeId, setRevokeId] = React.useState<string | null>(null)
  const [revealedSecret, setRevealedSecret] = React.useState<string | null>(
    null
  )
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    if (!organizationId && !isPlatformAdmin && organizations[0]?.id) {
      setOrganizationId(organizations[0].id)
    }
  }, [organizationId, organizations, isPlatformAdmin])

  const listInput =
    organizationId || (!isPlatformAdmin && organizations[0]?.id)
      ? { organizationId: organizationId || organizations[0]?.id }
      : undefined
  const keysQuery = trpc.apiKeys.list.useQuery(listInput, {
    enabled:
      canManage && (isPlatformAdmin || Boolean(listInput?.organizationId)),
  })
  const meQuery = trpc.access.me.useQuery(undefined, { staleTime: 60_000 })
  const grantable = React.useMemo(() => {
    const held = new Set(meQuery.data?.permissions ?? [])
    return permissions.filter((permission) => held.has(permission))
  }, [meQuery.data?.permissions])

  const revokeKey = trpc.apiKeys.revoke.useMutation()
  const keys = (keysQuery.data ?? []) as ApiKeyRow[]

  async function handleRevoke() {
    if (!revokeId) return
    try {
      await revokeKey.mutateAsync({ id: revokeId })
      await utils.apiKeys.list.invalidate()
      toast.success("Key revoked")
      setRevokeId(null)
    } catch {
      toast.error("Couldn't revoke the key.")
    }
  }

  async function copySecret() {
    if (!revealedSecret) return
    try {
      await navigator.clipboard.writeText(revealedSecret)
      setCopied(true)
      toast.success("Copied")
    } catch {
      toast.error("Couldn't copy")
    }
  }

  if (accessLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    )
  }

  if (!canManage) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          badge="Settings"
          title="API keys"
          description="Create keys for other systems that need access."
        />
        <EmptyState
          title="You don't have access"
          description="Ask an organization admin if you need to create keys."
        />
      </div>
    )
  }

  if (organizationsQuery.isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    )
  }

  if (organizations.length === 0 && !isPlatformAdmin) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          badge="Settings"
          title="API keys"
          description="Create keys for other systems that need access."
        />
        <EmptyState
          title="No organization yet"
          description="Create an organization before creating keys."
        />
      </div>
    )
  }

  const allOrgsValue = "__all__"
  const orgOptions = [
    ...(isPlatformAdmin
      ? [{ value: allOrgsValue, label: "All organizations" }]
      : []),
    ...organizations.map((organization) => ({
      value: organization.id,
      label: organization.name,
    })),
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Settings"
        title="API keys"
        description="Create keys for other systems that need access. Each secret is shown once."
        actions={
          <Button onClick={() => setFormOpen(true)}>
            <PlusIcon />
            Create key
          </Button>
        }
      />

      {orgOptions.length > 1 ? (
        <div className="max-w-sm">
          <SelectField
            aria-label="Organization"
            value={organizationId || (isPlatformAdmin ? allOrgsValue : "")}
            onValueChange={(value) =>
              setOrganizationId(value === allOrgsValue ? "" : value)
            }
            options={orgOptions}
          />
        </div>
      ) : null}

      <SectionCard
        title="Keys"
        description="Revoked keys stop working immediately and cannot be shown again."
      >
        {keysQuery.isLoading ? (
          <Skeleton className="h-32 w-full rounded-lg" />
        ) : keys.length === 0 ? (
          <EmptyState
            title="No keys yet"
            description="Create a key when another system needs access."
            bordered={false}
            action={
              <Button onClick={() => setFormOpen(true)}>
                <KeySquareIcon />
                Create key
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-2 py-2 font-medium">Name</th>
                  <th className="px-2 py-2 font-medium">Prefix</th>
                  <th className="px-2 py-2 font-medium">Scope</th>
                  <th className="px-2 py-2 font-medium">Last used</th>
                  <th className="px-2 py-2 font-medium">Expires</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => {
                  const revoked = Boolean(key.revokedAt)
                  const expired = isApiKeyExpired(key.expiresAt)
                  return (
                    <tr key={key.id} className="border-b border-border/70">
                      <td className="px-2 py-3">
                        <div className="font-medium">{key.name}</div>
                        <p className="text-xs text-muted-foreground">
                          {key.permissions
                            .slice(0, 3)
                            .map((permission) => permissionLabels[permission])
                            .join(", ")}
                          {key.permissions.length > 3
                            ? ` +${key.permissions.length - 3}`
                            : ""}
                        </p>
                      </td>
                      <td className="px-2 py-3 font-mono text-xs">
                        {key.prefix}…
                      </td>
                      <td className="px-2 py-3">
                        {key.organizationName ?? "All organizations"}
                      </td>
                      <td className="px-2 py-3 text-muted-foreground">
                        {key.lastUsedAt
                          ? formatRelativeTime(key.lastUsedAt)
                          : "Never"}
                      </td>
                      <td className="px-2 py-3 text-muted-foreground">
                        {key.expiresAt ? formatDate(key.expiresAt) : "Never"}
                      </td>
                      <td className="px-2 py-3">
                        {revoked ? (
                          <Badge variant="secondary">Revoked</Badge>
                        ) : expired ? (
                          <Badge variant="secondary">Expired</Badge>
                        ) : (
                          <Badge>Active</Badge>
                        )}
                      </td>
                      <td className="px-2 py-3 text-right">
                        {revoked ? null : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setRevokeId(key.id)}
                          >
                            Revoke
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <CreateKeyDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        organizations={organizations}
        grantable={grantable}
        isPlatformAdmin={isPlatformAdmin}
        defaultOrganizationId={organizationId || organizations[0]?.id || ""}
        onCreated={async (secret) => {
          await utils.apiKeys.list.invalidate()
          setRevealedSecret(secret)
          setCopied(false)
        }}
      />

      <ConfirmDialog
        open={Boolean(revokeId)}
        onOpenChange={(open) => {
          if (!open) setRevokeId(null)
        }}
        title="Revoke this key?"
        description="Scripts using this key will stop working. This cannot be undone."
        confirmLabel="Revoke"
        destructive
        pending={revokeKey.isPending}
        onConfirm={handleRevoke}
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
            <DialogTitle>Copy this key now</DialogTitle>
            <DialogDescription>
              This is the only time the secret is shown. Store it somewhere
              safe.
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
              Copy key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
