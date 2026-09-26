"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import type { ColumnDef } from "@tanstack/react-table"
import { ArrowLeftIcon, PrinterIcon, SettingsIcon } from "lucide-react"
import { keepPreviousData } from "@tanstack/react-query"

import { assetStatusLabels, type AssetStatus } from "@nms/shared"

import { AccessDenied } from "@/components/dashboard/access-denied"
import {
  DataTable,
  DataTableColumnHeader,
} from "@/components/dashboard/data-table"
import { EmptyState } from "@/components/dashboard/empty-state"
import { PageHeader } from "@/components/dashboard/page-header"
import { SectionCard } from "@/components/dashboard/section-card"
import { StatStrip } from "@/components/dashboard/stat-strip"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ConnectivityBadge } from "@/components/devices/connectivity-badge"
import { formatRelativeTime, statusLabel, statusVariant } from "@/lib/dashboard"
import { osFamilyLabel } from "@/lib/devices"
import { trpc } from "@/lib/trpc"
import { usePermissions } from "@/lib/use-permissions"
import type { RouterOutputs } from "@/lib/trpc"

type DeviceRow = RouterOutputs["devices"]["page"]["items"][number]
type AssetRow = RouterOutputs["assets"]["page"]["items"][number]

function formatMoney(value: string | null | undefined) {
  if (!value) return "—"
  const amount = Number(value)
  if (!Number.isFinite(amount)) return value
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  }).format(amount)
}

export default function SiteDetailPage() {
  return (
    <React.Suspense fallback={<SiteDetailSkeleton />}>
      <SiteDetail />
    </React.Suspense>
  )
}

function SiteDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  )
}

