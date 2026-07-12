import assert from "node:assert/strict"
import test from "node:test"

import {
  allocateVpnIpv4,
  buildAdminClientAllowedIps,
  buildAdminClientConfig,
  buildClientAllowedIps,
  buildServerPeerAllowedIps,
  buildSyncFirewallCommand,
  generateWireGuardKeyPair,
  normalizeVpnIpv4,
} from "./index"

test("normalizes inet values without breaking /32 allocation", () => {
  assert.equal(normalizeVpnIpv4("10.80.20.11/32"), "10.80.20.11")
  assert.equal(normalizeVpnIpv4("10.80.20.11"), "10.80.20.11")
})

test("skips addresses already returned by inet columns", () => {
  assert.equal(allocateVpnIpv4(["10.80.20.11"], "windows"), "10.80.20.12/32")
  assert.equal(allocateVpnIpv4(["10.80.20.11/32"], "windows"), "10.80.20.12/32")
})

test("allocates from the admin pool when requested", () => {
  assert.equal(
    allocateVpnIpv4(["10.80.100.11/32"], { pool: "admin" }),
    "10.80.100.12/32"
  )
})

test("adds route policy ranges to client allowed ips", () => {
  assert.deepEqual(
    buildClientAllowedIps({
      serverIp: "10.80.0.1",
      routePolicyRoutes: ["10.1.0.0/24", "10.1.0.0/24"],
    }),
    ["10.80.0.1/32", "10.1.0.0/24"]
  )
})

test("admin client allowed ips cover the overlay only", () => {
  assert.deepEqual(buildAdminClientAllowedIps(), ["10.80.0.0/16"])
})

test("adds route policy ranges to server peers", () => {
  assert.deepEqual(
    buildServerPeerAllowedIps({
      vpnIp: "10.80.20.11/32",
      routePolicyRoutes: ["10.1.0.0/24"],
    }),
    ["10.80.20.11/32", "10.1.0.0/24"]
  )
})

test("generates wireguard keypairs as base64 32-byte values", () => {
  const keyPair = generateWireGuardKeyPair()
  assert.equal(Buffer.from(keyPair.privateKey, "base64").byteLength, 32)
  assert.equal(Buffer.from(keyPair.publicKey, "base64").byteLength, 32)
  assert.notEqual(keyPair.privateKey, keyPair.publicKey)
})

test("builds admin client config with overlay allowed ips", () => {
  const config = buildAdminClientConfig({
    privateKey: "cHJpdmF0ZS1rZXktcGxhY2Vob2xkZXIhISE=",
    vpnIp: "10.80.100.11/32",
    serverPublicKey: "c2VydmVyLXB1YmxpYy1rZXktcGxhY2Vob2xk",
    endpoint: "vpn.example.com:51820",
  })

  assert.match(config, /Address = 10\.80\.100\.11\/32/)
  assert.match(config, /PrivateKey = /)
  assert.match(config, /AllowedIPs = 10\.80\.0\.0\/16/)
  assert.match(config, /Endpoint = vpn\.example\.com:51820/)
})

test("builds sync-firewall command with admin forwards and snat", () => {
  assert.deepEqual(
    buildSyncFirewallCommand({
      allowedRoutes: ["10.1.0.0/24"],
      adminForwards: [
        {
          sourceIp: "10.80.100.11",
          destinationIps: ["10.80.20.11", "10.80.30.5/32"],
        },
      ],
      snatTo: "10.80.0.1",
    }),
    [
      "sync-firewall",
      "--allowed-routes",
      "10.1.0.0/24",
      "--admin-forward",
      "10.80.100.11=10.80.20.11/32,10.80.30.5/32",
      "--snat-to",
      "10.80.0.1",
    ]
  )
})
