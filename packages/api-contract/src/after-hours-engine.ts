import { and, eq, inArray, isNotNull } from "drizzle-orm"

import {
  afterHoursRuns,
  auditEvents,
  deviceCommands,
  devices,
  playbookRuns,
  sites,
} from "@nms/db"
import {
  afterHoursApprovalExpiresAt,
  afterHoursDeviceEligibility,
  afterHoursRunIsSettled,
  afterHoursSteps,
  decideAfterHoursDeviceStep,
  decideAfterHoursSiteStart,
  hasOpenCommandOfKind,
  nextSiteOpenAt,
  parsePlaybookAction,
  playbookApprovalExpiresAt,
  severityForEvent,
  siteClosedSince,
  siteOpenState,
  summarizeAfterHoursRun,
  type AfterHoursRunStatus,
  type AfterHoursStep,
  type AfterHoursStepRow,
  type AfterHoursSummaryRow,
  type AuditEventType,
  type PlaybookSkipReason,
} from "@nms/shared"

import type { PlaybookDb } from "./playbook-engine"

const ACTIVE_RUN_STATUSES: AfterHoursRunStatus[] = [
  "pending_approval",
  "running",
]
const OPEN_COMMAND_STATUSES = ["pending", "sent"] as const

type SiteRow = Pick<
  typeof sites.$inferSelect,
  | "id"
  | "organizationId"
  | "name"
  | "timezone"
  | "businessHours"
  | "requireApproval"
  | "afterHoursPlaybooksEnabled"
  | "afterHoursStartAfterMinutes"
>

type RunRow = typeof afterHoursRuns.$inferSelect

export type AfterHoursStats = {
  sitesConsidered: number
  runsStarted: number
  runsRequested: number
  stepsQueued: number
  stepsSkipped: number
  runsCompleted: number
}

async function writeAfterHoursAudit(
  client: PlaybookDb,
  input: {
    eventType: AuditEventType
    organizationId: string
    siteId: string | null
    deviceId?: string | null
    actorUserId?: string | null
    eventData: Record<string, unknown>
  }
) {
  await client.insert(auditEvents).values({
    actorUserId: input.actorUserId ?? null,
    organizationId: input.organizationId,
    siteId: input.siteId,
    deviceId: input.deviceId ?? null,
    eventType: input.eventType,
    severity: severityForEvent(input.eventType),
    eventData: input.eventData,
  })
}

async function loadSites(client: PlaybookDb, siteIds?: string[]) {
  const rows = await client
    .select({
      id: sites.id,
      organizationId: sites.organizationId,
      name: sites.name,
      timezone: sites.timezone,
      businessHours: sites.businessHours,
      requireApproval: sites.requireApproval,
      afterHoursPlaybooksEnabled: sites.afterHoursPlaybooksEnabled,
      afterHoursStartAfterMinutes: sites.afterHoursStartAfterMinutes,
    })
    .from(sites)
    .where(
      siteIds && siteIds.length > 0
        ? inArray(sites.id, siteIds)
        : eq(sites.afterHoursPlaybooksEnabled, true)
    )
  return rows as SiteRow[]
}

/**
 * Worker entry point. Starts one run per enabled site per closed stretch,
 * walks each device through update then restart, and closes runs out when
 * the floor reopens or the schedule is turned off.
 */
export async function evaluateAfterHours(
  client: PlaybookDb,
  now = new Date()
): Promise<AfterHoursStats> {
  const stats: AfterHoursStats = {
    sitesConsidered: 0,
    runsStarted: 0,
    runsRequested: 0,
    stepsQueued: 0,
    stepsSkipped: 0,
    runsCompleted: 0,
  }

  const activeRuns = await client
    .select()
    .from(afterHoursRuns)
    .where(inArray(afterHoursRuns.status, ACTIVE_RUN_STATUSES))

  const enabledSites = await loadSites(client)
  const activeSiteIds = activeRuns
    .map((run) => run.siteId)
    .filter((siteId) => !enabledSites.some((site) => site.id === siteId))
  const otherSites =
    activeSiteIds.length > 0
      ? await loadSites(client, [...new Set(activeSiteIds)])
      : []
  const siteById = new Map(
    [...enabledSites, ...otherSites].map((site) => [site.id, site] as const)
  )

  for (const site of enabledSites) {
    stats.sitesConsidered += 1
    const siteOpen = siteOpenState(site, now)
    const closedSince = siteOpen === false ? siteClosedSince(site, now) : null
    const nextOpenAt = siteOpen === false ? nextSiteOpenAt(site, now) : null
    const decision = decideAfterHoursSiteStart({
      enabled: site.afterHoursPlaybooksEnabled,
      siteOpen,
      closedSince,
      nextOpenAt,
      startAfterMinutes: site.afterHoursStartAfterMinutes,
      now,
    })
    if (decision.kind !== "start") continue
    const alreadyExists = activeRuns.some(
      (run) => run.siteId === site.id && run.windowKey === decision.windowKey
    )
    if (alreadyExists) continue

    const created = await startSiteRun(client, {
      site,
      windowKey: decision.windowKey,
      closedAt: decision.closedSince,
      opensAt: nextOpenAt,
      now,
    })
    if (!created) continue
    if (created.status === "pending_approval") {
      stats.runsRequested += 1
    } else {
      stats.runsStarted += 1
      activeRuns.push(created)
    }
  }

  for (const run of activeRuns) {
    const site = siteById.get(run.siteId) ?? null
    const outcome = await advanceRun(client, { run, site, now })
    stats.stepsQueued += outcome.stepsQueued
    stats.stepsSkipped += outcome.stepsSkipped
    if (outcome.completed) stats.runsCompleted += 1
  }

  return stats
}

