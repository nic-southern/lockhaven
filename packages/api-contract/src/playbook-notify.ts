import { and, eq } from "drizzle-orm"

import { notificationChannels, notificationDeliveries } from "@nms/db"
import { channelMatchesSite } from "@nms/notifications"
import type { PlaybookRunNotificationSnapshot } from "@nms/notifications"

import type { ApiContext } from "./context"

type DbWriter = Pick<ApiContext["db"], "select" | "insert">

export async function enqueuePlaybookRequestNotifications(
  writer: DbWriter,
  snapshot: PlaybookRunNotificationSnapshot,
  now = new Date()
) {
  const channels = await writer
    .select()
    .from(notificationChannels)
    .where(
      and(
        eq(notificationChannels.organizationId, snapshot.organizationId),
        eq(notificationChannels.enabled, true)
      )
    )

  const matching = channels.filter((channel) =>
    channelMatchesSite({ siteIds: channel.siteIds ?? [] }, snapshot.siteId)
  )

  if (matching.length === 0) return []

  const rows = matching.map((channel) => ({
    channelId: channel.id,
    organizationId: snapshot.organizationId,
    alertId: snapshot.alertId,
    event: "playbook.requested" as const,
    status: "pending" as const,
    attempts: 0,
    nextAttemptAt: now,
    payload: { event: "playbook.requested", playbookRun: snapshot },
    createdAt: now,
    updatedAt: now,
  }))

  return writer.insert(notificationDeliveries).values(rows).returning({
    id: notificationDeliveries.id,
  })
}
