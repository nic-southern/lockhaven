import assert from "node:assert/strict"
import test from "node:test"

import {
  normalizeRouteValues,
  permissionForServiceType,
  serviceConnectionDefaults,
  siteBelongsToOrganization,
} from "./helpers"

test("normalizes route values before persistence", () => {
  assert.deepEqual(
    normalizeRouteValues([" 10.0.0.0/24 ", "", "10.0.0.0/24", "10.1.0.0/16"]),
    ["10.0.0.0/24", "10.1.0.0/16"]
  )
})

test("maps remote service types to the right permission", () => {
  assert.equal(permissionForServiceType("rdp"), "device:start_rdp")
  assert.equal(permissionForServiceType("ssh"), "device:start_ssh")
  assert.equal(permissionForServiceType("vnc"), "device:start_vnc")
  assert.equal(permissionForServiceType("winrm_https"), "device:start_vnc")
})

test("provides connection defaults for remote service types", () => {
  assert.deepEqual(serviceConnectionDefaults("vnc"), {
    protocol: "tcp",
    port: 5900,
  })
  assert.deepEqual(serviceConnectionDefaults("rdp"), {
    protocol: "tcp",
    port: 3389,
  })
  assert.deepEqual(serviceConnectionDefaults("ssh"), {
    protocol: "tcp",
    port: 22,
  })
})

test("keeps site assignments within the same organization", () => {
  assert.equal(siteBelongsToOrganization("org-1", "org-1"), true)
  assert.equal(siteBelongsToOrganization("org-1", "org-2"), false)
})
