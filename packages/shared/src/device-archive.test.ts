import assert from "node:assert/strict"
import test from "node:test"

import { DEVICE_ONLINE_WINDOW_MS } from "./domain"
import {
  archivedDeviceIsPresent,
  archivedOnlineAlertTitle,
  isDeviceArchived,
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
})
