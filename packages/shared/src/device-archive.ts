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

/** Values accepted by the `archived` list filter. */
export const deviceArchiveFilterValues = ["no", "yes", "all"] as const
export type DeviceArchiveFilterValue =
  (typeof deviceArchiveFilterValues)[number]

/** What the `archived` list filter resolves to for the query. */
export type DeviceArchiveScope = "active" | "archived" | "all"

/**
 * Archived devices stay out of the inventory list unless asked for. An
 * absent or unrecognized filter therefore means in-service devices only;
 * `all` (or both `yes` and `no`) opens the list up; `yes` alone narrows to
 * archived devices.
 */
export function resolveDeviceArchiveScope(
  values: readonly string[] | string | null | undefined
): DeviceArchiveScope {
  const list = (Array.isArray(values) ? values : values ? [values] : []).map(
    (value) => value.trim().toLowerCase()
  )
  if (list.includes("all")) {
    return "all"
  }
  const wantsArchived = list.includes("yes")
  const wantsActive = list.includes("no")
  if (wantsArchived && wantsActive) {
    return "all"
  }
  if (wantsArchived) {
    return "archived"
  }
  return "active"
}

/** Whether a resolved archive scope includes archived devices. */
export function archiveScopeShowsArchived(scope: DeviceArchiveScope) {
  return scope !== "active"
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
 * check-in both count. Presence alone does not return it to service; a
 * signal has to arrive after the archive. See `archivedDeviceReturnSignal`.
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

/** Live signals that mean an archived device is back. */
export const archivedOnlineSources = [
  "vpn_handshake",
  "agent_check_in",
] as const
export type ArchivedOnlineSource = (typeof archivedOnlineSources)[number]

/**
 * Which live signal should return an archived device to service.
 *
 * A VPN handshake counts when it is the same online window the product
 * already uses for a peer coming up, and that handshake is newer than the
 * archive. An agent check-in counts when the check-in itself is newer than
 * the archive. A revoked tunnel is not a VPN signal. A handshake or
 * check-in from before the archive, or any edit that is neither signal,
 * leaves the device archived.
 *
 * When both signals qualify, the later one is reported. A tie prefers the
 * check-in, because a check-in can refresh the tunnel time in the same moment.
 */
export function archivedDeviceReturnSignal(args: {
  archivedAt: Date | string | null | undefined
  lastHandshakeAt?: Date | string | null
  agentLastCheckInAt?: Date | string | null
  revokedAt?: Date | string | null
  now?: Date | number
  windowMs?: number
}): ArchivedOnlineSource | null {
  if (!isDeviceArchived(args.archivedAt)) {
    return null
  }

  const now = toMillis(args.now ?? Date.now()) ?? Date.now()
  const windowMs = args.windowMs ?? DEVICE_ONLINE_WINDOW_MS
  const handshakeAt = toMillis(args.lastHandshakeAt)
  const checkInAt = toMillis(args.agentLastCheckInAt)
  const archivedMs = toMillis(args.archivedAt)
  const revoked = args.revokedAt != null && args.revokedAt !== ""
  const vpn =
    !revoked &&
    archivedMs !== null &&
    handshakeAt !== null &&
    handshakeAt > archivedMs &&
    now - handshakeAt < windowMs
  const agent =
    archivedMs !== null && checkInAt !== null && checkInAt > archivedMs

  if (vpn && agent && handshakeAt !== null && checkInAt !== null) {
    return handshakeAt > checkInAt ? "vpn_handshake" : "agent_check_in"
  }
  if (vpn) {
    return "vpn_handshake"
  }
  if (agent) {
    return "agent_check_in"
  }
  return null
}

export function archivedDeviceReturnedAlertTitle(displayName: string) {
  const name = displayName.trim() || "Device"
  return `${name} was archived and is back`
}

/** Operator-facing name for the signal that brought a device back. */
export function archivedOnlineViaLabel(source: ArchivedOnlineSource) {
  return source === "vpn_handshake" ? "VPN" : "Agent"
}
