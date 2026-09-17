import { and, eq, isNull, lte, or, sql } from "drizzle-orm"

import { alerts } from "@nms/db"
import { db } from "@nms/db/client"
import {
  findActiveMaintenanceWindow,
  selectAlertsToEscalate,
  shouldAutoResolveConcentratorProbe,
  shouldHoldAlertForClosedHours,
  type EscalationCandidate,
} from "@nms/shared"

import { resolveAlert } from "./alerts"
import { recordEvent } from "./audit"
import {
  alertIsHeld,
  effectivePolicyFor,
  loadAlertLifecycleState,
  siteOpenFor,
} from "./lifecycle"
import { enqueueAlertNotifications } from "./notify"

async function promoteSuppressedAlerts(now: Date) {
  const state = await loadAlertLifecycleState()
  const suppressed = await db
    .select()
    .from(alerts)
    .where(eq(alerts.status, "suppressed"))

  let promoted = 0
  for (const alert of suppressed) {
    if (alertIsHeld(state, alert, now)) continue
    if (
      shouldHoldAlertForClosedHours(
        alert.kind,
        siteOpenFor(state, alert.siteId, now)
      )
    ) {
      continue
    }

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(alerts)
        .set({ status: "open", updatedAt: now })
        .where(and(eq(alerts.id, alert.id), eq(alerts.status, "suppressed")))
        .returning()
      if (!row) return null
      await recordEvent(
        {
          eventType: "alert_raised",
          organizationId: row.organizationId,
          siteId: row.siteId,
          deviceId: row.deviceId,
          severity: row.severity,
          eventData: {
            alertId: row.id,
            kind: row.kind,
            title: row.title,
            promotedFrom: "suppressed",
          },
        },
        tx
      )
      await enqueueAlertNotifications(tx, row, "alert.opened", now)
      return row
    })
    if (updated) promoted += 1
  }
  return promoted
}

async function autoResolveQuietProbes(now: Date) {
  const quiet = await db
    .select()
    .from(alerts)
    .where(
      and(
        eq(alerts.kind, "concentrator_probe"),
        sql`${alerts.status} <> 'resolved'`
      )
    )

  let resolved = 0
  for (const alert of quiet) {
    if (!shouldAutoResolveConcentratorProbe(alert, now)) continue
    await resolveAlert(alert.dedupeKey, { resolvedReason: "quiet" })
    resolved += 1
  }
  return resolved
}

async function escalateOpenAlerts(now: Date) {
  const state = await loadAlertLifecycleState()
  const open = await db.select().from(alerts).where(eq(alerts.status, "open"))

  const candidates: EscalationCandidate[] = open.map((alert) => ({
    id: alert.id,
    kind: alert.kind,
    status: alert.status,
    organizationId: alert.organizationId,
    siteId: alert.siteId,
    firstSeenAt: alert.firstSeenAt,
    snoozedUntil: alert.snoozedUntil,
    escalatedAt: alert.escalatedAt,
    inMaintenanceWindow: Boolean(
      findActiveMaintenanceWindow(state.windows, alert, now)
    ),
    inClosedHours: shouldHoldAlertForClosedHours(
      alert.kind,
      siteOpenFor(state, alert.siteId, now)
    ),
  }))

  const selected = selectAlertsToEscalate(
    candidates,
    (alert) =>
      effectivePolicyFor(state, alert.kind, alert.organizationId, alert.siteId),
    now
  )
  const selectedIds = new Set(selected.map((row) => row.id))

  let escalated = 0
  for (const alert of open) {
    if (!selectedIds.has(alert.id)) continue
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(alerts)
        .set({ escalatedAt: now, updatedAt: now })
        .where(
          and(
            eq(alerts.id, alert.id),
            eq(alerts.status, "open"),
            isNull(alerts.escalatedAt),
            or(isNull(alerts.snoozedUntil), lte(alerts.snoozedUntil, now))
          )
        )
        .returning()
      if (!row) return null
      await recordEvent(
        {
          eventType: "alert_escalated",
          organizationId: row.organizationId,
          siteId: row.siteId,
          deviceId: row.deviceId,
          severity: row.severity,
          eventData: {
            alertId: row.id,
            kind: row.kind,
            title: row.title,
          },
        },
        tx
      )
      await enqueueAlertNotifications(tx, row, "alert.escalated", now)
      return row
    })
    if (updated) escalated += 1
  }
  return escalated
}

/**
 * Promotes held alerts whose maintenance window or closed hours have ended,
 * auto-resolves quiet concentrator probes, and enqueues escalation deliveries
 * for due open alerts.
 */
export async function runEscalateAlerts(now = new Date()) {
  await loadAlertLifecycleState(true)
  const promoted = await promoteSuppressedAlerts(now)
  const resolved = await autoResolveQuietProbes(now)
  const escalated = await escalateOpenAlerts(now)
  return { promoted, resolved, escalated }
}
