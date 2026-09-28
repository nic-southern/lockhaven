"use client"

import * as React from "react"
import Link from "next/link"
import { keepPreviousData } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { FolderIcon, PlusIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { buildAssetLabelCsvRow, formatAssetLabelCsv } from "@nms/shared"

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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { downloadTextFile } from "@/lib/devices"
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
      filters: { isContainer: ["true"], parentAssetId: ["none"] },
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

  async function exportFolderLabels(folder: FolderRow) {
    try {
      const children = await utils.assets.children.fetch({
        parentAssetId: folder.id,
      })
      const rows: NonNullable<ReturnType<typeof buildAssetLabelCsvRow>>[] = []
      const push = (item: {
        tag: string
        serial: string | null
        siteName: string | null
        organizationName: string | null
      }) => {
        const row = buildAssetLabelCsvRow({
          tag: item.tag,
          serial: item.serial,
          siteName: item.siteName,
          companyName: item.organizationName,
        })
        if (row) rows.push(row)
      }
      push(folder)
      for (const child of children) push(child)
      if (rows.length === 0) {
        toast.error("No labels to export.")
        return
      }
      const stamp = new Date().toISOString().slice(0, 10)
      const slug = folder.tag
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
      downloadTextFile(
        `asset-labels-${slug || "folder"}-${stamp}.csv`,
        formatAssetLabelCsv(rows)
      )
      toast.success(
        `Exported ${rows.length} ${rows.length === 1 ? "label" : "labels"}`
      )
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "We couldn't export folder labels."
      )
    }
  }

  async function printFolderLabels(folder: FolderRow) {
    try {
      const children = await utils.assets.children.fetch({
        parentAssetId: folder.id,
      })
      const ids = [folder.id, ...children.map((child) => child.id)]
      router.push(`/assets/labels?ids=${ids.join(",")}`)
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "We couldn't open folder labels."
      )
    }
  }

  const columns = React.useMemo<ColumnDef<FolderRow>[]>(
    () => [
      {
        accessorKey: "tag",
        meta: { label: "Tracking tag" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Tracking tag" />
        ),
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2">
            <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-col gap-1">
              <Link
                href={`/assets/${row.original.id}`}
                className="font-mono text-sm font-medium hover:underline"
                onClick={(event) => event.stopPropagation()}
              >
                {row.original.tag}
              </Link>
              <Badge variant="outline" className="w-fit">
                Folder
              </Badge>
            </div>
          </div>
        ),
      },
      {
        id: "items",
        accessorFn: (row) => row.childCount ?? 0,
        meta: { label: "Items" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Items" />
        ),
        cell: ({ row }) => {
          const count = row.original.childCount ?? 0
          return (
            <span className="text-sm tabular-nums">
              {count} {count === 1 ? "item" : "items"}
            </span>
          )
        },
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
              {
                label: "Print labels",
                onSelect: () => void printFolderLabels(row.original),
              },
              {
                label: "Export labels",
                onSelect: () => void exportFolderLabels(row.original),
              },
            ]}
          />
        ),
      },
    ],
    // print/export close over utils + router; recreate when those change
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable utils client
    [router, utils]
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
        description="Browse parent folders as containers. Open one to see contained assets and print their tracking tags."
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
