import { and, eq, inArray } from "drizzle-orm"

import { deviceCommands } from "@nms/db"
import { db } from "@nms/db/client"
import {
  applyCommandAcks,
  commandsForCheckIn,
  encodeHubCommands,
  isAgentBehind,
  normalizeAgentPlatform,
  pickDesiredRelease,
  resolveAgentChannel,
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
    results: AgentCommandResult[] | undefined
    now: Date
  }
) {
  const openRows = await tx
    .select({
      id: deviceCommands.id,
      kind: deviceCommands.kind,
      status: deviceCommands.status,
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
}) {
  const channel = resolveAgentChannel(
    args.siteChannel,
    args.organizationChannel
  ) as AgentChannel
  return pickDesiredRelease(
    args.releases,
    channel,
    normalizeAgentPlatform(args.osFamily)
  )
}

export function deviceIsOutdated(args: {
  agentVersion: string | null | undefined
  desiredVersion: string | null | undefined
}) {
  return isAgentBehind(args.agentVersion, args.desiredVersion)
}
