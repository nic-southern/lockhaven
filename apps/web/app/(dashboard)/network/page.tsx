"use client"

import Link from "next/link"
import { ArrowRightIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/dashboard/page-header"
import { StatStrip } from "@/components/dashboard/stat-strip"
import { ConnectionLogTable } from "@/components/network/connection-log-table"
import { formatRelativeTime } from "@/lib/dashboard"
import { trpc } from "@/lib/trpc"

export default function NetworkPage() {
  const summaryQuery = trpc.network.summary.useQuery(undefined, {
    refetchInterval: 30_000,
  })
  const summary = summaryQuery.data

  const stat = (value: number | undefined) =>
    summaryQuery.isLoading ? (
      <Skeleton className="h-7 w-14" />
    ) : (
      (value ?? 0).toLocaleString()
    )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Network"
        title="Connection log"
        description="Every new connection made through the tunnel, grouped by who made it and where it went. Blocked attempts show what the firewall stopped."
        actions={
          <Button variant="outline" className="w-full sm:w-auto" asChild>
            <Link href="/alerts?f.kind=concentrator_probe">
              Hub probe alerts
              <ArrowRightIcon />
            </Link>
          </Button>
        }
      />

      <StatStrip
        items={[
          {
            label: "Connections · 24h",
            value: stat(summary?.last24h),
            hint: summary?.lastEventAt
              ? `Last seen ${formatRelativeTime(summary.lastEventAt)}`
              : "Nothing recorded yet",
          },
          {
            label: "Blocked · 24h",
            value: stat(summary?.dropped24h),
            hint: "Stopped by route policy or the hub firewall",
          },
          {
            label: "Hub probes · 24h",
            value: stat(summary?.hubProbes24h),
            hint: "Blocked attempts to reach the hub itself",
          },
          {
            label: "Allowed · 24h",
            value: stat(
              summary ? summary.last24h - summary.dropped24h : undefined
            ),
            hint: "Reached their destination",
          },
        ]}
      />

      <Card>
        <CardHeader>
          <CardTitle>Connections</CardTitle>
          <CardDescription>
            One row per source, destination, and port. Counts and data cover the
            selected time range.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ConnectionLogTable variant="full" />
        </CardContent>
      </Card>
    </div>
  )
}
