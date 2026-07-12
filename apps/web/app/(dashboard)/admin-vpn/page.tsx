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

  const ownProfileForOrg = profiles.find(
    (profile) =>
      profile.organizationId === organizationId && profile.isOwnProfile
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
              Generates a config for your account. The private key is shown only
              in the downloaded file.
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
            <FormField label="Label (optional)" htmlFor="admin-vpn-label">
              <Input
                id="admin-vpn-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="MacBook"
              />
            </FormField>
            {ownProfileForOrg && !ownProfileForOrg.revokedAt ? (
              <p className="text-sm text-muted-foreground">
                You already have an active profile for this organization.
                Reissue it to download a new config.
              </p>
            ) : null}
            <Button
              className="w-full"
              disabled={
                !organizationId ||
                createProfile.isPending ||
                Boolean(ownProfileForOrg && !ownProfileForOrg.revokedAt)
              }
              onClick={() =>
                createProfile.mutate({
                  organizationId,
                  label: label.trim() || undefined,
                })
              }
            >
              {createProfile.isPending
                ? "Creating…"
                : ownProfileForOrg?.revokedAt
                  ? "Restore and download"
                  : "Create and download"}
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
              description="Create a profile to download a WireGuard config for native device access."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
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
                      <TableCell>
                        <div className="font-medium">
                          {profile.organizationName}
                        </div>
                        {profile.label ? (
                          <div className="text-xs text-muted-foreground">
                            {profile.label}
                          </div>
                        ) : null}
                      </TableCell>
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
                          Reissue
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={
                            Boolean(profile.revokedAt) ||
                            revokeProfile.isPending
                          }
                          onClick={() => setRevokeId(profile.id)}
                        >
                          Revoke
                        </Button>
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
        description="This replaces the current keys. Download and import the new config. The previous config will stop working."
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
        description="This disconnects the tunnel. You can reissue later to restore access with new keys."
        confirmLabel="Revoke"
        pending={revokeProfile.isPending}
        onConfirm={() => {
          if (revokeId) {
            revokeProfile.mutate({ id: revokeId })
          }
        }}
      />
    </div>
  )
}
