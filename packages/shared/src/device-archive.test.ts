import assert from "node:assert/strict"
import test from "node:test"

import { DEVICE_ONLINE_WINDOW_MS } from "./domain"
import {
  archiveScopeShowsArchived,
  archivedDeviceIsPresent,
  archivedDeviceReturnSignal,
  archivedDeviceReturnedAlertTitle,
  archivedOnlineAlertTitle,
  archivedOnlineViaLabel,
  isDeviceArchived,
  resolveDeviceArchiveScope,
  shouldSkipQuietAlert,
} from "./device-archive"

const now = new Date("2026-09-17T12:00:00Z")
const archivedAt = new Date("2026-09-01T00:00:00Z")

test("archive is a durable timestamp, not a live status", () => {
  assert.equal(isDeviceArchived(null), false)
  assert.equal(isDeviceArchived(undefined), false)
  assert.equal(isDeviceArchived(archivedAt), true)
  assert.equal(isDeviceArchived(archivedAt.toISOString()), true)
})

test("inventory list hides archived devices unless asked", () => {
  assert.equal(resolveDeviceArchiveScope(undefined), "active", "no filter")
  assert.equal(resolveDeviceArchiveScope(null), "active")
  assert.equal(resolveDeviceArchiveScope([]), "active", "empty filter")
  assert.equal(
    resolveDeviceArchiveScope(["maybe"]),
    "active",
    "unknown values fall back to the default"
  )
  assert.equal(resolveDeviceArchiveScope(["no"]), "active")
  assert.equal(resolveDeviceArchiveScope("no"), "active", "single value")
})

test("archived devices are included on request", () => {
  assert.equal(resolveDeviceArchiveScope(["all"]), "all")
  assert.equal(resolveDeviceArchiveScope(" ALL "), "all", "case and spacing")
  assert.equal(
    resolveDeviceArchiveScope(["no", "yes"]),
    "all",
    "both options selected behaves like the toggle"
  )
  assert.equal(
    resolveDeviceArchiveScope(["yes", "all"]),
    "all",
    "all wins over a narrower value"
  )
  assert.equal(
    resolveDeviceArchiveScope(["yes"]),
    "archived",
    "archived-only view"
  )
})

test("archive scope reports whether archived rows are visible", () => {
  assert.equal(archiveScopeShowsArchived("active"), false)
  assert.equal(archiveScopeShowsArchived("archived"), true)
  assert.equal(archiveScopeShowsArchived("all"), true)
})

test("archived devices skip offline and flap, not other kinds", () => {
  assert.equal(
    shouldSkipQuietAlert({ archivedAt, kind: "device_offline" }),
    true
  )
  assert.equal(
    shouldSkipQuietAlert({ archivedAt, kind: "peer_flapping" }),
    true
  )
  assert.equal(
    shouldSkipQuietAlert({ archivedAt, kind: "archived_device_online" }),
    false
  )
  assert.equal(
    shouldSkipQuietAlert({ archivedAt, kind: "new_endpoint" }),
    false
  )
  assert.equal(
    shouldSkipQuietAlert({ archivedAt: null, kind: "device_offline" }),
    false
  )
})

test("presence follows handshake or check-in inside the online window", () => {
  assert.equal(
    archivedDeviceIsPresent({ archivedAt: null, vpnOnline: true, now }),
    false,
    "unarchived devices are not archive-present"
  )
  assert.equal(
    archivedDeviceIsPresent({
      archivedAt,
      lastHandshakeAt: new Date(now.getTime() - 30_000),
      now,
    }),
    true,
    "fresh handshake"
  )
  assert.equal(
    archivedDeviceIsPresent({
      archivedAt,
      lastSeenAt: new Date(now.getTime() - 45_000),
      now,
    }),
    true,
    "fresh agent check-in"
  )
  assert.equal(
    archivedDeviceIsPresent({ archivedAt, vpnOnline: true, now }),
    true,
    "live peer"
  )
  assert.equal(
    archivedDeviceIsPresent({
      archivedAt,
      lastHandshakeAt: new Date(now.getTime() - DEVICE_ONLINE_WINDOW_MS),
      lastSeenAt: new Date(now.getTime() - DEVICE_ONLINE_WINDOW_MS),
      now,
    }),
    false,
    "stale handshake and check-in stay quiet"
  )
})

test("archive-online copy stays product language", () => {
  assert.equal(
    archivedOnlineAlertTitle("Clinic spare"),
    "Clinic spare is archived and came online"
  )
  assert.equal(
    archivedOnlineAlertTitle("  "),
    "Device is archived and came online"
  )
  assert.equal(
    archivedDeviceReturnedAlertTitle("Clinic spare"),
    "Clinic spare was archived and is back"
  )
  assert.equal(
    archivedDeviceReturnedAlertTitle("  "),
    "Device was archived and is back"
  )
  assert.equal(archivedOnlineViaLabel("vpn_handshake"), "VPN")
  assert.equal(archivedOnlineViaLabel("agent_check_in"), "Agent")
  const copy = [
    archivedDeviceReturnedAlertTitle("Clinic spare"),
    archivedOnlineViaLabel("vpn_handshake"),
    archivedOnlineViaLabel("agent_check_in"),
  ].join(" ")
  assert.doesNotMatch(copy, /wireguard|handshake|database|json|api/i)
})

