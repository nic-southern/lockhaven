import assert from "node:assert/strict"
import { test } from "node:test"

import {
  mergeAlertTicketContext,
  type TicketNotificationSnapshot,
} from "./payload"
import { signWebhookPayload } from "./signature"
import {
  deliverTicketOpened,
  parseTicketIngestResponse,
  sessionIngestBody,
  sessionIngestUrlFromWebhook,
} from "./ticket"

const ticket: TicketNotificationSnapshot = {
  title: "Work on shop-pc",
  deviceId: "device-1",
  deviceName: "shop-pc",
  siteId: "site-1",
  siteName: "Shop",
  technicianName: "Alex Rivera",
  technicianEmail: "alex@example.com",
  sessionId: "sess-9",
  accessRequestId: null,
  recordingUrl:
    "https://console.example.com/api/sessions/sess-9/recording/play",
  reason: "Printer jam during close",
  notes: "Need a look before open.",
  serviceType: "vnc",
}

test("maps alert detail names the tickets ingest expects", () => {
  const merged = mergeAlertTicketContext(
    { device: "pos-01", site: "Harbor" },
    { hostname: "pos-01.local", assetTag: "CAB-12" }
  )
  assert.equal(merged.deviceName, "pos-01")
  assert.equal(merged.hostname, "pos-01.local")
  assert.equal(merged.siteName, "Harbor")
  assert.equal(merged.assetTag, "CAB-12")
  assert.equal(merged.device, "pos-01")
})

test("keeps explicit deviceName over the older device key", () => {
  const merged = mergeAlertTicketContext(
    { device: "old", deviceName: "cabinet-4" },
    { deviceName: "cabinet-4" }
  )
  assert.equal(merged.deviceName, "cabinet-4")
})

test("omits empty session fields so ingest validation stays happy", () => {
  const body = sessionIngestBody({
    ...ticket,
    accessRequestId: null,
    serviceType: null,
    notes: null,
  })
  assert.equal("accessRequestId" in body, false)
  assert.equal("serviceType" in body, false)
  assert.equal("notes" in body, false)
  assert.equal(body.deviceName, "shop-pc")
  assert.equal(body.technicianEmail, "alex@example.com")
})

test("rewrites lockhaven ingest URLs to the session helper", () => {
  assert.equal(
    sessionIngestUrlFromWebhook("https://pm.example.com/ingest/lockhaven"),
    "https://pm.example.com/ingest/session"
  )
  assert.equal(
    sessionIngestUrlFromWebhook("https://pm.example.com/ingest/lockhaven/?x=1"),
    "https://pm.example.com/ingest/session"
  )
  assert.equal(
    sessionIngestUrlFromWebhook("https://hooks.example.com/lockhaven"),
    null
  )
})

test("parses a tickets ingest response without inventing a path", () => {
  const parsed = parseTicketIngestResponse(
    JSON.stringify({
      ok: true,
      ignored: false,
      created: true,
      ticket: { id: "item-1", number: 12 },
    }),
    "https://pm.example.com/ingest/session"
  )
  assert.equal(parsed.created, true)
  assert.equal(parsed.ticketId, "item-1")
  assert.equal(parsed.ticketNumber, "T-0012")
  assert.equal(parsed.ticketsUrl, "https://pm.example.com")
})

test("posts a session body to the sibling ingest path", async () => {
  const secret = "channel-secret-value"
  const now = new Date("2026-09-17T12:00:00.000Z")
  const timestamp = String(Math.floor(now.getTime() / 1000))
  let captured: {
    url: string
    body: string
    headers: Record<string, string>
  } | null = null

  const delivered = await deliverTicketOpened({
    url: "https://pm.example.com/ingest/lockhaven",
    secret,
    ticket,
    now,
    fetchImpl: async (url, init) => {
      captured = {
        url,
        body: init.body,
        headers: init.headers,
      }
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            ok: true,
            created: true,
            ticket: { id: "t-1", number: 4 },
          }),
      }
    },
  })

  assert.ok(captured)
  assert.equal(captured.url, "https://pm.example.com/ingest/session")
  assert.deepEqual(JSON.parse(captured.body), sessionIngestBody(ticket))
  assert.equal(captured.headers["Content-Type"], "application/json")
  assert.equal(captured.headers["X-Lockhaven-Timestamp"], timestamp)
  assert.equal(
    captured.headers["X-Lockhaven-Signature"],
    signWebhookPayload(secret, timestamp, captured.body)
  )
  assert.equal(delivered.result.ticketNumber, "T-0004")
  assert.equal(delivered.result.ticketsUrl, "https://pm.example.com")
})

test("posts a versioned envelope to a generic webhook URL", async () => {
  let capturedBody = ""
  await deliverTicketOpened({
    url: "https://hooks.example.com/psa",
    secret: "other-secret",
    ticket,
    now: new Date("2026-09-17T12:00:00.000Z"),
    fetchImpl: async (_url, init) => {
      capturedBody = init.body
      return {
        ok: true,
        status: 202,
        text: async () => "accepted",
      }
    },
  })
  const envelope = JSON.parse(capturedBody) as {
    version: number
    event: string
    ticket: { deviceName: string }
    alert: unknown
  }
  assert.equal(envelope.version, 1)
  assert.equal(envelope.event, "ticket.opened")
  assert.equal(envelope.ticket.deviceName, "shop-pc")
  assert.equal(envelope.alert, null)
})

test("rejects an unsigned or failed ticket post", async () => {
  await assert.rejects(
    () =>
      deliverTicketOpened({
        url: "https://pm.example.com/ingest/lockhaven",
        secret: "secret",
        ticket,
        fetchImpl: async () => ({
          ok: false,
          status: 401,
          text: async () => '{"ok":false,"error":"unauthorized"}',
        }),
      }),
    /HTTP 401/
  )
})