function SiteDetail() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const siteId = params.id
  const { can, isLoading: permissionsLoading } = usePermissions()
  const canViewDevices = can("device:view")
  const canViewValue = can("audit:view")
  const canManageSite = can("site:admin") || can("organization:admin")

  const sitesQuery = trpc.sites.list.useQuery(undefined, {
    enabled: !permissionsLoading,
  })
  const site = (sitesQuery.data ?? []).find((entry) => entry.id === siteId)

  const devicesQuery = trpc.devices.page.useQuery(
    {
      limit: 200,
      filters: { siteId: [siteId] },
    },
    {
      enabled: canViewDevices && Boolean(siteId),
      placeholderData: keepPreviousData,
      refetchInterval: 30_000,
    }
  )
  const assetsQuery = trpc.assets.page.useQuery(
    {
      limit: 200,
      filters: { siteId: [siteId] },
    },
    {
      enabled: canViewDevices && Boolean(siteId),
      placeholderData: keepPreviousData,
    }
  )
  const installedValueQuery = trpc.reports.installedValue.useQuery(
    { siteId },
    {
      enabled: canViewValue && Boolean(siteId),
    }
  )

  const devices = devicesQuery.data?.items ?? []
  const assets = assetsQuery.data?.items ?? []

  const deviceColumns = React.useMemo<ColumnDef<DeviceRow>[]>(
    () => [
      {
        accessorKey: "displayName",
        meta: { label: "Device" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Device" />
        ),
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <Link
              href={`/devices/${row.original.id}`}
              className="truncate font-medium hover:underline"
            >
              {row.original.displayName}
            </Link>
            {row.original.hostname &&
            row.original.hostname !== row.original.displayName ? (
              <span className="truncate font-mono text-xs text-muted-foreground">
                {row.original.hostname}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: "connectivity",
        accessorFn: (row) => row.connectivity,
        meta: { label: "Connectivity" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Connectivity" />
        ),
        cell: ({ row }) => (
          <ConnectivityBadge
            connectivity={row.original.connectivity}
            lastHandshakeAt={row.original.vpnLastHandshakeAt}
            showDetail={false}
          />
        ),
      },
      {
        accessorKey: "osFamily",
        meta: { label: "OS" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="OS" />
        ),
        cell: ({ row }) => osFamilyLabel(row.original.osFamily),
      },
      {
        accessorKey: "status",
        meta: { label: "Status" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Status" />
        ),
        cell: ({ row }) => (
          <Badge variant={statusVariant[row.original.status] ?? "secondary"}>
            {statusLabel(row.original.status)}
          </Badge>
        ),
      },
      {
        id: "asset",
        accessorFn: (row) => row.assetTag ?? "",
        meta: { label: "Tracking tag" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Tracking tag" />
        ),
        cell: ({ row }) =>
          row.original.assetTag && row.original.assetId ? (
            <Link
              href={`/assets?id=${row.original.assetId}`}
              className="font-mono text-xs hover:underline"
            >
              {row.original.assetTag}
            </Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "lastSeenAt",
        meta: { label: "Last seen" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Last seen" />
        ),
        cell: ({ row }) =>
          row.original.lastSeenAt
            ? formatRelativeTime(row.original.lastSeenAt)
            : "—",
      },
    ],
    []
  )

  const assetColumns = React.useMemo<ColumnDef<AssetRow>[]>(
    () => [
      {
        accessorKey: "tag",
        meta: { label: "Tracking tag" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Tracking tag" />
        ),
        cell: ({ row }) => (
          <Link
            href={`/assets?id=${row.original.id}`}
            className="font-mono text-sm font-medium hover:underline"
          >
            {row.original.tag}
          </Link>
        ),
      },
      {
        id: "deviceModel",
        accessorFn: (row) => row.deviceModelName ?? row.model ?? "",
        meta: { label: "Device model" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Device model" />
        ),
        cell: ({ row }) =>
          row.original.deviceModelName ??
          ([row.original.vendor, row.original.model]
            .filter(Boolean)
            .join(" ") ||
            "—"),
      },
      {
        accessorKey: "serial",
        meta: { label: "Serial" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Serial" />
        ),
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {row.original.serial ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "status",
        meta: { label: "Status" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Status" />
        ),
        cell: ({ row }) => (
          <Badge variant="secondary">
            {assetStatusLabels[row.original.status as AssetStatus]}
          </Badge>
        ),
      },
      {
        id: "device",
        accessorFn: (row) => row.deviceName ?? "",
        meta: { label: "Device" },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Device" />
        ),
        cell: ({ row }) =>
          row.original.deviceId ? (
            <Link
              href={`/devices/${row.original.deviceId}`}
              className="hover:underline"
            >
              {row.original.deviceName}
            </Link>
          ) : (
            <span className="text-muted-foreground">Not linked</span>
          ),
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        meta: { className: "w-12" },
        cell: ({ row }) => (
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/assets/labels?ids=${row.original.id}`}>
              <PrinterIcon />
              <span className="sr-only">Print label</span>
            </Link>
          </Button>
        ),
      },
    ],
    []
  )

  if (permissionsLoading || sitesQuery.isLoading) {
    return <SiteDetailSkeleton />
  }

  if (!canViewDevices && !canManageSite && !canViewValue) {
    return <AccessDenied />
  }

  if (!site) {
    return (
      <div className="flex flex-col gap-6">
        <Button variant="ghost" size="sm" className="w-fit" asChild>
          <Link href="/sites">
            <ArrowLeftIcon />
            All sites
          </Link>
        </Button>
        <Card>
          <CardContent className="py-8">
            <EmptyState
              title="Site not found"
              description="It may have been removed, or you may not have access to it."
              bordered={false}
              action={
                <Button asChild>
                  <Link href="/sites">Back to sites</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 w-fit text-muted-foreground"
          asChild
        >
          <Link href="/sites">
            <ArrowLeftIcon />
            All sites
          </Link>
        </Button>

        <PageHeader
          title={site.name}
          description={[
            site.timezone?.replaceAll("_", " "),
            `${devices.length} device${devices.length === 1 ? "" : "s"}`,
            `${assets.length} asset${assets.length === 1 ? "" : "s"}`,
          ]
            .filter(Boolean)
            .join(" · ")}
          actions={
            canManageSite ? (
              <Button
                variant="outline"
                onClick={() =>
                  router.push(`/sites?edit=${encodeURIComponent(site.id)}`)
                }
              >
                <SettingsIcon />
                Site settings
              </Button>
            ) : null
          }
        />
      </div>

      {canViewValue ? (
        <SectionCard
          title="Installed value"
          description="Replacement value of linked in-service assets at this site. Assets with no cost set are left out of the totals."
          contentClassName="gap-4"
          actions={
            <Button variant="outline" size="sm" asChild>
              <Link
                href={`/reports?tab=value&siteId=${encodeURIComponent(site.id)}`}
              >
                Open report
              </Link>
            </Button>
          }
        >
          {installedValueQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <>
              <StatStrip
                items={[
                  {
                    label: "In service (linked)",
                    value: installedValueQuery.data?.inServiceLinkedCount ?? 0,
                  },
                  {
                    label: "Replacement value",
                    value: formatMoney(
                      installedValueQuery.data?.totalInstalledValue
                    ),
                  },
                  {
                    label: "Purchase value",
                    value: formatMoney(
                      installedValueQuery.data?.totalPurchaseValue
                    ),
                  },
                  {
                    label: "No cost set",
                    value: installedValueQuery.data?.noCostCount ?? 0,
                    hint:
                      (installedValueQuery.data?.noCostCount ?? 0) > 0
                        ? "Excluded from dollar totals"
                        : undefined,
                  },
                ]}
              />
              {(installedValueQuery.data?.noCostCount ?? 0) > 0 ? (
                <p className="text-sm text-muted-foreground">
                  Set purchase or replacement cost on the device model under
                  Settings → Device models so these assets count toward
                  installed value.
                </p>
              ) : null}
            </>
          )}
        </SectionCard>
      ) : null}

      {canViewDevices ? (
        <SectionCard
          title="Devices"
          description="Devices assigned to this location."
          contentClassName="gap-4"
        >
          <DataTable
            columns={deviceColumns}
            data={devices}
            isLoading={devicesQuery.isLoading}
            getRowId={(row) => row.id}
            searchPlaceholder="Search devices"
            initialSorting={[{ id: "displayName", desc: false }]}
            onRowClick={(row) => router.push(`/devices/${row.id}`)}
            emptyTitle="No devices at this site"
            emptyDescription="Assign a device to this location from its settings, or enroll one here."
          />
        </SectionCard>
      ) : null}

      {canViewDevices ? (
        <SectionCard
          title="Assets"
          description="Assets linked to this location, including tracking tags from the agent."
          contentClassName="gap-4"
          actions={
            assets.length > 0 ? (
              <Button variant="outline" size="sm" asChild>
                <Link
                  href={`/assets/labels?ids=${assets.map((asset) => asset.id).join(",")}`}
                >
                  <PrinterIcon />
                  Print labels
                </Link>
              </Button>
            ) : null
          }
        >
          {assetsQuery.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : assets.length === 0 ? (
            <EmptyState
              title="No assets at this site"
              description="Assets show up here when they are linked to this location, or when a device at this site creates one on check-in."
              bordered={false}
            />
          ) : (
            <DataTable
              columns={assetColumns}
              data={assets}
              getRowId={(row) => row.id}
              searchPlaceholder="Search assets"
              initialSorting={[{ id: "tag", desc: false }]}
              onRowClick={(row) => router.push(`/assets?id=${row.id}`)}
              emptyTitle="No assets at this site"
              emptyDescription="Assets show up here when they are linked to this location."
            />
          )}
        </SectionCard>
      ) : null}
    </div>
  )
}