async function startSiteRun(
  client: PlaybookDb,
  input: {
    site: SiteRow
    windowKey: string
    closedAt: Date
    opensAt: Date | null
    now: Date
  }
) {
  const requireApproval = input.site.requireApproval
  const [run] = await client
    .insert(afterHoursRuns)
    .values({
      organizationId: input.site.organizationId,
      siteId: input.site.id,
      windowKey: input.windowKey,
      closedAt: input.closedAt,
      opensAt: input.opensAt,
      status: requireApproval ? "pending_approval" : "running",
      requireApproval,
      expiresAt: requireApproval
        ? afterHoursApprovalExpiresAt(
            playbookApprovalExpiresAt(input.now),
            input.opensAt
          )
        : null,
      startedAt: requireApproval ? null : input.now,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing()
    .returning()
  if (!run) return null

  await writeAfterHoursAudit(client, {
    eventType: requireApproval
      ? "after_hours_run_requested"
      : "after_hours_run_started",
    organizationId: run.organizationId,
    siteId: run.siteId,
    eventData: {
      afterHoursRunId: run.id,
      siteName: input.site.name,
      windowKey: run.windowKey,
      closedAt: run.closedAt.toISOString(),
      opensAt: run.opensAt?.toISOString() ?? null,
      steps: [...afterHoursSteps],
      requireApproval,
    },
  })
  return run
}

type StepState = AfterHoursStepRow & {
  id: string
  deviceId: string | null
  action: string
  deviceCommandId: string | null
}

async function loadStepRows(client: PlaybookDb, runId: string) {
  const rows = await client
    .select({
      id: playbookRuns.id,
      deviceId: playbookRuns.deviceId,
      action: playbookRuns.action,
      status: playbookRuns.status,
      skipReason: playbookRuns.skipReason,
      deviceCommandId: playbookRuns.deviceCommandId,
      commandStatus: deviceCommands.status,
      commandSentAt: deviceCommands.sentAt,
    })
    .from(playbookRuns)
    .leftJoin(
      deviceCommands,
      eq(deviceCommands.id, playbookRuns.deviceCommandId)
    )
    .where(eq(playbookRuns.afterHoursRunId, runId))
  return rows.map(
    (row): StepState => ({
      id: row.id,
      deviceId: row.deviceId,
      action: row.action,
      status: row.status,
      skipReason: row.skipReason,
      deviceCommandId: row.deviceCommandId,
      commandStatus: row.commandStatus ?? null,
      commandSentAt: row.commandSentAt ?? null,
    })
  )
}

function toSummaryRows(rows: StepState[]): AfterHoursSummaryRow[] {
  return rows.map((row) => ({
    deviceId: row.deviceId,
    action: row.action,
    status: row.status,
    skipReason: row.skipReason,
    commandStatus: row.commandStatus,
  }))
}

async function advanceRun(
  client: PlaybookDb,
  input: { run: RunRow; site: SiteRow | null; now: Date }
) {
  const { run, site, now } = input
  const outcome = { stepsQueued: 0, stepsSkipped: 0, completed: false }

  const siteOpen = site ? siteOpenState(site, now) : null
  const closedSince =
    site && siteOpen === false ? siteClosedSince(site, now) : null
  const windowStillClosed =
    siteOpen === false &&
    closedSince !== null &&
    closedSince.toISOString() === run.windowKey
  const scheduleOn = Boolean(site?.afterHoursPlaybooksEnabled)

  if (run.status === "pending_approval") {
    if (!windowStillClosed || !scheduleOn) {
      await finishRun(client, {
        run,
        site,
        status: "expired",
        now,
        reason: scheduleOn ? "floor_opened" : "schedule_disabled",
      })
      outcome.completed = true
      return outcome
    }
    if (run.expiresAt && run.expiresAt.getTime() <= now.getTime()) {
      await finishRun(client, {
        run,
        site,
        status: "expired",
        now,
        reason: "not_reviewed",
      })
      outcome.completed = true
    }
    return outcome
  }

  if (!windowStillClosed || !scheduleOn) {
    await finishRun(client, {
      run,
      site,
      status: scheduleOn ? "completed" : "cancelled",
      now,
      reason: scheduleOn ? "floor_opened" : "schedule_disabled",
    })
    outcome.completed = true
    return outcome
  }

  const deviceRows = await client
    .select({
      id: devices.id,
      displayName: devices.displayName,
      status: devices.status,
      lastSeenAt: devices.lastSeenAt,
      archivedAt: devices.archivedAt,
    })
    .from(devices)
    .where(eq(devices.siteId, run.siteId))

  let steps = await loadStepRows(client, run.id)
  const archivedCount = deviceRows.filter((row) => row.archivedAt).length

  for (const device of deviceRows) {
    if (device.archivedAt) continue
    const eligibility = afterHoursDeviceEligibility({
      archivedAt: device.archivedAt,
      status: device.status,
      lastSeenAt: device.lastSeenAt,
      now,
    })
    const updateRun =
      steps.find(
        (row) => row.deviceId === device.id && row.action === "update"
      ) ?? null
    const rebootRun =
      steps.find(
        (row) => row.deviceId === device.id && row.action === "reboot"
      ) ?? null
    const decision = decideAfterHoursDeviceStep({
      updateRun,
      rebootRun,
      eligibility,
      now,
    })
    if (decision.kind === "skip") {
      const inserted = await persistStep(client, {
        run,
        deviceId: device.id,
        action: decision.action,
        status: "skipped",
        skipReason: decision.reason,
        now,
      })
      if (inserted) outcome.stepsSkipped += 1
      continue
    }
    if (decision.kind !== "enqueue") continue

    const queued = await queueStep(client, {
      run,
      deviceId: device.id,
      deviceName: device.displayName,
      action: decision.action,
      now,
    })
    if (queued) outcome.stepsQueued += 1
  }

  steps = await loadStepRows(client, run.id)
  const summaryRows = toSummaryRows(steps)
  const everyDeviceHasRow = deviceRows
    .filter((row) => !row.archivedAt)
    .every((row) => steps.some((step) => step.deviceId === row.id))
  if (everyDeviceHasRow && afterHoursRunIsSettled(summaryRows)) {
    await finishRun(client, {
      run,
      site,
      status: "completed",
      now,
      reason: "settled",
      steps,
      archivedCount,
    })
    outcome.completed = true
  }
  return outcome
}

async function persistStep(
  client: PlaybookDb,
  input: {
    run: RunRow
    deviceId: string
    action: AfterHoursStep
    status: "queued" | "skipped"
    skipReason?: PlaybookSkipReason
    deviceCommandId?: string | null
    now: Date
  }
) {
  const action = parsePlaybookAction(input.action)
  if (!action) return null
  const [row] = await client
    .insert(playbookRuns)
    .values({
      afterHoursRunId: input.run.id,
      organizationId: input.run.organizationId,
      siteId: input.run.siteId,
      deviceId: input.deviceId,
      action,
      status: input.status,
      skipReason: input.skipReason ?? null,
      deviceCommandId: input.deviceCommandId ?? null,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing()
    .returning()
  return row ?? null
}

/**
 * Queue one allowlisted command for the step. When the same kind is already
 * waiting on the device (for example an alert playbook queued an update
 * moments earlier) the step adopts that command instead of stacking another.
 */
async function queueStep(
  client: PlaybookDb,
  input: {
    run: RunRow
    deviceId: string
    deviceName: string
    action: AfterHoursStep
    now: Date
  }
) {
  const kind = parsePlaybookAction(input.action)
  if (!kind) return false

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
        inArray(deviceCommands.status, [...OPEN_COMMAND_STATUSES])
      )
    )

  let commandId: string
  let adopted = false
  if (hasOpenCommandOfKind(open, kind)) {
    const existing = open.find((row) => row.kind === kind)
    if (!existing) return false
    commandId = existing.id
    adopted = true
  } else {
    const [command] = await client
      .insert(deviceCommands)
      .values({
        deviceId: input.deviceId,
        kind,
        status: "pending",
        createdByUserId: null,
      })
      .returning()
    if (!command) return false
    commandId = command.id
  }

  const row = await persistStep(client, {
    run: input.run,
    deviceId: input.deviceId,
    action: input.action,
    status: "queued",
    deviceCommandId: commandId,
    now: input.now,
  })
  if (!row) {
    if (!adopted) {
      await client
        .update(deviceCommands)
        .set({ status: "cancelled", completedAt: input.now })
        .where(
          and(
            eq(deviceCommands.id, commandId),
            eq(deviceCommands.status, "pending")
          )
        )
    }
    return false
  }

  if (!adopted) {
    await writeAfterHoursAudit(client, {
      eventType: "device_command_enqueued",
      organizationId: input.run.organizationId,
      siteId: input.run.siteId,
      deviceId: input.deviceId,
      eventData: {
        commandId,
        kind,
        afterHoursRunId: input.run.id,
        deviceName: input.deviceName,
        source: "after_hours",
      },
    })
  }
  return true
}

async function finishRun(
  client: PlaybookDb,
  input: {
    run: RunRow
    site: SiteRow | null
    status: Extract<AfterHoursRunStatus, "completed" | "cancelled" | "expired">
    now: Date
    reason: "settled" | "floor_opened" | "schedule_disabled" | "not_reviewed"
    steps?: StepState[]
    archivedCount?: number
  }
) {
  const steps = input.steps ?? (await loadStepRows(client, input.run.id))

  const undelivered = steps.filter(
    (row) =>
      row.status === "queued" &&
      row.deviceCommandId &&
      row.commandStatus === "pending"
  )
  if (undelivered.length > 0) {
    const commandIds = undelivered
      .map((row) => row.deviceCommandId)
      .filter((id): id is string => Boolean(id))
    await client
      .update(deviceCommands)
      .set({ status: "cancelled", completedAt: input.now })
      .where(
        and(
          inArray(deviceCommands.id, commandIds),
          eq(deviceCommands.status, "pending")
        )
      )
    await client
      .update(playbookRuns)
      .set({ status: "cancelled", updatedAt: input.now })
      .where(
        inArray(
          playbookRuns.id,
          undelivered.map((row) => row.id)
        )
      )
  }

  const finalSteps =
    undelivered.length > 0 ? await loadStepRows(client, input.run.id) : steps
  const archivedCount =
    input.archivedCount ??
    (
      await client
        .select({ id: devices.id })
        .from(devices)
        .where(
          and(
            eq(devices.siteId, input.run.siteId),
            isNotNull(devices.archivedAt)
          )
        )
    ).length
  const summary = summarizeAfterHoursRun(
    toSummaryRows(finalSteps),
    archivedCount
  )

  const [updated] = await client
    .update(afterHoursRuns)
    .set({
      status: input.status,
      summary,
      completedAt: input.now,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(afterHoursRuns.id, input.run.id),
        inArray(afterHoursRuns.status, ACTIVE_RUN_STATUSES)
      )
    )
    .returning()
  if (!updated) return null

  await writeAfterHoursAudit(client, {
    eventType: "after_hours_run_completed",
    organizationId: input.run.organizationId,
    siteId: input.run.siteId,
    eventData: {
      afterHoursRunId: input.run.id,
      siteName: input.site?.name ?? null,
      windowKey: input.run.windowKey,
      status: input.status,
      reason: input.reason,
      summary,
    },
  })
  return updated
}

/** Approver decision from the Console. Approval hands the run to the worker's next pass. */
export async function decideAfterHoursRun(
  client: PlaybookDb,
  input: {
    run: RunRow
    decision: "approved" | "denied"
    actorUserId: string
    siteName: string | null
    now: Date
  }
) {
  const status: AfterHoursRunStatus =
    input.decision === "approved" ? "running" : "denied"
  const [updated] = await client
    .update(afterHoursRuns)
    .set({
      status,
      decidedByUserId: input.actorUserId,
      decidedAt: input.now,
      startedAt: input.decision === "approved" ? input.now : null,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(afterHoursRuns.id, input.run.id),
        eq(afterHoursRuns.status, "pending_approval")
      )
    )
    .returning()
  if (!updated) return null

  await writeAfterHoursAudit(client, {
    eventType:
      input.decision === "approved"
        ? "after_hours_run_approved"
        : "after_hours_run_denied",
    organizationId: updated.organizationId,
    siteId: updated.siteId,
    actorUserId: input.actorUserId,
    eventData: {
      afterHoursRunId: updated.id,
      siteName: input.siteName,
      windowKey: updated.windowKey,
      steps: [...afterHoursSteps],
    },
  })
  return updated
}
