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
import { AuditTable } from "@/components/audit/audit-table"
import { PageHeader } from "@/components/dashboard/page-header"
import { usePermissions } from "@/lib/use-permissions"

export default function ActivityPage() {
  const { can } = usePermissions()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Activity"
        title="Activity log"
        description="Every sign-in, inventory change, access grant, remote session, and tunnel event across the workspace."
        actions={
          can("device:view") ? (
            <Button variant="outline" className="w-full sm:w-auto" asChild>
              <Link href="/alerts">
                Alerts
                <ArrowRightIcon />
              </Link>
            </Button>
          ) : null
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Events</CardTitle>
          <CardDescription>
            Filter by severity, actor, site, or device. Open a row for the full
            record.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AuditTable variant="full" />
        </CardContent>
      </Card>
    </div>
  )
}
