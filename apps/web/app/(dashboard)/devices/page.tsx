"use client"

import * as React from "react"
import Link from "next/link"
import { PlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/dashboard/page-header"
import {
  DEVICES_DEFAULT_VIEW,
  DevicesTable,
} from "@/components/devices/devices-table"
import { trpc } from "@/lib/trpc"
import { useUrlTableView } from "@/lib/use-table-view"

function DevicesContent() {
  const { state, update } = useUrlTableView(DEVICES_DEFAULT_VIEW)
  return <DevicesTable view={state} onViewChange={update} />
}

export default function DevicesPage() {
  const meQuery = trpc.access.me.useQuery()
  const canEnroll = meQuery.data?.permissions.includes("device:enroll") ?? false

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Devices"
        title="Devices"
        description="Every enrolled endpoint, its tunnel state, and what it exposes. Filter, tag, and act on many at once."
        actions={
          canEnroll ? (
            <Button asChild size="sm">
              <Link href="/?enroll=1">
                <PlusIcon />
                Add device
              </Link>
            </Button>
          ) : null
        }
      />
      <React.Suspense
        fallback={
          <div className="flex flex-col gap-3">
            <Skeleton className="h-9 w-full max-w-md" />
            <Skeleton className="h-64 w-full" />
          </div>
        }
      >
        <DevicesContent />
      </React.Suspense>
    </div>
  )
}