test("a live vpn handshake after archive returns the device", () => {
  const archivedAt = new Date("2026-09-17T12:00:00Z")
  const now = new Date("2026-09-17T12:05:00Z")
  assert.equal(
    archivedDeviceReturnSignal({
      archivedAt,
      lastHandshakeAt: new Date("2026-09-17T12:04:00Z"),
      now,
    }),
    "vpn_handshake",
    "peer came up"
  )
  assert.equal(
    archivedDeviceReturnSignal({
      archivedAt: archivedAt.toISOString(),
      lastHandshakeAt: "2026-09-17T12:04:30Z",
      now,
    }),
    "vpn_handshake",
    "string timestamps"
  )
})

test("a handshake from before the archive does not return the device", () => {
  const archivedAt = new Date("2026-09-17T12:00:00Z")
  const now = new Date("2026-09-17T12:02:00Z")
  assert.equal(
    archivedDeviceReturnSignal({
      archivedAt,
      lastHandshakeAt: new Date("2026-09-17T11:59:00Z"),
      now,
    }),
    null,
    "still inside the online window, but it predates the archive"
  )
  assert.equal(
    archivedDeviceReturnSignal({
      archivedAt,
      lastHandshakeAt: archivedAt,
      now,
    }),
    null,
    "the handshake known at archive time is not a new signal"
  )
})

test("a stale handshake after archive is not online", () => {
  const now = new Date("2026-09-17T12:00:00Z")
  const archivedAt = new Date(now.getTime() - DEVICE_ONLINE_WINDOW_MS - 60_000)
  assert.equal(
    archivedDeviceReturnSignal({
      archivedAt,
      lastHandshakeAt: new Date(now.getTime() - DEVICE_ONLINE_WINDOW_MS),
      now,
    }),
    null,
    "exactly at the window edge counts as offline"
  )
  assert.equal(
    archivedDeviceReturnSignal({
      archivedAt,
      lastHandshakeAt: new Date(now.getTime() - DEVICE_ONLINE_WINDOW_MS + 1),
      now,
    }),
    "vpn_handshake",
    "just inside the same window the peer-up signal uses"
  )
})

test("an agent check-in after archive returns the device without a tunnel", () => {
  const archivedAt = new Date("2026-09-17T12:00:00Z")
  const now = new Date("2026-09-17T18:00:00Z")
  assert.equal(
    archivedDeviceReturnSignal({
      archivedAt,
      agentLastCheckInAt: new Date("2026-09-17T12:00:01Z"),
      lastHandshakeAt: new Date("2026-09-01T00:00:00Z"),
      now,
    }),
    "agent_check_in"
  )
})

test("a check-in from before the archive does not return the device", () => {
  const archivedAt = new Date("2026-09-17T12:00:00Z")
  const now = new Date("2026-09-17T12:05:00Z")
  assert.equal(
    archivedDeviceReturnSignal({
      archivedAt,
      agentLastCheckInAt: new Date("2026-09-17T11:00:00Z"),
      now,
    }),
    null
  )
  assert.equal(
    archivedDeviceReturnSignal({
      archivedAt,
      agentLastCheckInAt: archivedAt,
      now,
    }),
    null,
    "a check-in at the archive instant is not later"
  )
})

test("revoked tunnel access is not a vpn signal", () => {
  const archivedAt = new Date("2026-09-17T12:00:00Z")
  const now = new Date("2026-09-17T12:05:00Z")
  const lastHandshakeAt = new Date("2026-09-17T12:04:00Z")
  assert.equal(
    archivedDeviceReturnSignal({
      archivedAt,
      revokedAt: new Date("2026-09-17T11:00:00Z"),
      lastHandshakeAt,
      now,
    }),
    null
  )
  assert.equal(
    archivedDeviceReturnSignal({
      archivedAt,
      revokedAt: new Date("2026-09-17T11:00:00Z"),
      lastHandshakeAt,
      agentLastCheckInAt: now,
      now,
    }),
    "agent_check_in",
    "a later check-in still counts"
  )
})

test("the later online signal is the one that returns the device", () => {
  const archivedAt = new Date("2026-09-17T12:00:00Z")
  const now = new Date("2026-09-17T12:10:00Z")
  assert.equal(
    archivedDeviceReturnSignal({
      archivedAt,
      lastHandshakeAt: new Date("2026-09-17T12:08:00Z"),
      agentLastCheckInAt: new Date("2026-09-17T12:04:00Z"),
      now,
    }),
    "vpn_handshake"
  )
  assert.equal(
    archivedDeviceReturnSignal({
      archivedAt,
      lastHandshakeAt: new Date("2026-09-17T12:04:00Z"),
      agentLastCheckInAt: new Date("2026-09-17T12:08:00Z"),
      now,
    }),
    "agent_check_in"
  )
  const sameTime = new Date("2026-09-17T12:06:00Z")
  assert.equal(
    archivedDeviceReturnSignal({
      archivedAt,
      lastHandshakeAt: sameTime,
      agentLastCheckInAt: sameTime,
      now,
    }),
    "agent_check_in",
    "a tie prefers check-in"
  )
})

test("in-service devices and edits without an online signal stay archived", () => {
  const now = new Date("2026-09-17T12:00:00Z")
  assert.equal(
    archivedDeviceReturnSignal({
      archivedAt: null,
      lastHandshakeAt: now,
      agentLastCheckInAt: now,
      now,
    }),
    null,
    "already in service"
  )
  assert.equal(
    archivedDeviceReturnSignal({
      archivedAt,
      now,
    }),
    null,
    "no handshake or check-in"
  )
  assert.equal(
    archivedDeviceReturnSignal({
      archivedAt,
      lastHandshakeAt: null,
      agentLastCheckInAt: null,
      now,
    }),
    null,
    "clearing unrelated fields is not a signal"
  )
})
