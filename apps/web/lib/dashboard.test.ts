import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { connectivityTone, formatRelativeTime } from "./dashboard"

describe("formatRelativeTime", () => {
  it("returns Never for empty values", () => {
    assert.equal(formatRelativeTime(null), "Never")
    assert.equal(formatRelativeTime(undefined), "Never")
  })

  it("formats recent timestamps relatively", () => {
    const recent = new Date(Date.now() - 45_000)
    assert.match(formatRelativeTime(recent), /second|minute|ago|now/i)
  })
})

describe("connectivityTone", () => {
  it("prioritizes revoked, then handshake, then last seen", () => {
    assert.equal(
      connectivityTone({
        revokedAt: new Date(),
        lastHandshakeAt: new Date(),
        lastSeenAt: new Date(),
      }),
      "danger"
    )
    assert.equal(
      connectivityTone({
        lastHandshakeAt: new Date(),
        lastSeenAt: new Date(),
      }),
      "online"
    )
    assert.equal(connectivityTone({ lastSeenAt: new Date() }), "warning")
    assert.equal(connectivityTone({}), "offline")
  })
})
