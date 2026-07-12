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
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog"
import { EmptyState } from "@/components/dashboard/empty-state"
import { FormField, NativeSelect } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { cn } from "@/lib/utils"
import { trpc } from "@/lib/trpc"

export default function RoutePoliciesPage() {
  const utils = trpc.useUtils()
  const organizationsQuery = trpc.organizations.list.useQuery()
  const routePoliciesQuery = trpc.routePolicies.list.useQuery()
  const [selectedPolicyId, setSelectedPolicyId] = React.useState("")
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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Route policies"
        title="Allowed routes"
        description="Define the networks a device can reach once it joins the VPN."
      />

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>New policy</CardTitle>
            <CardDescription>
              Create a named route set for enrollment tokens and devices.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <FormField
              label="Organization"
              htmlFor="policy-create-organization"
            >
              <NativeSelect
                id="policy-create-organization"
                value={createOrganizationId}
                onChange={(event) =>
                  setCreateOrganizationId(event.target.value)
                }
              >
                <option value="">Choose an organization</option>
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </NativeSelect>
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
              className="w-fit"
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Policies</CardTitle>
            <CardDescription>
              Choose a policy to edit or remove it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Routes</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {routePoliciesQuery.isLoading ? (
                    <TableRow>
                      <TableCell colSpan={3} className="py-10">
                        <Skeleton className="h-5 w-40" />
                      </TableCell>
                    </TableRow>
                  ) : routePolicies.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="p-0">
                        <EmptyState
                          title="No route policies yet"
                          description="Create a policy to control what a device can reach."
                          bordered={false}
                        />
                      </TableCell>
                    </TableRow>
                  ) : (
                    routePolicies.map((policy) => (
                      <TableRow
                        key={policy.id}
                        className={cn(
                          "cursor-pointer",
                          selectedPolicyId === policy.id && "bg-muted/60"
                        )}
                        onClick={() => setSelectedPolicyId(policy.id)}
                      >
                        <TableCell className="font-medium">
                          {policy.name}
                        </TableCell>
                        <TableCell className="font-mono text-xs break-words">
                          {policy.routes.join(", ")}
                        </TableCell>
                        <TableCell>{policy.description ?? "—"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {selectedPolicy ? (
        <Card>
          <CardHeader>
            <CardTitle>Edit policy</CardTitle>
            <CardDescription>
              Adjust the selected route set or remove it.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
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
                onClick={() => setDeleteOpen(true)}
                disabled={deleteRoutePolicy.isPending}
              >
                Remove policy
              </Button>
            </div>
          </CardContent>
        </Card>
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
