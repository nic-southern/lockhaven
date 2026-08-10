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
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog"
import { EmptyState } from "@/components/dashboard/empty-state"
import { FormField, NativeSelect } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { SectionCard } from "@/components/dashboard/section-card"
import { downloadTextFile } from "@/lib/wireguard"
import { trpc } from "@/lib/trpc"

function profileStatus(profile: {
  revokedAt: Date | string | null
  serverPeerEnabled: boolean
  lastHandshakeAt: Date | string | null
}) {
  if (profile.revokedAt || !profile.serverPeerEnabled) {
    return { label: "Revoked", tone: "secondary" as const }
  }

  if (profile.lastHandshakeAt) {
    const ageMs = Date.now() - new Date(profile.lastHandshakeAt).getTime()
    if (ageMs < 3 * 60 * 1000) {
      return { label: "Online", tone: "default" as const }
    }
  }

  return { label: "Ready", tone: "outline" as const }
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin VPN"
        description="Download a WireGuard profile to reach this organization's devices from your Mac. Traffic is one-way from your admin tunnel to devices."
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
              <NativeSelect
                id="admin-vpn-org"
                value={organizationId}
                onChange={(event) => setOrganizationId(event.target.value)}
                disabled={organizationsQuery.isLoading}
              >
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </NativeSelect>
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
          description="Import the downloaded file into WireGuard on macOS, then connect. SSH to device VPN addresses directly."
        >
          {profilesQuery.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : profiles.length === 0 ? (
            <EmptyState
              title="No admin VPN profiles yet"
              description="Create a profile for each machine you connect from to download its WireGuard config."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profiles.map((profile) => {
                  const status = profileStatus(profile)
                  return (
                    <TableRow key={profile.id}>
                      <TableCell className="font-medium">
                        {profile.label || "—"}
                      </TableCell>
                      <TableCell>{profile.organizationName}</TableCell>
                      <TableCell>
                        <div>{profile.userName || profile.userEmail}</div>
                        <div className="text-xs text-muted-foreground">
                          {profile.userEmail}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {profile.vpnIpv4}
                      </TableCell>
                      <TableCell>
                        <Badge variant={status.tone}>{status.label}</Badge>
                      </TableCell>
                      <TableCell className="space-x-2 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={reissueProfile.isPending}
                          onClick={() => setReissueId(profile.id)}
                        >
                          {profile.revokedAt ? "Restore" : "Reissue"}
                        </Button>
                        {profile.revokedAt ? (
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={deleteProfile.isPending}
                            onClick={() => setDeleteId(profile.id)}
                          >
                            Delete
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={revokeProfile.isPending}
                            onClick={() => setRevokeId(profile.id)}
                          >
                            Revoke
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
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
