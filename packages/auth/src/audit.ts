import { auditEvents } from "@nms/db"
import { db } from "@nms/db/client"

export type AuthAuditEventType =
  | "admin_login"
  | "admin_login_failed"
  | "admin_logout"
  | "two_factor_enrolled"
  | "two_factor_reset"
  | "passkey_added"
  | "passkey_removed"
  | "password_changed"
  | "session_revoked"

export type AuthRequestContext = {
  ipAddress?: string | null
  userAgent?: string | null
}

export function requestContextFromHeaders(
  headers: Headers | undefined | null
): AuthRequestContext {
  if (!headers) {
    return {}
  }

  const forwarded = headers.get("x-forwarded-for")
  const ipAddress =
    forwarded?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    headers.get("cf-connecting-ip") ||
    null

  return {
    ipAddress,
    userAgent: headers.get("user-agent"),
  }
}

/**
 * Best-effort audit write for authentication events. Failures are swallowed so
 * that a logging problem never blocks a sign-in or sign-out.
 */
export async function recordAuthEvent(input: {
  eventType: AuthAuditEventType
  actorUserId?: string | null
  eventData?: Record<string, unknown>
  request?: AuthRequestContext
}) {
  try {
    await db.insert(auditEvents).values({
      actorUserId: input.actorUserId ?? null,
      organizationId: null,
      deviceId: null,
      eventType: input.eventType,
      eventData: {
        ...(input.eventData ?? {}),
        ipAddress: input.request?.ipAddress ?? null,
        userAgent: input.request?.userAgent ?? null,
      },
    })
  } catch (error) {
    console.error("auth audit write failed", error)
  }
}
