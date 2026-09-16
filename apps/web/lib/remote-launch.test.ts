import assert from "node:assert/strict"
import test from "node:test"

import {
  openRemoteLaunchResult,
  preferredConnectionMethod,
} from "./remote-launch"

test("prefers native launch for VNC and SSH when on VPN", () => {
  assert.equal(
    preferredConnectionMethod({ vpnConnected: true, serviceType: "vnc" }),
    "native"
  )
  assert.equal(
    preferredConnectionMethod({ vpnConnected: true, serviceType: "ssh" }),
    "native"
  )
  assert.equal(
    preferredConnectionMethod({ vpnConnected: true, serviceType: "rdp" }),
    "guacamole"
  )
  assert.equal(
    preferredConnectionMethod({ vpnConnected: false, serviceType: "vnc" }),
    "guacamole"
  )
})

test("openRemoteLaunchResult is a no-op for empty results", async () => {
  assert.equal(await openRemoteLaunchResult(null), null)
})

test("pending approval does not open a session window", async () => {
  const opened = await openRemoteLaunchResult({
    url: null,
    nativeUrl: null,
    launchTicket: null,
    mode: "pending_approval",
    request: {
      id: "11111111-1111-4111-8111-111111111111",
      status: "pending",
      expiresAt: "2026-09-16T20:00:00.000Z",
      reason: "Replace a failed disk",
    },
  })
  assert.deepEqual(opened, { mode: "pending_approval", copiedSecret: false })
})
