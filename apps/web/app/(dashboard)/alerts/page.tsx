"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { ArrowRightIcon } from "lucide-react"
import type { ColumnFiltersState } from "@tanstack/react-table"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { AlertsTable } from "@/components/alerts/alerts-table"
import { PageHeader } from "@/components/dashboard/page-header"
import { StatStrip } from "@/components/dashboard/stat-strip"
import { trpc } from "@/lib/trpc"
import { usePermissions } from "@/lib/use-permissions"

export default function AlertsPage() {
  return (
    <React.Suspense
      fallback={
        <div className="flex flex-col gap-6">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      }
    >
      <AlertsContent />
    </React.Suspense>
  )
}

/** Reads `f.<column>=a,b` and `status=` from the URL so links can pre-filter. */
function useInitialFilters() {
  const searchParams = useSearchParams()
  return React.useMemo(() => {
    const filters: ColumnFiltersState = []
    for (const [key, raw] of searchParams.entries()) {
      if (!key.startsWith("f.")) continue
      const values = raw.split(",").filter(Boolean)
      if (values.length > 0) filters.push({ id: key.slice(2), value: values })
    }
    return { filters, status: searchParams.get("status") }
  }, [searchParams])
}

function AlertsContent() {
  const { can } = usePermissions()
  const initial = useInitialFilters()
  const summaryQuery = trpc.alerts.summary.useQuery(undefined, {
    refetchInterval: 30_000,
  })
  const summary = summaryQuery.data

  const stat = (value: number | undefined) =>
    summaryQuery.isLoading ? (
      <Skeleton className="h-7 w-10" />
    ) : (
      (value ?? 0).toLocaleString()
    )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Alerts"
        title="Alerts"
        description="Conditions that need a person: devices that went quiet, tunnels that changed address or flapped, blocked attempts to reach the hub, and control-plane failures."
        actions={
          can("audit:view") ? (
            <Button variant="outline" className="w-full sm:w-auto" asChild>
              <Link href="/activity?f.eventType=alert_raised">
                Alert history
                <ArrowRightIcon />
              </Link>
            </Button>
          ) : null
        }
      />

      <StatStrip
        items={[
          {
            label: "Needs action",
            value: stat(summary?.open),
            hint: "Open and not yet acknowledged",
          },
          {
            label: "Critical",
            value: stat(summary?.critical),
            hint: "Unresolved, highest severity",
          },
          {
            label: "Warning",
            value: stat(summary?.warning),
            hint: "Unresolved, needs a look",
          },
          {
            label: "Acknowledged",
            value: stat(summary?.acknowledged),
            hint: "Someone is on it",
          },
        ]}
      />

      <Card>
        <CardHeader>
          <CardTitle>All alerts</CardTitle>
          <CardDescription>
            Acknowledge an alert to show you are handling it; resolve it once
            the condition is fixed. Both are recorded in the activity log.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertsTable
            variant="full"
            initialColumnFilters={initial.filters}
            initialStatus={initial.status}
          />
        </CardContent>
      </Card>
    </div>
  )
}
