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
import { StatusIndicator } from "@/components/dashboard/status-indicator"
import { formatDate, formatRelativeTime } from "@/lib/dashboard"
import { trpc } from "@/lib/trpc"

import type { DeviceDetail } from "./shared"

function titleStatus(running: boolean | null | undefined) {
  if (running == null) {
    return { label: "—", tone: "neutral" as const, pulse: false }
  }
  if (running) {
    return { label: "Running", tone: "online" as const, pulse: true }
  }
  return { label: "Not running", tone: "offline" as const, pulse: false }
}

export function SoftwareTab({ device }: { device: DeviceDetail }) {
  const [search, setSearch] = React.useState("")
  const [updatesOnly, setUpdatesOnly] = React.useState(false)
  const [notRunningOnly, setNotRunningOnly] = React.useState(false)
  const trimmedSearch = search.trim() || undefined

  const titlesQuery = trpc.telemetry.titles.useQuery(
    {
      deviceId: device.id,
      search: trimmedSearch,
      notRunningOnly,
    },
    { refetchInterval: 30_000 }
  )
  const packagesQuery = trpc.telemetry.packages.useQuery(
    {
      deviceId: device.id,
      search: trimmedSearch,
      updatesOnly,
    },
    { refetchInterval: 30_000 }
  )

  const titles = titlesQuery.data
  const titleItems = titles?.items ?? []
  const packages = packagesQuery.data
  const packageItems = packages?.items ?? []
  const updateCount = packageItems.filter(
    (pkg) => pkg.availableVersion && pkg.availableVersion !== pkg.version
  ).length

  return (
    <div className="flex flex-col gap-6">
      {packages?.rebootRequired ? (
        <SectionCard
          title="Restart pending"
          description="This device reported that a restart is needed to finish updates."
        >
          <Badge variant="destructive">Restart required</Badge>
        </SectionCard>
      ) : null}

      <SectionCard
        title="Titles"
        description={
          titles?.collectedAt
            ? `Last reported ${formatRelativeTime(titles.collectedAt)}.`
            : "Title, build, and running status reported by this device."
        }
        actions={
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={notRunningOnly}
              onChange={(event) => setNotRunningOnly(event.target.checked)}
            />
            Not running
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

        {titlesQuery.isLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        ) : titleItems.length === 0 ? (
          <EmptyState
            title="No titles reported yet"
            description={
              search || notRunningOnly
                ? "Nothing matches the current filters."
                : "Titles will show up here after the next check-in."
            }
            bordered={false}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Build</TableHead>
                <TableHead>Config</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {titleItems.map((item) => {
                const status = titleStatus(item.processRunning)
                return (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.title}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {item.build || "—"}
                    </TableCell>
                    <TableCell
                      className="max-w-48 truncate font-mono text-xs text-muted-foreground"
                      title={item.configHash ?? undefined}
                    >
                      {item.configHash || "—"}
                    </TableCell>
                    <TableCell>
                      {status.label === "—" ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <StatusIndicator
                          tone={status.tone}
                          label={status.label}
                          pulse={status.pulse}
                        />
                      )}
                    </TableCell>
                    <TableCell
                      className="text-xs text-muted-foreground"
                      title={formatDate(item.lastSeenAt)}
                    >
                      {formatRelativeTime(item.lastSeenAt)}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      <SectionCard
        title="Installed software"
        description={
          packages?.collectedAt
            ? `Last reported ${formatRelativeTime(packages.collectedAt)}.`
            : "Other software reported by this device."
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
        {packagesQuery.isLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        ) : packageItems.length === 0 ? (
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
                {packageItems.map((pkg) => {
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
