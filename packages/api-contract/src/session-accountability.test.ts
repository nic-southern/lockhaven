import assert from "node:assert/strict"
import test from "node:test"

import {
  canApproveAccessRequest,
  canLaunchWithAccessRequest,
  resolveSiteAccessSettings,
  validateAccessReason,
} from "@nms/shared"

test("site settings resolve independently per flag", () => {
  assert.deepEqual(
    resolveSiteAccessSettings({
      requireAccessReason: true,
      requireApproval: false,
    }),
    { requireAccessReason: true, requireApproval: false }
  )
  assert.deepEqual(
    resolveSiteAccessSettings({
      requireAccessReason: false,
      requireApproval: true,
    }),
    { requireAccessReason: false, requireApproval: true }
  )
})

test("approval cannot skip pending or denied states", () => {
  const now = new Date("2026-09-16T12:00:00.000Z")
  const later = new Date("2026-09-16T18:00:00.000Z")
  assert.equal(canApproveAccessRequest("pending", later, now), true)
  assert.equal(canApproveAccessRequest("denied", later, now), false)
  assert.equal(
    canLaunchWithAccessRequest({
      status: "denied",
      expiresAt: later,
      now,
      requestedByUserId: "a",
      actorId: "a",
    }),
    false
  )
})

test("required reasons reject blank copy", () => {
  assert.equal(validateAccessReason(true, "  hi").ok, false)
  assert.equal(validateAccessReason(true, "Need console access").ok, true)
})
