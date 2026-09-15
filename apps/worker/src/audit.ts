import { auditEvents } from "@nms/db"
import { db } from "@nms/db/client"
import {
  severityForEvent,
  type AuditEventType,
  type AuditSeverity,
} from "@nms/shared"

export type WorkerAuditInput = {
  eventType: AuditEventType
  organizationId?: string | null
  siteId?: string | null
  deviceId?: string | null
  actorUserId?: string | null
  severity?: AuditSeverity
  eventData?: Record<string, unknown>
}

/**
 * Worker-originated events have no signed-in actor; `actor_user_id` stays
 * null so the Activity log can render them as system events.
 */
export async function recordEvent(input: WorkerAuditInput) {
  await db.insert(auditEvents).values({
    actorUserId: input.actorUserId ?? null,
    organizationId: input.organizationId ?? null,
    siteId: input.siteId ?? null,
    deviceId: input.deviceId ?? null,
    eventType: input.eventType,
    severity: input.severity ?? severityForEvent(input.eventType),
    eventData: input.eventData ?? {},
  })
}
