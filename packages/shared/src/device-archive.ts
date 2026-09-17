import { DEVICE_ONLINE_WINDOW_MS } from "./domain"
import type { AlertKind } from "./events"
import {
  quietOfflineAlertKinds,
  type QuietOfflineAlertKind,
} from "./site-hours"

/** Offline/down kinds that must stay quiet while a device is archived. */
export const archivedQuietAlertKinds = quietOfflineAlertKinds
export type ArchivedQuietAlertKind = QuietOfflineAlertKind

function toMillis(value: Date | string | number | null | undefined) {
  if (value == null) {
    return null
  }
  const millis =
    value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(millis) ? millis : null
}

export function isDeviceArchived(archivedAt: Date | string | null | undefined) {
  return archivedAt != null && archivedAt !== ""
}

export function shouldSkipQuietAlert(args: {
  archivedAt: Date | string | null | undefined
  kind: AlertKind
}) {
  return (
    isDeviceArchived(args.archivedAt) &&
    (archivedQuietAlertKinds as readonly string[]).includes(args.kind)
  )
}

/**
 * Whether an archived device is currently present. Handshake and agent
 * check-in both count; coming online does not unarchive.
 */
export function archivedDeviceIsPresent(args: {
  archivedAt: Date | string | null | undefined
  lastHandshakeAt?: Date | string | null
  lastSeenAt?: Date | string | null
  vpnOnline?: boolean
  now?: Date | number
  windowMs?: number
}) {
  if (!isDeviceArchived(args.archivedAt)) {
    return false
  }
  if (args.vpnOnline) {
    return true
  }
  const now = toMillis(args.now ?? Date.now()) ?? Date.now()
  const windowMs = args.windowMs ?? DEVICE_ONLINE_WINDOW_MS
  const handshake = toMillis(args.lastHandshakeAt)
  if (handshake !== null && now - handshake < windowMs) {
    return true
  }
  const seen = toMillis(args.lastSeenAt)
  return seen !== null && now - seen < windowMs
}

export function archivedOnlineAlertTitle(displayName: string) {
  const name = displayName.trim() || "Device"
  return `${name} is archived and came online`
}
