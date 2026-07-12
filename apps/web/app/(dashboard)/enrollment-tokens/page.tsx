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
import { CodeBlock } from "@/components/dashboard/code-block"
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog"
import { EmptyState } from "@/components/dashboard/empty-state"
import { FormField, NativeSelect } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { formatDate, statusLabel } from "@/lib/dashboard"
import { cn } from "@/lib/utils"
import { trpc } from "@/lib/trpc"

function toDatetimeLocal(value: string | Date | null | undefined) {
  if (!value) {
    return ""
  }

  const date = new Date(value)
  const pad = (input: number) => String(input).padStart(2, "0")

  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    "T",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes()),
  ].join("")
}

function fromDatetimeLocal(value: string) {
  return new Date(value)
}

const tokenStatusVariant: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  active: "secondary",
  expired: "destructive",
  exhausted: "outline",
}

export default function EnrollmentTokensPage() {
  const utils = trpc.useUtils()
  const organizationsQuery = trpc.organizations.list.useQuery()
  const sitesQuery = trpc.sites.list.useQuery()
  const routePoliciesQuery = trpc.routePolicies.list.useQuery()
  const tokensQuery = trpc.enrollmentTokens.list.useQuery()

  const organizations = React.useMemo(
    () => organizationsQuery.data ?? [],
    [organizationsQuery.data]
  )
  const sites = React.useMemo(() => sitesQuery.data ?? [], [sitesQuery.data])
  const routePolicies = React.useMemo(
    () => routePoliciesQuery.data ?? [],
    [routePoliciesQuery.data]
  )
  const tokens = React.useMemo(() => tokensQuery.data ?? [], [tokensQuery.data])

  const [selectedTokenId, setSelectedTokenId] = React.useState("")
  const [now] = React.useState(() => Date.now())
  const [createOrganizationId, setCreateOrganizationId] = React.useState("")
  const [createSiteId, setCreateSiteId] = React.useState("")
  const [createRoutePolicyId, setCreateRoutePolicyId] = React.useState("")
  const [createSiteWide, setCreateSiteWide] = React.useState(true)
  const [createExpiresAt, setCreateExpiresAt] = React.useState("")
  const [createMaxUses, setCreateMaxUses] = React.useState("1")
  const [createdToken, setCreatedToken] = React.useState("")
  const [revokeOpen, setRevokeOpen] = React.useState(false)

  const [editOrganizationId, setEditOrganizationId] = React.useState("")
  const [editSiteId, setEditSiteId] = React.useState("")
  const [editRoutePolicyId, setEditRoutePolicyId] = React.useState("")
  const [editSiteWide, setEditSiteWide] = React.useState(true)
  const [editExpiresAt, setEditExpiresAt] = React.useState("")
  const [editMaxUses, setEditMaxUses] = React.useState("1")

  const createToken = trpc.enrollmentTokens.create.useMutation({
    async onSuccess(result) {
      setCreatedToken(result.token)
      setSelectedTokenId(result.enrollmentToken.id)
      await utils.enrollmentTokens.list.invalidate()
      toast.success("Enrollment token created")
    },
    onError() {
      toast.error("We couldn't create the token.")
    },
  })
  const updateToken = trpc.enrollmentTokens.update.useMutation({
    async onSuccess() {
      await utils.enrollmentTokens.list.invalidate()
      toast.success("Token updated")
    },
    onError() {
      toast.error("We couldn't update the token.")
    },
  })
  const revokeToken = trpc.enrollmentTokens.revoke.useMutation({
    async onSuccess() {
      await utils.enrollmentTokens.list.invalidate()
      setRevokeOpen(false)
      toast.success("Token revoked")
    },
    onError() {
      toast.error("We couldn't revoke the token.")
    },
  })

  React.useEffect(() => {
    if (tokens.length === 0) {
      setSelectedTokenId("")
      return
    }

    if (!tokens.some((token) => token.id === selectedTokenId)) {
      setSelectedTokenId(tokens[0].id)
    }
  }, [selectedTokenId, tokens])

  const selectedToken = React.useMemo(
    () => tokens.find((token) => token.id === selectedTokenId) ?? null,
    [selectedTokenId, tokens]
  )

  React.useEffect(() => {
    if (selectedToken) {
      setEditOrganizationId(selectedToken.organizationId)
      setEditSiteId(selectedToken.siteId ?? "")
      setEditRoutePolicyId(selectedToken.routePolicyId ?? "")
      setEditSiteWide(selectedToken.siteWide)
      setEditExpiresAt(toDatetimeLocal(selectedToken.expiresAt))
      setEditMaxUses(String(selectedToken.maxUses))
    }
  }, [selectedToken])

  const createSites = React.useMemo(
    () => sites.filter((site) => site.organizationId === createOrganizationId),
    [createOrganizationId, sites]
  )
  const editSites = React.useMemo(
    () => sites.filter((site) => site.organizationId === editOrganizationId),
    [editOrganizationId, sites]
  )

  const selectedTokenStatus = selectedToken
    ? new Date(selectedToken.expiresAt).getTime() <= now
      ? "expired"
      : !selectedToken.siteWide && selectedToken.uses >= selectedToken.maxUses
        ? "exhausted"
        : "active"
    : "active"

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Enrollment tokens"
        title="Token workspace"
        description="Create, edit, and revoke enrollment tokens from one place."
      />

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>New token</CardTitle>
            <CardDescription>
              Set the organization, site, policy, expiry, and use limit.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <FormField label="Organization" htmlFor="token-create-organization">
              <NativeSelect
                id="token-create-organization"
                value={createOrganizationId}
                onChange={(event) => {
                  setCreateOrganizationId(event.target.value)
                  setCreateSiteId("")
                }}
              >
                <option value="">Choose an organization</option>
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Site" htmlFor="token-create-site">
              <NativeSelect
                id="token-create-site"
                value={createSiteId}
                onChange={(event) => setCreateSiteId(event.target.value)}
              >
                <option value="">No site</option>
                {createSites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Route policy" htmlFor="token-create-policy">
              <NativeSelect
                id="token-create-policy"
                value={createRoutePolicyId}
                onChange={(event) => setCreateRoutePolicyId(event.target.value)}
              >
                <option value="">No policy</option>
                {routePolicies.map((policy) => (
                  <option key={policy.id} value={policy.id}>
                    {policy.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <div className="flex items-center gap-2">
              <Checkbox
                id="token-create-site-wide"
                checked={createSiteWide}
                onCheckedChange={(checked) =>
                  setCreateSiteWide(checked === true)
                }
              />
              <Label
                htmlFor="token-create-site-wide"
                className="text-sm font-normal"
              >
                Site-wide reusable token
              </Label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Expires" htmlFor="token-create-expires">
                <Input
                  id="token-create-expires"
                  type="datetime-local"
                  value={createExpiresAt}
                  onChange={(event) => setCreateExpiresAt(event.target.value)}
                />
              </FormField>
              <FormField label="Max uses" htmlFor="token-create-max-uses">
                <Input
                  id="token-create-max-uses"
                  type="number"
                  min={1}
                  value={createMaxUses}
                  onChange={(event) => setCreateMaxUses(event.target.value)}
                  disabled={createSiteWide}
                />
              </FormField>
            </div>
            {createSiteWide ? (
              <p className="text-sm text-muted-foreground">
                Shared tokens can be reused until they expire or are revoked.
              </p>
            ) : null}
            <Button
              className="w-fit"
              onClick={() => {
                void createToken.mutateAsync({
                  organizationId: createOrganizationId,
                  siteId: createSiteId || null,
                  siteWide: createSiteWide,
                  routePolicyId: createRoutePolicyId || null,
                  expiresAt: fromDatetimeLocal(createExpiresAt),
                  maxUses: createSiteWide ? 1 : Number(createMaxUses),
                })
              }}
              disabled={
                !createOrganizationId ||
                !createExpiresAt ||
                (createSiteWide && !createSiteId) ||
                createToken.isPending
              }
            >
              Create token
            </Button>
            {createdToken ? (
              <CodeBlock label="Enrollment token" value={createdToken} />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tokens</CardTitle>
            <CardDescription>
              Pick a token to edit or revoke it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Org</TableHead>
                    <TableHead>Site</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Policy</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tokensQuery.isLoading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-10">
                        <Skeleton className="h-5 w-40" />
                      </TableCell>
                    </TableRow>
                  ) : tokens.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="p-0">
                        <EmptyState
                          title="No tokens yet"
                          description="Create a token to enroll the first device."
                          bordered={false}
                        />
                      </TableCell>
                    </TableRow>
                  ) : (
                    tokens.map((token) => {
                      const tokenStatus =
                        new Date(token.expiresAt).getTime() <= now
                          ? "expired"
                          : !token.siteWide && token.uses >= token.maxUses
                            ? "exhausted"
                            : "active"

                      return (
                        <TableRow
                          key={token.id}
                          className={cn(
                            "cursor-pointer",
                            selectedTokenId === token.id && "bg-muted/60"
                          )}
                          onClick={() => setSelectedTokenId(token.id)}
                        >
                          <TableCell className="font-medium">
                            {token.organizationName ?? "—"}
                          </TableCell>
                          <TableCell>{token.siteName ?? "—"}</TableCell>
                          <TableCell>
                            <Badge
                              variant={token.siteWide ? "secondary" : "outline"}
                            >
                              {token.siteWide ? "Shared" : "Standard"}
                            </Badge>
                          </TableCell>
                          <TableCell>{token.routePolicyName ?? "—"}</TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                tokenStatusVariant[tokenStatus] ?? "outline"
                              }
                            >
                              {statusLabel(tokenStatus)}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {selectedToken ? (
        <Card>
          <CardHeader>
            <CardTitle>Edit token</CardTitle>
            <CardDescription>
              Update the token settings or revoke it when it should no longer
              work.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <FormField label="Organization" htmlFor="token-edit-organization">
              <NativeSelect
                id="token-edit-organization"
                value={editOrganizationId}
                onChange={(event) => {
                  setEditOrganizationId(event.target.value)
                  setEditSiteId("")
                }}
              >
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Site" htmlFor="token-edit-site">
              <NativeSelect
                id="token-edit-site"
                value={editSiteId}
                onChange={(event) => setEditSiteId(event.target.value)}
              >
                <option value="">No site</option>
                {editSites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Route policy" htmlFor="token-edit-policy">
              <NativeSelect
                id="token-edit-policy"
                value={editRoutePolicyId}
                onChange={(event) => setEditRoutePolicyId(event.target.value)}
              >
                <option value="">No policy</option>
                {routePolicies.map((policy) => (
                  <option key={policy.id} value={policy.id}>
                    {policy.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <div className="flex items-center gap-2">
              <Checkbox
                id="token-edit-site-wide"
                checked={editSiteWide}
                onCheckedChange={(checked) => setEditSiteWide(checked === true)}
              />
              <Label
                htmlFor="token-edit-site-wide"
                className="text-sm font-normal"
              >
                Site-wide reusable token
              </Label>
            </div>
            <FormField label="Expires" htmlFor="token-edit-expires">
              <Input
                id="token-edit-expires"
                type="datetime-local"
                value={editExpiresAt}
                onChange={(event) => setEditExpiresAt(event.target.value)}
              />
            </FormField>
            <FormField label="Max uses" htmlFor="token-edit-max-uses">
              <Input
                id="token-edit-max-uses"
                type="number"
                min={1}
                value={editMaxUses}
                onChange={(event) => setEditMaxUses(event.target.value)}
                disabled={editSiteWide}
              />
            </FormField>
            {editSiteWide ? (
              <p className="text-sm text-muted-foreground md:col-span-2">
                Shared tokens can be reused until they expire or are revoked.
              </p>
            ) : null}
            <div className="rounded-lg border bg-muted/20 p-4 text-sm md:col-span-2">
              <div className="grid gap-2 sm:grid-cols-3">
                <div>
                  <p className="text-muted-foreground">Created</p>
                  <p className="font-medium">
                    {formatDate(selectedToken.createdAt)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Uses</p>
                  <p className="font-medium">
                    {selectedToken.siteWide
                      ? "Unlimited"
                      : `${selectedToken.uses} / ${selectedToken.maxUses}`}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Status</p>
                  <Badge
                    variant={
                      tokenStatusVariant[selectedTokenStatus] ?? "outline"
                    }
                  >
                    {statusLabel(selectedTokenStatus)}
                  </Badge>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-3 md:col-span-2">
              <Button
                onClick={() => {
                  void updateToken.mutateAsync({
                    id: selectedToken.id,
                    organizationId: editOrganizationId,
                    siteId: editSiteId || null,
                    siteWide: editSiteWide,
                    routePolicyId: editRoutePolicyId || null,
                    expiresAt: fromDatetimeLocal(editExpiresAt),
                    maxUses: editSiteWide ? 1 : Number(editMaxUses),
                  })
                }}
                disabled={
                  !editOrganizationId ||
                  !editExpiresAt ||
                  (editSiteWide && !editSiteId) ||
                  updateToken.isPending
                }
              >
                Save changes
              </Button>
              <Button
                variant="outline"
                onClick={() => setRevokeOpen(true)}
                disabled={revokeToken.isPending}
              >
                Revoke token
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <ConfirmDialog
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
        title="Revoke token"
        description="This token will stop working immediately. Devices that already enrolled with it are unaffected."
        confirmLabel="Revoke token"
        destructive
        pending={revokeToken.isPending}
        onConfirm={() => {
          if (!selectedToken) return
          void revokeToken.mutateAsync({ id: selectedToken.id })
        }}
      />
    </div>
  )
}
