import { and, eq } from "drizzle-orm"

import {
  assets,
  devices,
  notificationChannels,
  notificationDeliveries,
  sites,
  type Alert,
} from "@nms/db"
import { db } from "@nms/db/client"
import {
  channelMatchesAlert,
  mergeAlertTicketContext,
  type AlertNotificationSnapshot,
  type NotificationDeliveryEvent,
} from "@nms/notifications"
import { shouldEnqueueAlertNotification } from "@nms/shared"

type DbWriter = Pick<typeof db, "insert" | "select" | "update" | "execute">

async function loadAlertTicketContext(
  writer: DbWriter,
  alert: Pick<Alert, "deviceId" | "siteId" | "assetId">
) {
  const context: {
    deviceName?: string | null
    hostname?: string | null
    siteName?: string | null
    assetId?: string | null
    assetTag?: string | null
  } = {}

  if (alert.deviceId) {
    const [device] = await writer
      .select({
        displayName: devices.displayName,
        hostname: devices.hostname,
        assetId: devices.assetId,
      })
      .from(devices)
      .where(eq(devices.id, alert.deviceId))
    if (device) {
      context.deviceName = device.displayName
      context.hostname = device.hostname
      context.assetId = device.assetId
    }
  }

  if (alert.siteId) {
    const [site] = await writer
      .select({ name: sites.name })
      .from(sites)
      .where(eq(sites.id, alert.siteId))
    context.siteName = site?.name ?? null
  }

  const assetId = alert.assetId ?? context.assetId ?? null
  if (assetId) {
    const [asset] = await writer
      .select({ tag: assets.tag })
      .from(assets)
      .where(eq(assets.id, assetId))
    context.assetId = assetId
    context.assetTag = asset?.tag ?? null
  }

  return context
}

export async function asAlertSnapshot(
  writer: DbWriter,
  alert: Pick<
    Alert,
    | "id"
    | "kind"
    | "severity"
    | "title"
    | "status"
    | "organizationId"
    | "siteId"
    | "deviceId"
    | "assetId"
    | "detail"
  >
): Promise<AlertNotificationSnapshot> {
  const context = await loadAlertTicketContext(writer, alert)
  return {
    id: alert.id,
    kind: alert.kind,
    severity: alert.severity,
    title: alert.title,
    status: alert.status,
    organizationId: alert.organizationId,
    siteId: alert.siteId,
    deviceId: alert.deviceId,
    detail: mergeAlertTicketContext(alert.detail ?? {}, context),
  }
}

export async function enqueueAlertNotifications(
  writer: DbWriter,
  alert: Pick<
    Alert,
    | "id"
    | "kind"
    | "severity"
    | "title"
    | "status"
    | "organizationId"
    | "siteId"
    | "deviceId"
    | "assetId"
    | "detail"
    | "snoozedUntil"
  >,
  event: Extract<
    NotificationDeliveryEvent,
    "alert.opened" | "alert.resolved" | "alert.escalated"
  >,
  now = new Date()
) {
  if (
    !shouldEnqueueAlertNotification(
      { status: alert.status, snoozedUntil: alert.snoozedUntil },
      event,
      now
    )
  ) {
    return []
  }
  if (!alert.organizationId) {
    return []
  }

  const channels = await writer
    .select()
    .from(notificationChannels)
    .where(
      and(
        eq(notificationChannels.organizationId, alert.organizationId),
        eq(notificationChannels.enabled, true)
      )
    )

  const matching = channels.filter((channel) =>
    channelMatchesAlert(
      {
        minSeverity: channel.minSeverity,
        alertKinds: channel.alertKinds ?? [],
        siteIds: channel.siteIds ?? [],
      },
      {
        kind: alert.kind,
        severity: alert.severity,
        siteId: alert.siteId,
      }
    )
  )

  if (matching.length === 0) {
    return []
  }

  const snapshot = await asAlertSnapshot(writer, alert)
  const rows = matching.map((channel) => ({
    channelId: channel.id,
    organizationId: alert.organizationId as string,
    alertId: alert.id,
    event,
    status: "pending" as const,
    attempts: 0,
    nextAttemptAt: now,
    payload: { alert: snapshot, event },
    createdAt: now,
    updatedAt: now,
  }))

  return writer.insert(notificationDeliveries).values(rows).returning({
    id: notificationDeliveries.id,
  })
}
