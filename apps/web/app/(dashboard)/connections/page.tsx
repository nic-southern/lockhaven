"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageHeader } from "@/components/dashboard/page-header"
import { StatStrip } from "@/components/dashboard/stat-strip"
import { ServicesTable } from "@/components/sessions/services-table"
import { SessionsTable } from "@/components/sessions/sessions-table"
import { trpc } from "@/lib/trpc"

const tabs = ["sessions", "services"] as const
type ConnectionsTab = (typeof tabs)[number]

export default function ConnectionsPage() {
  return (
    <React.Suspense
      fallback={
        <div className="flex flex-col gap-6">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      }
    >
      <ConnectionsContent />
    </React.Suspense>
  )
}

function ConnectionsContent() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const requested = searchParams.get("tab")
  const tab: ConnectionsTab = requested === "services" ? "services" : "sessions"

  const summaryQuery = trpc.dashboard.summary.useQuery(undefined, {
    refetchInterval: 30_000,
  })

  const setTab = (next: string) => {
    if (!(tabs as readonly string[]).includes(next)) return
    const params = new URLSearchParams(searchParams.toString())
    if (next === "sessions") params.delete("tab")
    else params.set("tab", next)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    })
  }

  const sessions = summaryQuery.data?.sessions

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Remote access"
        title="Sessions"
        description="Who connected to what, and which services are reachable right now."
      />

      <StatStrip
        items={[
          {
            label: "Open sessions",
            value: summaryQuery.isLoading ? (
              <Skeleton className="h-8 w-12" />
            ) : (
              (sessions?.active ?? 0)
            ),
            hint: "Started in the last 24 hours and not yet closed",
          },
          {
            label: "Sessions today",
            value: summaryQuery.isLoading ? (
              <Skeleton className="h-8 w-12" />
            ) : (
              (sessions?.last24h ?? 0)
            ),
            hint: "Across every device you can see",
          },
          {
            label: "Devices online",
            value: summaryQuery.isLoading ? (
              <Skeleton className="h-8 w-12" />
            ) : (
              (summaryQuery.data?.devices.online ?? 0)
            ),
            hint: `of ${summaryQuery.data?.devices.total ?? 0} enrolled`,
          },
        ]}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList variant="line" className="w-full justify-start border-b">
          <TabsTrigger value="sessions" className="px-3">
            Session history
          </TabsTrigger>
          <TabsTrigger value="services" className="px-3">
            Published services
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="pt-6">
          {tab === "sessions" ? (
            <SessionsTable variant="full" />
          ) : (
            <ServicesTable />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
