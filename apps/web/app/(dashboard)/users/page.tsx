"use client"

import * as React from "react"
import type {
  ColumnDef,
  ColumnFiltersState,
  PaginationState,
  SortingState,
} from "@tanstack/react-table"
import { keepPreviousData } from "@tanstack/react-query"
import {
  FingerprintIcon,
  MailPlusIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
} from "lucide-react"
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
import { AccessDenied } from "@/components/dashboard/access-denied"
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog"
import {
  DataTable,
  DataTableColumnHeader,
  DataTableRowActions,
} from "@/components/dashboard/data-table"
import { PageHeader } from "@/components/dashboard/page-header"
import { SectionCard } from "@/components/dashboard/section-card"
import { StatStrip } from "@/components/dashboard/stat-strip"
import { InviteUserDialog } from "@/components/users/invite-user-dialog"
import {
  labelForOrganizationRole,
  labelForPlatformRole,
  labelForSiteRole,
  platformRoleLabels,
} from "@/components/users/role-labels"
import { UserDetailSheet } from "@/components/users/user-detail-sheet"
import { formatDate, formatRelativeTime, statusLabel } from "@/lib/dashboard"
import { buildListQuery, columnFiltersToRecord } from "@/lib/list-query"
import { trpc } from "@/lib/trpc"
import { platformRoles } from "@nms/shared"

type UserRow = {
  id: string
  name: string
  email: string
  platformRole: string
  status: string
  twoFactorEnabled: boolean
  mustChangePassword: boolean
  passkeyCount: number
  lastLoginAt: Date | string | null
  createdAt: Date | string
  organizationMemberships: Array<{
    organizationId: string
    organizationName: string
    role: string
    status: string
  }>
  siteMemberships: Array<{
    siteId: string
    siteName: string
    organizationId: string
    role: string
    status: string
  }>
}

