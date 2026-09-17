import { and, desc, eq, gte, inArray, sql } from "drizzle-orm"

import {
  auditEvents,
  deviceCommands,
  devices,
  siteAfterHoursRuns,
  sites,
  vpnIdentities,
} from "@nms/db"
import {
  AFTER_HOURS_ACTIVE_STATUSES,
  afterHoursDeviceName,
  applyCancelledCommands,
  decideAfterHoursCancel,
  decideAfterHoursRun,
  playbookApprovalExpiresAt,
  sanitizeAfterHoursSteps,
  selectAfterHoursDevices,
  severityForEvent,
  type AfterHoursCancelReason,
  type AfterHoursDeviceCandidate,
  type AfterHoursDeviceResult,
  type AuditEventType,
  type PlaybookAction,
} from "@nms/shared"

/** Active runs older than this have long since been picked up or expired. */
const ACTIVE_RUN_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000

import { enqueueAllowlistedCommand, type PlaybookDb } from "./playbook-engine"

/**
 * Last open/closed reading per site, kept between worker passes so a close
 * is seen as a transition rather than a state. The worker backs this with
 * Redis; tests can pass a Map.
 */
export interface SiteOpenStateStore {
  loadAll(): Promise<Map<string, boolean>>
  saveAll(states: Map<string, boolean>, removeKeys: string[]): Promise<void>
}

export type AfterHoursSiteRow = {
  id: string
  organizationId: string
  name: string
  timezone: string | null
  businessHours: (typeof sites.$inferSelect)["businessHours"]
  afterHoursEnabled: boolean
  afterHoursSteps: unknown
  afterHoursRequireApproval: boolean
}

type AfterHoursAuditEvent = Extract<
  AuditEventType,
  | "after_hours_run_requested"
  | "after_hours_run_queued"
  | "after_hours_run_skipped"
  | "after_hours_run_approved"
  | "after_hours_run_denied"
  | "after_hours_run_cancelled"
  | "device_command_enqueued"
>

async function writeAfterHoursAudit(
  client: PlaybookDb,
  input: {
    eventType: AfterHoursAuditEvent
    organizationId: string
    siteId: string
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

export async function expireAfterHoursRuns(
  client: PlaybookDb,
  now = new Date()
) {
  await client
    .update(siteAfterHoursRuns)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        eq(siteAfterHoursRuns.status, "pending_approval"),
        sql`${siteAfterHoursRuns.expiresAt} <= ${now}`
      )
    )
}

async function loadSiteDevices(
  client: PlaybookDb,
  siteId: string
): Promise<AfterHoursDeviceCandidate[]> {
  const rows = await client
    .select({
      id: devices.id,
      displayName: devices.displayName,
      hostname: devices.hostname,
      status: devices.status,
      archivedAt: devices.archivedAt,
      lastSeenAt: devices.lastSeenAt,
      lastHandshakeAt: vpnIdentities.lastHandshakeAt,
      revokedAt: vpnIdentities.revokedAt,
    })
    .from(devices)
    .leftJoin(vpnIdentities, eq(vpnIdentities.deviceId, devices.id))
    .where(eq(devices.siteId, siteId))
  return rows.map((row) => ({
    id: row.id,
    displayName: row.displayName,
    hostname: row.hostname,
    status: row.status,
    archivedAt: row.archivedAt,
    lastSeenAt: row.lastSeenAt,
    lastHandshakeAt: row.lastHandshakeAt ?? null,
    revokedAt: row.revokedAt ?? null,
  }))
}

/**
 * Queues every step for every reachable device at the site and records a
 * per-device receipt. Steps are re-checked against the whitelist here so a
 * stale row can never dispatch anything else.
 */
