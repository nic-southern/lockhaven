"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog"
import {
  DataTable,
  DataTableColumnHeader,
  DataTableRowActions,
} from "@/components/dashboard/data-table"
import { FormField } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { SectionCard } from "@/components/dashboard/section-card"
import { SelectField } from "@/components/dashboard/select-field"
import { StatusIndicator } from "@/components/dashboard/status-indicator"
import { formatRelativeTime } from "@/lib/dashboard"
import { downloadTextFile } from "@/lib/wireguard"
import { trpc } from "@/lib/trpc"
import type { ColumnDef } from "@tanstack/react-table"

type ProfileStatus = "Online" | "Ready" | "Revoked"

function profileStatus(profile: {
  revokedAt: Date | string | null
  serverPeerEnabled: boolean
  lastHandshakeAt: Date | string | null
}): ProfileStatus {
  if (profile.revokedAt || !profile.serverPeerEnabled) {
    return "Revoked"
  }

  if (profile.lastHandshakeAt) {
    const ageMs = Date.now() - new Date(profile.lastHandshakeAt).getTime()
    if (ageMs < 3 * 60 * 1000) {
      return "Online"
    }
  }

  return "Ready"
}

type ProfileRow = {
  id: string
  label: string
  organizationName: string
  userName: string
  userEmail: string
  vpnIpv4: string
  status: ProfileStatus
  lastHandshakeAt: Date | string | null
  revokedAt: Date | string | null
  allowSameUserAccess: boolean
  isOwnProfile: boolean
}

