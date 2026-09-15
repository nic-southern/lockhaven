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
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog"
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
import { trpc } from "@/lib/trpc"
import type { ColumnDef } from "@tanstack/react-table"

type RoutePolicyRow = {
  id: string
  organizationId: string | null
  organizationName: string
  name: string
  routes: string[]
  routeCount: number
  description: string | null
}

export default function RoutePoliciesPage() {
  const utils = trpc.useUtils()
  const organizationsQuery = trpc.organizations.list.useQuery()
  const routePoliciesQuery = trpc.routePolicies.list.useQuery()
  const [selectedPolicyId, setSelectedPolicyId] = React.useState("")
  const [mobileDetailOpen, setMobileDetailOpen] = React.useState(false)
  const [createOrganizationId, setCreateOrganizationId] = React.useState("")
  const [deleteOpen, setDeleteOpen] = React.useState(false)

  const [createName, setCreateName] = React.useState("")
  const [createDescription, setCreateDescription] = React.useState("")
  const [createRoutes, setCreateRoutes] = React.useState("10.80.0.1/32")

  const [editName, setEditName] = React.useState("")
  const [editDescription, setEditDescription] = React.useState("")
  const [editRoutes, setEditRoutes] = React.useState("")

  const createRoutePolicy = trpc.routePolicies.create.useMutation({
    async onSuccess() {
      await utils.routePolicies.list.invalidate()
      setCreateName("")
      setCreateDescription("")
      setCreateRoutes("")
      toast.success("Route policy created")
    },
    onError() {
      toast.error("We couldn't create the route policy.")
    },
  })
  const updateRoutePolicy = trpc.routePolicies.update.useMutation({
    async onSuccess() {
      await utils.routePolicies.list.invalidate()
      toast.success("Route policy updated")
    },
    onError() {
      toast.error("We couldn't update the route policy.")
    },
  })
  const deleteRoutePolicy = trpc.routePolicies.delete.useMutation({
    async onSuccess() {
      await utils.routePolicies.list.invalidate()
      setDeleteOpen(false)
      toast.success("Route policy removed")
    },
    onError() {
      toast.error("We couldn't remove the route policy.")
    },
  })

  const routePolicies = React.useMemo(
    () => routePoliciesQuery.data ?? [],
    [routePoliciesQuery.data]
  )
  const organizations = React.useMemo(
    () => organizationsQuery.data ?? [],
    [organizationsQuery.data]
  )

  React.useEffect(() => {
    if (organizations.length > 0 && !createOrganizationId) {
      setCreateOrganizationId(organizations[0].id)
    }
  }, [createOrganizationId, organizations])

  React.useEffect(() => {
    if (routePolicies.length === 0) {
      setSelectedPolicyId("")
      return
    }

    if (!routePolicies.some((policy) => policy.id === selectedPolicyId)) {
      setSelectedPolicyId(routePolicies[0].id)
    }
  }, [routePolicies, selectedPolicyId])

  const selectedPolicy = React.useMemo(
    () =>
      routePolicies.find((policy) => policy.id === selectedPolicyId) ?? null,
    [routePolicies, selectedPolicyId]
  )

  React.useEffect(() => {
    if (selectedPolicy) {
      setEditName(selectedPolicy.name)
      setEditDescription(selectedPolicy.description ?? "")
      setEditRoutes(selectedPolicy.routes.join("\n"))
    }
  }, [selectedPolicy])

  const rows = React.useMemo<RoutePolicyRow[]>(
    () =>
      routePolicies.map((policy) => ({
        id: policy.id,
        organizationId: policy.organizationId,
        organizationName:
          organizations.find((entry) => entry.id === policy.organizationId)
            ?.name ?? "Shared",
        name: policy.name,
        routes: policy.routes,
        routeCount: policy.routes.length,
        description: policy.description,
      })),
    [organizations, routePolicies]
  )

  const openPolicy = React.useCallback((id: string) => {
    setSelectedPolicyId(id)
    setMobileDetailOpen(true)
  }, [])

  const columns = React.useMemo<ColumnDef<RoutePolicyRow>[]>(
    () => [
      {
        accessorKey: "name",
        meta: { label: "Name" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Name" />
        ),
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name}</span>
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
        id: "routes",
        accessorFn: (row) => row.routes.join(" "),
        enableSorting: false,
        meta: { label: "Routes" },
        header: "Routes",
        cell: ({ row }) => (
          <div className="flex max-w-md flex-wrap gap-1">
            {row.original.routes.slice(0, 4).map((route) => (
              <Badge
                key={route}
                variant="outline"
                className="font-mono text-[11px]"
              >
                {route}
              </Badge>
            ))}
            {row.original.routes.length > 4 ? (
              <Badge variant="secondary" className="text-[11px]">
                +{row.original.routes.length - 4} more
              </Badge>
            ) : null}
            {row.original.routes.length === 0 ? (
              <span className="text-sm text-muted-foreground">—</span>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: "routeCount",
        meta: { label: "Count", align: "right" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Count" align="right" />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.routeCount}</span>
        ),
      },
      {
        accessorKey: "description",
        meta: { label: "Description" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Description" />
        ),
        cell: ({ row }) => (
          <span className="line-clamp-1 max-w-xs text-muted-foreground">
            {row.original.description ?? "—"}
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
                label: "Edit policy",
                onSelect: () => openPolicy(row.original.id),
              },
              {
                label: "Remove policy",
                destructive: true,
                separatorBefore: true,
                onSelect: () => {
                  setSelectedPolicyId(row.original.id)
                  setDeleteOpen(true)
                },
              },
            ]}
          />
        ),
      },
    ],
    [openPolicy]
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Route policies"
        title="Allowed routes"
        description="Define the networks a device can reach once it joins the VPN."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <SectionCard
          className="order-2 lg:order-1"
          title="New policy"
          description="Create a named route set for enrollment tokens and devices."
          collapsibleOnMobile
          contentClassName="flex flex-col gap-4"
        >
          <FormField label="Organization" htmlFor="policy-create-organization">
            <SelectField
              id="policy-create-organization"
              value={createOrganizationId}
              onValueChange={setCreateOrganizationId}
              placeholder="Choose an organization"
              options={organizations.map((organization) => ({
                value: organization.id,
                label: organization.name,
              }))}
            />
          </FormField>
          <FormField label="Name" htmlFor="policy-create-name">
            <Input
              id="policy-create-name"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
            />
          </FormField>
          <FormField
            label="Routes"
            htmlFor="policy-create-routes"
            description="One CIDR per line."
          >
            <Textarea
              id="policy-create-routes"
              className="min-h-32 font-mono text-xs"
              value={createRoutes}
              onChange={(event) => setCreateRoutes(event.target.value)}
            />
          </FormField>
          <FormField label="Description" htmlFor="policy-create-description">
            <Textarea
              id="policy-create-description"
              value={createDescription}
              onChange={(event) => setCreateDescription(event.target.value)}
            />
          </FormField>
          <Button
            className="w-full sm:w-fit"
            onClick={() => {
              void createRoutePolicy.mutateAsync({
                organizationId: createOrganizationId,
                name: createName,
                routes: createRoutes
                  .split("\n")
                  .map((route) => route.trim())
                  .filter(Boolean),
                description: createDescription || null,
              })
            }}
            disabled={
              !createOrganizationId ||
              !createName ||
              createRoutePolicy.isPending
            }
          >
            Create policy
          </Button>
        </SectionCard>

        <Card className="order-1 lg:order-2">
          <CardHeader>
            <CardTitle>Policies</CardTitle>
            <CardDescription>
              Sort, filter, and pick a policy to edit or remove it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={columns}
              data={rows}
              isLoading={routePoliciesQuery.isLoading}
              getRowId={(row) => row.id}
              searchPlaceholder="Search policies or routes"
              facets={[
                {
                  columnId: "organizationName",
                  title: "Organization",
                  options: [
                    ...organizations.map((organization) => ({
                      value: organization.name,
                      label: organization.name,
                    })),
                    { value: "Shared", label: "Shared" },
                  ],
                },
              ]}
              initialSorting={[{ id: "name", desc: false }]}
              onRowClick={(row) => openPolicy(row.id)}
              isRowActive={(row) => row.id === selectedPolicyId}
              emptyTitle="No route policies yet"
              emptyDescription="Create a policy to control what a device can reach."
            />
          </CardContent>
        </Card>
      </div>

      {selectedPolicy ? (
        <DetailSheet
          open={mobileDetailOpen}
          onOpenChange={setMobileDetailOpen}
          title="Edit policy"
          description="Adjust the selected route set or remove it."
          contentClassName="gap-6"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Name" htmlFor="policy-edit-name">
              <Input
                id="policy-edit-name"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
              />
            </FormField>
            <FormField label="Description" htmlFor="policy-edit-description">
              <Textarea
                id="policy-edit-description"
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
              />
            </FormField>
            <FormField
              label="Routes"
              htmlFor="policy-edit-routes"
              description="One CIDR per line."
              className="md:col-span-2"
            >
              <Textarea
                id="policy-edit-routes"
                className="min-h-32 font-mono text-xs"
                value={editRoutes}
                onChange={(event) => setEditRoutes(event.target.value)}
              />
            </FormField>
            <div className="flex flex-wrap gap-3 md:col-span-2">
              <Button
                className="w-full sm:w-auto"
                onClick={() => {
                  void updateRoutePolicy.mutateAsync({
                    id: selectedPolicy.id,
                    organizationId:
                      selectedPolicy.organizationId ?? createOrganizationId,
                    name: editName,
                    routes: editRoutes
                      .split("\n")
                      .map((route) => route.trim())
                      .filter(Boolean),
                    description: editDescription || null,
                  })
                }}
                disabled={!editName || updateRoutePolicy.isPending}
              >
                Save changes
              </Button>
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => setDeleteOpen(true)}
                disabled={deleteRoutePolicy.isPending}
              >
                Remove policy
              </Button>
            </div>
          </div>
        </DetailSheet>
      ) : null}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Remove route policy"
        description={
          selectedPolicy
            ? `Remove ${selectedPolicy.name}? Devices and tokens using it will lose this route set.`
            : "Remove this route policy?"
        }
        confirmLabel="Remove policy"
        destructive
        pending={deleteRoutePolicy.isPending}
        onConfirm={() => {
          if (!selectedPolicy) return
          void deleteRoutePolicy.mutateAsync({ id: selectedPolicy.id })
        }}
      />
    </div>
  )
}
