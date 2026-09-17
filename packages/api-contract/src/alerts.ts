import { alerts, and, auditEvents, eq, sql } from "@nms/db"
import { db } from "@nms/db/client"
import {
  alertKindDefaultSeverity,
  alertKindLabels,
  archivedOnlineAlertTitle,
  severityForEvent,
  type AlertKind,
  type AlertStatus,
  type AuditEventType,
  type AuditSeverity,
} from "@nms/shared"

import { enqueueAlertNotifications } from "./alert-deliveries"
import {
  activeMaintenanceWindowFor,
  resolveAlertPolicy,
  shouldSkipQuietAlertForClosedHours,
} from "./alert-runtime"

export type RaiseAlertInput = {
  kind: AlertKind
  dedupeKey: string
  organizationId?: string | null
  siteId?: string | null
  deviceId?: string | null
  assetId?: string | null
  title?: string
  detail?: Record<string, unknown>
  severity?: AuditSeverity
  /**
   * `event` (default): each call is a distinct happening and counts as a new
   * occurrence while the alert stays open.
   * `condition`: the caller re-asserts an ongoing state on every pass, so an
   * open alert only has its last-seen time refreshed; the occurrence count
   * records how many times the condition began.
   */
  mode?: "event" | "condition"
}

/** How stale an open condition alert may get before its last-seen time is rewritten. */
const CONDITION_TOUCH_INTERVAL_MS = 60_000

type AuditWriter = Pick<typeof db, "insert">

async function recordSystemEvent(
  input: {
    eventType: AuditEventType
    organizationId?: string | null
    siteId?: string | null
    deviceId?: string | null
    severity?: AuditSeverity
    eventData?: Record<string, unknown>
  },
  writer: AuditWriter = db
) {
  await writer.insert(auditEvents).values({
    actorUserId: null,
    organizationId: input.organizationId ?? null,
    siteId: input.siteId ?? null,
    deviceId: input.deviceId ?? null,
    eventType: input.eventType,
    severity: input.severity ?? severityForEvent(input.eventType),
    eventData: input.eventData ?? {},
  })
}

/**
 * Opens an alert or, when the same condition is already open, records the
 * repeat. Acknowledged alerts keep their acknowledgement; only a resolved
 * alert followed by a repeat opens a fresh row. Alerts raised inside an
 * active maintenance window are created `suppressed` and do not enqueue
 * deliveries until they are promoted. Offline and flap alerts that begin
 * while the site is closed are not opened; they are re-evaluated when the
 * floor opens.
 */
export async function raiseAlert(input: RaiseAlertInput) {
  const now = new Date()
  const policy = await resolveAlertPolicy(
    input.kind,
    input.organizationId,
    input.siteId
  )
  if (!policy.enabled) {
    return { id: "", created: false as const }
  }

  const severity =
    input.severity ?? policy.severity ?? alertKindDefaultSeverity[input.kind]
  const title = input.title ?? alertKindLabels[input.kind]
  const detail = input.detail ?? {}
  const mode = input.mode ?? "event"
  const window = await activeMaintenanceWindowFor(
    {
      organizationId: input.organizationId ?? null,
      siteId: input.siteId ?? null,
      deviceId: input.deviceId ?? null,
    },
    now
  )
  const floorClosedQuiet = await shouldSkipQuietAlertForClosedHours(
    input.kind,
    input.siteId,
    now
  )

  const [existing] = await db
    .select({
      id: alerts.id,
      status: alerts.status,
      occurrences: alerts.occurrences,
      lastSeenAt: alerts.lastSeenAt,
    })
    .from(alerts)
    .where(
      and(
        eq(alerts.dedupeKey, input.dedupeKey),
        sql`${alerts.status} <> 'resolved'`
      )
    )

  if (existing) {
    if (existing.status === "suppressed" && !window) {
      if (floorClosedQuiet) {
        return { id: existing.id, created: false as const }
      }
      const promoted = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(alerts)
          .set({
            status: "open",
            lastSeenAt: now,
            updatedAt: now,
            severity,
            detail,
          })
          .where(
            and(eq(alerts.id, existing.id), eq(alerts.status, "suppressed"))
          )
          .returning()
        if (!row) return null
        await enqueueAlertNotifications(tx, row, "alert.opened", now)
        return row
      })
      return { id: promoted?.id ?? existing.id, created: false as const }
    }

    if (mode === "condition") {
      const fresh =
        now.getTime() - existing.lastSeenAt.getTime() <
        CONDITION_TOUCH_INTERVAL_MS
      if (!fresh) {
        await db
          .update(alerts)
          .set({ lastSeenAt: now, updatedAt: now, severity, detail })
          .where(eq(alerts.id, existing.id))
      }
      return { id: existing.id, created: false as const }
    }

    await db
      .update(alerts)
      .set({
        occurrences: existing.occurrences + 1,
        lastSeenAt: now,
        updatedAt: now,
        severity,
        detail,
      })
      .where(eq(alerts.id, existing.id))
    return { id: existing.id, created: false as const }
  }

  if (floorClosedQuiet) {
    return { id: "", created: false as const }
  }

  const status: AlertStatus = window ? "suppressed" : "open"

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(alerts)
      .values({
        organizationId: input.organizationId ?? null,
        siteId: input.siteId ?? null,
        deviceId: input.deviceId ?? null,
        assetId: input.assetId ?? null,
        kind: input.kind,
        severity,
        status,
        title,
        detail,
        dedupeKey: input.dedupeKey,
        firstSeenAt: now,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning()

    if (!row) return null

    await recordSystemEvent(
      {
        eventType: "alert_raised",
        organizationId: input.organizationId ?? null,
        siteId: input.siteId ?? null,
        deviceId: input.deviceId ?? null,
        severity,
        eventData: {
          alertId: row.id,
          kind: input.kind,
          title,
          status,
          ...detail,
        },
      },
      tx
    )

    if (row.status === "open") {
      await enqueueAlertNotifications(tx, row, "alert.opened", now)
    }

    return row
  })

  if (!created) {
    // Lost a race with another writer; treat as a repeat occurrence.
    return raiseAlert(input)
  }

  return { id: created.id, created: true as const }
}

