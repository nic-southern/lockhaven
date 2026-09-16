import assert from "node:assert/strict"
import test from "node:test"

import {
  signWebhookPayload,
  verifyWebhookSignature,
  webhookHeaders,
} from "./signature"

const secret = "channel-secret-value"
const body = '{"version":1,"event":"alert.opened"}'

test("signs payloads as sha256 hex with timestamp", () => {
  const signature = signWebhookPayload(secret, "1710000000", body)
  assert.match(signature, /^sha256=[0-9a-f]{64}$/)
})

test("verifies a matching signature within the timestamp window", () => {
  const now = new Date("2026-04-01T12:00:00.000Z")
  const { timestamp, signature } = webhookHeaders(secret, body, now)
  assert.equal(
    verifyWebhookSignature({
      secret,
      timestamp,
      body,
      signature,
      now,
    }),
    true
  )
})

test("rejects a tampered body, wrong secret, or stale timestamp", () => {
  const now = new Date("2026-04-01T12:00:00.000Z")
  const { timestamp, signature } = webhookHeaders(secret, body, now)

  assert.equal(
    verifyWebhookSignature({
      secret,
      timestamp,
      body: '{"version":1,"event":"alert.resolved"}',
      signature,
      now,
    }),
    false
  )
  assert.equal(
    verifyWebhookSignature({
      secret: "other-secret",
      timestamp,
      body,
      signature,
      now,
    }),
    false
  )
  assert.equal(
    verifyWebhookSignature({
      secret,
      timestamp,
      body,
      signature,
      now: new Date(now.getTime() + 10 * 60 * 1000),
    }),
    false
  )
})
