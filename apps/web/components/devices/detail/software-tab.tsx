"use client"

import * as React from "react"

import { Badge } from "@/components/ui/badge"
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
import { EmptyState } from "@/components/dashboard/empty-state"
import { SectionCard } from "@/components/dashboard/section-card"
import { formatDate, formatRelativeTime } from "@/lib/dashboard"
import { trpc } from "@/lib/trpc"

import type { DeviceDetail } from "./shared"

export function SoftwareTab({ device }: { device: DeviceDetail }) {
  const [search, setSearch] = React.useState("")
  const [updatesOnly, setUpdatesOnly] = React.useState(false)
  const packagesQuery = trpc.telemetry.packages.useQuery(
    {
      deviceId: device.id,
      search: search.trim() || undefined,
      updatesOnly,
    },
    { refetchInterval: 30_000 }
  )

  const data = packagesQuery.data
  const items = data?.items ?? []
  const updateCount = items.filter(
    (pkg) => pkg.availableVersion && pkg.availableVersion !== pkg.version
  ).length

  return (
    <div className="flex flex-col gap-6">
      {data?.rebootRequired ? (
        <SectionCard
          title="Restart pending"
          description="This device reported that a restart is needed to finish updates."
        >
          <Badge variant="destructive">Restart required</Badge>
        </SectionCard>
      ) : null}

      <SectionCard
        title="Installed software"
        description={
          data?.collectedAt
            ? `Last reported ${formatRelativeTime(data.collectedAt)}.`
            : "Packages reported by this device."
        }
        actions={
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={updatesOnly}
              onChange={(event) => setUpdatesOnly(event.target.checked)}
            />
            Updates only
          </label>
        }
        contentClassName="flex flex-col gap-4"
      >
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search software"
          aria-label="Search software"
        />

        {packagesQuery.isLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="No software inventory yet"
            description={
              search || updatesOnly
                ? "Nothing matches the current filters."
                : "Installed software will show up here after the next check-in."
            }
            bordered={false}
          />
        ) : (
          <>
            {updateCount > 0 && !updatesOnly ? (
              <p className="text-sm text-muted-foreground">
                {updateCount === 1
                  ? "1 update available."
                  : `${updateCount} updates available.`}
              </p>
            ) : null}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Update</TableHead>
                  <TableHead>Last seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((pkg) => {
                  const hasUpdate =
                    Boolean(pkg.availableVersion) &&
                    pkg.availableVersion !== pkg.version
                  return (
                    <TableRow key={pkg.id}>
                      <TableCell className="font-medium">{pkg.name}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {pkg.version || "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {pkg.source}
                      </TableCell>
                      <TableCell>
                        {hasUpdate ? (
                          <Badge variant="secondary">
                            {pkg.availableVersion}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell
                        className="text-xs text-muted-foreground"
                        title={formatDate(pkg.lastSeenAt)}
                      >
                        {formatRelativeTime(pkg.lastSeenAt)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </>
        )}
      </SectionCard>
    </div>
  )
}