/** Resolves an open alert for the condition, if there is one. */
export async function resolveAlert(
  dedupeKey: string,
  detail: Record<string, unknown> = {}
) {
  const now = new Date()
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(alerts)
      .where(
        and(
          eq(alerts.dedupeKey, dedupeKey),
          sql`${alerts.status} <> 'resolved'`
        )
      )
    if (!existing) return null

    const wasSuppressed = existing.status === "suppressed"
    const [resolved] = await tx
      .update(alerts)
      .set({
        status: "resolved",
        resolvedAt: now,
        updatedAt: now,
        detail: sql`${alerts.detail} || ${JSON.stringify(detail)}::jsonb`,
      })
      .where(eq(alerts.id, existing.id))
      .returning()

    if (!resolved) return null

    await recordSystemEvent(
      {
        eventType: "alert_resolved",
        organizationId: resolved.organizationId,
        siteId: resolved.siteId,
        deviceId: resolved.deviceId,
        eventData: {
          alertId: resolved.id,
          kind: resolved.kind,
          title: resolved.title,
          resolvedBy: "system",
          ...detail,
        },
      },
      tx
    )

    if (!wasSuppressed) {
      await enqueueAlertNotifications(tx, resolved, "alert.resolved", now)
    }
    return resolved
  })
}

export const alertKeys = {
  newEndpoint: (deviceId: string) => `new_endpoint:${deviceId}`,
  peerFlapping: (deviceId: string) => `peer_flapping:${deviceId}`,
  deviceOffline: (deviceId: string) => `device_offline:${deviceId}`,
  concentratorProbe: (deviceId: string) => `concentrator_probe:${deviceId}`,
  firewallSync: () => "firewall_sync_failed:hub",
  agentOutdated: (deviceId: string) => `agent_outdated:${deviceId}`,
  warrantyExpiring: (assetId: string) => `warranty_expiring:${assetId}`,
  archivedDeviceOnline: (deviceId: string) =>
    `archived_device_online:${deviceId}`,
}

export async function syncArchivedDeviceAlerts(input: {
  deviceId: string
  organizationId: string
  siteId: string | null
  displayName: string
  archived: boolean
  present: boolean
  source?: "vpn_handshake" | "agent_check_in" | "archive"
  endpoint?: string | null
}) {
  if (!input.archived) {
    await resolveAlert(alertKeys.archivedDeviceOnline(input.deviceId), {
      resolvedReason: "device_unarchived",
    })
    return
  }

  await resolveAlert(alertKeys.deviceOffline(input.deviceId), {
    resolvedReason: "device_archived",
  })
  await resolveAlert(alertKeys.peerFlapping(input.deviceId), {
    resolvedReason: "device_archived",
  })
  await resolveAlert(alertKeys.agentOutdated(input.deviceId), {
    resolvedReason: "device_archived",
  })

  if (input.present) {
    await raiseAlert({
      kind: "archived_device_online",
      mode: "condition",
      dedupeKey: alertKeys.archivedDeviceOnline(input.deviceId),
      organizationId: input.organizationId,
      siteId: input.siteId,
      deviceId: input.deviceId,
      title: archivedOnlineAlertTitle(input.displayName),
      detail: {
        device: input.displayName,
        source: input.source ?? "archive",
        endpoint: input.endpoint ?? null,
      },
    })
    return
  }

  await resolveAlert(alertKeys.archivedDeviceOnline(input.deviceId), {
    resolvedReason: "archived_quiet",
  })
}
