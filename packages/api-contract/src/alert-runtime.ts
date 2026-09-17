import { and, eq, gte } from "drizzle-orm"

import {
  alertPolicies,
  deviceCommands,
  maintenanceWindows,
  sites,
  type AlertPolicy,
} from "@nms/db"
import { db } from "@nms/db/client"
import {
  findActiveMaintenanceWindow,
  inPlannedRebootGrace,
  isClosedHoursQuietKind,
  pickEffectiveAlertPolicy,
  siteOpenState,
  type AlertKind,
  type AlertPolicyFields,
  type EffectiveAlertPolicy,
  type SiteBusinessHours,
} from "@nms/shared"

type SiteHoursRow = {
  id: string
  timezone: string | null
  businessHours: SiteBusinessHours | null
}

type Cache = {
  at: number
  policies: AlertPolicy[]
  windows: Awaited<ReturnType<typeof loadWindows>>
  sites: SiteHoursRow[]
}

const CACHE_TTL_MS = 10_000
const RECENT_COMMAND_LOOKBACK_MS = 24 * 60 * 60 * 1000
let cache: Cache | null = null

async function loadWindows() {
  return db.select().from(maintenanceWindows)
}

async function loadSiteHours() {
  return db
    .select({
      id: sites.id,
      timezone: sites.timezone,
      businessHours: sites.businessHours,
    })
    .from(sites)
}

function asPolicyFields(row: AlertPolicy): AlertPolicyFields {
  return {
    organizationId: row.organizationId,
    siteId: row.siteId,
    kind: row.kind,
    enabled: row.enabled,
    severity: row.severity,
    escalateAfterMinutes: row.escalateAfterMinutes,
    thresholds: row.thresholds ?? {},
  }
}

export async function loadAlertLifecycleState(force = false) {
  const now = Date.now()
  if (!force && cache && now - cache.at < CACHE_TTL_MS) {
    return cache
  }
  const [policies, windows, siteHours] = await Promise.all([
    db.select().from(alertPolicies),
    loadWindows(),
    loadSiteHours(),
  ])
  cache = { at: now, policies, windows, sites: siteHours }
  return cache
}

export function effectivePolicyFor(
  state: Awaited<ReturnType<typeof loadAlertLifecycleState>>,
  kind: AlertPolicyFields["kind"],
  organizationId: string | null | undefined,
  siteId: string | null | undefined
): EffectiveAlertPolicy {
  return pickEffectiveAlertPolicy(
    state.policies.map(asPolicyFields),
    kind,
    organizationId,
    siteId
  )
}

export async function resolveAlertPolicy(
  kind: AlertPolicyFields["kind"],
  organizationId: string | null | undefined,
  siteId: string | null | undefined
) {
  const state = await loadAlertLifecycleState()
  return effectivePolicyFor(state, kind, organizationId, siteId)
}

export async function offlineAlertHours(
  organizationId: string | null | undefined,
  siteId: string | null | undefined
) {
  const policy = await resolveAlertPolicy(
    "device_offline",
    organizationId,
    siteId
  )
  return policy.offlineHours
}

export async function activeMaintenanceWindowFor(
  target: {
    organizationId: string | null
    siteId: string | null
    deviceId: string | null
  },
  now: Date
) {
  if (!target.organizationId) return null
  const state = await loadAlertLifecycleState()
  return findActiveMaintenanceWindow(state.windows, target, now)
}

export function siteOpenFor(
  state: Awaited<ReturnType<typeof loadAlertLifecycleState>>,
  siteId: string | null | undefined,
  now: Date
) {
  if (!siteId) return null
  const site = state.sites.find((row) => row.id === siteId)
  return siteOpenState(site ?? null, now)
}

export async function siteOpenForTarget(siteId: string | null, now: Date) {
  if (!siteId) return null
  const state = await loadAlertLifecycleState()
  return siteOpenFor(state, siteId, now)
}

/**
 * Offline and flapping are expected right after a Hub-issued restart. Only
 * those kinds ask; everything else pages as usual.
 */
export async function deviceInPlannedRebootGrace(
  kind: AlertKind,
  deviceId: string | null | undefined,
  now: Date
) {
  if (!deviceId || !isClosedHoursQuietKind(kind)) return false
  // A restart can sit waiting for a check-in long after it was created; the
  // grace itself is measured from when it was handed to the agent.
  const since = new Date(now.getTime() - RECENT_COMMAND_LOOKBACK_MS)
  const rows = await db
    .select({
      kind: deviceCommands.kind,
      status: deviceCommands.status,
      sentAt: deviceCommands.sentAt,
      completedAt: deviceCommands.completedAt,
    })
    .from(deviceCommands)
    .where(
      and(
        eq(deviceCommands.deviceId, deviceId),
        eq(deviceCommands.kind, "reboot"),
        gte(deviceCommands.createdAt, since)
      )
    )
  return inPlannedRebootGrace(rows, now)
}

export function alertIsHeld(
  state: Awaited<ReturnType<typeof loadAlertLifecycleState>>,
  alert: {
    organizationId: string | null
    siteId: string | null
    deviceId: string | null
    kind: AlertKind
  },
  now: Date
) {
  return Boolean(findActiveMaintenanceWindow(state.windows, alert, now))
}

export async function alertIsHeldFor(
  target: {
    organizationId: string | null
    siteId: string | null
    deviceId: string | null
    kind: AlertKind
  },
  now: Date
) {
  const state = await loadAlertLifecycleState()
  return alertIsHeld(state, target, now)
}
