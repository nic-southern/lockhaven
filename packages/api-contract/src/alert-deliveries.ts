import { and, eq } from "drizzle-orm"

import {
  notificationChannels,
  notificationDeliveries,
  type Alert,
} from "@nms/db"
import { db } from "@nms/db/client"
import {
  channelMatchesAlert,
  type AlertNotificationSnapshot,
  type NotificationDeliveryEvent,
} from "@nms/notifications"
import { shouldEnqueueAlertNotification } from "@nms/shared"

type DbWriter = Pick<typeof db, "insert" | "select" | "update" | "execute">

function asAlertSnapshot(
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
    | "detail"
  >
): AlertNotificationSnapshot {
  return {
    id: alert.id,
    kind: alert.kind,
    severity: alert.severity,
    title: alert.title,
    status: alert.status,
    organizationId: alert.organizationId,
    siteId: alert.siteId,
    deviceId: alert.deviceId,
    detail: alert.detail ?? {},
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

  const snapshot = asAlertSnapshot(alert)
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
