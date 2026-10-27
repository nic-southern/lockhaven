import assert from "node:assert/strict"
import test from "node:test"

import {
  adminVpnConfigFilename,
  normalizeRouteValues,
  permissionForServiceType,
  serviceConnectionDefaults,
  siteBelongsToOrganization,
  WIREGUARD_TUNNEL_NAME_PATTERN,
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

function tunnelName(filename: string) {
  assert.match(filename, /\.conf$/)
  return filename.slice(0, -".conf".length)
}

test("names admin vpn configs after the machine label", () => {
  assert.equal(
    adminVpnConfigFilename("Acme Corp", "10.80.100.11/32", "Desktop"),
    "desktop-100-11.conf"
  )
  assert.equal(
    adminVpnConfigFilename("Acme Corp", "10.80.100.12/32", "Laptop"),
    "laptop-100-12.conf"
  )
})

test("falls back to the organization when a profile has no label", () => {
  assert.equal(
    adminVpnConfigFilename("Acme Corp", "10.80.100.11/32", null),
    "acme-cor-100-11.conf"
  )
  assert.equal(
    adminVpnConfigFilename("!!!", "10.80.100.11", ""),
    "lh-100-11.conf"
  )
})

test("admin vpn config names import in Android and desktop WireGuard", () => {
  const names = [
    adminVpnConfigFilename("Acme Corp", "10.80.100.11/32", "Desktop"),
    adminVpnConfigFilename("Acme Corp", "10.80.100.12/32", "Laptop"),
    adminVpnConfigFilename("Acme Corp", "10.80.100.11/32", null),
    adminVpnConfigFilename("!!!", "10.80.100.11", ""),
    adminVpnConfigFilename(
      "A very long organization name",
      "10.80.100.254/32",
      "Field technician phone"
    ),
    adminVpnConfigFilename("Org", "10.80.100.11/32", "CON"),
    adminVpnConfigFilename("Org", "10.80.100.8/32", "Desktop north"),
    adminVpnConfigFilename("Org", "10.80.100.9/32", "Desktop south"),
  ]

  for (const filename of names) {
    const stem = tunnelName(filename)
    assert.match(stem, WIREGUARD_TUNNEL_NAME_PATTERN)
    assert.ok(!stem.startsWith("."))
    assert.ok(!stem.endsWith("."))
  }

  assert.notEqual(names[0], names[1])
  assert.notEqual(names[6], names[7])
})
