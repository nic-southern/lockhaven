"use client"

import * as React from "react"
import {
  CheckIcon,
  CopyIcon,
  FingerprintIcon,
  KeyRoundIcon,
  LaptopIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog"
import { SelectField } from "@/components/dashboard/select-field"
import { formatDate, formatRelativeTime, statusLabel } from "@/lib/dashboard"
import { trpc } from "@/lib/trpc"
import {
  organizationRoles,
  platformRoles,
  siteRoles,
  type OrganizationRole,
  type PlatformRole,
  type SiteRole,
} from "@nms/shared"

import {
  labelForOrganizationRole,
  labelForPlatformRole,
  labelForSiteRole,
  organizationRoleLabels,
  platformRoleLabels,
  siteRoleLabels,
} from "./role-labels"

const NO_ACCESS = "__none"

type ConfirmAction =
  | "suspend"
  | "reactivate"
  | "resetTwoFactor"
  | "forcePasswordReset"
  | "revokeSessions"

function describeUserAgent(value: string | null | undefined) {
  if (!value) return "Unknown browser"
  const browser = /Edg\//.test(value)
    ? "Edge"
    : /Chrome\//.test(value)
      ? "Chrome"
      : /Firefox\//.test(value)
        ? "Firefox"
        : /Safari\//.test(value)
          ? "Safari"
          : "Browser"
  const os = /Windows/.test(value)
    ? "Windows"
    : /Mac OS X/.test(value)
      ? "macOS"
      : /iPhone|iPad/.test(value)
        ? "iOS"
        : /Android/.test(value)
          ? "Android"
          : /Linux/.test(value)
            ? "Linux"
            : null
  return os ? `${browser} on ${os}` : browser
}

function eventLabel(eventType: string) {
  return statusLabel(eventType.replace(/^admin_/, "").replace(/_/g, " "))
}

export function UserDetailSheet({
  userId,
  open,
  onOpenChange,
  currentUserId,
  currentPlatformRole,
  onChanged,
}: {
  userId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  currentUserId: string | undefined
  currentPlatformRole: PlatformRole | undefined
  onChanged: () => void
}) {
  const utils = trpc.useUtils()
  const detail = trpc.users.get.useQuery(
    { userId: userId ?? "" },
    { enabled: open && Boolean(userId) }
  )
  const organizationsQuery = trpc.users.assignableOrganizations.useQuery(
    undefined,
    { enabled: open }
  )

  const [confirm, setConfirm] = React.useState<ConfirmAction | null>(null)
  const [temporaryPassword, setTemporaryPassword] = React.useState<
    string | null
  >(null)
  const [copied, setCopied] = React.useState(false)

  const refresh = React.useCallback(async () => {
    await Promise.all([
      utils.users.get.invalidate({ userId: userId ?? "" }),
      utils.users.list.invalidate(),
      utils.users.summary.invalidate(),
    ])
    onChanged()
  }, [onChanged, userId, utils])

  const mutationOptions = (success: string) => ({
    async onSuccess() {
      toast.success(success)
      await refresh()
    },
    onError(error: { message?: string }) {
      toast.error(error.message || "We couldn't apply that change.")
    },
  })

  const updatePlatformRole = trpc.users.updatePlatformRole.useMutation(
    mutationOptions("Platform role updated")
  )
  const setOrganizationRole = trpc.users.setOrganizationRole.useMutation(
    mutationOptions("Organization access updated")
  )
  const setSiteRoles = trpc.users.setSiteRoles.useMutation(
    mutationOptions("Site access updated")
  )
  const suspend = trpc.users.suspend.useMutation(
    mutationOptions("User suspended")
  )
  const reactivate = trpc.users.reactivate.useMutation(
    mutationOptions("User reactivated")
  )
  const resetTwoFactor = trpc.users.resetTwoFactor.useMutation(
    mutationOptions("Two-step verification reset")
  )
  const revokeSessions = trpc.users.revokeSessions.useMutation(
    mutationOptions("Signed out everywhere")
  )
  const revokeSession = trpc.users.revokeSession.useMutation(
    mutationOptions("Session signed out")
  )
  const forcePasswordReset = trpc.users.forcePasswordReset.useMutation({
    async onSuccess(result) {
      setTemporaryPassword(result.temporaryPassword)
      await refresh()
    },
    onError(error) {
      toast.error(error.message || "We couldn't reset the password.")
    },
  })

  const user = detail.data
  const organizations = organizationsQuery.data ?? []
  const isSelf = user?.id === currentUserId
  const isOwner = currentPlatformRole === "owner"
  const busy =
    updatePlatformRole.isPending ||
    setOrganizationRole.isPending ||
    setSiteRoles.isPending ||
    suspend.isPending ||
    reactivate.isPending ||
    resetTwoFactor.isPending ||
    revokeSessions.isPending ||
    forcePasswordReset.isPending

  const isPlatformWide = user?.platformRole !== "member"

  function runConfirm() {
    if (!user || !confirm) return
    const input = { userId: user.id }
    switch (confirm) {
      case "suspend":
        suspend.mutate(input)
        break
      case "reactivate":
        reactivate.mutate(input)
        break
      case "resetTwoFactor":
        resetTwoFactor.mutate(input)
        break
      case "forcePasswordReset":
        forcePasswordReset.mutate(input)
        break
      case "revokeSessions":
        revokeSessions.mutate(input)
        break
    }
    setConfirm(null)
  }

  const confirmCopy: Record<
    ConfirmAction,
    { title: string; description: string; label: string; destructive: boolean }
  > = {
    suspend: {
      title: "Suspend this user?",
      description:
        "They'll be signed out everywhere and won't be able to sign in until reactivated. Their roles are kept.",
      label: "Suspend",
      destructive: true,
    },
    reactivate: {
      title: "Reactivate this user?",
      description:
        "They'll be able to sign in again with their existing roles.",
      label: "Reactivate",
      destructive: false,
    },
    resetTwoFactor: {
      title: "Reset two-step verification?",
      description:
        "Their authenticator app, backup codes, and passkeys are removed and every session is signed out. They'll set up two-step verification again at next sign-in.",
      label: "Reset",
      destructive: true,
    },
    forcePasswordReset: {
      title: "Reset their password?",
      description:
        "A temporary password is generated and shown to you once. Every session is signed out and they must choose a new password at next sign-in.",
      label: "Generate temporary password",
      destructive: true,
    },
    revokeSessions: {
      title: "Sign out everywhere?",
      description: "All of their active sessions end immediately.",
      label: "Sign out",
      destructive: false,
    },
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <SheetHeader className="border-b border-border/70 px-6 py-5">
          {user ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <SheetTitle className="truncate">{user.name}</SheetTitle>
                  <SheetDescription className="truncate">
                    {user.email}
                  </SheetDescription>
                </div>
                <Badge
                  variant={user.status === "active" ? "secondary" : "outline"}
                  className="shrink-0"
                >
                  {statusLabel(user.status)}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <Badge variant="outline">
                  {labelForPlatformRole(user.platformRole)}
                </Badge>
                {user.twoFactorEnabled ? (
                  <Badge className="gap-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                    <ShieldCheckIcon className="size-3" />
                    Two-step on
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="gap-1 text-amber-700 dark:text-amber-300"
                  >
                    <ShieldOffIcon className="size-3" />
                    Two-step pending
                  </Badge>
                )}
                {user.passkeys.length > 0 ? (
                  <Badge variant="outline" className="gap-1">
                    <FingerprintIcon className="size-3" />
                    {user.passkeys.length}{" "}
                    {user.passkeys.length === 1 ? "passkey" : "passkeys"}
                  </Badge>
                ) : null}
                {user.mustChangePassword ? (
                  <Badge variant="outline" className="gap-1">
                    <KeyRoundIcon className="size-3" />
                    Password reset pending
                  </Badge>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-56" />
            </>
          )}
        </SheetHeader>

        {user ? (
          <Tabs defaultValue="access" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="mx-6 mt-4 w-fit">
              <TabsTrigger value="access">Access</TabsTrigger>
              <TabsTrigger value="security">Security</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <TabsContent value="access" className="mt-0 flex flex-col gap-6">
                {isOwner ? (
                  <section className="flex flex-col gap-2">
                    <h3 className="text-sm font-medium">Platform role</h3>
                    <p className="text-xs text-muted-foreground">
                      Owners and admins see every organization. Members only see
                      what they are granted below.
                    </p>
                    <SelectField
                      value={user.platformRole}
                      onValueChange={(value) =>
                        updatePlatformRole.mutate({
                          userId: user.id,
                          role: value as PlatformRole,
                        })
                      }
                      disabled={
                        busy || (isSelf && user.platformRole === "owner")
                      }
                      aria-label="Platform role"
                      options={platformRoles.map((role) => ({
                        value: role,
                        label: platformRoleLabels[role],
                      }))}
                    />
                  </section>
                ) : (
                  <section className="flex flex-col gap-1">
                    <h3 className="text-sm font-medium">Platform role</h3>
                    <p className="text-sm text-muted-foreground">
                      {labelForPlatformRole(user.platformRole)}
                    </p>
                  </section>
                )}

                {isPlatformWide ? (
                  <p className="rounded-lg border border-border/80 bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
                    This user has access to every organization and site through
                    their platform role. Organization and site grants are not
                    needed.
                  </p>
                ) : (
                  <section className="flex flex-col gap-3">
                    <div>
                      <h3 className="text-sm font-medium">
                        Organizations and sites
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        An organization role applies to every site in it. Site
                        roles grant access to specific sites only.
                      </p>
                    </div>
                    {organizations.length === 0 ? (
                      <Skeleton className="h-16 w-full" />
                    ) : (
                      organizations.map((organization) => {
                        const membership = user.organizationMemberships.find(
                          (entry) => entry.organizationId === organization.id
                        )
                        const siteGrants = user.siteMemberships.filter(
                          (entry) => entry.organizationId === organization.id
                        )
                        return (
                          <OrganizationAccessEditor
                            key={organization.id}
                            organization={organization}
                            membershipRole={membership?.role ?? null}
                            siteGrants={siteGrants.map((entry) => ({
                              siteId: entry.siteId,
                              role: entry.role,
                            }))}
                            disabled={busy}
                            onRoleChange={(role) =>
                              setOrganizationRole.mutate({
                                userId: user.id,
                                organizationId: organization.id,
                                role,
                              })
                            }
                            onSiteGrantsChange={(grants) =>
                              setSiteRoles.mutate({
                                userId: user.id,
                                organizationId: organization.id,
                                grants,
                              })
                            }
                          />
                        )
                      })
                    )}
                  </section>
                )}

                <section className="flex flex-col gap-2 border-t border-border/70 pt-5">
                  <h3 className="text-sm font-medium">Account status</h3>
                  <div className="flex flex-wrap items-center gap-2">
                    {user.status === "active" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy || isSelf}
                        onClick={() => setConfirm("suspend")}
                      >
                        Suspend user
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => setConfirm("reactivate")}
                      >
                        Reactivate user
                      </Button>
                    )}
                    <span className="text-xs text-muted-foreground">
                      Joined {formatDate(user.createdAt)}
                      {user.disabledAt
                        ? ` · Suspended ${formatDate(user.disabledAt)}`
                        : ""}
                    </span>
                  </div>
                </section>
              </TabsContent>

              <TabsContent
                value="security"
                className="mt-0 flex flex-col gap-6"
              >
                <section className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-border/80 p-3">
                    <p className="text-xs text-muted-foreground">
                      Last sign-in
                    </p>
                    <p className="mt-1 text-sm font-medium">
                      {user.lastLoginAt
                        ? formatRelativeTime(user.lastLoginAt)
                        : "Never"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/80 p-3">
                    <p className="text-xs text-muted-foreground">
                      Two-step verification
                    </p>
                    <p className="mt-1 text-sm font-medium">
                      {user.twoFactorEnabled
                        ? `Enabled ${user.twoFactorEnforcedAt ? formatRelativeTime(user.twoFactorEnforcedAt) : ""}`
                        : "Not set up yet"}
                    </p>
                  </div>
                </section>

                <section className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium">Passkeys</h3>
                  {user.passkeys.length === 0 ? (
                    <p className="text-sm text-muted-foreground">None added.</p>
                  ) : (
                    <ul className="divide-y divide-border/70 rounded-lg border border-border/80">
                      {user.passkeys.map((entry) => (
                        <li
                          key={entry.id}
                          className="flex items-center gap-3 px-3 py-2 text-sm"
                        >
                          <FingerprintIcon className="size-4 text-muted-foreground" />
                          <span className="flex-1 truncate">
                            {entry.name || "Passkey"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(entry.createdAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-medium">Active sessions</h3>
                    {user.sessions.length > 0 ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => setConfirm("revokeSessions")}
                      >
                        Sign out everywhere
                      </Button>
                    ) : null}
                  </div>
                  {user.sessions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No active sessions.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border/70 rounded-lg border border-border/80">
                      {user.sessions.map((entry) => (
                        <li
                          key={entry.id}
                          className="flex items-center justify-between gap-3 px-3 py-2"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <LaptopIcon className="size-4 shrink-0 text-muted-foreground" />
                            <div className="min-w-0">
                              <p className="truncate text-sm">
                                {describeUserAgent(entry.userAgent)}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {entry.ipAddress ?? "Unknown address"} · Active{" "}
                                {formatRelativeTime(entry.updatedAt)}
                              </p>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy || revokeSession.isPending}
                            onClick={() =>
                              revokeSession.mutate({
                                userId: user.id,
                                sessionId: entry.id,
                              })
                            }
                          >
                            Sign out
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="flex flex-col gap-3 border-t border-border/70 pt-5">
                  <h3 className="text-sm font-medium">Recovery</h3>
                  {temporaryPassword ? (
                    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                      <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
                        Temporary password — shown once
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <code className="flex-1 font-mono text-sm break-all">
                          {temporaryPassword}
                        </code>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          aria-label="Copy temporary password"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(
                                temporaryPassword
                              )
                              setCopied(true)
                              window.setTimeout(() => setCopied(false), 1600)
                            } catch {
                              toast.error("Couldn't copy")
                            }
                          }}
                        >
                          {copied ? <CheckIcon /> : <CopyIcon />}
                        </Button>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Share it securely. They must replace it at next sign-in.
                      </p>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => setConfirm("forcePasswordReset")}
                    >
                      <KeyRoundIcon />
                      Reset password
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || isSelf}
                      onClick={() => setConfirm("resetTwoFactor")}
                    >
                      <ShieldOffIcon />
                      Reset two-step verification
                    </Button>
                  </div>
                </section>
              </TabsContent>

              <TabsContent value="activity" className="mt-0">
                {user.recentActivity.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No recent activity.
                  </p>
                ) : (
                  <ol className="relative flex flex-col gap-4 border-l border-border/70 pl-4">
                    {user.recentActivity.map((entry) => {
                      const data = entry.eventData as Record<string, unknown>
                      const ip =
                        typeof data.ipAddress === "string"
                          ? data.ipAddress
                          : null
                      return (
                        <li key={entry.id} className="relative">
                          <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-background bg-muted-foreground/50" />
                          <p className="text-sm font-medium">
                            {eventLabel(entry.eventType)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(entry.createdAt)}
                            {ip ? ` · ${ip}` : ""}
                          </p>
                        </li>
                      )
                    })}
                  </ol>
                )}
              </TabsContent>
            </div>
          </Tabs>
        ) : (
          <div className="flex flex-col gap-3 px-6 py-5">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}

        <ConfirmDialog
          open={Boolean(confirm)}
          onOpenChange={(next) => {
            if (!next) setConfirm(null)
          }}
          title={confirm ? confirmCopy[confirm].title : ""}
          description={confirm ? confirmCopy[confirm].description : ""}
          confirmLabel={confirm ? confirmCopy[confirm].label : "Continue"}
          destructive={confirm ? confirmCopy[confirm].destructive : false}
          pending={busy}
          onConfirm={runConfirm}
        />
      </SheetContent>
    </Sheet>
  )
}

function OrganizationAccessEditor({
  organization,
  membershipRole,
  siteGrants,
  disabled,
  onRoleChange,
  onSiteGrantsChange,
}: {
  organization: {
    id: string
    name: string
    sites: Array<{ id: string; name: string }>
  }
  membershipRole: string | null
  siteGrants: Array<{ siteId: string; role: string }>
  disabled: boolean
  onRoleChange: (role: OrganizationRole | null) => void
  onSiteGrantsChange: (
    grants: Array<{ siteId: string; role: SiteRole }>
  ) => void
}) {
  const [expanded, setExpanded] = React.useState(
    siteGrants.length > 0 || membershipRole === null
  )
  const grantMap = new Map(
    siteGrants.map((grant) => [grant.siteId, grant.role])
  )

  function updateGrant(siteId: string, role: SiteRole | null) {
    const next = new Map(grantMap)
    if (role) {
      next.set(siteId, role)
    } else {
      next.delete(siteId)
    }
    onSiteGrantsChange(
      [...next.entries()].map(([id, value]) => ({
        siteId: id,
        role: value as SiteRole,
      }))
    )
  }

  return (
    <div className="rounded-lg border border-border/80">
      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{organization.name}</p>
          <p className="text-xs text-muted-foreground">
            {membershipRole
              ? `${labelForOrganizationRole(membershipRole)} · all sites`
              : siteGrants.length > 0
                ? `${siteGrants.length} ${siteGrants.length === 1 ? "site" : "sites"}`
                : "No access"}
          </p>
        </div>
        <SelectField
          value={membershipRole ?? NO_ACCESS}
          onValueChange={(value) =>
            onRoleChange(
              value === NO_ACCESS ? null : (value as OrganizationRole)
            )
          }
          disabled={disabled}
          size="sm"
          className="h-8 w-44"
          aria-label={`Role in ${organization.name}`}
          options={[
            { value: NO_ACCESS, label: "No organization role" },
            ...organizationRoles.map((role) => ({
              value: role,
              label: organizationRoleLabels[role],
            })),
          ]}
        />
      </div>
      {organization.sites.length > 0 ? (
        <div className="border-t border-border/70">
          <button
            type="button"
            className="flex w-full items-center justify-between px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setExpanded((value) => !value)}
          >
            <span>
              Site grants
              {siteGrants.length > 0 ? ` (${siteGrants.length})` : ""}
            </span>
            <span>{expanded ? "Hide" : "Show"}</span>
          </button>
          {expanded ? (
            <ul className="divide-y divide-border/70 border-t border-border/70">
              {organization.sites.map((site) => {
                const role = grantMap.get(site.id) ?? null
                return (
                  <li
                    key={site.id}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-sm">
                      <Checkbox
                        checked={role !== null}
                        disabled={disabled}
                        onCheckedChange={(next) =>
                          updateGrant(site.id, next ? "technician" : null)
                        }
                      />
                      <span className="truncate">{site.name}</span>
                    </label>
                    {role ? (
                      <SelectField
                        value={role}
                        onValueChange={(value) =>
                          updateGrant(site.id, value as SiteRole)
                        }
                        disabled={disabled}
                        size="sm"
                        className="h-8 w-32"
                        aria-label={`Role at ${site.name}`}
                        options={siteRoles.map((entry) => ({
                          value: entry,
                          label: siteRoleLabels[entry],
                        }))}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {membershipRole
                          ? labelForOrganizationRole(membershipRole)
                          : labelForSiteRole("viewer") === "Viewer"
                            ? "—"
                            : "—"}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
