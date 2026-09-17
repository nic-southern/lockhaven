import {
  alertPolicies,
  maintenanceWindows,
  sites,
  type AlertPolicy,
  type Site,
} from "@nms/db"
import { db } from "@nms/db/client"
import {
  findActiveMaintenanceWindow,
  pickEffectiveAlertPolicy,
  shouldSkipClosedHoursAlert,
  type AlertKind,
  type AlertPolicyFields,
  type EffectiveAlertPolicy,
  type SiteBusinessHours,
} from "@nms/shared"

type SiteHoursRow = Pick<Site, "id" | "timezone" | "businessHours">

type Cache = {
  at: number
  policies: AlertPolicy[]
  windows: Awaited<ReturnType<typeof loadWindows>>
  siteHours: SiteHoursRow[]
}

const CACHE_TTL_MS = 10_000
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
  cache = { at: now, policies, windows, siteHours }
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

export function siteHoursFor(
  state: Awaited<ReturnType<typeof loadAlertLifecycleState>>,
  siteId: string | null | undefined
): { hours: SiteBusinessHours | null; timeZone: string | null } {
  if (!siteId) return { hours: null, timeZone: null }
  const row = state.siteHours.find((site) => site.id === siteId)
  return {
    hours: row?.businessHours ?? null,
    timeZone: row?.timezone ?? null,
  }
}

export async function shouldSkipQuietAlertForClosedHours(
  kind: AlertKind,
  siteId: string | null | undefined,
  now: Date
) {
  if (!siteId) return false
  const state = await loadAlertLifecycleState()
  const site = siteHoursFor(state, siteId)
  return shouldSkipClosedHoursAlert({
    kind,
    hours: site.hours,
    timeZone: site.timeZone,
    now,
  })
}
