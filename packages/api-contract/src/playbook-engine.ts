import { and, desc, eq, inArray, sql } from "drizzle-orm"

import {
  alerts,
  auditEvents,
  deviceCommands,
  devices,
  playbookRuns,
  playbooks,
} from "@nms/db"
import { db } from "@nms/db/client"
import {
  decidePlaybookAction,
  hasOpenCommandOfKind,
  parsePlaybookAction,
  pickMatchingPlaybook,
  playbookApprovalExpiresAt,
  severityForEvent,
  type AgentCommandKind,
  type AlertKind,
  type AlertStatus,
  type DeviceCommandStatus,
  type PlaybookAction,
  type PlaybookMatchFields,
  type PlaybookRunStatus,
  type PlaybookSkipReason,
} from "@nms/shared"

import { enqueuePlaybookRequestNotifications } from "./playbook-notify"

type TransactionClient = Parameters<typeof db.transaction>[0] extends (
  tx: infer T
) => unknown
  ? T
  : never

export type PlaybookDb =
  | Pick<typeof db, "select" | "insert" | "update">
  | TransactionClient

const OPEN_COMMAND_STATUSES: DeviceCommandStatus[] = ["pending", "sent"]
const COOLDOWN_STATUSES: PlaybookRunStatus[] = ["pending_approval", "queued"]
const TERMINAL_SKIP: ReadonlySet<PlaybookSkipReason> = new Set([
  "no_device",
  "unknown_action",
])

export async function enqueueAllowlistedCommand(
  client: PlaybookDb,
  input: {
    deviceId: string
    kind: AgentCommandKind
    createdByUserId?: string | null
  }
) {
  const kind = parsePlaybookAction(input.kind)
  if (!kind) return null

  const open = await client
    .select({
      id: deviceCommands.id,
      kind: deviceCommands.kind,
      status: deviceCommands.status,
    })
    .from(deviceCommands)
    .where(
      and(
        eq(deviceCommands.deviceId, input.deviceId),
        inArray(deviceCommands.status, OPEN_COMMAND_STATUSES)
      )
    )

  if (hasOpenCommandOfKind(open, kind)) {
    return { conflict: true as const, command: null }
  }

  const [command] = await client
    .insert(deviceCommands)
    .values({
      deviceId: input.deviceId,
      kind,
      status: "pending",
      createdByUserId: input.createdByUserId ?? null,
    })
    .returning()

  return { conflict: false as const, command }
}

async function writePlaybookAudit(
  client: PlaybookDb,
  input: {
    eventType:
      | "playbook_run_queued"
      | "device_command_enqueued"
      | "playbook_run_approved"
      | "playbook_run_denied"
    organizationId: string
    siteId: string | null
    deviceId: string | null
    actorUserId?: string | null
    eventData: Record<string, unknown>
  }
) {
  await client.insert(auditEvents).values({
    actorUserId: input.actorUserId ?? null,
    organizationId: input.organizationId,
    siteId: input.siteId,
    deviceId: input.deviceId,
    eventType: input.eventType,
    severity: severityForEvent(input.eventType),
    eventData: input.eventData,
  })
}

export async function expirePendingPlaybookRuns(
  client: PlaybookDb,
  now = new Date()
) {
  await client
    .update(playbookRuns)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        eq(playbookRuns.status, "pending_approval"),
        sql`${playbookRuns.expiresAt} <= ${now}`
      )
    )
}

async function cancelDisabledPendingRuns(client: PlaybookDb, now: Date) {
  const pending = await client
    .select({
      id: playbookRuns.id,
      playbookId: playbookRuns.playbookId,
    })
    .from(playbookRuns)
    .where(eq(playbookRuns.status, "pending_approval"))
  if (pending.length === 0) return
  const playbookIds = [...new Set(pending.map((row) => row.playbookId))]
  const disabled = await client
    .select({ id: playbooks.id })
    .from(playbooks)
    .where(
      and(inArray(playbooks.id, playbookIds), eq(playbooks.enabled, false))
    )
  const disabledIds = new Set(disabled.map((row) => row.id))
  const cancelIds = pending
    .filter((row) => disabledIds.has(row.playbookId))
    .map((row) => row.id)
  if (cancelIds.length === 0) return
  await client
    .update(playbookRuns)
    .set({ status: "cancelled", updatedAt: now })
    .where(inArray(playbookRuns.id, cancelIds))
}

function asMatchFields(
  row: typeof playbooks.$inferSelect
): PlaybookMatchFields {
  return {
    id: row.id,
    organizationId: row.organizationId,
    siteId: row.siteId,
    alertKind: row.alertKind,
    action: row.action,
    enabled: row.enabled,
    requireApproval: row.requireApproval,
    cooldownMinutes: row.cooldownMinutes,
  }
}

