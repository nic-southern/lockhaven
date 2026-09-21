"use client"

import * as React from "react"
import Link from "next/link"

import { AccessDenied } from "@/components/dashboard/access-denied"
import { EmptyState } from "@/components/dashboard/empty-state"
import { PageHeader } from "@/components/dashboard/page-header"
import { SectionCard } from "@/components/dashboard/section-card"
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
import { formatDate, formatRelativeTime } from "@/lib/dashboard"
import { trpc } from "@/lib/trpc"
import { usePermissions } from "@/lib/use-permissions"

function updateKindLabel(severity: string | null | undefined) {
  if (severity === "security") return "Security"
  if (severity === "critical") return "Critical"
  return null
}

export default function SoftwarePage() {
  const { can, isLoading: accessLoading } = usePermissions()
  const canView = can("device:view")
  const [search, setSearch] = React.useState("")
  const trimmedSearch = search.trim() || undefined

  const installNowQuery = trpc.telemetry.installNow.useQuery(
    { search: trimmedSearch, limit: 100 },
    { enabled: canView, refetchInterval: 30_000 }
  )

  if (!accessLoading && !canView) {
    return (
      <AccessDenied description="Software is limited to people who can view devices." />
    )
  }

  const data = installNowQuery.data
  const items = data?.items ?? []
  const reported = data?.reported ?? false
  const installNowCount = data?.installNowCount ?? 0
  const loading = accessLoading || installNowQuery.isLoading

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Software"
        title="Software"
        description="Installed software lives on each device. Updates that should be applied right away are listed here."
      />

      <SectionCard
        title="Install now"
        description={
          !reported
            ? "Security and critical updates reported by devices."
            : installNowCount === 0
              ? "Nothing needs to be installed right away."
              : installNowCount === 1
                ? "1 update should be installed right away."
                : `${installNowCount} updates should be installed right away.`
        }
        contentClassName="flex flex-col gap-4"
      >
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search devices or software"
          aria-label="Search devices or software"
        />

        {loading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        ) : !reported && !trimmedSearch ? (
          <EmptyState
            title="No software reported yet"
            description="Software will show up here after a device checks in."
            bordered={false}
          />
        ) : items.length === 0 ? (
          <EmptyState
            title={
              trimmedSearch
                ? "Nothing matches the current filters."
                : "Nothing needs to be installed right away."
            }
            description={
              trimmedSearch
                ? "Try a different search."
                : "Security and critical updates will be listed here when a device reports them."
            }
            bordered={false}
          />
        ) : (
          <>
            {installNowCount > items.length ? (
              <p className="text-sm text-muted-foreground">
                Showing the first {items.length} updates.
              </p>
            ) : null}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>Software</TableHead>
                  <TableHead>Installed</TableHead>
                  <TableHead>Available</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Reported</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const kind = updateKindLabel(item.updateSeverity)
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/devices/${item.deviceId}?tab=software`}
                          className="hover:underline"
                        >
                          {item.deviceName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {item.siteName || "—"}
                      </TableCell>
                      <TableCell>{item.name}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {item.version || "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {item.availableVersion || "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="destructive">Install now</Badge>
                          {kind ? (
                            <Badge variant="outline">{kind}</Badge>
                          ) : null}
                        </div>
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
          </>
        )}
      </SectionCard>
    </div>
  )
}
