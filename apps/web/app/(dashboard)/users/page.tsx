"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import * as React from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { EmptyState } from "@/components/dashboard/empty-state"
import { FormField, NativeSelect } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { statusLabel } from "@/lib/dashboard"
import { cn } from "@/lib/utils"
import { trpc } from "@/lib/trpc"

const organizationRoles = ["owner", "admin", "operator", "viewer"] as const
const siteRoles = ["operator", "viewer"] as const
const membershipStatuses = ["active", "suspended"] as const

export default function UsersPage() {
  const utils = trpc.useUtils()
  const organizationsQuery = trpc.organizations.list.useQuery()
  const sitesQuery = trpc.sites.list.useQuery()
  const [selectedOrganizationId, setSelectedOrganizationId] = React.useState("")
  const [selectedMemberId, setSelectedMemberId] = React.useState("")

  const [createName, setCreateName] = React.useState("")
  const [createEmail, setCreateEmail] = React.useState("")
  const [createPassword, setCreatePassword] = React.useState("")
  const [createOrganizationRole, setCreateOrganizationRole] =
    React.useState<(typeof organizationRoles)[number]>("viewer")
  const [createSiteRole, setCreateSiteRole] =
    React.useState<(typeof siteRoles)[number]>("viewer")
  const [createSiteIds, setCreateSiteIds] = React.useState<string[]>([])

  const [editOrganizationRole, setEditOrganizationRole] =
    React.useState<(typeof organizationRoles)[number]>("viewer")
  const [editStatus, setEditStatus] =
    React.useState<(typeof membershipStatuses)[number]>("active")
  const [grantSiteId, setGrantSiteId] = React.useState("")
  const [grantSiteRole, setGrantSiteRole] =
    React.useState<(typeof siteRoles)[number]>("viewer")

  const membersQuery = trpc.access.organizationMembers.useQuery(
    { organizationId: selectedOrganizationId },
    { enabled: Boolean(selectedOrganizationId) }
  )

  const createUser = trpc.access.createUser.useMutation({
    async onSuccess() {
      await utils.access.organizationMembers.invalidate()
      setCreateName("")
      setCreateEmail("")
      setCreatePassword("")
      setCreateSiteIds([])
      toast.success("User created")
    },
    onError() {
      toast.error("We couldn't create the user.")
    },
  })

  const updateOrganizationMembership =
    trpc.access.updateOrganizationMembership.useMutation({
      async onSuccess() {
        await utils.access.organizationMembers.invalidate()
        toast.success("Membership updated")
      },
      onError() {
        toast.error("We couldn't update the membership.")
      },
    })

  const updateSiteMembership = trpc.access.updateSiteMembership.useMutation({
    async onSuccess() {
      await utils.access.organizationMembers.invalidate()
      toast.success("Site access updated")
    },
    onError() {
      toast.error("We couldn't update site access.")
    },
  })

  const organizations = React.useMemo(
    () => organizationsQuery.data ?? [],
    [organizationsQuery.data]
  )
  const sites = React.useMemo(() => sitesQuery.data ?? [], [sitesQuery.data])
  const organizationSites = React.useMemo(
    () =>
      sites.filter((site) => site.organizationId === selectedOrganizationId),
    [selectedOrganizationId, sites]
  )
  const members = React.useMemo(
    () => membersQuery.data?.members ?? [],
    [membersQuery.data]
  )

  React.useEffect(() => {
    if (organizations.length > 0 && !selectedOrganizationId) {
      setSelectedOrganizationId(organizations[0].id)
    }
  }, [organizations, selectedOrganizationId])

  React.useEffect(() => {
    if (members.length === 0) {
      setSelectedMemberId("")
      return
    }

    if (!members.some((member) => member.id === selectedMemberId)) {
      setSelectedMemberId(members[0].id)
    }
  }, [members, selectedMemberId])

  const selectedMember = React.useMemo(
    () => members.find((member) => member.id === selectedMemberId) ?? null,
    [members, selectedMemberId]
  )

  React.useEffect(() => {
    if (selectedMember) {
      setEditOrganizationRole(
        selectedMember.membership.role as (typeof organizationRoles)[number]
      )
      setEditStatus(
        selectedMember.membership.status as (typeof membershipStatuses)[number]
      )
      setGrantSiteRole("viewer")
    }
  }, [selectedMember])

  React.useEffect(() => {
    setGrantSiteId(organizationSites[0]?.id ?? "")
  }, [organizationSites])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Users"
        title="Access and memberships"
        description="Create users for an organization, adjust roles, and grant access to specific sites."
      />

      <Card>
        <CardHeader>
          <CardTitle>New user</CardTitle>
          <CardDescription>
            Create a user with a temporary password and an initial organization
            role.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <FormField label="Organization" htmlFor="user-create-organization">
            <NativeSelect
              id="user-create-organization"
              value={selectedOrganizationId}
              onChange={(event) =>
                setSelectedOrganizationId(event.target.value)
              }
            >
              <option value="">Choose an organization</option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Organization role" htmlFor="user-create-org-role">
            <NativeSelect
              id="user-create-org-role"
              value={createOrganizationRole}
              onChange={(event) =>
                setCreateOrganizationRole(
                  event.target.value as (typeof organizationRoles)[number]
                )
              }
            >
              {organizationRoles.map((role) => (
                <option key={role} value={role}>
                  {statusLabel(role)}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Name" htmlFor="user-create-name">
            <Input
              id="user-create-name"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
            />
          </FormField>
          <FormField label="Email" htmlFor="user-create-email">
            <Input
              id="user-create-email"
              type="email"
              value={createEmail}
              onChange={(event) => setCreateEmail(event.target.value)}
            />
          </FormField>
          <FormField label="Temporary password" htmlFor="user-create-password">
            <Input
              id="user-create-password"
              type="password"
              value={createPassword}
              onChange={(event) => setCreatePassword(event.target.value)}
            />
          </FormField>
          <FormField label="Initial site role" htmlFor="user-create-site-role">
            <NativeSelect
              id="user-create-site-role"
              value={createSiteRole}
              onChange={(event) =>
                setCreateSiteRole(
                  event.target.value as (typeof siteRoles)[number]
                )
              }
            >
              {siteRoles.map((role) => (
                <option key={role} value={role}>
                  {statusLabel(role)}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <div className="flex flex-col gap-3 md:col-span-2">
            <p className="text-sm font-medium">Initial site grants</p>
            {organizationSites.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No sites in this organization yet.
              </p>
            ) : (
              <div className="flex flex-wrap gap-4">
                {organizationSites.map((site) => {
                  const checked = createSiteIds.includes(site.id)

                  return (
                    <div key={site.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`user-create-site-${site.id}`}
                        checked={checked}
                        onCheckedChange={(value) => {
                          setCreateSiteIds((current) =>
                            value === true
                              ? [...current, site.id]
                              : current.filter((id) => id !== site.id)
                          )
                        }}
                      />
                      <Label
                        htmlFor={`user-create-site-${site.id}`}
                        className="text-sm font-normal"
                      >
                        {site.name}
                      </Label>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          <div className="md:col-span-2">
            <Button
              onClick={() => {
                void createUser.mutateAsync({
                  organizationId: selectedOrganizationId,
                  name: createName,
                  email: createEmail,
                  password: createPassword,
                  organizationRole: createOrganizationRole,
                  siteIds: createSiteIds,
                  siteRole: createSiteRole,
                })
              }}
              disabled={
                !selectedOrganizationId ||
                !createName ||
                !createEmail ||
                !createPassword ||
                createUser.isPending
              }
            >
              Create user
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              Choose a member to update their role or site access.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Org role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Site grants</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {membersQuery.isLoading ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-10">
                        <Skeleton className="h-5 w-40" />
                      </TableCell>
                    </TableRow>
                  ) : members.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="p-0">
                        <EmptyState
                          title="No members yet"
                          description="Create a user above to add the first member."
                          bordered={false}
                        />
                      </TableCell>
                    </TableRow>
                  ) : (
                    members.map((member) => (
                      <TableRow
                        key={member.id}
                        className={cn(
                          "cursor-pointer",
                          selectedMemberId === member.id && "bg-muted/60"
                        )}
                        onClick={() => setSelectedMemberId(member.id)}
                      >
                        <TableCell className="font-medium">
                          <div className="flex flex-col gap-1">
                            <span>{member.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {member.email}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {statusLabel(member.membership.role)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              member.membership.status === "active"
                                ? "secondary"
                                : "outline"
                            }
                          >
                            {statusLabel(member.membership.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {member.siteMemberships.length > 0
                            ? member.siteMemberships
                                .map(
                                  (site) => `${site.siteName} (${site.role})`
                                )
                                .join(", ")
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Selected member</CardTitle>
            <CardDescription>
              Change the organization role or grant access to a site.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {selectedMember ? (
              <>
                <div className="rounded-lg border bg-muted/20 p-4 text-sm">
                  <p className="font-medium">{selectedMember.name}</p>
                  <p className="text-muted-foreground">
                    {selectedMember.email}
                  </p>
                </div>

                <FormField
                  label="Organization role"
                  htmlFor={`member-org-role-${selectedMember.id}`}
                >
                  <NativeSelect
                    id={`member-org-role-${selectedMember.id}`}
                    value={editOrganizationRole}
                    onChange={(event) =>
                      setEditOrganizationRole(
                        event.target.value as (typeof organizationRoles)[number]
                      )
                    }
                  >
                    {organizationRoles.map((role) => (
                      <option key={role} value={role}>
                        {statusLabel(role)}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>

                <FormField
                  label="Status"
                  htmlFor={`member-status-${selectedMember.id}`}
                >
                  <NativeSelect
                    id={`member-status-${selectedMember.id}`}
                    value={editStatus}
                    onChange={(event) =>
                      setEditStatus(
                        event.target
                          .value as (typeof membershipStatuses)[number]
                      )
                    }
                  >
                    {membershipStatuses.map((status) => (
                      <option key={status} value={status}>
                        {statusLabel(status)}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>

                <Button
                  className="w-fit"
                  onClick={() => {
                    void updateOrganizationMembership.mutateAsync({
                      organizationId: selectedOrganizationId,
                      userId: selectedMember.id,
                      role: editOrganizationRole,
                      status: editStatus,
                    })
                  }}
                  disabled={updateOrganizationMembership.isPending}
                >
                  Save role
                </Button>

                <div className="flex flex-col gap-3 border-t pt-4">
                  <p className="text-sm font-medium">Site grant</p>
                  <div className="flex flex-col gap-3">
                    <FormField
                      label="Site"
                      htmlFor={`member-site-${selectedMember.id}`}
                    >
                      <NativeSelect
                        id={`member-site-${selectedMember.id}`}
                        value={grantSiteId}
                        onChange={(event) => setGrantSiteId(event.target.value)}
                      >
                        <option value="">Choose a site</option>
                        {organizationSites.map((site) => (
                          <option key={site.id} value={site.id}>
                            {site.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </FormField>
                    <FormField
                      label="Role"
                      htmlFor={`member-site-role-${selectedMember.id}`}
                    >
                      <NativeSelect
                        id={`member-site-role-${selectedMember.id}`}
                        value={grantSiteRole}
                        onChange={(event) =>
                          setGrantSiteRole(
                            event.target.value as (typeof siteRoles)[number]
                          )
                        }
                      >
                        {siteRoles.map((role) => (
                          <option key={role} value={role}>
                            {statusLabel(role)}
                          </option>
                        ))}
                      </NativeSelect>
                    </FormField>
                    <Button
                      variant="outline"
                      className="w-fit"
                      onClick={() => {
                        if (!grantSiteId) return

                        void updateSiteMembership.mutateAsync({
                          siteId: grantSiteId,
                          userId: selectedMember.id,
                          role: grantSiteRole,
                          status: "active",
                        })
                      }}
                      disabled={updateSiteMembership.isPending || !grantSiteId}
                    >
                      Save site grant
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Select a member to edit it.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