export async function queueAfterHoursRunCommands(
  client: PlaybookDb,
  input: {
    run: {
      id: string
      siteId: string
      organizationId: string
      steps: unknown
    }
    siteName: string
    actorUserId?: string | null
    now?: Date
  }
) {
  const now = input.now ?? new Date()
  const steps = sanitizeAfterHoursSteps(
    Array.isArray(input.run.steps) ? input.run.steps : []
  )
  const candidates = await loadSiteDevices(client, input.run.siteId)
  const selection = selectAfterHoursDevices(candidates, now)
  const results: AfterHoursDeviceResult[] = selection.skipped.map((entry) => ({
    deviceId: entry.device.id,
    deviceName: afterHoursDeviceName(entry.device),
    outcome: entry.outcome,
    commandIds: [],
  }))

  let queuedDevices = 0
  for (const device of selection.eligible) {
    const commandIds: string[] = []
    for (const step of steps) {
      const enqueued = await enqueueAllowlistedCommand(client, {
        deviceId: device.id,
        kind: step,
        createdByUserId: input.actorUserId ?? null,
      })
      if (!enqueued?.command) continue
      commandIds.push(enqueued.command.id)
      await writeAfterHoursAudit(client, {
        eventType: "device_command_enqueued",
        organizationId: input.run.organizationId,
        siteId: input.run.siteId,
        deviceId: device.id,
        actorUserId: input.actorUserId ?? null,
        eventData: {
          commandId: enqueued.command.id,
          kind: step,
          afterHoursRunId: input.run.id,
          siteName: input.siteName,
          source: "after_hours",
        },
      })
    }
    if (commandIds.length > 0) queuedDevices += 1
    results.push({
      deviceId: device.id,
      deviceName: afterHoursDeviceName(device),
      outcome: commandIds.length > 0 ? "queued" : "open_command",
      commandIds,
    })
  }

  const status = queuedDevices > 0 ? "queued" : "skipped"
  const [updated] = await client
    .update(siteAfterHoursRuns)
    .set({
      status,
      steps,
      deviceResults: results,
      queuedDeviceCount: queuedDevices,
      skippedDeviceCount: results.length - queuedDevices,
      updatedAt: now,
    })
    .where(eq(siteAfterHoursRuns.id, input.run.id))
    .returning()

  await writeAfterHoursAudit(client, {
    eventType:
      status === "queued"
        ? "after_hours_run_queued"
        : "after_hours_run_skipped",
    organizationId: input.run.organizationId,
    siteId: input.run.siteId,
    actorUserId: input.actorUserId ?? null,
    eventData: {
      afterHoursRunId: input.run.id,
      siteName: input.siteName,
      steps,
      queuedDevices,
      skippedDevices: results.length - queuedDevices,
      devices: results.map((entry) => ({
        deviceId: entry.deviceId,
        outcome: entry.outcome,
        commands: entry.commandIds.length,
      })),
    },
  })

  return { run: updated ?? null, status, queuedDevices, results }
}

/**
 * Opens a run for a site that just closed. With approval required the run
 * waits in Approvals and the device list is decided when someone approves;
 * otherwise commands queue immediately.
 */
