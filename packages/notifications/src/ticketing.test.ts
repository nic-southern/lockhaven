import assert from "node:assert/strict"
import test from "node:test"

import {
  isTicketingIngestUrl,
  looksLikeLockhavenIngestUrl,
  mergeAlertTicketContext,
  pickTicketingWebhookUrl,
  postSignedJson,
  ticketingAssetUrl,
  ticketingIngestAcceptsEvent,
  ticketingIngestSecret,
  ticketingIngestUrl,
  ticketingLockhavenUrl,
  ticketingSessionUrl,
} from "./ticketing"
import { verifyWebhookSignature } from "./signature"

test("derives lockhaven, session, and asset ingest paths", () => {
  const url = "https://pm.example.com/ingest/lockhaven/"
  assert.equal(
    ticketingLockhavenUrl(url),
    "https://pm.example.com/ingest/lockhaven"
  )
  assert.equal(
    ticketingSessionUrl(url),
    "https://pm.example.com/ingest/session"
  )
  assert.equal(ticketingAssetUrl(url), "https://pm.example.com/ingest/asset")
})

test("matches tickets ingest URLs by path or configured host", () => {
  assert.equal(
    looksLikeLockhavenIngestUrl("https://pm.example.com/ingest/lockhaven"),
    true
  )
  assert.equal(
    isTicketingIngestUrl(
      "https://pm.example.com/ingest/lockhaven",
      "https://pm.example.com/ingest"
    ),
    true
  )
  assert.equal(
    isTicketingIngestUrl(
      "https://hooks.example.com/alerts",
      "https://pm.example.com/ingest/lockhaven"
    ),
    false
  )
})

test("reads ingest URL and secret from env without placeholders", () => {
  assert.equal(ticketingIngestUrl({}), null)
  assert.equal(
    ticketingIngestUrl({
      TICKETING_INGEST_URL: " https://pm.example.com/ingest/lockhaven ",
    }),
    "https://pm.example.com/ingest/lockhaven"
  )
  assert.equal(
    ticketingIngestSecret({ TICKETING_INGEST_SECRET: "replace_me" }),
    null
  )
  assert.equal(
    ticketingIngestSecret({ TICKETING_INGEST_SECRET: "short" }),
    null
  )
  assert.equal(
    ticketingIngestSecret({ TICKETING_INGEST_SECRET: "host-secret-value" }),
    "host-secret-value"
  )
})

test("prefers the configured tickets URL among webhook destinations", () => {
  assert.equal(
    pickTicketingWebhookUrl(
      [
        "https://hooks.example.com/alerts",
        "https://pm.example.com/ingest/lockhaven",
      ],
      "https://pm.example.com/ingest/lockhaven"
    ),
    "https://pm.example.com/ingest/lockhaven"
  )
  assert.equal(
    pickTicketingWebhookUrl(
      ["https://hooks.example.com/alerts"],
      "https://pm.example.com/ingest/lockhaven"
    ),
    null
  )
  assert.equal(
    pickTicketingWebhookUrl(
      ["https://other.example.com/ingest/lockhaven"],
      null
    ),
    "https://other.example.com/ingest/lockhaven"
  )
})

test("tickets ingest accepts alert and session events, not playbook review", () => {
  assert.equal(ticketingIngestAcceptsEvent("alert.opened"), true)
  assert.equal(ticketingIngestAcceptsEvent("alert.resolved"), true)
  assert.equal(ticketingIngestAcceptsEvent("access.requested"), true)
  assert.equal(ticketingIngestAcceptsEvent("channel.test"), true)
  assert.equal(ticketingIngestAcceptsEvent("playbook.requested"), false)
})

test("merges site, device, and asset names onto alert detail", () => {
  const merged = mergeAlertTicketContext(
    { device: "pos-01", message: "quiet" },
    {
      siteName: "Harbor",
      deviceName: "Front cabinet",
      hostname: "pos-01",
      assetId: "asset-1",
      assetTag: "CAB-014",
    }
  )
  assert.equal(merged.siteName, "Harbor")
  assert.equal(merged.deviceName, "pos-01")
  assert.equal(merged.hostname, "pos-01")
  assert.equal(merged.assetTag, "CAB-014")
  assert.equal(merged.message, "quiet")
})

test("does not overwrite names already on the alert", () => {
  const merged = mergeAlertTicketContext(
    { siteName: "Shop", deviceName: "office-01", assetTag: "SW-1" },
    {
      siteName: "Other",
      deviceName: "ignored",
      assetTag: "NOPE",
    }
  )
  assert.equal(merged.siteName, "Shop")
  assert.equal(merged.deviceName, "office-01")
  assert.equal(merged.assetTag, "SW-1")
})

test("posts a signed JSON body the ingest HMAC can verify", async () => {
  const secret = "channel-secret-value"
  const now = new Date("2026-09-17T12:00:00.000Z")
  const payload = {
    technicianName: "Jordan Lee",
    technicianEmail: "jordan@example.com",
    deviceName: "office-01",
  }
  const original = globalThis.fetch
  let captured: { url: string; headers: Headers; body: string } | null = null
  globalThis.fetch = (async (url, init) => {
    captured = {
      url: String(url),
      headers: new Headers(init?.headers),
      body: String(init?.body),
    }
    return new Response(JSON.stringify({ ok: true, created: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }) as typeof fetch

  try {
    const result = await postSignedJson({
      url: "https://pm.example.com/ingest/session",
      secret,
      payload,
      now,
    })
    assert.equal(result.created, true)
    assert.ok(captured)
    assert.equal(captured.url, "https://pm.example.com/ingest/session")
    const timestamp = captured.headers.get("X-Lockhaven-Timestamp")
    const signature = captured.headers.get("X-Lockhaven-Signature")
    assert.ok(timestamp)
    assert.ok(signature)
    assert.equal(
      verifyWebhookSignature({
        secret,
        timestamp,
        body: captured.body,
        signature,
        now,
      }),
      true
    )
    assert.deepEqual(JSON.parse(captured.body), payload)
  } finally {
    globalThis.fetch = original
  }
})

test("failed ingest responses throw without swallowing the status", async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response("unauthorized", { status: 401 })) as typeof fetch
  try {
    await assert.rejects(
      () =>
        postSignedJson({
          url: "https://pm.example.com/ingest/session",
          secret: "channel-secret-value",
          payload: { technicianName: "A", technicianEmail: "a@example.com" },
        }),
      /HTTP 401/
    )
  } finally {
    globalThis.fetch = original
  }
})
