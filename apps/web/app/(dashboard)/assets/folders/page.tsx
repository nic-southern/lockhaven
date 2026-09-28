"use client"

import * as React from "react"
import Link from "next/link"
import { keepPreviousData } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { PlusIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { AccessDenied } from "@/components/dashboard/access-denied"
import {
  DataTable,
  DataTableColumnHeader,
  DataTableRowActions,
} from "@/components/dashboard/data-table"
import { DetailSheet } from "@/components/dashboard/detail-sheet"
import { EmptyState } from "@/components/dashboard/empty-state"
import { FormField } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { SelectField } from "@/components/dashboard/select-field"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { trpc } from "@/lib/trpc"
import type { RouterOutputs } from "@/lib/trpc"
import { usePermissions } from "@/lib/use-permissions"

type FolderRow = RouterOutputs["assets"]["page"]["items"][number]

export default function AssetsFoldersPage() {
  return (
    <React.Suspense
      fallback={
        <div className="flex flex-col gap-6">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      }
    >
      <FoldersContent />
    </React.Suspense>
  )
}

function FoldersContent() {
  const router = useRouter()
  const { can, isLoading: accessLoading } = usePermissions()
  const canView = can("device:view")
  const canUpdate = can("device:update")
  const utils = trpc.useUtils()

  const [createOpen, setCreateOpen] = React.useState(false)
  const [organizationId, setOrganizationId] = React.useState("")
  const [siteId, setSiteId] = React.useState("")
  const [tag, setTag] = React.useState("")

  const organizationsQuery = trpc.organizations.list.useQuery(undefined, {
    enabled: canView,
  })
  const sitesQuery = trpc.sites.list.useQuery(undefined, { enabled: canView })
  const pageQuery = trpc.assets.page.useQuery(
    {
      limit: 200,
      filters: { isContainer: ["true"] },
    },
    { enabled: canView, placeholderData: keepPreviousData }
  )

  const organizations = organizationsQuery.data ?? []
  const sites = sitesQuery.data ?? []
  const items = (pageQuery.data?.items ?? []).filter(
    (item) => item.isContainer && !item.parentAssetId
  )

  const createFolder = trpc.assets.createFolder.useMutation({
    async onSuccess(record) {
      await utils.assets.page.invalidate()
      setCreateOpen(false)
      setTag("")
      setSiteId("")
      toast.success("Folder added")
      router.push(`/assets/${record.id}`)
    },
    onError(error) {
      toast.error(error.message || "We couldn't add the folder.")
    },
  })

  const columns = React.useMemo<ColumnDef<FolderRow>[]>(
    () => [
      {
        accessorKey: "tag",
        meta: { label: "Tracking tag" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Tracking tag" />
        ),
        cell: ({ row }) => (
          <Link
            href={`/assets/${row.original.id}`}
            className="font-mono text-sm font-medium hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {row.original.tag}
          </Link>
        ),
      },
      {
        accessorKey: "siteName",
        meta: { label: "Site" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Site" />
        ),
        cell: ({ row }) => row.original.siteName ?? "—",
      },
      {
        id: "organization",
        accessorFn: (row) => row.organizationName ?? "",
        meta: { label: "Organization" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Organization" />
        ),
        cell: ({ row }) => row.original.organizationName ?? "—",
      },
      {
        id: "presence",
        accessorFn: (row) => (row.managed ? "Managed" : "Unmanaged"),
        meta: { label: "Presence" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Presence" />
        ),
        cell: ({ row }) =>
          row.original.managed ? (
            <div className="flex min-w-0 flex-col">
              <span className="text-sm">Managed</span>
              {row.original.deviceId ? (
                <Link
                  href={`/devices/${row.original.deviceId}`}
                  className="truncate text-xs text-muted-foreground hover:underline"
                  onClick={(event) => event.stopPropagation()}
                >
                  {row.original.deviceName}
                </Link>
              ) : null}
            </div>
          ) : (
            "Unmanaged"
          ),
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        meta: { className: "w-12" },
        cell: ({ row }) => (
          <DataTableRowActions
            label={row.original.tag}
            actions={[
              {
                label: "Open folder",
                onSelect: () => router.push(`/assets/${row.original.id}`),
              },
            ]}
          />
        ),
      },
    ],
    [router]
  )

  if (accessLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }

  if (!canView) {
    return <AccessDenied />
  }

  const resolvedOrgId = organizationId || organizations[0]?.id || ""

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Folders"
        title="Folders"
        description="Top-level containers that hold tracked items. Open a folder to manage contents and labels."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link href="/assets">All assets</Link>
            </Button>
            {canUpdate ? (
              <Button
                onClick={() => {
                  setOrganizationId(organizations[0]?.id ?? "")
                  setSiteId("")
                  setTag("")
                  setCreateOpen(true)
                }}
              >
                <PlusIcon />
                Add folder
              </Button>
            ) : null}
          </div>
        }
      />

      <DataTable
        columns={columns}
        data={items}
        isLoading={pageQuery.isLoading}
        getRowId={(row) => row.id}
        searchPlaceholder="Search folders"
        initialSorting={[{ id: "tag", desc: false }]}
        onRowClick={(row) => router.push(`/assets/${row.id}`)}
        emptyTitle="No folders yet"
        emptyDescription="Add a folder with its own tracking tag, then place items inside it."
      />

      {items.length === 0 && !pageQuery.isLoading ? (
        <EmptyState
          title="No folders yet"
          description="Folders are assets marked as containers. Differentiate them by tracking tag."
        />
      ) : null}

      <DetailSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New folder"
        description="A folder has its own tracking tag and can hold contained items."
        className="sm:max-w-xl"
      >
        <div className="grid gap-4">
          <FormField label="Organization" htmlFor="folder-org">
            <SelectField
              id="folder-org"
              value={resolvedOrgId}
              onValueChange={(value) => {
                setOrganizationId(value)
                setSiteId("")
              }}
              placeholder="Choose an organization"
              options={organizations.map((organization) => ({
                value: organization.id,
                label: organization.name,
              }))}
            />
          </FormField>
          <FormField label="Tracking tag" htmlFor="folder-tag">
            <Input
              id="folder-tag"
              value={tag}
              onChange={(event) => setTag(event.target.value)}
              className="font-mono"
            />
          </FormField>
          <FormField label="Site" htmlFor="folder-site">
            <SelectField
              id="folder-site"
              value={siteId}
              onValueChange={setSiteId}
              placeholder="No site"
              emptyLabel="No site"
              options={sites
                .filter((site) => site.organizationId === resolvedOrgId)
                .map((site) => ({ value: site.id, label: site.name }))}
            />
          </FormField>
          <Button
            disabled={!resolvedOrgId || !tag.trim() || createFolder.isPending}
            onClick={() =>
              void createFolder.mutateAsync({
                organizationId: resolvedOrgId,
                siteId: siteId || null,
                tag: tag.trim(),
                status: "in_service",
              })
            }
          >
            Add folder
          </Button>
        </div>
      </DetailSheet>
    </div>
  )
}
