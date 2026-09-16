import assert from "node:assert/strict"
import test from "node:test"

import {
  backoffDelayMs,
  hasAttemptsRemaining,
  MAX_NOTIFICATION_ATTEMPTS,
  nextAttemptAt,
} from "./backoff"

test("doubles the 15 second base delay after each failure", () => {
  assert.equal(backoffDelayMs(1), 15_000)
  assert.equal(backoffDelayMs(2), 30_000)
  assert.equal(backoffDelayMs(3), 60_000)
  assert.equal(backoffDelayMs(4), 120_000)
  assert.equal(backoffDelayMs(8), 1_920_000)
})

test("schedules the next attempt from now plus the backoff", () => {
  const now = new Date("2026-04-01T00:00:00.000Z")
  assert.equal(nextAttemptAt(2, now).toISOString(), "2026-04-01T00:00:30.000Z")
})

test("allows eight attempts and then stops", () => {
  assert.equal(MAX_NOTIFICATION_ATTEMPTS, 8)
  assert.equal(hasAttemptsRemaining(7), true)
  assert.equal(hasAttemptsRemaining(8), false)
})
