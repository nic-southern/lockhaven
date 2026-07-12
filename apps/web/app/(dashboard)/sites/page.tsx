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
import { CodeBlock } from "@/components/dashboard/code-block"
import { DetailSheet } from "@/components/dashboard/detail-sheet"
import { EmptyState } from "@/components/dashboard/empty-state"
import { FormField, NativeSelect } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { SectionCard } from "@/components/dashboard/section-card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { trpc } from "@/lib/trpc"

export default function SitesPage() {
  const utils = trpc.useUtils()
  const organizationsQuery = trpc.organizations.list.useQuery()
  const sitesQuery = trpc.sites.list.useQuery()
  const devicesQuery = trpc.devices.list.useQuery()
  const [selectedSiteId, setSelectedSiteId] = React.useState("")
  const [mobileDetailOpen, setMobileDetailOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)

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
      setCreateName("")
      setCreateTimezone("")
      setCreateNotes("")
      toast.success("Site created")
    },
    onError() {
      toast.error("We couldn't create the site.")
    },
  })

  const updateSite = trpc.sites.update.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.sites.list.invalidate(),
        utils.devices.list.invalidate(),
      ])
      toast.success("Site updated")
    },
    onError() {
      toast.error("We couldn't update the site.")
    },
  })

  const deleteSite = trpc.sites.delete.useMutation({
    async onSuccess() {
      await Promise.all([
        utils.sites.list.invalidate(),
        utils.devices.list.invalidate(),
      ])
      setDeleteOpen(false)
      toast.success("Site removed")
    },
    onError() {
      toast.error("We couldn't remove the site.")
    },
  })

  const sites = React.useMemo(() => sitesQuery.data ?? [], [sitesQuery.data])
  const organizations = React.useMemo(
    () => organizationsQuery.data ?? [],
    [organizationsQuery.data]
  )
  const devices = React.useMemo(
    () => devicesQuery.data ?? [],
    [devicesQuery.data]
  )

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
  }, [selectedSite])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Sites"
        title="Locations"
        description="Create and update sites, then assign devices to the right location."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <SectionCard
          className="order-2 lg:order-1"
          title="New site"
          description="Add a location for devices to live under. An SSH key is created automatically."
          collapsibleOnMobile
          contentClassName="flex flex-col gap-4"
        >
          <FormField label="Organization" htmlFor="site-create-organization">
            <NativeSelect
              id="site-create-organization"
              value={createOrganizationId}
              onChange={(event) => setCreateOrganizationId(event.target.value)}
            >
              <option value="">Choose an organization</option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Name" htmlFor="site-create-name">
            <Input
              id="site-create-name"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
            />
          </FormField>
          <FormField label="Timezone" htmlFor="site-create-timezone">
            <Input
              id="site-create-timezone"
              value={createTimezone}
              onChange={(event) => setCreateTimezone(event.target.value)}
            />
          </FormField>
          <FormField label="Notes" htmlFor="site-create-notes">
            <Textarea
              id="site-create-notes"
              value={createNotes}
              onChange={(event) => setCreateNotes(event.target.value)}
            />
          </FormField>
          <Button
            className="w-full sm:w-fit"
            onClick={() => {
              void createSite.mutateAsync({
                organizationId: createOrganizationId,
                name: createName,
                timezone: createTimezone || null,
                notes: createNotes || null,
              })
            }}
            disabled={
              !createOrganizationId || !createName || createSite.isPending
            }
          >
            Create site
          </Button>
        </SectionCard>

        <Card className="order-1 lg:order-2">
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
                    <TableHead>SSH</TableHead>
                    <TableHead>Timezone</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sitesQuery.isLoading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-10">
                        <Skeleton className="h-5 w-40" />
                      </TableCell>
                    </TableRow>
                  ) : sites.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="p-0">
                        <EmptyState
                          title="No sites yet"
                          description="Create a site to start assigning devices to a location."
                          bordered={false}
                        />
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
                          className={cn(
                            "cursor-pointer",
                            selectedSiteId === site.id && "bg-muted/60"
                          )}
                          onClick={() => {
                            setSelectedSiteId(site.id)
                            setMobileDetailOpen(true)
                          }}
                        >
                          <TableCell className="font-medium">
                            {site.name}
                          </TableCell>
                          <TableCell>{organization?.name ?? "—"}</TableCell>
                          <TableCell>{deviceCount}</TableCell>
                          <TableCell>
                            {site.hasSshCredential ? (
                              <Badge variant="secondary">Ready</Badge>
                            ) : (
                              <Badge variant="outline">None</Badge>
                            )}
                          </TableCell>
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
        <DetailSheet
          open={mobileDetailOpen}
          onOpenChange={setMobileDetailOpen}
          title="Edit site"
          description="Update the selected location or remove it."
          contentClassName="gap-6"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Name" htmlFor="site-edit-name">
              <Input
                id="site-edit-name"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
              />
            </FormField>
            <FormField label="Timezone" htmlFor="site-edit-timezone">
              <Input
                id="site-edit-timezone"
                value={editTimezone}
                onChange={(event) => setEditTimezone(event.target.value)}
              />
            </FormField>
            <FormField
              label="Notes"
              htmlFor="site-edit-notes"
              className="md:col-span-2"
            >
              <Textarea
                id="site-edit-notes"
                value={editNotes}
                onChange={(event) => setEditNotes(event.target.value)}
              />
            </FormField>
            <div className="flex flex-wrap gap-3 md:col-span-2">
              <Button
                className="w-full sm:w-auto"
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
                className="w-full sm:w-auto"
                onClick={() => setDeleteOpen(true)}
                disabled={deleteSite.isPending}
              >
                Remove site
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t pt-6">
            <div>
              <p className="text-sm font-medium">SSH access</p>
              <p className="text-sm text-muted-foreground">
                A key is created with the site. Enrollment installs it on
                devices automatically.
              </p>
            </div>
            {selectedSite.hasSshCredential && selectedSite.sshPublicKey ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Username: {selectedSite.sshUsername ?? "root"}
                </p>
                <CodeBlock
                  label="Public key"
                  value={selectedSite.sshPublicKey}
                />
              </>
            ) : (
              <EmptyState
                title="SSH key pending"
                description="This location does not have an SSH key yet. Create a new site to provision one automatically."
              />
            )}
          </div>
        </DetailSheet>
      ) : null}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Remove site"
        description={
          selectedSite
            ? `Remove ${selectedSite.name}? Devices assigned to it will lose this site.`
            : "Remove this site?"
        }
        confirmLabel="Remove site"
        destructive
        pending={deleteSite.isPending}
        onConfirm={() => {
          if (!selectedSite) return
          void deleteSite.mutateAsync({ id: selectedSite.id })
        }}
      />
    </div>
  )
}
