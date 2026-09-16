import assert from "node:assert/strict"
import test from "node:test"

import {
  accessRequestExpiresAt,
  buildSessionHistoryPlayerUrl, // pragma: allowlist secret
  canApproveAccessRequest,
  canDenyAccessRequest,
  canLaunchWithAccessRequest,
  effectiveAccessRequestStatus,
  resolveSiteAccessSettings,
  validateAccessReason,
} from "./session-accountability"

test("sites without settings do not require a reason or approval", () => {
  assert.deepEqual(resolveSiteAccessSettings(null), {
    requireAccessReason: false,
    requireApproval: false,
  })
  assert.deepEqual(resolveSiteAccessSettings(undefined), {
    requireAccessReason: false,
    requireApproval: false,
  })
  assert.deepEqual(
    resolveSiteAccessSettings({
      requireAccessReason: false,
      requireApproval: false,
    }),
    { requireAccessReason: false, requireApproval: false }
  )
})

test("resolves reason and approval flags from the site", () => {
  assert.deepEqual(
    resolveSiteAccessSettings({
      requireAccessReason: true,
      requireApproval: true,
    }),
    { requireAccessReason: true, requireApproval: true }
  )
  assert.deepEqual(
    resolveSiteAccessSettings({
      requireAccessReason: true,
      requireApproval: false,
    }),
    { requireAccessReason: true, requireApproval: false }
  )
})

test("requires a reason only when the site asks for one", () => {
  assert.deepEqual(validateAccessReason(false, "  "), {
    ok: true,
    reason: null,
  })
  assert.deepEqual(validateAccessReason(false, "Check the printer"), {
    ok: true,
    reason: "Check the printer",
  })
  assert.equal(validateAccessReason(true, "").ok, false)
  assert.equal(validateAccessReason(true, "no").ok, false)
  assert.deepEqual(validateAccessReason(true, "Replace a failed disk"), {
    ok: true,
    reason: "Replace a failed disk",
  })
})

test("approval state machine: pending can be approved or denied until expiry", () => {
  const now = new Date("2026-09-16T12:00:00.000Z")
  const later = new Date("2026-09-16T20:00:00.000Z")
  const expired = new Date("2026-09-16T11:00:00.000Z")

  assert.equal(canApproveAccessRequest("pending", later, now), true)
  assert.equal(canDenyAccessRequest("pending", later, now), true)
  assert.equal(canApproveAccessRequest("pending", expired, now), false)
  assert.equal(canApproveAccessRequest("denied", later, now), false)
  assert.equal(canApproveAccessRequest("approved", later, now), false)
  assert.equal(canApproveAccessRequest("consumed", later, now), false)
})

test("expired pending and approved requests become expired", () => {
  const now = new Date("2026-09-16T12:00:00.000Z")
  const past = new Date("2026-09-16T11:59:00.000Z")
  const future = new Date("2026-09-16T13:00:00.000Z")

  assert.equal(effectiveAccessRequestStatus("pending", past, now), "expired")
  assert.equal(effectiveAccessRequestStatus("approved", past, now), "expired")
  assert.equal(effectiveAccessRequestStatus("denied", past, now), "denied")
  assert.equal(effectiveAccessRequestStatus("pending", future, now), "pending")
})

test("launch is allowed only for the requester with a live approval", () => {
  const now = new Date("2026-09-16T12:00:00.000Z")
  const later = accessRequestExpiresAt(now, 8)

  assert.equal(
    canLaunchWithAccessRequest({
      status: "approved",
      expiresAt: later,
      now,
      requestedByUserId: "tech-1",
      actorId: "tech-1",
    }),
    true
  )
  assert.equal(
    canLaunchWithAccessRequest({
      status: "approved",
      expiresAt: later,
      now,
      requestedByUserId: "tech-1",
      actorId: "tech-2",
    }),
    false
  )
  assert.equal(
    canLaunchWithAccessRequest({
      status: "pending",
      expiresAt: later,
      now,
      requestedByUserId: "tech-1",
      actorId: "tech-1",
    }),
    false
  )
  assert.equal(
    canLaunchWithAccessRequest({
      status: "denied",
      expiresAt: later,
      now,
      requestedByUserId: "tech-1",
      actorId: "tech-1",
    }),
    false
  )
  assert.equal(
    canLaunchWithAccessRequest({
      status: "approved",
      expiresAt: new Date("2026-09-16T11:00:00.000Z"),
      now,
      requestedByUserId: "tech-1",
      actorId: "tech-1",
    }),
    false
  )
})

test("builds the session history player url", () => {
  assert.equal(
    buildSessionHistoryPlayerUrl("https://guac.example.com/session/", "42"), // pragma: allowlist secret
    "https://guac.example.com/session/#/settings/recording/42" // pragma: allowlist secret
  )
})
