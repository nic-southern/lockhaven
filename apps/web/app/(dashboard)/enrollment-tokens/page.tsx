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
import { CodeBlock } from "@/components/dashboard/code-block"
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog"
import {
  DataTable,
  DataTableColumnHeader,
  DataTableRowActions,
} from "@/components/dashboard/data-table"
import { DetailSheet } from "@/components/dashboard/detail-sheet"
import { EmptyState } from "@/components/dashboard/empty-state"
import { EnrollmentInstallCommands } from "@/components/dashboard/enrollment-install-commands"
import { FormField } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { SectionCard } from "@/components/dashboard/section-card"
import { SelectField } from "@/components/dashboard/select-field"
import { formatDate, formatRelativeTime, statusLabel } from "@/lib/dashboard"
import { trpc } from "@/lib/trpc"
import type { ColumnDef } from "@tanstack/react-table"

type TokenStatus = "active" | "expired" | "exhausted"

type TokenRow = {
  id: string
  organizationName: string
  siteName: string
  scope: "Shared site" | "Shared imaging" | "Standard"
  routePolicyName: string
  status: TokenStatus
  uses: string
  expiresAt: Date | string | null
  createdAt: Date | string
}

function tokenStatusFor(token: {
  expiresAt: Date | string | null
  siteWide: boolean
  uses: number
  maxUses: number
}): TokenStatus {
  if (isEnrollmentTokenExpired(token.expiresAt)) return "expired"
  if (!token.siteWide && token.uses >= token.maxUses) return "exhausted"
  return "active"
}

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

