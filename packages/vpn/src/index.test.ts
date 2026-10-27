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
  sameUserPeerDestinationIps,
} from "./index"

test("normalizes inet values without breaking /32 allocation", () => {
  assert.equal(normalizeVpnIpv4("10.80.20.11/32"), "10.80.20.11")
  assert.equal(normalizeVpnIpv4("10.80.20.11"), "10.80.20.11")
})

test("skips addresses already returned by inet columns", () => {
  assert.equal(allocateVpnIpv4(["10.80.20.11"], "windows"), "10.80.20.12/32")
  assert.equal(allocateVpnIpv4(["10.80.20.11/32"], "windows"), "10.80.20.12/32")
})

test("allocates Android devices from the android pool", () => {
  assert.equal(allocateVpnIpv4([], "android"), "10.80.60.11/32")
  assert.equal(
    allocateVpnIpv4(["10.80.60.11/32"], "Android 14"),
    "10.80.60.12/32"
  )
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

function isCanonicalWireGuardKey(key: string) {
  return (
    /^[A-Za-z0-9+/]{43}=$/.test(key) &&
    Buffer.from(key, "base64").byteLength === 32 &&
    Buffer.from(key, "base64").toString("base64") === key
  )
}

test("generates wireguard keypairs as base64 32-byte values", () => {
  const keyPair = generateWireGuardKeyPair()
  assert.equal(isCanonicalWireGuardKey(keyPair.privateKey), true)
  assert.equal(isCanonicalWireGuardKey(keyPair.publicKey), true)
  assert.notEqual(keyPair.privateKey, keyPair.publicKey)
})

const androidInterfaceKeys = new Set([
  "address",
  "dns",
  "excludedapplications",
  "includedapplications",
  "listenport",
  "mtu",
  "privatekey",
])

const androidPeerKeys = new Set([
  "allowedips",
  "endpoint",
  "persistentkeepalive",
  "presharedkey",
  "publickey",
])

function assertAndroidWireGuardConfig(config: string) {
  assert.equal(config.endsWith("\n"), true)
  assert.equal(config.includes("\r"), false)
  assert.equal(config.includes("#"), false)

  let section = ""
  for (const line of config.split("\n")) {
    if (line === "") {
      continue
    }
    if (line.startsWith("[")) {
      assert.ok(line === "[Interface]" || line === "[Peer]")
      section = line
      continue
    }
    const separator = line.indexOf("=")
    assert.ok(separator > 0, line)
    const key = line.slice(0, separator).trim().toLowerCase()
    const allowed =
      section === "[Interface]" ? androidInterfaceKeys : androidPeerKeys
    assert.equal(allowed.has(key), true, line)
    assert.equal(
      /^(postup|postdown|preup|predown|saveconfig|table)$/.test(key),
      false
    )
  }
}

test("builds admin client config with overlay allowed ips", () => {
  const config = buildAdminClientConfig({
    privateKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    vpnIp: "10.80.100.11/32",
    serverPublicKey: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
    endpoint: "vpn.example.com:51820",
  })

  assert.match(config, /Address = 10\.80\.100\.11\/32/)
  assert.match(config, /PrivateKey = A{43}=/)
  assert.match(config, /AllowedIPs = 10\.80\.0\.0\/16/)
  assert.match(config, /Endpoint = vpn\.example\.com:51820/)
  assertAndroidWireGuardConfig(config)
  assert.equal(
    config,
    [
      "[Interface]",
      "Address = 10.80.100.11/32",
      "PrivateKey = AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      "",
      "[Peer]",
      "PublicKey = BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
      "Endpoint = vpn.example.com:51820",
      "AllowedIPs = 10.80.0.0/16",
      "PersistentKeepalive = 25",
      "",
    ].join("\n")
  )
})

test("admin client config adds a host prefix when the address has none", () => {
  const config = buildAdminClientConfig({
    privateKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    vpnIp: "10.80.100.11",
    serverPublicKey: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
    endpoint: " vpn.example.com:51820 ",
  })

  assert.match(config, /Address = 10\.80\.100\.11\/32/)
  assert.match(config, /Endpoint = vpn\.example\.com:51820\n/)
  assertAndroidWireGuardConfig(config)
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

test("same-user peer destinations only include opted-in sibling profiles", () => {
  const desktop = {
    id: "desktop",
    userId: "user-a",
    organizationId: "org-1",
    vpnIpv4: "10.80.100.11",
    serverPeerEnabled: true,
    revokedAt: null,
    allowSameUserAccess: true,
  }
  const laptop = {
    id: "laptop",
    userId: "user-a",
    organizationId: "org-1",
    vpnIpv4: "10.80.100.12",
    serverPeerEnabled: true,
    revokedAt: null,
    allowSameUserAccess: false,
  }
  const phone = {
    id: "phone",
    userId: "user-a",
    organizationId: "org-1",
    vpnIpv4: "10.80.100.13",
    serverPeerEnabled: true,
    revokedAt: null,
    allowSameUserAccess: true,
  }
  const otherUser = {
    id: "other",
    userId: "user-b",
    organizationId: "org-1",
    vpnIpv4: "10.80.100.14",
    serverPeerEnabled: true,
    revokedAt: null,
    allowSameUserAccess: true,
  }
  const revoked = {
    id: "revoked",
    userId: "user-a",
    organizationId: "org-1",
    vpnIpv4: "10.80.100.15",
    serverPeerEnabled: true,
    revokedAt: new Date("2026-01-01"),
    allowSameUserAccess: true,
  }

  const profiles = [desktop, laptop, phone, otherUser, revoked]

  assert.deepEqual(sameUserPeerDestinationIps(laptop, profiles), [
    "10.80.100.11",
    "10.80.100.13",
  ])
  assert.deepEqual(sameUserPeerDestinationIps(desktop, profiles), [
    "10.80.100.13",
  ])
  assert.deepEqual(sameUserPeerDestinationIps(otherUser, profiles), [])
})
