"use client"

import * as React from "react"
import { CheckIcon, CopyIcon, MailPlusIcon } from "lucide-react"
import { toast } from "sonner"

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
import { FormField } from "@/components/dashboard/form-field"
import { SelectField } from "@/components/dashboard/select-field"
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
  organizationRoleDescriptions,
  organizationRoleLabels,
  platformRoleLabels,
  siteRoleDescriptions,
  siteRoleLabels,
} from "./role-labels"

const NO_ORG_ROLE = "__none"

export function buildInviteUrl(token: string) {
  const origin = typeof window !== "undefined" ? window.location.origin : ""
  return `${origin}/accept-invite?token=${encodeURIComponent(token)}`
}

export function InviteUserDialog({
  open,
  onOpenChange,
  canAssignPlatformRoles,
  onInvited,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  canAssignPlatformRoles: boolean
  onInvited?: () => void
}) {
  const organizationsQuery = trpc.users.assignableOrganizations.useQuery(
    undefined,
    { enabled: open }
  )
  const invite = trpc.users.invite.useMutation()

  const [email, setEmail] = React.useState("")
  const [name, setName] = React.useState("")
  const [platformRole, setPlatformRole] = React.useState<PlatformRole>("member")
  const [organizationRole, setOrganizationRole] = React.useState<
    OrganizationRole | typeof NO_ORG_ROLE
  >("technician")
  const [siteGrants, setSiteGrants] = React.useState<Record<string, SiteRole>>(
    {}
  )
  const [defaultSiteRole, setDefaultSiteRole] =
    React.useState<SiteRole>("technician")
  const [result, setResult] = React.useState<{ token: string } | null>(null)
  const [copied, setCopied] = React.useState(false)

  const organizations = organizationsQuery.data ?? []
  // Default to the first organization until the user picks one explicitly.
  const [organizationOverride, setOrganizationOverride] = React.useState("")
  const organizationId = organizationOverride || organizations[0]?.id || ""
  const setOrganizationId = setOrganizationOverride
  const selectedOrganization = organizations.find(
    (organization) => organization.id === organizationId
  )

  function reset() {
    setEmail("")
    setName("")
    setPlatformRole("member")
    setOrganizationOverride("")
    setOrganizationRole("technician")
    setSiteGrants({})
    setResult(null)
    setCopied(false)
  }

  const isPlatformWide = platformRole !== "member"
  const grants = Object.entries(siteGrants).map(([siteId, role]) => ({
    siteId,
    role,
  }))
  const canSubmit =
    email.trim().length > 3 &&
    name.trim().length > 0 &&
    (isPlatformWide ||
      (organizationId &&
        (organizationRole !== NO_ORG_ROLE || grants.length > 0)))

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    try {
      const response = await invite.mutateAsync({
        email: email.trim(),
        name: name.trim(),
        platformRole,
        organizationId: isPlatformWide ? null : organizationId || null,
        organizationRole:
          isPlatformWide || organizationRole === NO_ORG_ROLE
            ? null
            : organizationRole,
        siteGrants: isPlatformWide ? [] : grants,
      })
      setResult({ token: response.token })
      onInvited?.()
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "We couldn't create the invitation."
      )
    }
  }

  async function copyLink() {
    if (!result) return
    try {
      await navigator.clipboard.writeText(buildInviteUrl(result.token))
      setCopied(true)
      toast.success("Invitation link copied")
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      toast.error("Couldn't copy")
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>Invitation ready</DialogTitle>
              <DialogDescription>
                Share this link with {name.trim() || email}. It works once and
                expires in 7 days. They&apos;ll create a password and set up
                two-step verification when they open it.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <div className="rounded-lg border border-border/80 bg-muted/40 p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Invitation link
                </p>
                <p className="mt-1 font-mono text-xs break-all">
                  {buildInviteUrl(result.token)}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                For security, this link is only shown once. If it&apos;s lost,
                revoke the invitation and send a new one.
              </p>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  onOpenChange(false)
                  reset()
                }}
              >
                Done
              </Button>
              <Button onClick={copyLink}>
                {copied ? <CheckIcon /> : <CopyIcon />}
                Copy link
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form className="flex flex-col gap-5" onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>Invite a user</DialogTitle>
              <DialogDescription>
                Choose what they can see and do. You can adjust access later.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Name" htmlFor="invite-name">
                <Input
                  id="invite-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="off"
                  required
                />
              </FormField>
              <FormField label="Email" htmlFor="invite-email">
                <Input
                  id="invite-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="off"
                  required
                />
              </FormField>
            </div>

            {canAssignPlatformRoles ? (
              <FormField
                label="Platform role"
                htmlFor="invite-platform-role"
                description={
                  isPlatformWide
                    ? "Platform roles see every organization and site."
                    : "Members only see the organizations and sites you grant below."
                }
              >
                <SelectField
                  id="invite-platform-role"
                  value={platformRole}
                  onValueChange={(value) =>
                    setPlatformRole(value as PlatformRole)
                  }
                  options={platformRoles.map((role) => ({
                    value: role,
                    label: platformRoleLabels[role],
                  }))}
                />
              </FormField>
            ) : null}

            {!isPlatformWide ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Organization" htmlFor="invite-organization">
                    <SelectField
                      id="invite-organization"
                      value={organizationId}
                      onValueChange={(value) => {
                        setOrganizationId(value)
                        setSiteGrants({})
                      }}
                      placeholder="Choose an organization"
                      options={organizations.map((organization) => ({
                        value: organization.id,
                        label: organization.name,
                      }))}
                    />
                  </FormField>
                  <FormField
                    label="Organization role"
                    htmlFor="invite-org-role"
                    description={
                      organizationRole === NO_ORG_ROLE
                        ? "Access comes only from the site grants below."
                        : organizationRoleDescriptions[organizationRole]
                    }
                  >
                    <SelectField
                      id="invite-org-role"
                      value={organizationRole}
                      onValueChange={(value) =>
                        setOrganizationRole(
                          value as OrganizationRole | typeof NO_ORG_ROLE
                        )
                      }
                      options={[
                        ...organizationRoles.map((role) => ({
                          value: role,
                          label: organizationRoleLabels[role],
                        })),
                        { value: NO_ORG_ROLE, label: "Specific sites only" },
                      ]}
                    />
                  </FormField>
                </div>

                {selectedOrganization ? (
                  <div className="flex flex-col gap-3 rounded-lg border border-border/80 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">Site grants</p>
                        <p className="text-xs text-muted-foreground">
                          {organizationRole === NO_ORG_ROLE
                            ? "Pick the sites this person can work with."
                            : "Optional. Site roles add to the organization role."}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          Default role
                        </span>
                        <SelectField
                          value={defaultSiteRole}
                          onValueChange={(value) =>
                            setDefaultSiteRole(value as SiteRole)
                          }
                          size="sm"
                          className="h-8 w-32"
                          aria-label="Default site role"
                          options={siteRoles.map((role) => ({
                            value: role,
                            label: siteRoleLabels[role],
                          }))}
                        />
                      </div>
                    </div>
                    {selectedOrganization.sites.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        This organization has no sites yet.
                      </p>
                    ) : (
                      <ul className="flex max-h-56 flex-col divide-y divide-border/70 overflow-y-auto rounded-md border border-border/70">
                        {selectedOrganization.sites.map((site) => {
                          const checked = site.id in siteGrants
                          return (
                            <li
                              key={site.id}
                              className="flex items-center justify-between gap-3 px-3 py-2"
                            >
                              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-sm">
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={(next) => {
                                    setSiteGrants((current) => {
                                      const copy = { ...current }
                                      if (next) {
                                        copy[site.id] = defaultSiteRole
                                      } else {
                                        delete copy[site.id]
                                      }
                                      return copy
                                    })
                                  }}
                                />
                                <span className="truncate">{site.name}</span>
                              </label>
                              {checked ? (
                                <SelectField
                                  value={siteGrants[site.id]}
                                  onValueChange={(value) =>
                                    setSiteGrants((current) => ({
                                      ...current,
                                      [site.id]: value as SiteRole,
                                    }))
                                  }
                                  size="sm"
                                  className="h-8 w-32"
                                  aria-label={`Role at ${site.name}`}
                                  options={siteRoles.map((role) => ({
                                    value: role,
                                    label: siteRoleLabels[role],
                                    description: siteRoleDescriptions[role],
                                  }))}
                                />
                              ) : null}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                ) : null}
              </>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={invite.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit || invite.isPending}>
                <MailPlusIcon />
                {invite.isPending ? "Creating…" : "Create invitation"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
