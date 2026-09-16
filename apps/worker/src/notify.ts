import { and, eq, inArray, sql } from "drizzle-orm"

import {
  notificationChannels,
  notificationDeliveries,
  type Alert,
  type NotificationChannel,
} from "@nms/db"
import { db } from "@nms/db/client"
import {
  channelMatchesAlert,
  deliverNotification,
  emailChannelConfigSchema,
  hasAttemptsRemaining,
  MAX_NOTIFICATION_ATTEMPTS,
  nextAttemptAt,
  webhookChannelConfigSchema,
  type AlertNotificationSnapshot,
  type NotificationDeliveryEvent,
} from "@nms/notifications"
import { decryptSecret } from "@nms/remote-access"
import { shouldEnqueueAlertNotification } from "@nms/shared"

type DbWriter = Pick<typeof db, "insert" | "select" | "update" | "execute">

function credentialSecret() {
  const secret = process.env.REMOTE_CREDENTIALS_KEY
  if (!secret) {
    throw new Error("REMOTE_CREDENTIALS_KEY is not set")
  }
  return secret
}

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

function snapshotFromPayload(
  payload: Record<string, unknown>
): AlertNotificationSnapshot | null {
  const alert = payload.alert
  if (!alert || typeof alert !== "object") return null
  const row = alert as AlertNotificationSnapshot
  if (!row.id || !row.kind || !row.severity || !row.title) return null
  return row
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

export async function destinationForChannel(channel: NotificationChannel) {
  if (channel.type === "email") {
    const config = emailChannelConfigSchema.parse(channel.config)
    return {
      type: "email" as const,
      addresses: config.addresses,
      channelName: channel.name,
    }
  }
  if (channel.type === "webhook") {
    const config = webhookChannelConfigSchema.parse(channel.config)
    return {
      type: "webhook" as const,
      url: config.url,
      secret: decryptSecret(config.secret, credentialSecret()),
    }
  }
  throw new Error(`Unsupported channel type: ${channel.type}`)
}

export async function sendChannelMessage(
  channel: NotificationChannel,
  event: NotificationDeliveryEvent,
  alert: AlertNotificationSnapshot | null = null
) {
  return deliverNotification({
    destination: await destinationForChannel(channel),
    event,
    alert,
  })
}

const CLAIM_LIMIT = 25

export async function processNotificationDeliveries(now = new Date()) {
  const claimed = await db.transaction(async (tx) => {
    const result = await tx.execute(sql`
      UPDATE notification_deliveries
      SET status = 'sending', updated_at = ${now}
      WHERE id IN (
        SELECT id FROM notification_deliveries
        WHERE status = 'pending'
          AND next_attempt_at <= ${now}
          AND attempts < ${MAX_NOTIFICATION_ATTEMPTS}
        ORDER BY next_attempt_at
        LIMIT ${CLAIM_LIMIT}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `)
    const ids = (result.rows as Array<{ id: string }>).map((row) => row.id)
    if (ids.length === 0) return []
    return tx
      .select({
        delivery: notificationDeliveries,
        channel: notificationChannels,
      })
      .from(notificationDeliveries)
      .innerJoin(
        notificationChannels,
        eq(notificationChannels.id, notificationDeliveries.channelId)
      )
      .where(inArray(notificationDeliveries.id, ids))
  })

  for (const row of claimed) {
    await settleDelivery(
      row.delivery.id,
      row.channel,
      row.delivery.event,
      snapshotFromPayload(row.delivery.payload),
      now
    )
  }

  return claimed.length
}

async function settleDelivery(
  id: string,
  channel: NotificationChannel,
  event: NotificationDeliveryEvent,
  alert: AlertNotificationSnapshot | null,
  now: Date
) {
  try {
    const lastResponse = await sendChannelMessage(channel, event, alert)
    await db
      .update(notificationDeliveries)
      .set({
        status: "sent",
        lastResponse,
        sentAt: now,
        updatedAt: now,
      })
      .where(eq(notificationDeliveries.id, id))
  } catch (error) {
    const [current] = await db
      .select({ attempts: notificationDeliveries.attempts })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.id, id))
    const attempts = (current?.attempts ?? 0) + 1
    const lastResponse =
      error instanceof Error ? error.message.slice(0, 1000) : String(error)
    const done = !hasAttemptsRemaining(attempts)
    await db
      .update(notificationDeliveries)
      .set({
        attempts,
        lastResponse,
        status: done ? "failed" : "pending",
        nextAttemptAt: done ? now : nextAttemptAt(attempts, now),
        updatedAt: now,
      })
      .where(eq(notificationDeliveries.id, id))
  }
}
