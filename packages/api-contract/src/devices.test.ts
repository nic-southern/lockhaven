import assert from "node:assert/strict"
import test from "node:test"

import {
  DEVICE_ONLINE_WINDOW_MS,
  deriveConnectivity,
  deviceBulkActionSchema,
  deviceTagsSchema,
  parseTagInput,
} from "@nms/shared"

const now = new Date("2026-09-15T12:00:00Z")

test("connectivity follows the handshake window", () => {
  assert.equal(
    deriveConnectivity({ lastHandshakeAt: null, now }),
    "never",
    "no handshake yet"
  )
  assert.equal(
    deriveConnectivity({
      lastHandshakeAt: new Date(now.getTime() - 30_000),
      now,
    }),
    "online"
  )
  assert.equal(
    deriveConnectivity({
      lastHandshakeAt: new Date(now.getTime() - DEVICE_ONLINE_WINDOW_MS),
      now,
    }),
    "offline",
    "exactly at the window edge counts as offline"
  )
  assert.equal(
    deriveConnectivity({
      lastHandshakeAt: new Date(now.getTime() - 1_000),
      revokedAt: new Date(now.getTime() - 500),
      now,
    }),
    "revoked",
    "revocation wins over a fresh handshake"
  )
  assert.equal(
    deriveConnectivity({ lastHandshakeAt: "not a date", now }),
    "never",
    "unparseable timestamps are treated as never connected"
  )
})

test("tag input is split, lowercased, and de-duplicated", () => {
  assert.deepEqual(parseTagInput("Clinic, pilot  PILOT\nlab-01"), [
    "clinic",
    "pilot",
    "lab-01",
  ])
  assert.deepEqual(parseTagInput("   "), [])
})

test("tag schema enforces the allowed alphabet and sorts", () => {
  assert.deepEqual(deviceTagsSchema.parse(["Pilot", "clinic", "pilot"]), [
    "clinic",
    "pilot",
  ])
  assert.throws(() => deviceTagsSchema.parse(["has space"]))
  assert.throws(() => deviceTagsSchema.parse(["-leading-dash"]))
  assert.throws(() => deviceTagsSchema.parse(["x".repeat(33)]))
  assert.throws(() =>
    deviceTagsSchema.parse(Array.from({ length: 21 }, (_, i) => `t${i}`))
  )
})

test("bulk action schema rejects empty selections and unknown actions", () => {
  const id = "3fa85f64-5717-4562-b3fc-2c963f66afa6"
  assert.equal(
    deviceBulkActionSchema.parse({
      action: "assign_site",
      ids: [id],
      siteId: null,
    }).action,
    "assign_site"
  )
  assert.throws(() =>
    deviceBulkActionSchema.parse({
      action: "assign_site",
      ids: [],
      siteId: null,
    })
  )
  assert.throws(() =>
    deviceBulkActionSchema.parse({ action: "add_tags", ids: [id], tags: [] })
  )
  assert.equal(
    deviceBulkActionSchema.parse({ action: "archive", ids: [id] }).action,
    "archive"
  )
  assert.equal(
    deviceBulkActionSchema.parse({ action: "unarchive", ids: [id] }).action,
    "unarchive"
  )
  assert.throws(() =>
    deviceBulkActionSchema.parse({ action: "explode", ids: [id] })
  )
})
