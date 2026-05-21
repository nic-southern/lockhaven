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
import { trpc } from "@/lib/trpc"

export default function RoutePoliciesPage() {
  const utils = trpc.useUtils()
  const routePoliciesQuery = trpc.routePolicies.list.useQuery()
  const [selectedPolicyId, setSelectedPolicyId] = React.useState("")

  const [createName, setCreateName] = React.useState("")
  const [createDescription, setCreateDescription] = React.useState("")
  const [createRoutes, setCreateRoutes] = React.useState("10.80.0.1/32")

  const [editName, setEditName] = React.useState("")
  const [editDescription, setEditDescription] = React.useState("")
  const [editRoutes, setEditRoutes] = React.useState("")

  const createRoutePolicy = trpc.routePolicies.create.useMutation({
    async onSuccess() {
      await utils.routePolicies.list.invalidate()
    },
  })
  const updateRoutePolicy = trpc.routePolicies.update.useMutation({
    async onSuccess() {
      await utils.routePolicies.list.invalidate()
    },
  })
  const deleteRoutePolicy = trpc.routePolicies.delete.useMutation({
    async onSuccess() {
      await utils.routePolicies.list.invalidate()
    },
  })

  const routePolicies = routePoliciesQuery.data ?? []

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
  }, [selectedPolicy?.id])

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-2">
        <Badge variant="outline" className="w-fit">
          Route policies
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight">
          Allowed routes
        </h1>
        <p className="text-sm text-muted-foreground">
          Define the networks a device can reach once it joins the VPN.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>New policy</CardTitle>
            <CardDescription>
              Create a named route set for enrollment tokens and devices.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Name</span>
              <input
                className="h-10 rounded-md border bg-background px-3"
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Routes</span>
              <textarea
                className="min-h-32 rounded-md border bg-background px-3 py-2 font-mono text-xs"
                value={createRoutes}
                onChange={(event) => setCreateRoutes(event.target.value)}
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Description</span>
              <textarea
                className="min-h-24 rounded-md border bg-background px-3 py-2"
                value={createDescription}
                onChange={(event) => setCreateDescription(event.target.value)}
              />
            </label>
            <Button
              onClick={() => {
                void createRoutePolicy.mutateAsync({
                  name: createName,
                  routes: createRoutes
                    .split("\n")
                    .map((route) => route.trim())
                    .filter(Boolean),
                  description: createDescription || null,
                })
                setCreateName("")
                setCreateDescription("")
                setCreateRoutes("")
              }}
              disabled={!createName || createRoutePolicy.isPending}
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
                      <TableCell
                        colSpan={3}
                        className="py-8 text-center text-muted-foreground"
                      >
                        <Skeleton className="h-5 w-40" />
                      </TableCell>
                    </TableRow>
                  ) : routePolicies.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={3}
                        className="py-8 text-center text-muted-foreground"
                      >
                        No route policies yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    routePolicies.map((policy) => (
                      <TableRow
                        key={policy.id}
                        className={
                          selectedPolicyId === policy.id
                            ? "bg-muted/60"
                            : undefined
                        }
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
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Name</span>
              <input
                className="h-10 rounded-md border bg-background px-3"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Description</span>
              <textarea
                className="min-h-24 rounded-md border bg-background px-3 py-2"
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
              />
            </label>
            <label className="grid gap-2 text-sm md:col-span-2">
              <span className="font-medium">Routes</span>
              <textarea
                className="min-h-32 rounded-md border bg-background px-3 py-2 font-mono text-xs"
                value={editRoutes}
                onChange={(event) => setEditRoutes(event.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-3 md:col-span-2">
              <Button
                onClick={() => {
                  void updateRoutePolicy.mutateAsync({
                    id: selectedPolicy.id,
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
                onClick={() => {
                  if (window.confirm(`Remove ${selectedPolicy.name}?`)) {
                    void deleteRoutePolicy.mutateAsync({
                      id: selectedPolicy.id,
                    })
                  }
                }}
                disabled={deleteRoutePolicy.isPending}
              >
                Remove policy
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
