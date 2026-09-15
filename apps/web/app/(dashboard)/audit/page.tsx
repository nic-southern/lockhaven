"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { AuditTable } from "@/components/audit/audit-table"
import { PageHeader } from "@/components/dashboard/page-header"

export default function AuditPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Audit"
        title="Activity log"
        description="Review recent operational changes across the workspace."
      />

      <Card>
        <CardHeader>
          <CardTitle>Events</CardTitle>
          <CardDescription>
            Recorded actions for sign-ins, inventory, access, and remote
            sessions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AuditTable variant="full" />
        </CardContent>
      </Card>
    </div>
  )
}