function isEnrollmentTokenExpired(expiresAt: string | Date | null | undefined) {
  if (!expiresAt) {
    return false
  }

  return new Date(expiresAt).getTime() <= Date.now()
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
  const [mobileDetailOpen, setMobileDetailOpen] = React.useState(false)
  const [createOrganizationId, setCreateOrganizationId] = React.useState("")
  const [createSiteId, setCreateSiteId] = React.useState("")
  // `null` means the user hasn't chosen, so the organization default applies.
  const [chosenCreateRoutePolicyId, setChosenCreateRoutePolicyId] =
    React.useState<string | null>(null)
  const defaultCreatePolicy = routePolicies.find(
    (policy) =>
      policy.isDefault &&
      (policy.organizationId === null ||
        policy.organizationId === createOrganizationId)
  )
  const createRoutePolicyId =
    chosenCreateRoutePolicyId ?? defaultCreatePolicy?.id ?? ""
  const [createSiteWide, setCreateSiteWide] = React.useState(true)
  const [createExpiresAt, setCreateExpiresAt] = React.useState("")
  const [createMaxUses, setCreateMaxUses] = React.useState("1")
  const [createdToken, setCreatedToken] = React.useState("")
  const [revokeOpen, setRevokeOpen] = React.useState(false)
  const [rotateOpen, setRotateOpen] = React.useState(false)

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
      await Promise.all([
        utils.enrollmentTokens.list.invalidate(),
        utils.enrollmentTokens.reveal.invalidate({
          id: result.enrollmentToken.id,
        }),
        utils.organizations.imagingSsh.invalidate(),
      ])
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
  const rotateSecret = trpc.enrollmentTokens.rotateSecret.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.enrollmentTokens.list.invalidate(),
        selectedTokenId
          ? utils.enrollmentTokens.reveal.invalidate({ id: selectedTokenId })
          : Promise.resolve(),
      ])
      setRotateOpen(false)
      toast.success("Install commands are ready")
    },
    onError() {
      toast.error("We couldn't issue a new secret.")
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
  const secretQuery = trpc.enrollmentTokens.reveal.useQuery(
    { id: selectedTokenId },
    { enabled: Boolean(selectedTokenId) }
  )

  const imagingOrganizationId =
    createSiteId === "" && createOrganizationId
      ? createOrganizationId
      : selectedToken && !selectedToken.siteId
        ? selectedToken.organizationId
        : ""

  const imagingSshQuery = trpc.organizations.imagingSsh.useQuery(
    { organizationId: imagingOrganizationId },
    { enabled: Boolean(imagingOrganizationId) }
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

  const selectedTokenStatus: TokenStatus = selectedToken
    ? tokenStatusFor(selectedToken)
    : "active"

  const rows = React.useMemo<TokenRow[]>(
    () =>
      tokens.map((token) => ({
        id: token.id,
        organizationName: token.organizationName ?? "—",
        siteName: token.siteName ?? "Imaging",
        scope: token.siteWide
          ? token.siteId
            ? "Shared site"
            : "Shared imaging"
          : "Standard",
        routePolicyName: token.routePolicyName ?? "—",
        status: tokenStatusFor(token),
        uses: token.siteWide ? "Unlimited" : `${token.uses} / ${token.maxUses}`,
        expiresAt: token.expiresAt,
        createdAt: token.createdAt,
      })),
    [tokens]
  )

  const openToken = React.useCallback((id: string) => {
    setSelectedTokenId(id)
    setMobileDetailOpen(true)
  }, [])

  const columns = React.useMemo<ColumnDef<TokenRow>[]>(
    () => [
      {
        accessorKey: "organizationName",
        meta: { label: "Organization" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Organization" />
        ),
        cell: ({ row }) => (
          <span className="font-medium">{row.original.organizationName}</span>
        ),
      },
      {
        accessorKey: "siteName",
        meta: { label: "Site" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Site" />
        ),
      },
      {
        accessorKey: "scope",
        meta: { label: "Scope" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Scope" />
        ),
        cell: ({ row }) => (
          <Badge
            variant={
              row.original.scope === "Standard" ? "outline" : "secondary"
            }
          >
            {row.original.scope}
          </Badge>
        ),
      },
      {
        accessorKey: "routePolicyName",
        meta: { label: "Policy" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Policy" />
        ),
      },
      {
        accessorKey: "uses",
        enableSorting: false,
        meta: { label: "Uses" },
        header: "Uses",
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.uses}</span>
        ),
      },
      {
        accessorKey: "status",
        meta: { label: "Status" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Status" />
        ),
        cell: ({ row }) => (
          <Badge variant={tokenStatusVariant[row.original.status] ?? "outline"}>
            {statusLabel(row.original.status)}
          </Badge>
        ),
      },
      {
        accessorKey: "expiresAt",
        meta: { label: "Expires" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Expires" />
        ),
        sortingFn: (a, b) => {
          const left = a.original.expiresAt
            ? new Date(a.original.expiresAt).getTime()
            : Number.POSITIVE_INFINITY
          const right = b.original.expiresAt
            ? new Date(b.original.expiresAt).getTime()
            : Number.POSITIVE_INFINITY
          return left - right
        },
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.expiresAt
              ? formatRelativeTime(row.original.expiresAt)
              : "Never"}
          </span>
        ),
      },
      {
        accessorKey: "createdAt",
        meta: { label: "Created" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Created" />
        ),
        sortingFn: (a, b) =>
          new Date(a.original.createdAt).getTime() -
          new Date(b.original.createdAt).getTime(),
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
            actions={[
              {
                label: "Edit token",
                onSelect: () => openToken(row.original.id),
              },
              {
                label: "Revoke token",
                destructive: true,
                separatorBefore: true,
                onSelect: () => {
                  setSelectedTokenId(row.original.id)
                  setRevokeOpen(true)
                },
              },
            ]}
          />
        ),
      },
    ],
    [openToken]
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Enrollment tokens"
        title="Token workspace"
        description="Create a token, then copy the install commands. Selecting a token shows the same commands again."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <SectionCard
          className="order-2 lg:order-1"
          title="New token"
          description="Set the organization, optional site, policy, and use limit. Leave site empty for imaging tokens that never expire until revoked."
          collapsibleOnMobile
          contentClassName="flex flex-col gap-4"
        >
          <FormField label="Organization" htmlFor="token-create-organization">
            <SelectField
              id="token-create-organization"
              value={createOrganizationId}
              onValueChange={(value) => {
                setCreateOrganizationId(value)
                setCreateSiteId("")
              }}
              placeholder="Choose an organization"
              options={organizations.map((organization) => ({
                value: organization.id,
                label: organization.name,
              }))}
            />
          </FormField>
          <FormField
            label="Site"
            htmlFor="token-create-site"
            description="Optional. Use no site for mass imaging, then assign the location after install."
          >
            <SelectField
              id="token-create-site"
              value={createSiteId}
              onValueChange={setCreateSiteId}
              emptyLabel="No site (imaging)"
              options={createSites.map((site) => ({
                value: site.id,
                label: site.name,
              }))}
            />
          </FormField>
          <FormField label="Route policy" htmlFor="token-create-policy">
            <SelectField
              id="token-create-policy"
              value={createRoutePolicyId}
              onValueChange={setChosenCreateRoutePolicyId}
              emptyLabel="No policy"
              options={routePolicies.map((policy) => ({
                value: policy.id,
                label: policy.isDefault
                  ? `${policy.name} (default)`
                  : policy.name,
              }))}
            />
          </FormField>
          <div className="flex items-center gap-2">
            <Checkbox
              id="token-create-site-wide"
              checked={createSiteWide}
              onCheckedChange={(checked) => setCreateSiteWide(checked === true)}
            />
            <Label
              htmlFor="token-create-site-wide"
              className="text-sm font-normal"
            >
              Reusable shared token
            </Label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {createSiteId ? (
              <FormField label="Expires" htmlFor="token-create-expires">
                <Input
                  id="token-create-expires"
                  type="datetime-local"
                  value={createExpiresAt}
                  onChange={(event) => setCreateExpiresAt(event.target.value)}
                />
              </FormField>
            ) : (
              <p className="text-sm text-muted-foreground sm:col-span-2">
                Imaging tokens do not expire. Revoke them when they should stop
                working.
              </p>
            )}
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
              {createSiteId
                ? "Shared for this site until it expires or is revoked."
                : "Shared imaging token for this organization until it is revoked. All Linux hosts get the same SSH key so you can reach every imaged device."}
            </p>
          ) : null}
          {!createSiteId && createOrganizationId && !createSiteWide ? (
            <p className="text-sm text-muted-foreground">
              Imaging enrollments still use the organization SSH key so every
              Linux host can be reached after install.
            </p>
          ) : null}
          {!createSiteId && imagingSshQuery.data?.sshPublicKey ? (
            <CodeBlock
              label="Imaging SSH public key"
              value={imagingSshQuery.data.sshPublicKey}
            />
          ) : null}
          <Button
            className="w-full sm:w-fit"
            onClick={() => {
              void createToken.mutateAsync({
                organizationId: createOrganizationId,
                siteId: createSiteId || null,
                siteWide: createSiteWide,
                routePolicyId: createRoutePolicyId || null,
                expiresAt: createSiteId
                  ? fromDatetimeLocal(createExpiresAt)
                  : null,
                maxUses: createSiteWide ? 1 : Number(createMaxUses),
              })
            }}
            disabled={
              !createOrganizationId ||
              (!!createSiteId && !createExpiresAt) ||
              createToken.isPending
            }
          >
            Create token
          </Button>
          {createdToken ? (
            <div className="flex flex-col gap-3">
              <CodeBlock label="Enrollment token" value={createdToken} />
              <EnrollmentInstallCommands token={createdToken} />
            </div>
          ) : null}
        </SectionCard>

        <Card className="order-1 lg:order-2">
          <CardHeader>
            <CardTitle>Tokens</CardTitle>
            <CardDescription>
              Sort and filter tokens, then pick one to copy install commands,
              edit, or revoke it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={columns}
              data={rows}
              isLoading={tokensQuery.isLoading}
              getRowId={(row) => row.id}
              searchPlaceholder="Search tokens"
              facets={[
                {
                  columnId: "status",
                  title: "Status",
                  options: [
                    { value: "active", label: "Active" },
                    { value: "expired", label: "Expired" },
                    { value: "exhausted", label: "Exhausted" },
                  ],
                },
                {
                  columnId: "scope",
                  title: "Scope",
                  options: [
                    { value: "Shared site", label: "Shared site" },
                    { value: "Shared imaging", label: "Shared imaging" },
                    { value: "Standard", label: "Standard" },
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
              initialSorting={[{ id: "createdAt", desc: true }]}
              initialColumnVisibility={{ createdAt: false }}
              onRowClick={(row) => openToken(row.id)}
              isRowActive={(row) => row.id === selectedTokenId}
              emptyTitle="No tokens yet"
              emptyDescription="Create a token to enroll the first device."
            />
          </CardContent>
        </Card>
      </div>

      {selectedToken ? (
        <DetailSheet
          open={mobileDetailOpen}
          onOpenChange={setMobileDetailOpen}
          title="Edit token"
          description="Copy install commands, update settings, or revoke this token when it should no longer work."
          contentClassName="gap-6"
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Install commands</p>
              <p className="text-sm text-muted-foreground">
                Linux agent enrolls or attaches, then starts the service. Tunnel
                only sets up private access without the agent.
              </p>
            </div>
            {secretQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">
                Loading install commands…
              </p>
            ) : secretQuery.data?.token ? (
              <EnrollmentInstallCommands token={secretQuery.data.token} />
            ) : (
              <EmptyState
                title="Install commands unavailable"
                description="This token’s secret isn’t stored. Issue a new secret to copy commands. Commands that still use the old value will stop working."
                bordered
                action={
                  <Button
                    variant="outline"
                    onClick={() => setRotateOpen(true)}
                    disabled={rotateSecret.isPending}
                  >
                    Issue new secret
                  </Button>
                }
              />
            )}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Organization" htmlFor="token-edit-organization">
              <SelectField
                id="token-edit-organization"
                value={editOrganizationId}
                onValueChange={(value) => {
                  setEditOrganizationId(value)
                  setEditSiteId("")
                }}
                options={organizations.map((organization) => ({
                  value: organization.id,
                  label: organization.name,
                }))}
              />
            </FormField>
            <FormField
              label="Site"
              htmlFor="token-edit-site"
              description="Optional. Leave empty for imaging tokens assigned later."
            >
              <SelectField
                id="token-edit-site"
                value={editSiteId}
                onValueChange={setEditSiteId}
                emptyLabel="No site (imaging)"
                options={editSites.map((site) => ({
                  value: site.id,
                  label: site.name,
                }))}
              />
            </FormField>
            <FormField label="Route policy" htmlFor="token-edit-policy">
              <SelectField
                id="token-edit-policy"
                value={editRoutePolicyId}
                onValueChange={setEditRoutePolicyId}
                emptyLabel="No policy"
                options={routePolicies.map((policy) => ({
                  value: policy.id,
                  label: policy.name,
                }))}
              />
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
                Reusable shared token
              </Label>
            </div>
            {editSiteId ? (
              <FormField label="Expires" htmlFor="token-edit-expires">
                <Input
                  id="token-edit-expires"
                  type="datetime-local"
                  value={editExpiresAt}
                  onChange={(event) => setEditExpiresAt(event.target.value)}
                />
              </FormField>
            ) : (
              <p className="text-sm text-muted-foreground md:col-span-2">
                Imaging tokens do not expire. Revoke them when they should stop
                working.
              </p>
            )}
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
                {editSiteId
                  ? "Shared for this site until it expires or is revoked."
                  : "Shared imaging token for this organization until it is revoked."}
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
                className="w-full sm:w-auto"
                onClick={() => {
                  void updateToken.mutateAsync({
                    id: selectedToken.id,
                    organizationId: editOrganizationId,
                    siteId: editSiteId || null,
                    siteWide: editSiteWide,
                    routePolicyId: editRoutePolicyId || null,
                    expiresAt: editSiteId
                      ? fromDatetimeLocal(editExpiresAt)
                      : null,
                    maxUses: editSiteWide ? 1 : Number(editMaxUses),
                  })
                }}
                disabled={
                  !editOrganizationId ||
                  (!!editSiteId && !editExpiresAt) ||
                  updateToken.isPending
                }
              >
                Save changes
              </Button>
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => setRevokeOpen(true)}
                disabled={revokeToken.isPending}
              >
                Revoke token
              </Button>
            </div>
          </div>
        </DetailSheet>
      ) : null}

      <ConfirmDialog
        open={rotateOpen}
        onOpenChange={setRotateOpen}
        title="Issue a new secret"
        description="Install commands that still use the old secret will stop working. Devices that already enrolled are unaffected."
        confirmLabel="Issue new secret"
        pending={rotateSecret.isPending}
        onConfirm={() => {
          if (!selectedToken) return
          void rotateSecret.mutateAsync({ id: selectedToken.id })
        }}
      />
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
