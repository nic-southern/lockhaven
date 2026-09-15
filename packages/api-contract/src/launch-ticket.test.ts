import assert from "node:assert/strict"
import { test } from "node:test"

import {
  MemoryLaunchTicketStore,
  hashLaunchTicket,
  issueLaunchTicket,
  redeemLaunchTicket,
  type LaunchTicketPayload,
} from "./launch-ticket"

const key = "test-launch-ticket-key"

const payload: LaunchTicketPayload = {
  userId: "user-1",
  remoteSessionId: "session-1",
  deviceId: "device-1",
  serviceId: "service-1",
  serviceType: "vnc",
  secretKind: "vnc_password",
  secret: "hunter2-hunter2",
}

test("launch tickets redeem exactly once", async () => {
  const store = new MemoryLaunchTicketStore()
  const ticket = await issueLaunchTicket(payload, key, store)

  assert.equal(ticket.length >= 40, true)
  const first = await redeemLaunchTicket(ticket, key, store)
  assert.deepEqual(first, payload)

  const second = await redeemLaunchTicket(ticket, key, store)
  assert.equal(second, null)
})

test("launch tickets are stored encrypted and hashed", async () => {
  const store = new MemoryLaunchTicketStore()
  const ticket = await issueLaunchTicket(payload, key, store)

  const raw = await store.take(hashLaunchTicket(ticket))
  assert.ok(raw)
  assert.equal(raw.includes(payload.secret), false)
  assert.equal(raw.includes(payload.userId), false)
})

test("launch tickets fail with the wrong key or an unknown ticket", async () => {
  const store = new MemoryLaunchTicketStore()
  const ticket = await issueLaunchTicket(payload, key, store)

  assert.equal(await redeemLaunchTicket("not-a-ticket", key, store), null)
  assert.equal(await redeemLaunchTicket(ticket, "wrong-key", store), null)
})
