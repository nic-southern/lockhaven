import assert from "node:assert/strict"
import test from "node:test"

import {
  endpointHost,
  endpointHostChanged,
  evaluatePeer,
  isFlapping,
  normalizeEndpoint,
  type PeerState,
} from "./transitions"
import type { WgPeerStats } from "./index"

const now = new Date("2026-09-15T12:00:00Z")
const hour = 60 * 60 * 1000

function peer(overrides: Partial<WgPeerStats> = {}): WgPeerStats {
  return {
    publicKey: "pk",
    presharedKey: "(none)",
    endpoint: "203.0.113.10:51820",
    allowedIps: ["10.80.10.11/32"],
    latestHandshakeAt: new Date(now.getTime() - 30_000),
    rxBytes: 1000,
    txBytes: 2000,
    persistentKeepalive: 25,
    ...overrides,
  }
}

function state(overrides: Partial<PeerState> = {}): PeerState {
  return {
    online: true,
    endpoint: "203.0.113.10:51820",
    lastHandshakeAt: new Date(now.getTime() - 60_000).toISOString(),
    rxBytes: 900,
    txBytes: 1900,
    lastSampleAt: new Date(now.getTime() - 10 * 60_000).toISOString(),
    lastOnlineAt: new Date(now.getTime() - 60_000).toISOString(),
    ...overrides,
  }
}

test("first observation sets a baseline without transitions", () => {
  const result = evaluatePeer({
    previous: null,
    peer: peer(),
    now,
    sampleIntervalMs: hour,
  })
  assert.deepEqual(result.transitions, [])
  assert.equal(result.next.online, true)
  assert.equal(result.next.endpoint, "203.0.113.10:51820")
  assert.equal(result.intervalSampleDue, true, "first sample is due")
})

test("detects peer up and down", () => {
  const up = evaluatePeer({
    previous: state({ online: false }),
    peer: peer(),
    now,
    sampleIntervalMs: hour,
  })
  assert.deepEqual(
    up.transitions.map((t) => t.kind),
    ["up"]
  )

  const down = evaluatePeer({
    previous: state({ online: true }),
    peer: peer({ latestHandshakeAt: new Date(now.getTime() - 10 * 60_000) }),
    now,
    sampleIntervalMs: hour,
  })
  assert.deepEqual(
    down.transitions.map((t) => t.kind),
    ["down"]
  )
  assert.equal(down.next.online, false)
  assert.equal(
    down.next.lastOnlineAt,
    state().lastOnlineAt,
    "keeps the last time it was seen online"
  )
})

test("missing peer counts as down and keeps the last endpoint", () => {
  const result = evaluatePeer({
    previous: state(),
    peer: null,
    now,
    sampleIntervalMs: hour,
  })
  assert.deepEqual(
    result.transitions.map((t) => t.kind),
    ["down"]
  )
  assert.equal(result.next.endpoint, "203.0.113.10:51820")
  assert.equal(result.next.rxBytes, 900)
})

test("detects endpoint host changes only while online", () => {
  const changed = evaluatePeer({
    previous: state(),
    peer: peer({ endpoint: "198.51.100.7:40000" }),
    now,
    sampleIntervalMs: hour,
  })
  assert.deepEqual(
    changed.transitions.map((t) => t.kind),
    ["endpoint_changed"]
  )
  assert.equal(changed.transitions[0].previousEndpoint, "203.0.113.10:51820")
  assert.equal(changed.transitions[0].endpoint, "198.51.100.7:40000")

  const stale = evaluatePeer({
    previous: state({ online: false }),
    peer: peer({
      endpoint: "198.51.100.7:40000",
      latestHandshakeAt: new Date(now.getTime() - hour),
    }),
    now,
    sampleIntervalMs: hour,
  })
  assert.deepEqual(stale.transitions, [])
})

test("ignores port-only endpoint changes", () => {
  const result = evaluatePeer({
    previous: state(),
    peer: peer({ endpoint: "203.0.113.10:40000" }),
    now,
    sampleIntervalMs: hour,
  })
  assert.deepEqual(result.transitions, [])
  assert.equal(result.next.endpoint, "203.0.113.10:40000")
  assert.equal(result.next.lastSampleAt, state().lastSampleAt)
  assert.equal(result.intervalSampleDue, false)
})

test("detects IPv6 host changes and ignores IPv6 port-only churn", () => {
  const previous = state({ endpoint: "[2001:db8::1]:51820" })

  const sameHost = evaluatePeer({
    previous,
    peer: peer({ endpoint: "[2001:db8::1]:40000" }),
    now,
    sampleIntervalMs: hour,
  })
  assert.deepEqual(sameHost.transitions, [])
  assert.equal(sameHost.next.endpoint, "[2001:db8::1]:40000")

  const newHost = evaluatePeer({
    previous,
    peer: peer({ endpoint: "[2001:db8::2]:51820" }),
    now,
    sampleIntervalMs: hour,
  })
  assert.deepEqual(
    newHost.transitions.map((t) => t.kind),
    ["endpoint_changed"]
  )
  assert.equal(newHost.transitions[0].endpoint, "[2001:db8::2]:51820")
})

test("interval samples come due once per interval while online", () => {
  const notYet = evaluatePeer({
    previous: state(),
    peer: peer(),
    now,
    sampleIntervalMs: hour,
  })
  assert.equal(notYet.intervalSampleDue, false)
  assert.equal(notYet.next.lastSampleAt, state().lastSampleAt)

  const due = evaluatePeer({
    previous: state({
      lastSampleAt: new Date(now.getTime() - 2 * hour).toISOString(),
    }),
    peer: peer(),
    now,
    sampleIntervalMs: hour,
  })
  assert.equal(due.intervalSampleDue, true)
  assert.equal(due.next.lastSampleAt, now.toISOString())
})

test("endpoint helpers handle wg placeholders and IPv6", () => {
  assert.equal(normalizeEndpoint("(none)"), null)
  assert.equal(normalizeEndpoint(""), null)
  assert.equal(endpointHost("203.0.113.10:51820"), "203.0.113.10")
  assert.equal(endpointHost("[2001:db8::1]:51820"), "2001:db8::1")
  assert.equal(endpointHost(null), null)
  assert.equal(
    endpointHostChanged("203.0.113.10:51820", "203.0.113.10:40000"),
    false
  )
  assert.equal(
    endpointHostChanged("203.0.113.10:51820", "198.51.100.7:51820"),
    true
  )
  assert.equal(
    endpointHostChanged("[2001:db8::1]:51820", "[2001:db8::1]:40000"),
    false
  )
  assert.equal(endpointHostChanged(null, "203.0.113.10:51820"), false)
})

test("flapping requires enough transitions inside the window", () => {
  const times = [1, 2, 3, 4].map((m) => new Date(now.getTime() - m * 60_000))
  assert.equal(isFlapping(times, now, 4, 15 * 60_000), true)
  assert.equal(isFlapping(times.slice(0, 3), now, 4, 15 * 60_000), false)
  const old = times.map((t) => new Date(t.getTime() - 20 * 60_000))
  assert.equal(isFlapping(old, now, 4, 15 * 60_000), false)
})
