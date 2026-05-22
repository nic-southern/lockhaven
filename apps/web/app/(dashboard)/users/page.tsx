"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import * as React from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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

const organizationRoles = ["owner", "admin", "operator", "viewer"] as const
const siteRoles = ["operator", "viewer"] as const

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

  const membersQuery = trpc.access.organizationMembers.useQuery(
    { organizationId: selectedOrganizationId },
    { enabled: Boolean(selectedOrganizationId) }
  )

  const createUser = trpc.access.createUser.useMutation({
    async onSuccess() {
      await utils.access.organizationMembers.invalidate()
    },
  })

  const updateOrganizationMembership =
    trpc.access.updateOrganizationMembership.useMutation({
      async onSuccess() {
        await utils.access.organizationMembers.invalidate()
      },
    })

  const updateSiteMembership = trpc.access.updateSiteMembership.useMutation({
    async onSuccess() {
      await utils.access.organizationMembers.invalidate()
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

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-2">
        <Badge variant="outline" className="w-fit">
          Users
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight">
          Access and memberships
        </h1>
        <p className="text-sm text-muted-foreground">
          Create users for an organization, adjust roles, and grant access to
          specific sites.
        </p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>New user</CardTitle>
          <CardDescription>
            Create a user with a temporary password and an initial organization
            role.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Organization</span>
            <select
              className="h-10 rounded-md border bg-background px-3"
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
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Organization role</span>
            <select
              className="h-10 rounded-md border bg-background px-3"
              value={createOrganizationRole}
              onChange={(event) =>
                setCreateOrganizationRole(
                  event.target.value as (typeof organizationRoles)[number]
                )
              }
            >
              {organizationRoles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Name</span>
            <input
              className="h-10 rounded-md border bg-background px-3"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
            />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Email</span>
            <input
              className="h-10 rounded-md border bg-background px-3"
              type="email"
              value={createEmail}
              onChange={(event) => setCreateEmail(event.target.value)}
            />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Temporary password</span>
            <input
              className="h-10 rounded-md border bg-background px-3"
              type="password"
              value={createPassword}
              onChange={(event) => setCreatePassword(event.target.value)}
            />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Initial site role</span>
            <select
              className="h-10 rounded-md border bg-background px-3"
              value={createSiteRole}
              onChange={(event) =>
                setCreateSiteRole(
                  event.target.value as (typeof siteRoles)[number]
                )
              }
            >
              {siteRoles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 md:col-span-2">
            <p className="text-sm font-medium">Initial site grants</p>
            <div className="flex flex-wrap gap-3">
              {organizationSites.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No sites in this organization yet.
                </p>
              ) : (
                organizationSites.map((site) => {
                  const checked = createSiteIds.includes(site.id)

                  return (
                    <label
                      key={site.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          setCreateSiteIds((current) =>
                            event.target.checked
                              ? [...current, site.id]
                              : current.filter((id) => id !== site.id)
                          )
                        }}
                      />
                      {site.name}
                    </label>
                  )
                })
              )}
            </div>
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
                setCreateName("")
                setCreateEmail("")
                setCreatePassword("")
                setCreateSiteIds([])
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
                      <TableCell colSpan={4} className="py-8 text-center">
                        <Skeleton className="h-5 w-40" />
                      </TableCell>
                    </TableRow>
                  ) : members.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="py-8 text-center text-muted-foreground"
                      >
                        No members yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    members.map((member) => (
                      <TableRow
                        key={member.id}
                        className={
                          selectedMemberId === member.id
                            ? "bg-muted/60"
                            : undefined
                        }
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
                        <TableCell>{member.membership.role}</TableCell>
                        <TableCell>{member.membership.status}</TableCell>
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
          <CardContent className="space-y-4">
            {selectedMember ? (
              <>
                <div className="rounded-lg border bg-muted/20 p-4 text-sm">
                  <p className="font-medium">{selectedMember.name}</p>
                  <p className="text-muted-foreground">
                    {selectedMember.email}
                  </p>
                </div>

                <label className="grid gap-2 text-sm">
                  <span className="font-medium">Organization role</span>
                  <select
                    className="h-10 rounded-md border bg-background px-3"
                    defaultValue={selectedMember.membership.role}
                    id={`organization-role-${selectedMember.id}`}
                  >
                    {organizationRoles.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-2 text-sm">
                  <span className="font-medium">Status</span>
                  <select
                    className="h-10 rounded-md border bg-background px-3"
                    defaultValue={selectedMember.membership.status}
                    id={`organization-status-${selectedMember.id}`}
                  >
                    <option value="active">active</option>
                    <option value="suspended">suspended</option>
                  </select>
                </label>

                <Button
                  onClick={() => {
                    const role = (
                      document.getElementById(
                        `organization-role-${selectedMember.id}`
                      ) as HTMLSelectElement | null
                    )?.value as (typeof organizationRoles)[number]
                    const status = (
                      document.getElementById(
                        `organization-status-${selectedMember.id}`
                      ) as HTMLSelectElement | null
                    )?.value as "active" | "suspended"

                    if (!role || !status) {
                      return
                    }

                    void updateOrganizationMembership.mutateAsync({
                      organizationId: selectedOrganizationId,
                      userId: selectedMember.id,
                      role,
                      status,
                    })
                  }}
                  disabled={updateOrganizationMembership.isPending}
                >
                  Save role
                </Button>

                <div className="space-y-3 border-t pt-4">
                  <p className="text-sm font-medium">Site grant</p>
                  <div className="grid gap-3">
                    <label className="grid gap-2 text-sm">
                      <span className="font-medium">Site</span>
                      <select
                        className="h-10 rounded-md border bg-background px-3"
                        id={`site-id-${selectedMember.id}`}
                        defaultValue={organizationSites[0]?.id ?? ""}
                      >
                        <option value="">Choose a site</option>
                        {organizationSites.map((site) => (
                          <option key={site.id} value={site.id}>
                            {site.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-2 text-sm">
                      <span className="font-medium">Role</span>
                      <select
                        className="h-10 rounded-md border bg-background px-3"
                        id={`site-role-${selectedMember.id}`}
                        defaultValue="viewer"
                      >
                        {siteRoles.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Button
                      variant="outline"
                      onClick={() => {
                        const siteId = (
                          document.getElementById(
                            `site-id-${selectedMember.id}`
                          ) as HTMLSelectElement | null
                        )?.value
                        const role = (
                          document.getElementById(
                            `site-role-${selectedMember.id}`
                          ) as HTMLSelectElement | null
                        )?.value as (typeof siteRoles)[number]

                        if (!siteId || !role) {
                          return
                        }

                        void updateSiteMembership.mutateAsync({
                          siteId,
                          userId: selectedMember.id,
                          role,
                          status: "active",
                        })
                      }}
                      disabled={updateSiteMembership.isPending}
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
