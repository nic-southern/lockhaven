"use client"

import { AuditTable } from "@/components/audit/audit-table"
import { EmptyState } from "@/components/dashboard/empty-state"
import { SectionCard } from "@/components/dashboard/section-card"
import { usePermissions } from "@/lib/use-permissions"

import type { DeviceDetail } from "./shared"

export function ActivityTab({ device }: { device: DeviceDetail }) {
  const { can, isLoading } = usePermissions()

  if (!isLoading && !can("audit:view")) {
    return (
      <EmptyState
        title="Activity isn't available"
        description="You don't have access to the activity log for this device."
      />
    )
  }

  return (
    <SectionCard
      title="Activity"
      description="Every recorded change and session for this device."
      contentClassName="pt-0"
    >
      <AuditTable
        variant="device"
        fixedFilters={{ deviceId: [device.id] }}
        pageSize={25}
      />
    </SectionCard>
  )
}
