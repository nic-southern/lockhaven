import assert from "node:assert/strict"
import { test } from "node:test"

import { TRPCError } from "@trpc/server"

import { restV1OpenApi } from "./rest-v1-openapi"
import {
  dispatchRestV1,
  restErrorFromUnknown,
  type RestV1Caller,
} from "./rest-v1"

const deviceId = "11111111-1111-4111-8111-111111111111"
const alertId = "22222222-2222-4111-8111-111111111111"

function caller(calls: string[]): RestV1Caller {
  return {
    devices: {
      async page() {
        calls.push("devices.page")
        return { items: [{ id: deviceId }], nextCursor: null, total: 1 }
      },
      async byId(input) {
        calls.push(`devices.byId:${input.id}`)
        return { id: input.id, displayName: "Edge" }
      },
    },
    sites: {
      async list() {
        calls.push("sites.list")
        return [
          {
            id: "site-1",
            organizationId: "org-1",
            name: "Main",
            timezone: "UTC",
            notes: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            sshUsername: "root",
            sshPublicKey: "ssh-ed25519 AAAAC3",
          },
        ]
      },
    },
    enrollmentTokens: {
      async list() {
        calls.push("enrollmentTokens.list")
        return [{ id: "token-1", tokenHash: "should-not-leak" }]
      },
      async create(input) {
        calls.push("enrollmentTokens.create")
        assert.ok(input)
        return {
          token: "enroll-secret-once",
          enrollmentToken: { id: "token-2", tokenHash: "hashed" },
        }
      },
    },
    alerts: {
      async page() {
        calls.push("alerts.page")
        return { items: [], nextCursor: null, total: 0 }
      },
      async acknowledge(input) {
        calls.push(`alerts.acknowledge:${input.id}`)
        return { id: input.id, status: "acknowledged" }
      },
      async resolve(input) {
        calls.push(`alerts.resolve:${input.id}`)
        return { id: input.id, status: "resolved" }
      },
    },
    sessions: {
      async page() {
        calls.push("sessions.page")
        return { items: [], nextCursor: null, total: 0 }
      },
    },
    audit: {
      async page() {
        calls.push("audit.page")
        return { items: [], nextCursor: null, total: 0 }
      },
    },
  }
}

async function roundTrip(
  method: string,
  path: string[],
  restCaller: RestV1Caller,
  body?: unknown
) {
  return dispatchRestV1({
    method,
    path,
    searchParams: new URLSearchParams(),
    body,
    caller: restCaller,
  })
}

test("one REST round-trip per resource", async () => {
  const calls: string[] = []
  const restCaller = caller(calls)

  const devices = await roundTrip("GET", ["devices"], restCaller)
  assert.equal(devices.status, 200)

  const device = await roundTrip("GET", ["devices", deviceId], restCaller)
  assert.equal(device.status, 200)

  const sites = await roundTrip("GET", ["sites"], restCaller)
  assert.equal(sites.status, 200)
  const siteItems = (sites.body as { items: Array<Record<string, unknown>> })
    .items
  assert.equal("sshUsername" in siteItems[0]!, false)
  assert.equal("sshPublicKey" in siteItems[0]!, false)

  const tokens = await roundTrip("GET", ["enrollment-tokens"], restCaller)
  assert.equal(tokens.status, 200)
  const tokenItems = (tokens.body as { items: Array<Record<string, unknown>> })
    .items
  assert.equal("tokenHash" in tokenItems[0]!, false)

  const created = await roundTrip("POST", ["enrollment-tokens"], restCaller, {
    organizationId: "33333333-3333-4333-8333-111111111111",
    siteWide: true,
    maxUses: 1,
  })
  assert.equal(created.status, 201)
  const createdBody = created.body as {
    token: string
    enrollmentToken: Record<string, unknown>
  }
  assert.equal(createdBody.token, "enroll-secret-once")
  assert.equal("tokenHash" in createdBody.enrollmentToken, false)

  const alerts = await roundTrip("GET", ["alerts"], restCaller)
  assert.equal(alerts.status, 200)

  const ack = await roundTrip("POST", ["alerts", alertId, "ack"], restCaller)
  assert.equal(ack.status, 200)

  const resolved = await roundTrip(
    "POST",
    ["alerts", alertId, "resolve"],
    restCaller,
    { note: "cleared" }
  )
  assert.equal(resolved.status, 200)

  const sessions = await roundTrip("GET", ["sessions"], restCaller)
  assert.equal(sessions.status, 200)

  const activity = await roundTrip("GET", ["activity"], restCaller)
  assert.equal(activity.status, 200)

  assert.deepEqual(calls, [
    "devices.page",
    `devices.byId:${deviceId}`,
    "sites.list",
    "enrollmentTokens.list",
    "enrollmentTokens.create",
    "alerts.page",
    `alerts.acknowledge:${alertId}`,
    `alerts.resolve:${alertId}`,
    "sessions.page",
    "audit.page",
  ])
})

test("maps missing procedures and forbidden errors", async () => {
  const missing = await dispatchRestV1({
    method: "GET",
    path: ["nope"],
    searchParams: new URLSearchParams(),
    body: undefined,
    caller: caller([]),
  })
  assert.equal(missing.status, 404)

  const mapped = restErrorFromUnknown(
    new TRPCError({ code: "FORBIDDEN", message: "No access" })
  )
  assert.equal(mapped.status, 403)
  assert.deepEqual(mapped.body, { error: "No access" })
})

test("OpenAPI document covers each REST resource", () => {
  for (const path of [
    "/devices",
    "/devices/{id}",
    "/sites",
    "/enrollment-tokens",
    "/alerts/{id}/ack",
    "/alerts/{id}/resolve",
    "/sessions",
    "/activity",
    "/openapi.json",
  ]) {
    assert.ok(path in restV1OpenApi.paths, `missing ${path}`)
  }
})
