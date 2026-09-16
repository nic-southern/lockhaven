import { z } from "zod"

export const accessRequestStatuses = [
  "pending",
  "approved",
  "denied",
  "expired",
  "consumed",
] as const

export type AccessRequestStatus = (typeof accessRequestStatuses)[number]
export const accessRequestStatusSchema = z.enum(accessRequestStatuses)

/** Days to keep session recordings on disk. Override with SESSION_RECORDING_RETENTION_DAYS. */
export const SESSION_RECORDING_RETENTION_DAYS_DEFAULT = 30

/** Hours a pending or approved access request stays valid. */
export const ACCESS_REQUEST_TTL_HOURS_DEFAULT = 8

export const SESSION_RECORDING_ROOT_DEFAULT = "/var/lib/guacamole/recordings" // pragma: allowlist secret

export const ACCESS_REASON_MAX_LENGTH = 500
export const ACCESS_REASON_MIN_LENGTH = 3

export type SiteAccessSettings = {
  requireAccessReason: boolean
  requireApproval: boolean
}

export function resolveSiteAccessSettings(
  site:
    | {
        requireAccessReason?: boolean | null
        requireApproval?: boolean | null
      }
    | null
    | undefined
): SiteAccessSettings {
  return {
    requireAccessReason: Boolean(site?.requireAccessReason),
    requireApproval: Boolean(site?.requireApproval),
  }
}

export function accessRequestTtlMs(hours = ACCESS_REQUEST_TTL_HOURS_DEFAULT) {
  const parsed = Number(hours)
  const safe =
    Number.isFinite(parsed) && parsed > 0
      ? parsed
      : ACCESS_REQUEST_TTL_HOURS_DEFAULT
  return safe * 60 * 60 * 1000
}

export function accessRequestExpiresAt(
  now: Date,
  hours = ACCESS_REQUEST_TTL_HOURS_DEFAULT
) {
  return new Date(now.getTime() + accessRequestTtlMs(hours))
}

export function effectiveAccessRequestStatus(
  status: AccessRequestStatus,
  expiresAt: Date,
  now: Date
): AccessRequestStatus {
  if (
    (status === "pending" || status === "approved") &&
    expiresAt.getTime() <= now.getTime()
  ) {
    return "expired"
  }
  return status
}

export function canApproveAccessRequest(
  status: AccessRequestStatus,
  expiresAt: Date,
  now: Date
) {
  return effectiveAccessRequestStatus(status, expiresAt, now) === "pending"
}

export function canDenyAccessRequest(
  status: AccessRequestStatus,
  expiresAt: Date,
  now: Date
) {
  return effectiveAccessRequestStatus(status, expiresAt, now) === "pending"
}

export function canLaunchWithAccessRequest(input: {
  status: AccessRequestStatus
  expiresAt: Date
  now: Date
  requestedByUserId: string
  actorId: string
}) {
  if (input.requestedByUserId !== input.actorId) return false
  return (
    effectiveAccessRequestStatus(input.status, input.expiresAt, input.now) ===
    "approved"
  )
}

export function validateAccessReason(
  requireReason: boolean,
  reason: string | null | undefined
): { ok: true; reason: string | null } | { ok: false; message: string } {
  const trimmed = reason?.trim() ?? ""
  if (!requireReason) {
    if (!trimmed) return { ok: true, reason: null }
    if (trimmed.length > ACCESS_REASON_MAX_LENGTH) {
      return { ok: false, message: "Keep the reason under 500 characters." }
    }
    return { ok: true, reason: trimmed }
  }
  if (trimmed.length < ACCESS_REASON_MIN_LENGTH) {
    return {
      ok: false,
      message: "Tell us why you need access to this device.",
    }
  }
  if (trimmed.length > ACCESS_REASON_MAX_LENGTH) {
    return { ok: false, message: "Keep the reason under 500 characters." }
  }
  return { ok: true, reason: trimmed }
}

export function sessionRecordingRoot(
  value = process.env.SESSION_RECORDING_ROOT
) {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0
    ? trimmed
    : SESSION_RECORDING_ROOT_DEFAULT
}

export function sessionRecordingRetentionDays(
  value = process.env.SESSION_RECORDING_RETENTION_DAYS
) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : SESSION_RECORDING_RETENTION_DAYS_DEFAULT
}

export function buildSessionHistoryPlayerUrl( // pragma: allowlist secret
  baseUrl: string,
  historyIdentifier: string
) {
  return new URL(
    `#/settings/recording/${encodeURIComponent(historyIdentifier)}`,
    baseUrl
  ).toString()
}
