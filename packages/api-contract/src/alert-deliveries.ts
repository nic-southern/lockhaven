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
  type AlertTicketContext,
  type NotificationDeliveryEvent,
} from "@nms/notifications"
import { shouldEnqueueAlertNotification } from "@nms/shared"

type DbWriter = Pick<typeof db, "insert" | "select" | "update" | "execute">

type AlertForSnapshot = Pick<
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

async function ticketContextForAlert(
  writer: DbWriter,
  alert: AlertForSnapshot
): Promise<AlertTicketContext> {
  const context: AlertTicketContext = {}
  if (alert.siteId) {
    const [site] = await writer
      .select({ name: sites.name })
      .from(sites)
      .where(eq(sites.id, alert.siteId))
    context.siteName = site?.name ?? null
  }
  let linkedAssetId = alert.assetId
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
      linkedAssetId = linkedAssetId ?? device.assetId
    }
  }
  if (linkedAssetId) {
    const [asset] = await writer
      .select({ id: assets.id, tag: assets.tag })
      .from(assets)
      .where(eq(assets.id, linkedAssetId))
    context.assetId = asset?.id ?? null
    context.assetTag = asset?.tag ?? null
  }
  return context
}

async function asAlertSnapshot(
  writer: DbWriter,
  alert: AlertForSnapshot
): Promise<AlertNotificationSnapshot> {
  const detail = mergeAlertTicketContext(
    alert.detail ?? {},
    await ticketContextForAlert(writer, alert)
  )
  return {
    id: alert.id,
    kind: alert.kind,
    severity: alert.severity,
    title: alert.title,
    status: alert.status,
    organizationId: alert.organizationId,
    siteId: alert.siteId,
    deviceId: alert.deviceId,
    detail,
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
