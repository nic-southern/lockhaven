import { and, eq, inArray } from "drizzle-orm"

import { auditEvents, deviceCommands } from "@nms/db"
import { db } from "@nms/db/client"
import {
  applyCommandAcks,
  commandsForCheckIn,
  encodeHubCommands,
  isAgentBehind,
  normalizeAgentPlatform,
  pickDesiredRelease,
  resolveAgentChannel,
  severityForEvent,
  type AgentChannel,
  type AgentCommandResult,
  type AgentReleasePick,
} from "@nms/shared"

type TransactionClient = Parameters<typeof db.transaction>[0] extends (
  tx: infer T
) => unknown
  ? T
  : never

/**
 * Record results from the previous check-in, then return waiting commands
 * marked sent. Hub never emits a kind outside the allowlist.
 */
export async function settleDeviceCommands(
  tx: TransactionClient,
  args: {
    deviceId: string
    organizationId?: string | null
    siteId?: string | null
    results: AgentCommandResult[] | undefined
    now: Date
  }
) {
  const openRows = await tx
    .select({
      id: deviceCommands.id,
      kind: deviceCommands.kind,
      status: deviceCommands.status,
      serviceName: deviceCommands.serviceName,
    })
    .from(deviceCommands)
    .where(
      and(
        eq(deviceCommands.deviceId, args.deviceId),
        inArray(deviceCommands.status, ["pending", "sent"])
      )
    )
    .for("update")

  const acked = applyCommandAcks(openRows, args.results ?? [])
  const completed = acked.filter(
    (row, index) => row.status !== openRows[index]?.status
  )

  for (const row of completed) {
    const result = (args.results ?? []).find((item) => item.id === row.id)
    await tx
      .update(deviceCommands)
      .set({
        status: row.status,
        completedAt: args.now,
        resultDetail: result?.detail ?? null,
      })
      .where(eq(deviceCommands.id, row.id))

    await tx.insert(auditEvents).values({
      organizationId: args.organizationId ?? null,
      siteId: args.siteId ?? null,
      deviceId: args.deviceId,
      eventType: "device_command_completed",
      severity: severityForEvent("device_command_completed"),
      eventData: {
        commandId: row.id,
        kind: row.kind,
        status: row.status,
        serviceName: row.serviceName ?? null,
        detail: result?.detail ?? null,
      },
    })
  }

  const stillOpen = acked.filter((row) => row.status === "pending")
  const payload = encodeHubCommands(commandsForCheckIn(stillOpen))

  if (payload.length > 0) {
    await tx
      .update(deviceCommands)
      .set({
        status: "sent",
        sentAt: args.now,
      })
      .where(
        inArray(
          deviceCommands.id,
          payload.map((command) => command.id)
        )
      )
  }

  return payload
}

export function desiredCheckInRelease(args: {
  releases: AgentReleasePick[]
  siteChannel: string | null | undefined
  organizationChannel: string | null | undefined
  osFamily: string | null | undefined
  architecture?: string | null
}) {
  const channel = resolveAgentChannel(
    args.siteChannel,
    args.organizationChannel
  ) as AgentChannel
  return pickDesiredRelease(
    args.releases,
    channel,
    normalizeAgentPlatform(args.osFamily, args.architecture)
  )
}

export function deviceIsOutdated(args: {
  agentVersion: string | null | undefined
  desiredVersion: string | null | undefined
}) {
  return isAgentBehind(args.agentVersion, args.desiredVersion)
}