export default function AdminVpnPage() {
  const utils = trpc.useUtils()
  const organizationsQuery = trpc.organizations.list.useQuery()
  const profilesQuery = trpc.adminVpn.list.useQuery()
  const [organizationId, setOrganizationId] = React.useState("")
  const [label, setLabel] = React.useState("")
  const [revokeId, setRevokeId] = React.useState<string | null>(null)
  const [reissueId, setReissueId] = React.useState<string | null>(null)
  const [deleteId, setDeleteId] = React.useState<string | null>(null)

  const organizations = React.useMemo(
    () => organizationsQuery.data ?? [],
    [organizationsQuery.data]
  )
  const profiles = React.useMemo(
    () => profilesQuery.data ?? [],
    [profilesQuery.data]
  )

  React.useEffect(() => {
    if (organizations.length > 0 && !organizationId) {
      setOrganizationId(organizations[0].id)
    }
  }, [organizationId, organizations])

  const createProfile = trpc.adminVpn.create.useMutation({
    async onSuccess(result) {
      await utils.adminVpn.list.invalidate()
      downloadTextFile(result.filename, result.config)
      setLabel("")
      toast.success("Admin VPN profile created. Config downloaded once.")
    },
    onError(error) {
      toast.error(error.message || "We couldn't create the admin VPN profile.")
    },
  })

  const reissueProfile = trpc.adminVpn.reissue.useMutation({
    async onSuccess(result) {
      await utils.adminVpn.list.invalidate()
      downloadTextFile(result.filename, result.config)
      setReissueId(null)
      toast.success("Admin VPN profile reissued. New config downloaded once.")
    },
    onError(error) {
      toast.error(error.message || "We couldn't reissue the admin VPN profile.")
    },
  })

  const revokeProfile = trpc.adminVpn.revoke.useMutation({
    async onSuccess() {
      await utils.adminVpn.list.invalidate()
      setRevokeId(null)
      toast.success("Admin VPN profile revoked")
    },
    onError(error) {
      toast.error(error.message || "We couldn't revoke the admin VPN profile.")
    },
  })

  const updateProfile = trpc.adminVpn.update.useMutation({
    async onSuccess(profile) {
      await utils.adminVpn.list.invalidate()
      toast.success(
        profile.allowSameUserAccess
          ? "Same-user access enabled"
          : "Same-user access disabled"
      )
    },
    onError(error) {
      toast.error(error.message || "We couldn't update the profile.")
    },
  })

  const deleteProfile = trpc.adminVpn.delete.useMutation({
    async onSuccess() {
      await utils.adminVpn.list.invalidate()
      setDeleteId(null)
      toast.success("Admin VPN profile deleted")
    },
    onError(error) {
      toast.error(error.message || "We couldn't delete the admin VPN profile.")
    },
  })

  const ownActiveProfilesForOrg = profiles.filter(
    (profile) =>
      profile.organizationId === organizationId &&
      profile.isOwnProfile &&
      !profile.revokedAt
  )

  const rows = React.useMemo<ProfileRow[]>(
    () =>
      profiles.map((profile) => ({
        id: profile.id,
        label: profile.label || "—",
        organizationName: profile.organizationName,
        userName: profile.userName || profile.userEmail,
        userEmail: profile.userEmail,
        vpnIpv4: profile.vpnIpv4,
        status: profileStatus(profile),
        lastHandshakeAt: profile.lastHandshakeAt,
        revokedAt: profile.revokedAt,
        allowSameUserAccess: profile.allowSameUserAccess,
        isOwnProfile: profile.isOwnProfile,
      })),
    [profiles]
  )

  const updatePending = updateProfile.isPending
  const columns = React.useMemo<ColumnDef<ProfileRow>[]>(
    () => [
      {
        accessorKey: "label",
        meta: { label: "Device" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Device" />
        ),
        cell: ({ row }) => (
          <span className="font-medium">{row.original.label}</span>
        ),
      },
      {
        accessorKey: "organizationName",
        meta: { label: "Organization" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Organization" />
        ),
      },
      {
        accessorKey: "userName",
        meta: { label: "User" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="User" />
        ),
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span>{row.original.userName}</span>
            <span className="text-xs text-muted-foreground">
              {row.original.userEmail}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "vpnIpv4",
        meta: { label: "Address" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Address" />
        ),
        cell: ({ row }) => (
          <span className="font-mono text-sm">{row.original.vpnIpv4}</span>
        ),
      },
      {
        accessorKey: "status",
        meta: { label: "Status" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Status" />
        ),
        cell: ({ row }) => (
          <StatusIndicator
            tone={
              row.original.status === "Online"
                ? "online"
                : row.original.status === "Revoked"
                  ? "danger"
                  : "neutral"
            }
            pulse={row.original.status === "Online"}
            label={row.original.status}
          />
        ),
      },
      {
        accessorKey: "lastHandshakeAt",
        meta: { label: "Last handshake" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Last handshake" />
        ),
        sortingFn: (a, b) => {
          const left = a.original.lastHandshakeAt
            ? new Date(a.original.lastHandshakeAt).getTime()
            : 0
          const right = b.original.lastHandshakeAt
            ? new Date(b.original.lastHandshakeAt).getTime()
            : 0
          return left - right
        },
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {formatRelativeTime(row.original.lastHandshakeAt)}
          </span>
        ),
      },
      {
        id: "sameUser",
        accessorFn: (row) => (row.allowSameUserAccess ? "Enabled" : "Disabled"),
        enableSorting: false,
        meta: { label: "Same-user access" },
        header: "Same-user access",
        cell: ({ row }) =>
          row.original.revokedAt ? (
            <span className="text-sm text-muted-foreground">—</span>
          ) : (
            <div className="flex items-center gap-2">
              <Switch
                id={`same-user-${row.original.id}`}
                checked={row.original.allowSameUserAccess}
                disabled={updatePending}
                aria-label="Allow my other devices"
                onCheckedChange={(checked) => {
                  updateProfile.mutate({
                    id: row.original.id,
                    allowSameUserAccess: checked === true,
                  })
                }}
              />
              <span className="text-xs text-muted-foreground">
                {row.original.allowSameUserAccess ? "Allowed" : "Off"}
              </span>
            </div>
          ),
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        meta: { className: "w-12" },
        cell: ({ row }) => (
          <DataTableRowActions
            label={row.original.label}
            actions={[
              {
                label: row.original.revokedAt ? "Restore" : "Reissue",
                onSelect: () => setReissueId(row.original.id),
              },
              row.original.revokedAt
                ? {
                    label: "Delete profile",
                    destructive: true,
                    separatorBefore: true,
                    onSelect: () => setDeleteId(row.original.id),
                  }
                : {
                    label: "Revoke profile",
                    destructive: true,
                    separatorBefore: true,
                    onSelect: () => setRevokeId(row.original.id),
                  },
            ]}
          />
        ),
      },
    ],
    [updatePending, updateProfile]
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin VPN"
        description="Download a profile for each machine you connect from. Enable same-user access on a profile to let your other machines reach it."
      />

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Create profile</CardTitle>
            <CardDescription>
              Create one profile per machine you connect from. The private key
              is shown only in the downloaded file.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField label="Organization" htmlFor="admin-vpn-org">
              <SelectField
                id="admin-vpn-org"
                value={organizationId}
                onValueChange={setOrganizationId}
                disabled={organizationsQuery.isLoading}
                options={organizations.map((organization) => ({
                  value: organization.id,
                  label: organization.name,
                }))}
              />
            </FormField>
            <FormField
              label="Device name"
              htmlFor="admin-vpn-label"
              description="Used to name the downloaded file so you can tell your machines apart."
            >
              <Input
                id="admin-vpn-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Desktop"
              />
            </FormField>
            {ownActiveProfilesForOrg.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                You have {ownActiveProfilesForOrg.length} active{" "}
                {ownActiveProfilesForOrg.length === 1 ? "profile" : "profiles"}{" "}
                here. Each machine needs its own profile — the same config
                cannot be used on two machines at once.
              </p>
            ) : null}
            <Button
              className="w-full"
              disabled={!organizationId || createProfile.isPending}
              onClick={() =>
                createProfile.mutate({
                  organizationId,
                  label: label.trim() || undefined,
                })
              }
            >
              {createProfile.isPending ? "Creating…" : "Create and download"}
            </Button>
          </CardContent>
        </Card>

        <SectionCard
          title="Profiles"
          description="Import each downloaded file on its machine, then connect. Turn on same-user access when you want your other machines to reach that profile."
        >
          <DataTable
            columns={columns}
            data={rows}
            isLoading={profilesQuery.isLoading}
            getRowId={(row) => row.id}
            searchPlaceholder="Search profiles"
            facets={[
              {
                columnId: "status",
                title: "Status",
                options: [
                  { value: "Online", label: "Online" },
                  { value: "Ready", label: "Ready" },
                  { value: "Revoked", label: "Revoked" },
                ],
              },
              {
                columnId: "organizationName",
                title: "Organization",
                options: organizations.map((organization) => ({
                  value: organization.name,
                  label: organization.name,
                })),
              },
            ]}
            initialSorting={[{ id: "status", desc: false }]}
            emptyTitle="No admin VPN profiles yet"
            emptyDescription="Create a profile for each machine you connect from to download its config."
          />
        </SectionCard>
      </div>

      <ConfirmDialog
        open={Boolean(reissueId)}
        onOpenChange={(open) => {
          if (!open) setReissueId(null)
        }}
        title="Reissue admin VPN profile?"
        description="This replaces the keys for this machine only. Download and import the new config. The previous config for this machine will stop working."
        confirmLabel="Reissue and download"
        pending={reissueProfile.isPending}
        onConfirm={() => {
          if (reissueId) {
            reissueProfile.mutate({ id: reissueId })
          }
        }}
      />

      <ConfirmDialog
        open={Boolean(revokeId)}
        onOpenChange={(open) => {
          if (!open) setRevokeId(null)
        }}
        title="Revoke admin VPN profile?"
        description="This disconnects that machine's tunnel and stops its config from working. You can restore access later with new keys."
        confirmLabel="Revoke"
        pending={revokeProfile.isPending}
        onConfirm={() => {
          if (revokeId) {
            revokeProfile.mutate({ id: revokeId })
          }
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteId)}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null)
        }}
        title="Delete admin VPN profile?"
        description="This removes the profile and frees its address for reuse. It cannot be restored."
        confirmLabel="Delete"
        pending={deleteProfile.isPending}
        onConfirm={() => {
          if (deleteId) {
            deleteProfile.mutate({ id: deleteId })
          }
        }}
      />
    </div>
  )
}
