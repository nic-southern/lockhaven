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

export default function SitesPage() {
  const utils = trpc.useUtils()
  const organizationsQuery = trpc.organizations.list.useQuery()
  const sitesQuery = trpc.sites.list.useQuery()
  const devicesQuery = trpc.devices.list.useQuery()
  const [selectedSiteId, setSelectedSiteId] = React.useState("")

  const [createOrganizationId, setCreateOrganizationId] = React.useState("")
  const [createName, setCreateName] = React.useState("")
  const [createTimezone, setCreateTimezone] = React.useState("")
  const [createNotes, setCreateNotes] = React.useState("")
  const [editName, setEditName] = React.useState("")
  const [editTimezone, setEditTimezone] = React.useState("")
  const [editNotes, setEditNotes] = React.useState("")

  const createSite = trpc.sites.create.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.sites.list.invalidate(),
        utils.devices.list.invalidate(),
      ])
    },
  })

  const updateSite = trpc.sites.update.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.sites.list.invalidate(),
        utils.devices.list.invalidate(),
      ])
    },
  })

  const deleteSite = trpc.sites.delete.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.sites.list.invalidate(),
        utils.devices.list.invalidate(),
      ])
    },
  })

  const sites = sitesQuery.data ?? []
  const organizations = organizationsQuery.data ?? []
  const devices = devicesQuery.data ?? []

  React.useEffect(() => {
    if (sites.length === 0) {
      setSelectedSiteId("")
      return
    }

    if (!sites.some((site) => site.id === selectedSiteId)) {
      setSelectedSiteId(sites[0].id)
    }
  }, [selectedSiteId, sites])

  const selectedSite = React.useMemo(
    () => sites.find((site) => site.id === selectedSiteId) ?? null,
    [selectedSiteId, sites]
  )

  const deviceCountBySite = React.useMemo(() => {
    const counts = new Map<string, number>()

    for (const device of devices) {
      if (!device.siteId) continue
      counts.set(device.siteId, (counts.get(device.siteId) ?? 0) + 1)
    }

    return counts
  }, [devices])

  React.useEffect(() => {
    if (selectedSite) {
      setEditName(selectedSite.name)
      setEditTimezone(selectedSite.timezone ?? "")
      setEditNotes(selectedSite.notes ?? "")
    }
  }, [selectedSite?.id])

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-2">
        <Badge variant="outline" className="w-fit">
          Sites
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight">Locations</h1>
        <p className="text-sm text-muted-foreground">
          Create and update sites, then assign devices to the right location.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>New site</CardTitle>
            <CardDescription>
              Add a location for devices to live under.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Organization</span>
              <select
                className="h-10 rounded-md border bg-background px-3"
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
              </select>
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Name</span>
              <input
                className="h-10 rounded-md border bg-background px-3"
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Timezone</span>
              <input
                className="h-10 rounded-md border bg-background px-3"
                value={createTimezone}
                onChange={(event) => setCreateTimezone(event.target.value)}
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Notes</span>
              <textarea
                className="min-h-24 rounded-md border bg-background px-3 py-2"
                value={createNotes}
                onChange={(event) => setCreateNotes(event.target.value)}
              />
            </label>
            <Button
              onClick={() => {
                void createSite.mutateAsync({
                  organizationId: createOrganizationId,
                  name: createName,
                  timezone: createTimezone || null,
                  notes: createNotes || null,
                })
                setCreateName("")
                setCreateTimezone("")
                setCreateNotes("")
              }}
              disabled={
                !createOrganizationId || !createName || createSite.isPending
              }
            >
              Create site
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sites</CardTitle>
            <CardDescription>Choose a site to edit it inline.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Org</TableHead>
                    <TableHead>Devices</TableHead>
                    <TableHead>Timezone</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sitesQuery.isLoading ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="py-8 text-center text-muted-foreground"
                      >
                        <Skeleton className="h-5 w-40" />
                      </TableCell>
                    </TableRow>
                  ) : sites.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="py-8 text-center text-muted-foreground"
                      >
                        No sites yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    sites.map((site) => {
                      const organization = organizations.find(
                        (entry) => entry.id === site.organizationId
                      )
                      const deviceCount = deviceCountBySite.get(site.id) ?? 0

                      return (
                        <TableRow
                          key={site.id}
                          className={
                            selectedSiteId === site.id
                              ? "bg-muted/60"
                              : undefined
                          }
                          onClick={() => setSelectedSiteId(site.id)}
                        >
                          <TableCell className="font-medium">
                            {site.name}
                          </TableCell>
                          <TableCell>{organization?.name ?? "—"}</TableCell>
                          <TableCell>{deviceCount}</TableCell>
                          <TableCell>{site.timezone ?? "—"}</TableCell>
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

      {selectedSite ? (
        <Card>
          <CardHeader>
            <CardTitle>Edit site</CardTitle>
            <CardDescription>
              Update the selected location or remove it.
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
              <span className="font-medium">Timezone</span>
              <input
                className="h-10 rounded-md border bg-background px-3"
                value={editTimezone}
                onChange={(event) => setEditTimezone(event.target.value)}
              />
            </label>
            <label className="grid gap-2 text-sm md:col-span-2">
              <span className="font-medium">Notes</span>
              <textarea
                className="min-h-24 rounded-md border bg-background px-3 py-2"
                value={editNotes}
                onChange={(event) => setEditNotes(event.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-3 md:col-span-2">
              <Button
                onClick={() => {
                  void updateSite.mutateAsync({
                    id: selectedSite.id,
                    name: editName,
                    timezone: editTimezone || null,
                    notes: editNotes || null,
                  })
                }}
                disabled={!editName || updateSite.isPending}
              >
                Save changes
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  if (window.confirm(`Remove ${selectedSite.name}?`)) {
                    void deleteSite.mutateAsync({ id: selectedSite.id })
                  }
                }}
                disabled={deleteSite.isPending}
              >
                Remove site
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
