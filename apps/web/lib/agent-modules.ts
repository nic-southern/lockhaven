import { and, eq, inArray, isNull, notInArray, or } from "drizzle-orm"

import {
  agentModuleAssignments,
  agentModules,
  deviceModuleObservations,
} from "@nms/db"
import { db } from "@nms/db/client"
import {
  AGENT_MODULES_PER_DEVICE_MAX,
  encodeHubModules,
  hubModuleDefinitionSchema,
  type CheckInModuleReport,
  type HubModuleDefinition,
} from "@nms/shared"

type QueryClient = Pick<typeof db, "select">
type TransactionClient = Parameters<typeof db.transaction>[0] extends (
  tx: infer T
) => unknown
  ? T
  : never

export async function loadAssignedModules(
  client: QueryClient,
  device: { id: string; organizationId: string; siteId: string | null }
): Promise<HubModuleDefinition[]> {
  const assignmentScope = or(
    and(
      eq(agentModuleAssignments.organizationId, device.organizationId),
      isNull(agentModuleAssignments.siteId),
      isNull(agentModuleAssignments.deviceId)
    ),
    device.siteId
      ? and(
          eq(agentModuleAssignments.organizationId, device.organizationId),
          eq(agentModuleAssignments.siteId, device.siteId),
          isNull(agentModuleAssignments.deviceId)
        )
      : undefined,
    and(
      eq(agentModuleAssignments.organizationId, device.organizationId),
      eq(agentModuleAssignments.deviceId, device.id)
    )
  )

  const rows = await client
    .select({
      id: agentModules.id,
      kind: agentModules.kind,
      name: agentModules.name,
      collectors: agentModules.collectors,
    })
    .from(agentModuleAssignments)
    .innerJoin(
      agentModules,
      eq(agentModules.id, agentModuleAssignments.moduleId)
    )
    .where(
      and(
        eq(agentModules.organizationId, device.organizationId),
        assignmentScope
      )
    )

  const unique = new Map<string, HubModuleDefinition>()
  for (const row of rows) {
    const parsed = hubModuleDefinitionSchema.safeParse({
      id: row.id,
      kind: row.kind,
      name: row.name,
      collectors: row.collectors,
    })
    if (parsed.success) {
      unique.set(parsed.data.id, parsed.data)
    }
  }
  return encodeHubModules([...unique.values()]).slice(
    0,
    AGENT_MODULES_PER_DEVICE_MAX
  )
}

export async function ingestModuleObservations(
  tx: TransactionClient,
  args: {
    deviceId: string
    now: Date
    reports: CheckInModuleReport[]
    assignedModuleIds: string[]
    replaceCollectors: boolean
  }
) {
  if (args.assignedModuleIds.length === 0) {
    await tx
      .delete(deviceModuleObservations)
      .where(eq(deviceModuleObservations.deviceId, args.deviceId))
    return
  }

  await tx
    .delete(deviceModuleObservations)
    .where(
      and(
        eq(deviceModuleObservations.deviceId, args.deviceId),
        notInArray(deviceModuleObservations.moduleId, args.assignedModuleIds)
      )
    )

  if (!args.replaceCollectors || args.reports.length === 0) return

  for (const report of args.reports) {
    const collectorIds = report.observations.map(
      (observation) => observation.id
    )
    if (collectorIds.length === 0) continue

    const existing = await tx
      .select({
        id: deviceModuleObservations.id,
        collectorId: deviceModuleObservations.collectorId,
      })
      .from(deviceModuleObservations)
      .where(
        and(
          eq(deviceModuleObservations.deviceId, args.deviceId),
          eq(deviceModuleObservations.moduleId, report.module_id)
        )
      )

    const existingByCollector = new Map(
      existing.map((row) => [row.collectorId, row.id] as const)
    )

    for (const observation of report.observations) {
      const payload = observation
      const currentId = existingByCollector.get(observation.id)
      if (currentId) {
        await tx
          .update(deviceModuleObservations)
          .set({
            collectorType: observation.type,
            payload,
            lastSeenAt: args.now,
          })
          .where(eq(deviceModuleObservations.id, currentId))
        continue
      }
      await tx.insert(deviceModuleObservations).values({
        deviceId: args.deviceId,
        moduleId: report.module_id,
        collectorId: observation.id,
        collectorType: observation.type,
        payload,
        lastSeenAt: args.now,
      })
    }

    const reported = new Set(collectorIds)
    const stale = existing
      .filter((row) => !reported.has(row.collectorId))
      .map((row) => row.id)
    if (stale.length > 0) {
      await tx
        .delete(deviceModuleObservations)
        .where(inArray(deviceModuleObservations.id, stale))
    }
  }
}
