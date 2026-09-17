import { alertPolicies, maintenanceWindows, type AlertPolicy } from "@nms/db"
import { db } from "@nms/db/client"
import {
  findActiveMaintenanceWindow,
  pickEffectiveAlertPolicy,
  type AlertPolicyFields,
  type EffectiveAlertPolicy,
} from "@nms/shared"

type Cache = {
  at: number
  policies: AlertPolicy[]
  windows: Awaited<ReturnType<typeof loadWindows>>
}

const CACHE_TTL_MS = 10_000
let cache: Cache | null = null

async function loadWindows() {
  return db.select().from(maintenanceWindows)
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
  const [policies, windows] = await Promise.all([
    db.select().from(alertPolicies),
    loadWindows(),
  ])
  cache = { at: now, policies, windows }
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
