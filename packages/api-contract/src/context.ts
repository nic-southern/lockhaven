import type { ActorPrincipal } from "@nms/auth"
import type { db as dbClient } from "@nms/db/client"

export type RequestInfo = {
  ipAddress: string | null
  userAgent: string | null
}

export type ApiContext = {
  db: typeof dbClient
  actor: ActorPrincipal | null
  requestId: string
  /** Caller network details, recorded on audit events when present. */
  request?: RequestInfo
}

/** Pulls the caller address and agent from proxy-aware headers. */
export function requestInfoFromHeaders(
  headers: Headers | null | undefined
): RequestInfo {
  if (!headers) {
    return { ipAddress: null, userAgent: null }
  }
  const forwarded = headers.get("x-forwarded-for")
  const ipAddress =
    forwarded?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    headers.get("cf-connecting-ip") ||
    null
  return {
    ipAddress: ipAddress && isPlausibleIp(ipAddress) ? ipAddress : null,
    userAgent: headers.get("user-agent")?.slice(0, 512) ?? null,
  }
}

function isPlausibleIp(value: string) {
  return /^[0-9a-fA-F:.]+$/.test(value) && value.length <= 45
}
