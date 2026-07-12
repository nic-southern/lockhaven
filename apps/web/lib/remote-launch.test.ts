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

test("openRemoteLaunchResult is a no-op for empty results", () => {
  assert.equal(openRemoteLaunchResult(null), undefined)
})
