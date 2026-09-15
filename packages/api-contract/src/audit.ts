import { auditEvents } from "@nms/db"
import {
  severityForEvent,
  type AuditEventType,
  type AuditSeverity,
} from "@nms/shared"

import type { ApiContext } from "./context"

/** Accepts the request database or a transaction handle. */
export type AuditContext = {
  db: Pick<ApiContext["db"], "insert">
  actor: ApiContext["actor"]
  request?: ApiContext["request"]
}

export type AuditEventInput = {
  eventType: AuditEventType
  organizationId?: string | null
  siteId?: string | null
  deviceId?: string | null
  /** Defaults to the shared per-event-type severity. */
  severity?: AuditSeverity
  eventData?: Record<string, unknown>
}

export function auditRow(ctx: AuditContext, input: AuditEventInput) {
  return {
    actorUserId: ctx.actor?.id ?? null,
    organizationId: input.organizationId ?? null,
    siteId: input.siteId ?? null,
    deviceId: input.deviceId ?? null,
    eventType: input.eventType,
    severity: input.severity ?? severityForEvent(input.eventType),
    actorIp: ctx.request?.ipAddress ?? null,
    userAgent: ctx.request?.userAgent ?? null,
    eventData: input.eventData ?? {},
  }
}

export async function writeAuditEvent(
  ctx: AuditContext,
  input: AuditEventInput
) {
  await ctx.db.insert(auditEvents).values(auditRow(ctx, input))
}

export async function writeAuditEvents(
  ctx: AuditContext,
  inputs: AuditEventInput[]
) {
  if (inputs.length === 0) return
  await ctx.db
    .insert(auditEvents)
    .values(inputs.map((input) => auditRow(ctx, input)))
}
