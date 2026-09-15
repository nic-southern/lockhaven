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
import {
  DataTable,
  DataTableColumnHeader,
  DataTableRowActions,
} from "@/components/dashboard/data-table"
import { DetailSheet } from "@/components/dashboard/detail-sheet"
import { FormField } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { SectionCard } from "@/components/dashboard/section-card"
import { SelectField } from "@/components/dashboard/select-field"
import { statusLabel } from "@/lib/dashboard"
import { trpc } from "@/lib/trpc"
import type { ColumnDef } from "@tanstack/react-table"

const organizationRoles = ["owner", "admin", "operator", "viewer"] as const
const siteRoles = ["operator", "viewer"] as const
const membershipStatuses = ["active", "suspended"] as const

type MemberRow = {
  id: string
  name: string
  email: string
  role: string
  status: string
  siteGrants: string
  siteGrantCount: number
}

export default function UsersPage() {
  const utils = trpc.useUtils()
  const organizationsQuery = trpc.organizations.list.useQuery()
  const sitesQuery = trpc.sites.list.useQuery()
  const [selectedOrganizationId, setSelectedOrganizationId] = React.useState("")
  const [selectedMemberId, setSelectedMemberId] = React.useState("")
  const [mobileDetailOpen, setMobileDetailOpen] = React.useState(false)

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

  const rows = React.useMemo<MemberRow[]>(
    () =>
      members.map((member) => ({
        id: member.id,
        name: member.name,
        email: member.email,
        role: member.membership.role,
        status: member.membership.status,
        siteGrants:
          member.siteMemberships.length > 0
            ? member.siteMemberships
                .map((site) => `${site.siteName} (${statusLabel(site.role)})`)
                .join(", ")
            : "—",
        siteGrantCount: member.siteMemberships.length,
      })),
    [members]
  )

  const openMember = React.useCallback((id: string) => {
    setSelectedMemberId(id)
    setMobileDetailOpen(true)
  }, [])

  const columns = React.useMemo<ColumnDef<MemberRow>[]>(
    () => [
      {
        accessorKey: "name",
        meta: { label: "User" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="User" />
        ),
        cell: ({ row }) => (
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">{row.original.name}</span>
            <span className="text-xs text-muted-foreground">
              {row.original.email}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "email",
        meta: { label: "Email" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Email" />
        ),
      },
      {
        accessorKey: "role",
        meta: { label: "Org role" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Org role" />
        ),
        cell: ({ row }) => (
          <Badge variant="outline">{statusLabel(row.original.role)}</Badge>
        ),
      },
      {
        accessorKey: "status",
        meta: { label: "Status" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Status" />
        ),
        cell: ({ row }) => (
          <Badge
            variant={row.original.status === "active" ? "secondary" : "outline"}
          >
            {statusLabel(row.original.status)}
          </Badge>
        ),
      },
      {
        accessorKey: "siteGrants",
        enableSorting: false,
        meta: { label: "Site grants" },
        header: "Site grants",
        cell: ({ row }) => (
          <span className="line-clamp-1 max-w-xs text-sm text-muted-foreground">
            {row.original.siteGrants}
          </span>
        ),
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        meta: { className: "w-12" },
        cell: ({ row }) => (
          <DataTableRowActions
            label={row.original.name}
            actions={[
              {
                label: "Edit access",
                onSelect: () => openMember(row.original.id),
              },
            ]}
          />
        ),
      },
    ],
    [openMember]
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Users"
        title="Access and memberships"
        description="Create users for an organization, adjust roles, and grant access to specific sites."
      />

      <SectionCard
        title="New user"
        description="Create a user with a temporary password and an initial organization role."
        collapsibleOnMobile
        contentClassName="grid gap-4 md:grid-cols-2"
      >
        <FormField label="Organization" htmlFor="user-create-organization">
          <SelectField
            id="user-create-organization"
            value={selectedOrganizationId}
            onValueChange={setSelectedOrganizationId}
            placeholder="Choose an organization"
            options={organizations.map((organization) => ({
              value: organization.id,
              label: organization.name,
            }))}
          />
        </FormField>
        <FormField label="Organization role" htmlFor="user-create-org-role">
          <SelectField
            id="user-create-org-role"
            value={createOrganizationRole}
            onValueChange={(value) =>
              setCreateOrganizationRole(
                value as (typeof organizationRoles)[number]
              )
            }
            options={organizationRoles.map((role) => ({
              value: role,
              label: statusLabel(role),
            }))}
          />
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
          <SelectField
            id="user-create-site-role"
            value={createSiteRole}
            onValueChange={(value) =>
              setCreateSiteRole(value as (typeof siteRoles)[number])
            }
            options={siteRoles.map((role) => ({
              value: role,
              label: statusLabel(role),
            }))}
          />
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
            className="w-full sm:w-fit"
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
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              Sort and filter members, then pick one to update their role or
              site access.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={columns}
              data={rows}
              isLoading={
                membersQuery.isLoading && Boolean(selectedOrganizationId)
              }
              getRowId={(row) => row.id}
              searchPlaceholder="Search members"
              facets={[
                {
                  columnId: "role",
                  title: "Org role",
                  options: organizationRoles.map((role) => ({
                    value: role,
                    label: statusLabel(role),
                  })),
                },
                {
                  columnId: "status",
                  title: "Status",
                  options: membershipStatuses.map((status) => ({
                    value: status,
                    label: statusLabel(status),
                  })),
                },
              ]}
              initialSorting={[{ id: "name", desc: false }]}
              initialColumnVisibility={{ email: false }}
              onRowClick={(row) => openMember(row.id)}
              isRowActive={(row) => row.id === selectedMemberId}
              emptyTitle="No members yet"
              emptyDescription="Create a user above to add the first member."
            />
          </CardContent>
        </Card>

        <DetailSheet
          open={mobileDetailOpen}
          onOpenChange={setMobileDetailOpen}
          title="Selected member"
          description="Change the organization role or grant access to a site."
        >
          {selectedMember ? (
            <>
              <div className="rounded-lg border bg-muted/20 p-4 text-sm">
                <p className="font-medium">{selectedMember.name}</p>
                <p className="text-muted-foreground">{selectedMember.email}</p>
              </div>

              <FormField
                label="Organization role"
                htmlFor={`member-org-role-${selectedMember.id}`}
              >
                <SelectField
                  id={`member-org-role-${selectedMember.id}`}
                  value={editOrganizationRole}
                  onValueChange={(value) =>
                    setEditOrganizationRole(
                      value as (typeof organizationRoles)[number]
                    )
                  }
                  options={organizationRoles.map((role) => ({
                    value: role,
                    label: statusLabel(role),
                  }))}
                />
              </FormField>

              <FormField
                label="Status"
                htmlFor={`member-status-${selectedMember.id}`}
              >
                <SelectField
                  id={`member-status-${selectedMember.id}`}
                  value={editStatus}
                  onValueChange={(value) =>
                    setEditStatus(value as (typeof membershipStatuses)[number])
                  }
                  options={membershipStatuses.map((status) => ({
                    value: status,
                    label: statusLabel(status),
                  }))}
                />
              </FormField>

              <Button
                className="w-full sm:w-fit"
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
                    <SelectField
                      id={`member-site-${selectedMember.id}`}
                      value={grantSiteId}
                      onValueChange={setGrantSiteId}
                      placeholder="Choose a site"
                      options={organizationSites.map((site) => ({
                        value: site.id,
                        label: site.name,
                      }))}
                    />
                  </FormField>
                  <FormField
                    label="Role"
                    htmlFor={`member-site-role-${selectedMember.id}`}
                  >
                    <SelectField
                      id={`member-site-role-${selectedMember.id}`}
                      value={grantSiteRole}
                      onValueChange={(value) =>
                        setGrantSiteRole(value as (typeof siteRoles)[number])
                      }
                      options={siteRoles.map((role) => ({
                        value: role,
                        label: statusLabel(role),
                      }))}
                    />
                  </FormField>
                  <Button
                    variant="outline"
                    className="w-full sm:w-fit"
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
        </DetailSheet>
      </div>
    </div>
  )
}