async function resolveDeviceId(
  client: PlaybookDb,
  alert: { deviceId: string | null; assetId: string | null }
) {
  if (alert.deviceId) return alert.deviceId
  if (!alert.assetId) return null
  const [linked] = await client
    .select({ id: devices.id })
    .from(devices)
    .where(eq(devices.assetId, alert.assetId))
  return linked?.id ?? null
}

export async function evaluatePlaybooks(client: PlaybookDb, now = new Date()) {
  await expirePendingPlaybookRuns(client, now)
  await cancelDisabledPendingRuns(client, now)

  const [playbookRows, alertRows] = await Promise.all([
    client.select().from(playbooks),
    client
      .select({
        id: alerts.id,
        kind: alerts.kind,
        status: alerts.status,
        organizationId: alerts.organizationId,
        siteId: alerts.siteId,
        deviceId: alerts.deviceId,
        assetId: alerts.assetId,
        snoozedUntil: alerts.snoozedUntil,
        title: alerts.title,
      })
      .from(alerts)
      .where(inArray(alerts.status, ["open", "acknowledged"])),
  ])

  if (alertRows.length === 0 || playbookRows.length === 0) {
    return { considered: 0, queued: 0, pendingApproval: 0, skipped: 0 }
  }

  const alertIds = alertRows.map((row) => row.id)
  const existingRuns = await client
    .select({
      id: playbookRuns.id,
      playbookId: playbookRuns.playbookId,
      alertId: playbookRuns.alertId,
      deviceId: playbookRuns.deviceId,
      status: playbookRuns.status,
      createdAt: playbookRuns.createdAt,
    })
    .from(playbookRuns)
    .where(inArray(playbookRuns.alertId, alertIds))

  const runByPlaybookAlert = new Map(
    existingRuns.map((row) => [`${row.playbookId}:${row.alertId}`, row])
  )

  const cooldownRows = await client
    .select({
      playbookId: playbookRuns.playbookId,
      deviceId: playbookRuns.deviceId,
      createdAt: playbookRuns.createdAt,
    })
    .from(playbookRuns)
    .where(inArray(playbookRuns.status, COOLDOWN_STATUSES))
    .orderBy(desc(playbookRuns.createdAt))

  const lastQueued = new Map<string, Date>()
  for (const row of cooldownRows) {
    if (!row.deviceId) continue
    const key = `${row.playbookId}:${row.deviceId}`
    if (!lastQueued.has(key)) lastQueued.set(key, row.createdAt)
  }

  const stats = { considered: 0, queued: 0, pendingApproval: 0, skipped: 0 }

  for (const alert of alertRows) {
    const playbook = pickMatchingPlaybook(
      playbookRows.map(asMatchFields),
      alert.kind,
      alert.organizationId,
      alert.siteId
    )
    if (!playbook?.id || !alert.organizationId) continue
    stats.considered += 1

    const existing = runByPlaybookAlert.get(`${playbook.id}:${alert.id}`)
    const deviceId = await resolveDeviceId(client, alert)
    const action = parsePlaybookAction(playbook.action)
    const lastQueuedAt = deviceId
      ? (lastQueued.get(`${playbook.id}:${deviceId}`) ?? null)
      : null

    let hasOpenCommand = false
    if (deviceId && action) {
      const open = await client
        .select({
          id: deviceCommands.id,
          kind: deviceCommands.kind,
          status: deviceCommands.status,
        })
        .from(deviceCommands)
        .where(
          and(
            eq(deviceCommands.deviceId, deviceId),
            inArray(deviceCommands.status, OPEN_COMMAND_STATUSES)
          )
        )
      hasOpenCommand = hasOpenCommandOfKind(open, action)
    }

    const decision = decidePlaybookAction({
      action: playbook.action,
      requireApproval: playbook.requireApproval,
      alertStatus: alert.status as AlertStatus,
      snoozedUntil: alert.snoozedUntil,
      deviceId,
      now,
      lastQueuedAt,
      cooldownMinutes: playbook.cooldownMinutes,
      hasOpenCommand,
      existingRunStatus: existing?.status ?? null,
    })

    if (decision.kind === "skip") {
      if (!TERMINAL_SKIP.has(decision.reason) || existing || !action) continue
      if (decision.reason === "no_device" && alert.assetId) continue
      await persistRun(client, {
        playbookId: playbook.id,
        alertId: alert.id,
        organizationId: alert.organizationId,
        siteId: alert.siteId,
        deviceId,
        action,
        status: "skipped",
        skipReason: decision.reason,
        now,
      })
      stats.skipped += 1
      continue
    }

    if (!deviceId || !action) continue

    if (decision.kind === "approve") {
      const run = await persistRun(client, {
        playbookId: playbook.id,
        alertId: alert.id,
        organizationId: alert.organizationId,
        siteId: alert.siteId,
        deviceId,
        action,
        status: "pending_approval",
        expiresAt: playbookApprovalExpiresAt(now),
        now,
      })
      if (!run) continue
      const [device] = await client
        .select({ displayName: devices.displayName })
        .from(devices)
        .where(eq(devices.id, deviceId))
      await enqueuePlaybookRequestNotifications(
        client,
        {
          id: run.id,
          organizationId: alert.organizationId,
          siteId: alert.siteId,
          alertId: alert.id,
          alertKind: alert.kind as AlertKind,
          playbookName:
            playbookRows.find((row) => row.id === playbook.id)?.name ??
            "Playbook",
          action,
          deviceName: device?.displayName ?? "Device",
          siteName: null,
          expiresAt: playbookApprovalExpiresAt(now).toISOString(),
        },
        now
      )
      stats.pendingApproval += 1
      continue
    }

    const queued = await queuePlaybookCommand(client, {
      playbookId: playbook.id,
      playbookName:
        playbookRows.find((row) => row.id === playbook.id)?.name ?? "Playbook",
      alertId: alert.id,
      organizationId: alert.organizationId,
      siteId: alert.siteId,
      deviceId,
      action,
      now,
    })
    if (queued === "queued") stats.queued += 1
    if (queued === "skipped") stats.skipped += 1
  }

  return stats
}