export async function startAfterHoursRun(
  client: PlaybookDb,
  input: {
    site: AfterHoursSiteRow
    steps: PlaybookAction[]
    now: Date
  }
) {
  const { site, steps, now } = input
  const requireApproval = site.afterHoursRequireApproval
  const [run] = await client
    .insert(siteAfterHoursRuns)
    .values({
      siteId: site.id,
      organizationId: site.organizationId,
      closedAt: now,
      steps,
      requireApproval,
      status: requireApproval ? "pending_approval" : "queued",
      expiresAt: requireApproval ? playbookApprovalExpiresAt(now) : null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
  if (!run) return null

  if (requireApproval) {
    const candidates = await loadSiteDevices(client, site.id)
    const selection = selectAfterHoursDevices(candidates, now)
    await client
      .update(siteAfterHoursRuns)
      .set({
        deviceResults: [
          ...selection.eligible.map((device) => ({
            deviceId: device.id,
            deviceName: afterHoursDeviceName(device),
            outcome: "queued" as const,
            commandIds: [],
          })),
          ...selection.skipped.map((entry) => ({
            deviceId: entry.device.id,
            deviceName: afterHoursDeviceName(entry.device),
            outcome: entry.outcome,
            commandIds: [],
          })),
        ],
        queuedDeviceCount: selection.eligible.length,
        skippedDeviceCount: selection.skipped.length,
        updatedAt: now,
      })
      .where(eq(siteAfterHoursRuns.id, run.id))
    await writeAfterHoursAudit(client, {
      eventType: "after_hours_run_requested",
      organizationId: site.organizationId,
      siteId: site.id,
      eventData: {
        afterHoursRunId: run.id,
        siteName: site.name,
        steps,
        reachableDevices: selection.eligible.length,
        skippedDevices: selection.skipped.length,
        expiresAt: run.expiresAt?.toISOString() ?? null,
      },
    })
    return { run, status: "pending_approval" as const }
  }

  const queued = await queueAfterHoursRunCommands(client, {
    run,
    siteName: site.name,
    now,
  })
  return { run: queued.run ?? run, status: queued.status }
}

/**
 * Pulls back every command from the run that no agent has collected yet and
 * closes the run. Returns null when nothing was left to cancel: a queued run
 * whose steps were all delivered stays as it was.
 */
export async function cancelAfterHoursRun(
  client: PlaybookDb,
  input: {
    run: Pick<
      typeof siteAfterHoursRuns.$inferSelect,
      "id" | "siteId" | "organizationId" | "status" | "deviceResults"
    >
    siteName: string
    reason: AfterHoursCancelReason
    actorUserId?: string | null
    now?: Date
  }
) {
  const now = input.now ?? new Date()
  const commandIds = input.run.deviceResults.flatMap(
    (entry) => entry.commandIds
  )
  let cancelledIds = new Set<string>()
  if (commandIds.length > 0) {
    const cancelled = await client
      .update(deviceCommands)
      .set({ status: "cancelled", completedAt: now })
      .where(
        and(
          inArray(deviceCommands.id, commandIds),
          eq(deviceCommands.status, "pending")
        )
      )
      .returning({ id: deviceCommands.id })
    cancelledIds = new Set(cancelled.map((row) => row.id))
  }

  if (input.run.status !== "pending_approval" && cancelledIds.size === 0) {
    return null
  }

  const results = applyCancelledCommands(input.run.deviceResults, cancelledIds)
  const [updated] = await client
    .update(siteAfterHoursRuns)
    .set({
      status: "cancelled",
      cancelReason: input.reason,
      deviceResults: results,
      queuedDeviceCount: results.filter((entry) => entry.outcome === "queued")
        .length,
      skippedDeviceCount: results.filter((entry) => entry.outcome !== "queued")
        .length,
      ...(input.actorUserId
        ? { decidedByUserId: input.actorUserId, decidedAt: now }
        : {}),
      updatedAt: now,
    })
    .where(
      and(
        eq(siteAfterHoursRuns.id, input.run.id),
        inArray(siteAfterHoursRuns.status, [...AFTER_HOURS_ACTIVE_STATUSES])
      )
    )
    .returning()
  if (!updated) return null

  await writeAfterHoursAudit(client, {
    eventType: "after_hours_run_cancelled",
    organizationId: input.run.organizationId,
    siteId: input.run.siteId,
    actorUserId: input.actorUserId ?? null,
    eventData: {
      afterHoursRunId: input.run.id,
      siteName: input.siteName,
      reason: input.reason,
      cancelledCommands: cancelledIds.size,
      previousStatus: input.run.status,
    },
  })
  return { run: updated, cancelledCommands: cancelledIds.size }
}

/**
 * Cancels runs that should not proceed: the floor reopened before devices
 * picked up their steps, or the site turned after-hours runs off mid-run.
 */
async function cancelStaleActiveRuns(
  client: PlaybookDb,
  sitesById: Map<string, AfterHoursSiteRow>,
  openBySite: Map<string, boolean | null>,
  now: Date
) {
  const active = await client
    .select()
    .from(siteAfterHoursRuns)
    .where(
      and(
        inArray(siteAfterHoursRuns.status, [...AFTER_HOURS_ACTIVE_STATUSES]),
        gte(
          siteAfterHoursRuns.createdAt,
          new Date(now.getTime() - ACTIVE_RUN_LOOKBACK_MS)
        )
      )
    )
  let cancelled = 0
  for (const run of active) {
    const site = sitesById.get(run.siteId)
    if (!site) continue
    const reason = decideAfterHoursCancel({
      runStatus: run.status,
      afterHoursEnabled: site.afterHoursEnabled,
      siteOpen: openBySite.get(run.siteId) ?? null,
    })
    if (!reason) continue
    const result = await cancelAfterHoursRun(client, {
      run,
      siteName: site.name,
      reason,
      now,
    })
    if (result) cancelled += 1
  }
  return cancelled
}

async function lastRunAtBySite(client: PlaybookDb, siteIds: string[]) {
  const map = new Map<string, Date>()
  if (siteIds.length === 0) return map
  const rows = await client
    .select({
      siteId: siteAfterHoursRuns.siteId,
      createdAt: siteAfterHoursRuns.createdAt,
    })
    .from(siteAfterHoursRuns)
    .where(inArray(siteAfterHoursRuns.siteId, siteIds))
    .orderBy(desc(siteAfterHoursRuns.createdAt))
  for (const row of rows) {
    if (!map.has(row.siteId)) map.set(row.siteId, row.createdAt)
  }
  return map
}

/**
 * One worker pass: read every site's open state, compare with the previous
 * pass, and start a run for each site that just closed and opted in. Sites
 * without hours are dropped from the store so a later change starts fresh.
 */
export async function evaluateAfterHoursSites(
  client: PlaybookDb,
  store: SiteOpenStateStore,
  now = new Date()
) {
  await expireAfterHoursRuns(client, now)

  const siteRows: AfterHoursSiteRow[] = await client
    .select({
      id: sites.id,
      organizationId: sites.organizationId,
      name: sites.name,
      timezone: sites.timezone,
      businessHours: sites.businessHours,
      afterHoursEnabled: sites.afterHoursEnabled,
      afterHoursSteps: sites.afterHoursSteps,
      afterHoursRequireApproval: sites.afterHoursRequireApproval,
    })
    .from(sites)

  const previous = await store.loadAll()
  const lastRuns = await lastRunAtBySite(
    client,
    siteRows.filter((row) => row.afterHoursEnabled).map((row) => row.id)
  )

  const next = new Map<string, boolean>()
  const openBySite = new Map<string, boolean | null>()
  const stats = {
    sites: siteRows.length,
    fired: 0,
    pendingApproval: 0,
    cancelled: 0,
  }

  for (const site of siteRows) {
    const decision = decideAfterHoursRun({
      site: {
        timezone: site.timezone,
        businessHours: site.businessHours,
        afterHoursEnabled: site.afterHoursEnabled,
        afterHoursSteps: Array.isArray(site.afterHoursSteps)
          ? site.afterHoursSteps
          : null,
      },
      previousOpen: previous.get(site.id) ?? null,
      lastRunAt: lastRuns.get(site.id) ?? null,
      now,
    })
    openBySite.set(site.id, decision.open)
    if (decision.open !== null) next.set(site.id, decision.open)
    if (decision.kind !== "fire") continue

    const started = await startAfterHoursRun(client, {
      site,
      steps: decision.steps,
      now,
    })
    if (!started) continue
    stats.fired += 1
    if (started.status === "pending_approval") stats.pendingApproval += 1
  }

  stats.cancelled = await cancelStaleActiveRuns(
    client,
    new Map(siteRows.map((row) => [row.id, row])),
    openBySite,
    now
  )

  const removeKeys = [...previous.keys()].filter((key) => !next.has(key))
  await store.saveAll(next, removeKeys)
  return stats
}
