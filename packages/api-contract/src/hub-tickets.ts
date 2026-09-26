import { and, eq, inArray, sql } from "drizzle-orm"

import { tickets } from "@nms/db"
import { db } from "@nms/db/client"
import { openTicketStatuses, type TicketStatus } from "@nms/shared"

type DbWriter = Pick<typeof db, "update" | "select" | "insert" | "execute">

/**
 * Moves Hub tickets linked to an alert to Done when the alert resolves.
 * Idempotent: already-Done rows are left alone.
 */
export async function markHubTicketsDoneForAlert(
  writer: DbWriter,
  alertId: string,
  now = new Date()
): Promise<string[]> {
  const updated = await writer
    .update(tickets)
    .set({
      status: "done",
      resolvedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(tickets.alertId, alertId),
        inArray(tickets.status, [...openTicketStatuses])
      )
    )
    .returning({ id: tickets.id })

  return updated.map((row) => row.id)
}

export async function openTicketStatusesForAlert(
  writer: DbWriter,
  alertId: string
): Promise<TicketStatus[]> {
  const rows = await writer
    .select({ status: tickets.status })
    .from(tickets)
    .where(and(eq(tickets.alertId, alertId), sql`${tickets.status} <> 'done'`))
  return rows.map((row) => row.status)
}
