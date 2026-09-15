import { DEVICE_ONLINE_WINDOW_MS, type DeviceConnectivity } from "./domain"

export type ConnectivityInput = {
  lastHandshakeAt: Date | string | null | undefined
  revokedAt?: Date | string | null | undefined
  now?: Date | number
}

function toMillis(value: Date | string | number | null | undefined) {
  if (value == null) {
    return null
  }
  const millis =
    value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(millis) ? millis : null
}

/**
 * Single source of truth for whether a device counts as online. Used by the
 * devices list, dashboard metrics, and per-device headers so they never
 * disagree about the same peer.
 */
export function deriveConnectivity(
  input: ConnectivityInput
): DeviceConnectivity {
  if (input.revokedAt) {
    return "revoked"
  }

  const handshake = toMillis(input.lastHandshakeAt)
  if (handshake === null) {
    return "never"
  }

  const now = toMillis(input.now ?? Date.now()) ?? Date.now()
  return now - handshake < DEVICE_ONLINE_WINDOW_MS ? "online" : "offline"
}

/** Normalizes free-form tag input (comma or whitespace separated). */
export function parseTagInput(value: string) {
  return [
    ...new Set(
      value
        .split(/[\s,]+/)
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)
    ),
  ]
}
