import assert from "node:assert/strict"
import test from "node:test"

import { hostnamesMatch, normalizeHostname } from "@nms/shared"

test("normalizeHostname lowercases, trims, and drops a trailing dot", () => {
  assert.equal(normalizeHostname("  KIOSK-01. "), "kiosk-01")
  assert.equal(
    normalizeHostname("front-desk.clinic.local"),
    "front-desk.clinic.local"
  )
  assert.equal(normalizeHostname(""), null)
  assert.equal(normalizeHostname("   "), null)
  assert.equal(normalizeHostname(null), null)
  assert.equal(normalizeHostname(undefined), null)
})

test("hostnamesMatch treats case and trailing-dot differences as the same device", () => {
  assert.equal(hostnamesMatch("kiosk-01", "KIOSK-01"), true)
  assert.equal(hostnamesMatch("kiosk-01", "kiosk-01."), true)
  assert.equal(hostnamesMatch("kiosk-01", "kiosk-02"), false)
  assert.equal(hostnamesMatch("kiosk-01", "kiosk-01.clinic.local"), false)
})

test("hostnamesMatch only matches an unknown hostname against another unknown", () => {
  assert.equal(hostnamesMatch(null, null), true)
  assert.equal(hostnamesMatch(null, "kiosk-01"), false)
  assert.equal(hostnamesMatch("kiosk-01", ""), false)
})
