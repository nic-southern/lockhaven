import { auditEvents } from "@nms/db"
import type { AuditEventType } from "@nms/shared"

import type { ApiContext } from "./context"

export async function writeAuditEvent(
  ctx: Pick<ApiContext, "db" | "actor">,
  input: {
    eventType: AuditEventType
    organizationId?: string | null
    deviceId?: string | null
    eventData?: Record<string, unknown>
  }
) {
  await ctx.db.insert(auditEvents).values({
    actorUserId: ctx.actor?.id ?? null,
    organizationId: input.organizationId ?? null,
    deviceId: input.deviceId ?? null,
    eventType: input.eventType,
    eventData: input.eventData ?? {},
  })
}
