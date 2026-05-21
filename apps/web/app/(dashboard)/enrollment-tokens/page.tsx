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
import { formatDate } from "@/lib/dashboard"
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
    },
  })
  const updateToken = trpc.enrollmentTokens.update.useMutation({
    async onSuccess() {
      await utils.enrollmentTokens.list.invalidate()
    },
  })
  const revokeToken = trpc.enrollmentTokens.revoke.useMutation({
    async onSuccess() {
      await utils.enrollmentTokens.list.invalidate()
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
    <div className="space-y-6">
      <section className="flex flex-col gap-2">
        <Badge variant="outline" className="w-fit">
          Enrollment tokens
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight">
          Token workspace
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Create, edit, and revoke enrollment tokens from one place.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>New token</CardTitle>
            <CardDescription>
              Set the organization, site, policy, expiry, and use limit.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Organization</span>
              <select
                className="h-10 rounded-md border bg-background px-3"
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
              </select>
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Site</span>
              <select
                className="h-10 rounded-md border bg-background px-3"
                value={createSiteId}
                onChange={(event) => setCreateSiteId(event.target.value)}
              >
                <option value="">No site</option>
                {createSites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Route policy</span>
              <select
                className="h-10 rounded-md border bg-background px-3"
                value={createRoutePolicyId}
                onChange={(event) => setCreateRoutePolicyId(event.target.value)}
              >
                <option value="">No policy</option>
                {routePolicies.map((policy) => (
                  <option key={policy.id} value={policy.id}>
                    {policy.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 rounded border"
                checked={createSiteWide}
                onChange={(event) => setCreateSiteWide(event.target.checked)}
              />
              Site-wide reusable token
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Expires</span>
                <input
                  type="datetime-local"
                  className="h-10 rounded-md border bg-background px-3"
                  value={createExpiresAt}
                  onChange={(event) => setCreateExpiresAt(event.target.value)}
                />
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Max uses</span>
                <input
                  type="number"
                  min={1}
                  className="h-10 rounded-md border bg-background px-3"
                  value={createMaxUses}
                  onChange={(event) => setCreateMaxUses(event.target.value)}
                  disabled={createSiteWide}
                />
              </label>
            </div>
            {createSiteWide ? (
              <p className="text-sm text-muted-foreground">
                Shared tokens can be reused until they expire or are revoked.
              </p>
            ) : null}
            <Button
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
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <p className="mb-2 font-medium">Token value</p>
                <code className="break-all">{createdToken}</code>
              </div>
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
                      <TableCell
                        colSpan={5}
                        className="py-8 text-center text-muted-foreground"
                      >
                        <Skeleton className="mx-auto h-5 w-40" />
                      </TableCell>
                    </TableRow>
                  ) : tokens.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="py-8 text-center text-muted-foreground"
                      >
                        No tokens yet
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
                          className={
                            selectedTokenId === token.id
                              ? "bg-muted/60"
                              : undefined
                          }
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
                              {tokenStatus.replaceAll("_", " ")}
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
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Organization</span>
              <select
                className="h-10 rounded-md border bg-background px-3"
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
              </select>
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Site</span>
              <select
                className="h-10 rounded-md border bg-background px-3"
                value={editSiteId}
                onChange={(event) => setEditSiteId(event.target.value)}
              >
                <option value="">No site</option>
                {editSites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Route policy</span>
              <select
                className="h-10 rounded-md border bg-background px-3"
                value={editRoutePolicyId}
                onChange={(event) => setEditRoutePolicyId(event.target.value)}
              >
                <option value="">No policy</option>
                {routePolicies.map((policy) => (
                  <option key={policy.id} value={policy.id}>
                    {policy.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 rounded border"
                checked={editSiteWide}
                onChange={(event) => setEditSiteWide(event.target.checked)}
              />
              Site-wide reusable token
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Expires</span>
              <input
                type="datetime-local"
                className="h-10 rounded-md border bg-background px-3"
                value={editExpiresAt}
                onChange={(event) => setEditExpiresAt(event.target.value)}
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Max uses</span>
              <input
                type="number"
                min={1}
                className="h-10 rounded-md border bg-background px-3"
                value={editMaxUses}
                onChange={(event) => setEditMaxUses(event.target.value)}
                disabled={editSiteWide}
              />
            </label>
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
                    {selectedTokenStatus.replaceAll("_", " ")}
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
                onClick={() => {
                  if (window.confirm("Revoke this token?")) {
                    void revokeToken.mutateAsync({ id: selectedToken.id })
                  }
                }}
                disabled={revokeToken.isPending}
              >
                Revoke token
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