export default function UsersPage() {
  const utils = trpc.useUtils()
  const meQuery = trpc.access.me.useQuery()
  const canManageUsers = meQuery.data?.canManageUsers ?? false

  const summaryQuery = trpc.users.summary.useQuery(undefined, {
    enabled: canManageUsers,
  })
  const organizationsQuery = trpc.users.assignableOrganizations.useQuery(
    undefined,
    { enabled: canManageUsers }
  )
  const invitationsQuery = trpc.users.invitations.useQuery(undefined, {
    enabled: canManageUsers,
  })

  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "name", desc: false },
  ])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    []
  )
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: 25,
  })
  const [search, setSearch] = React.useState("")
  const [debouncedSearch, setDebouncedSearch] = React.useState("")
  const [inviteOpen, setInviteOpen] = React.useState(false)
  const [selectedUserId, setSelectedUserId] = React.useState<string | null>(
    null
  )
  const [detailOpen, setDetailOpen] = React.useState(false)
  const [revokeInvitationId, setRevokeInvitationId] = React.useState<
    string | null
  >(null)

  React.useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedSearch(search), 250)
    return () => window.clearTimeout(handle)
  }, [search])

  const resetToFirstPage = React.useCallback(() => {
    setPagination((current) =>
      current.pageIndex === 0 ? current : { ...current, pageIndex: 0 }
    )
  }, [])

  const filters = React.useMemo(
    () => columnFiltersToRecord(columnFilters),
    [columnFilters]
  )

  const pageQuery = trpc.users.list.useQuery(
    {
      query: buildListQuery({
        pagination,
        sorting,
        filters,
        search: debouncedSearch,
      }),
    },
    { placeholderData: keepPreviousData, enabled: canManageUsers }
  )

  const refreshAll = React.useCallback(async () => {
    await Promise.all([
      utils.users.list.invalidate(),
      utils.users.summary.invalidate(),
      utils.users.invitations.invalidate(),
    ])
  }, [utils])

  const revokeInvitation = trpc.users.revokeInvitation.useMutation({
    async onSuccess() {
      toast.success("Invitation revoked")
      await refreshAll()
    },
    onError(error) {
      toast.error(error.message || "We couldn't revoke the invitation.")
    },
  })

  const openUser = React.useCallback((id: string) => {
    setSelectedUserId(id)
    setDetailOpen(true)
  }, [])

  const columns = React.useMemo<ColumnDef<UserRow>[]>(
    () => [
      {
        accessorKey: "name",
        meta: { label: "User" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="User" />
        ),
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate font-medium">{row.original.name}</span>
            <span className="truncate text-xs text-muted-foreground">
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
        accessorKey: "platformRole",
        meta: { label: "Platform role" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Platform role" />
        ),
        cell: ({ row }) => (
          <Badge
            variant={
              row.original.platformRole === "member" ? "outline" : "secondary"
            }
            className="whitespace-nowrap"
          >
            {labelForPlatformRole(row.original.platformRole)}
          </Badge>
        ),
      },
      {
        id: "organizationId",
        enableSorting: false,
        meta: { label: "Organizations" },
        header: "Organizations",
        cell: ({ row }) => {
          if (row.original.platformRole !== "member") {
            return (
              <span className="text-sm text-muted-foreground">
                All organizations
              </span>
            )
          }
          const memberships = row.original.organizationMemberships
          if (memberships.length === 0) {
            return <span className="text-sm text-muted-foreground">—</span>
          }
          return (
            <div className="flex max-w-xs flex-wrap gap-1">
              {memberships.slice(0, 2).map((entry) => (
                <Badge
                  key={entry.organizationId}
                  variant="outline"
                  className="max-w-[12rem] gap-1 font-normal"
                >
                  <span className="truncate">{entry.organizationName}</span>
                  <span className="text-muted-foreground">
                    · {labelForOrganizationRole(entry.role)}
                  </span>
                </Badge>
              ))}
              {memberships.length > 2 ? (
                <Badge variant="outline" className="font-normal">
                  +{memberships.length - 2}
                </Badge>
              ) : null}
            </div>
          )
        },
      },
      {
        id: "siteGrants",
        enableSorting: false,
        meta: { label: "Site grants" },
        header: "Site grants",
        cell: ({ row }) => {
          if (row.original.platformRole !== "member") {
            return <span className="text-sm text-muted-foreground">—</span>
          }
          const grants = row.original.siteMemberships
          if (grants.length === 0) {
            return <span className="text-sm text-muted-foreground">—</span>
          }
          const title = grants
            .map(
              (grant) => `${grant.siteName} (${labelForSiteRole(grant.role)})`
            )
            .join(", ")
          return (
            <span className="text-sm" title={title}>
              {grants.length} {grants.length === 1 ? "site" : "sites"}
            </span>
          )
        },
      },
      {
        id: "twoFactor",
        accessorKey: "twoFactorEnabled",
        meta: { label: "Two-step" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Two-step" />
        ),
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            {row.original.twoFactorEnabled ? (
              <Badge className="gap-1 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300">
                <ShieldCheckIcon className="size-3" />
                On
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="gap-1 text-amber-700 dark:text-amber-300"
              >
                <ShieldOffIcon className="size-3" />
                Pending
              </Badge>
            )}
            {row.original.passkeyCount > 0 ? (
              <span
                className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"
                title={`${row.original.passkeyCount} ${row.original.passkeyCount === 1 ? "passkey" : "passkeys"}`}
              >
                <FingerprintIcon className="size-3" />
                {row.original.passkeyCount}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: "lastLoginAt",
        meta: { label: "Last sign-in" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Last sign-in" />
        ),
        cell: ({ row }) =>
          row.original.lastLoginAt ? (
            <div className="flex flex-col">
              <span className="text-sm">
                {formatRelativeTime(row.original.lastLoginAt)}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatDate(row.original.lastLoginAt)}
              </span>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">Never</span>
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
        accessorKey: "createdAt",
        meta: { label: "Joined" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Joined" />
        ),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {formatDate(row.original.createdAt)}
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
                label: "Manage access",
                onSelect: () => openUser(row.original.id),
              },
            ]}
          />
        ),
      },
    ],
    [openUser]
  )

  const organizations = organizationsQuery.data ?? []
  const invitations = invitationsQuery.data ?? []
  const summary = summaryQuery.data
  const total = pageQuery.data?.total ?? 0

  if (meQuery.isSuccess && !canManageUsers) {
    return (
      <AccessDenied description="User management is limited to organization and platform administrators." />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Users"
        title="People and access"
        description="Invite people, decide what they can see, and keep sign-in secure across your organizations."
        actions={
          <Button onClick={() => setInviteOpen(true)}>
            <MailPlusIcon />
            Invite user
          </Button>
        }
      />

      <StatStrip
        items={[
          {
            label: "Active users",
            value: summary ? summary.active : "—",
            hint: summary
              ? `${summary.total.toLocaleString()} total`
              : undefined,
          },
          {
            label: "Two-step pending",
            value: summary ? summary.withoutTwoFactor : "—",
            hint: "Active users who haven't finished setup",
          },
          {
            label: "Platform admins",
            value: summary ? summary.admins : "—",
            hint: "Owners and admins see everything",
          },
          {
            label: "Pending invitations",
            value: summary ? summary.pendingInvitations : "—",
            hint: "Links that haven't been opened yet",
          },
        ]}
      />

      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>
            {total > 0
              ? `${total.toLocaleString()} ${total === 1 ? "person" : "people"} match the current view.`
              : "Everyone who can sign in to the console."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={pageQuery.data?.items as UserRow[] | undefined}
            isLoading={pageQuery.isLoading}
            isFetching={pageQuery.isFetching}
            getRowId={(row) => row.id}
            server={{
              rowCount: total,
              sorting,
              onSortingChange: (updater) => {
                setSorting(updater)
                resetToFirstPage()
              },
              columnFilters,
              onColumnFiltersChange: (updater) => {
                setColumnFilters(updater)
                resetToFirstPage()
              },
              pagination,
              onPaginationChange: setPagination,
            }}
            search={search}
            onSearchChange={(value) => {
              setSearch(value)
              resetToFirstPage()
            }}
            searchPlaceholder="Search by name or email"
            facets={[
              {
                columnId: "platformRole",
                title: "Platform role",
                options: platformRoles.map((role) => ({
                  value: role,
                  label: platformRoleLabels[role],
                })),
              },
              {
                columnId: "organizationId",
                title: "Organization",
                options: organizations.map((organization) => ({
                  value: organization.id,
                  label: organization.name,
                })),
              },
              {
                columnId: "twoFactor",
                title: "Two-step",
                options: [
                  { value: "enabled", label: "On" },
                  { value: "disabled", label: "Pending" },
                ],
              },
              {
                columnId: "status",
                title: "Status",
                options: [
                  { value: "active", label: "Active" },
                  { value: "suspended", label: "Suspended" },
                ],
              },
            ]}
            initialColumnVisibility={{ email: false, createdAt: false }}
            onRowClick={(row) => openUser(row.id)}
            isRowActive={(row) => detailOpen && row.id === selectedUserId}
            emptyTitle="No users yet"
            emptyDescription="Invite the first person to get started."
            emptyAction={
              <Button size="sm" onClick={() => setInviteOpen(true)}>
                <MailPlusIcon />
                Invite user
              </Button>
            }
          />
        </CardContent>
      </Card>

      <SectionCard
        title="Pending invitations"
        description="Invitation links that haven't been accepted. Revoke one to stop it from working."
        collapsibleOnMobile
      >
        {invitationsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : invitations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No pending invitations.
          </p>
        ) : (
          <ul className="divide-y divide-border/70 rounded-lg border border-border/80">
            {invitations.map((invitation) => {
              const grants = Array.isArray(invitation.siteGrants)
                ? (invitation.siteGrants as Array<{ siteId: string }>)
                : []
              return (
                <li
                  key={invitation.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {invitation.name}{" "}
                      <span className="font-normal text-muted-foreground">
                        · {invitation.email}
                      </span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {invitation.platformRole !== "member"
                        ? labelForPlatformRole(invitation.platformRole)
                        : [
                            invitation.organizationName,
                            invitation.organizationRole
                              ? labelForOrganizationRole(
                                  invitation.organizationRole
                                )
                              : null,
                            grants.length > 0
                              ? `${grants.length} ${grants.length === 1 ? "site" : "sites"}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                      {" · "}Expires {formatRelativeTime(invitation.expiresAt)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={revokeInvitation.isPending}
                    onClick={() => setRevokeInvitationId(invitation.id)}
                  >
                    Revoke
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </SectionCard>

      <InviteUserDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        canAssignPlatformRoles={meQuery.data?.platformRole === "owner"}
        onInvited={() => void refreshAll()}
      />

      <UserDetailSheet
        userId={selectedUserId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        currentUserId={meQuery.data?.id}
        currentPlatformRole={meQuery.data?.platformRole}
        onChanged={() => void refreshAll()}
      />

      <ConfirmDialog
        open={Boolean(revokeInvitationId)}
        onOpenChange={(next) => {
          if (!next) setRevokeInvitationId(null)
        }}
        title="Revoke this invitation?"
        description="The link stops working immediately. You can send a new invitation at any time."
        confirmLabel="Revoke"
        destructive
        pending={revokeInvitation.isPending}
        onConfirm={() => {
          if (revokeInvitationId) {
            revokeInvitation.mutate({ invitationId: revokeInvitationId })
          }
          setRevokeInvitationId(null)
        }}
      />
    </div>
  )
}