async function persistRun(
  client: PlaybookDb,
  input: {
    playbookId: string
    alertId: string
    organizationId: string
    siteId: string | null
    deviceId: string | null
    action: PlaybookAction
    status: PlaybookRunStatus
    skipReason?: PlaybookSkipReason
    deviceCommandId?: string | null
    expiresAt?: Date | null
    decidedByUserId?: string | null
    decidedAt?: Date | null
    now: Date
  }
) {
  const [run] = await client
    .insert(playbookRuns)
    .values({
      playbookId: input.playbookId,
      alertId: input.alertId,
      organizationId: input.organizationId,
      siteId: input.siteId,
      deviceId: input.deviceId,
      action: input.action,
      status: input.status,
      skipReason: input.skipReason ?? null,
      deviceCommandId: input.deviceCommandId ?? null,
      expiresAt: input.expiresAt ?? null,
      decidedByUserId: input.decidedByUserId ?? null,
      decidedAt: input.decidedAt ?? null,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing()
    .returning()
  return run ?? null
}

export async function queuePlaybookCommand(
  client: PlaybookDb,
  input: {
    playbookId: string
    playbookName: string
    alertId: string
    organizationId: string
    siteId: string | null
    deviceId: string
    action: PlaybookAction
    createdByUserId?: string | null
    runId?: string
    now?: Date
  }
) {
  const now = input.now ?? new Date()
  const enqueued = await enqueueAllowlistedCommand(client, {
    deviceId: input.deviceId,
    kind: input.action,
    createdByUserId: input.createdByUserId,
  })
  if (!enqueued?.command) {
    if (enqueued?.conflict) {
      if (input.runId) {
        await client
          .update(playbookRuns)
          .set({
            status: "failed",
            skipReason: "open_command",
            updatedAt: now,
          })
          .where(eq(playbookRuns.id, input.runId))
      }
      return "skipped" as const
    }
    return "skipped" as const
  }

  if (input.runId) {
    await client
      .update(playbookRuns)
      .set({
        status: "queued",
        deviceCommandId: enqueued.command.id,
        skipReason: null,
        updatedAt: now,
      })
      .where(eq(playbookRuns.id, input.runId))
  } else {
    await persistRun(client, {
      playbookId: input.playbookId,
      alertId: input.alertId,
      organizationId: input.organizationId,
      siteId: input.siteId,
      deviceId: input.deviceId,
      action: input.action,
      status: "queued",
      deviceCommandId: enqueued.command.id,
      now,
    })
  }

  await writePlaybookAudit(client, {
    eventType: "device_command_enqueued",
    organizationId: input.organizationId,
    siteId: input.siteId,
    deviceId: input.deviceId,
    actorUserId: input.createdByUserId ?? null,
    eventData: {
      commandId: enqueued.command.id,
      kind: input.action,
      playbookId: input.playbookId,
      playbookName: input.playbookName,
      alertId: input.alertId,
      source: "playbook",
    },
  })
  await writePlaybookAudit(client, {
    eventType: "playbook_run_queued",
    organizationId: input.organizationId,
    siteId: input.siteId,
    deviceId: input.deviceId,
    actorUserId: input.createdByUserId ?? null,
    eventData: {
      playbookId: input.playbookId,
      playbookName: input.playbookName,
      alertId: input.alertId,
      commandId: enqueued.command.id,
      action: input.action,
    },
  })
  return "queued" as const
}
