import { eq, inArray, sql } from "drizzle-orm"

import {
  notificationChannels,
  notificationDeliveries,
  type NotificationChannel,
} from "@nms/db"
import { db } from "@nms/db/client"
import { enqueueAlertNotifications } from "@nms/api-contract"
import {
  deliverNotification,
  emailChannelConfigSchema,
  hasAttemptsRemaining,
  MAX_NOTIFICATION_ATTEMPTS,
  nextAttemptAt,
  webhookChannelConfigSchema,
  type AlertNotificationSnapshot,
  type AccessRequestNotificationSnapshot,
  type PlaybookRunNotificationSnapshot,
  type TicketNotificationSnapshot,
  type NotificationDeliveryEvent,
} from "@nms/notifications"
import { decryptSecret } from "@nms/remote-access"

function credentialSecret() {
  const secret = process.env.REMOTE_CREDENTIALS_KEY
  if (!secret) {
    throw new Error("REMOTE_CREDENTIALS_KEY is not set")
  }
  return secret
}

function snapshotFromPayload(payload: Record<string, unknown>): {
  alert: AlertNotificationSnapshot | null
  accessRequest: AccessRequestNotificationSnapshot | null
  playbookRun: PlaybookRunNotificationSnapshot | null
  ticket: TicketNotificationSnapshot | null
} {
  const alert = payload.alert
  let alertSnapshot: AlertNotificationSnapshot | null = null
  if (alert && typeof alert === "object") {
    const row = alert as AlertNotificationSnapshot
    if (row.id && row.kind && row.severity && row.title) {
      alertSnapshot = row
    }
  }
  const accessRequest = payload.accessRequest
  let accessSnapshot: AccessRequestNotificationSnapshot | null = null
  if (accessRequest && typeof accessRequest === "object") {
    const row = accessRequest as AccessRequestNotificationSnapshot
    if (row.id && row.deviceName && row.requesterEmail) {
      accessSnapshot = row
    }
  }
  const playbookRun = payload.playbookRun
  let playbookSnapshot: PlaybookRunNotificationSnapshot | null = null
  if (playbookRun && typeof playbookRun === "object") {
    const row = playbookRun as PlaybookRunNotificationSnapshot
    if (row.id && row.playbookName && row.action && row.deviceName) {
      playbookSnapshot = row
    }
  }
  const ticket = payload.ticket
  let ticketSnapshot: TicketNotificationSnapshot | null = null
  if (ticket && typeof ticket === "object") {
    const row = ticket as TicketNotificationSnapshot
    if (row.title && row.technicianName && row.technicianEmail) {
      ticketSnapshot = row
    }
  }
  return {
    alert: alertSnapshot,
    accessRequest: accessSnapshot,
    playbookRun: playbookSnapshot,
    ticket: ticketSnapshot,
  }
}

export { enqueueAlertNotifications }

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
  alert: AlertNotificationSnapshot | null = null,
  accessRequest: AccessRequestNotificationSnapshot | null = null,
  playbookRun: PlaybookRunNotificationSnapshot | null = null,
  ticket: TicketNotificationSnapshot | null = null
) {
  return deliverNotification({
    destination: await destinationForChannel(channel),
    event,
    alert,
    accessRequest,
    playbookRun,
    ticket,
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
    const snapshots = snapshotFromPayload(row.delivery.payload)
    await settleDelivery(
      row.delivery.id,
      row.channel,
      row.delivery.event,
      snapshots.alert,
      snapshots.accessRequest,
      snapshots.playbookRun,
      snapshots.ticket,
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
  accessRequest: AccessRequestNotificationSnapshot | null,
  playbookRun: PlaybookRunNotificationSnapshot | null,
  ticket: TicketNotificationSnapshot | null,
  now: Date
) {
  try {
    const lastResponse = await sendChannelMessage(
      channel,
      event,
      alert,
      accessRequest,
      playbookRun,
      ticket
    )
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
