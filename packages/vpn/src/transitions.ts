import { DEVICE_ONLINE_WINDOW_MS } from "@nms/shared"

import type { WgPeerStats } from "./index"

/**
 * The last thing the worker knew about a peer, persisted between reconcile
 * runs so it can tell a fresh handshake from an unchanged one.
 */
export type PeerState = {
  online: boolean
  endpoint: string | null
  lastHandshakeAt: string | null
  rxBytes: number
  txBytes: number
  /** When the last routine (interval) sample was written. */
  lastSampleAt: string | null
  /** When the peer was last seen online; drives offline alerts. */
  lastOnlineAt: string | null
}

export type PeerTransitionKind = "up" | "down" | "endpoint_changed"

export type PeerTransition = {
  kind: PeerTransitionKind
  previousEndpoint: string | null
  endpoint: string | null
  lastHandshakeAt: Date | null
  rxBytes: number
  txBytes: number
}

export function isPeerOnline(
  lastHandshakeAt: Date | null,
  now: Date,
  windowMs = DEVICE_ONLINE_WINDOW_MS
) {
  if (!lastHandshakeAt) return false
  return now.getTime() - lastHandshakeAt.getTime() < windowMs
}

/** `(none)` is what wg reports before a peer has ever connected. */
export function normalizeEndpoint(endpoint: string | null | undefined) {
  if (!endpoint || endpoint === "(none)") return null
  return endpoint
}

export function endpointHost(endpoint: string | null) {
  if (!endpoint) return null
  // IPv6 endpoints look like [addr]:port.
  const bracketed = /^\[(.+)\]:\d+$/.exec(endpoint)
  if (bracketed) return bracketed[1]
  const separator = endpoint.lastIndexOf(":")
  return separator === -1 ? endpoint : endpoint.slice(0, separator)
}

/**
 * True when the public host changed. Port-only diffs are NAT or client
 * source-port noise and must not count as a new endpoint IP.
 */
export function endpointHostChanged(
  current: string | null,
  previous: string | null
) {
  const currentHost = endpointHost(current)
  const previousHost = endpointHost(previous)
  return Boolean(currentHost && previousHost && currentHost !== previousHost)
}

export type PeerEvaluation = {
  next: PeerState
  transitions: PeerTransition[]
  /** True when a routine sample is due (interval elapsed while online). */
  intervalSampleDue: boolean
}

/**
 * Compares the current wg reading against the previous state and reports
 * what changed. The first observation of a peer establishes a baseline and
 * never emits transitions, so restarting the worker doesn't spam events.
 */
export function evaluatePeer(args: {
  previous: PeerState | null
  peer: WgPeerStats | null
  now: Date
  sampleIntervalMs: number
  onlineWindowMs?: number
}): PeerEvaluation {
  const { previous, peer, now } = args
  const lastHandshakeAt = peer?.latestHandshakeAt ?? null
  const online = isPeerOnline(lastHandshakeAt, now, args.onlineWindowMs)
  const endpoint = normalizeEndpoint(peer?.endpoint)
  const rxBytes = peer?.rxBytes ?? previous?.rxBytes ?? 0
  const txBytes = peer?.txBytes ?? previous?.txBytes ?? 0
  const transitions: PeerTransition[] = []

  const base = {
    previousEndpoint: previous?.endpoint ?? null,
    endpoint,
    lastHandshakeAt,
    rxBytes,
    txBytes,
  }

  if (previous) {
    if (online && !previous.online) {
      transitions.push({ kind: "up", ...base })
    } else if (!online && previous.online) {
      transitions.push({ kind: "down", ...base })
    }

    if (online && endpointHostChanged(endpoint, previous.endpoint)) {
      transitions.push({ kind: "endpoint_changed", ...base })
    }
  }

  const lastSample = previous?.lastSampleAt
    ? new Date(previous.lastSampleAt)
    : null
  const intervalSampleDue =
    online &&
    (!lastSample ||
      now.getTime() - lastSample.getTime() >= args.sampleIntervalMs)

  const lastOnlineAt = online
    ? now.toISOString()
    : (previous?.lastOnlineAt ?? lastHandshakeAt?.toISOString() ?? null)

  return {
    next: {
      online,
      endpoint: endpoint ?? previous?.endpoint ?? null,
      lastHandshakeAt: lastHandshakeAt?.toISOString() ?? null,
      rxBytes,
      txBytes,
      lastSampleAt:
        transitions.length > 0 || intervalSampleDue
          ? now.toISOString()
          : (previous?.lastSampleAt ?? null),
      lastOnlineAt,
    },
    transitions,
    intervalSampleDue,
  }
}

/**
 * Counts up/down flips inside the window. Callers keep the timestamps of
 * recent transitions per peer and pass them here.
 */
export function isFlapping(
  transitionTimes: Date[],
  now: Date,
  threshold: number,
  windowMs: number
) {
  const cutoff = now.getTime() - windowMs
  const recent = transitionTimes.filter((time) => time.getTime() >= cutoff)
  return recent.length >= threshold
}
