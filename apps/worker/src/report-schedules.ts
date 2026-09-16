import { eq } from "drizzle-orm"

import {
  notificationChannels,
  organizations,
  reportSchedules,
  sites,
} from "@nms/db"
import { db } from "@nms/db/client"
import { buildReportCsv } from "@nms/api-contract"
import {
  emailChannelConfigSchema,
  isMailConfigured,
  renderScheduledReportEmail,
  sendTransactionalMail,
} from "@nms/notifications"
import {
  isReportScheduleDue,
  previousCadenceRange,
  reportCadenceLabels,
  reportTypeLabels,
} from "@nms/shared"

import { recordEvent } from "./audit"

/**
 * Sends due weekly and monthly report emails with CSV attachments.
 */
export async function sendReportSchedules(now = new Date()) {
  if (!isMailConfigured()) {
    return { sent: 0, skipped: 0 }
  }

  const rows = await db
    .select({
      schedule: reportSchedules,
      organizationName: organizations.name,
      siteName: sites.name,
      channel: notificationChannels,
    })
    .from(reportSchedules)
    .innerJoin(
      organizations,
      eq(organizations.id, reportSchedules.organizationId)
    )
    .leftJoin(sites, eq(sites.id, reportSchedules.siteId))
    .innerJoin(
      notificationChannels,
      eq(notificationChannels.id, reportSchedules.channelId)
    )
    .where(eq(reportSchedules.enabled, true))

  let sent = 0
  let skipped = 0

  for (const row of rows) {
    const due = isReportScheduleDue({
      cadence: row.schedule.cadence,
      enabled: row.schedule.enabled,
      createdAt: row.schedule.createdAt,
      lastSentAt: row.schedule.lastSentAt,
      now,
    })
    if (!due) {
      skipped += 1
      continue
    }
    if (row.channel.type !== "email") {
      skipped += 1
      continue
    }

    const parsed = emailChannelConfigSchema.safeParse(row.channel.config)
    if (!parsed.success || parsed.data.addresses.length === 0) {
      skipped += 1
      continue
    }

    const range = previousCadenceRange(row.schedule.cadence, now)
    const built = await buildReportCsv(db, row.schedule.type, {
      from: range.from,
      to: range.to,
      organizationId: row.schedule.organizationId,
      siteId: row.schedule.siteId ?? undefined,
    })
    const cadenceLabel = reportCadenceLabels[row.schedule.cadence]
    const reportLabel = reportTypeLabels[row.schedule.type]
    const mail = renderScheduledReportEmail({
      reportLabel,
      cadenceLabel,
      rangeLabel: built.rangeLabel,
      organizationName: row.organizationName,
      attachmentName: built.filename,
    })

    const delivered = await sendTransactionalMail({
      to: parsed.data.addresses,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: [
        {
          filename: built.filename,
          content: built.csv,
          contentType: "text/csv;charset=utf-8",
        },
      ],
    })
    if (!delivered) {
      skipped += 1
      continue
    }

    await db
      .update(reportSchedules)
      .set({ lastSentAt: now, updatedAt: now })
      .where(eq(reportSchedules.id, row.schedule.id))
    await recordEvent({
      eventType: "report_schedule_sent",
      organizationId: row.schedule.organizationId,
      siteId: row.schedule.siteId,
      eventData: {
        scheduleId: row.schedule.id,
        type: row.schedule.type,
        cadence: row.schedule.cadence,
        filename: built.filename,
      },
    })
    sent += 1
  }

  return { sent, skipped }
}
