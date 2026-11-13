import assert from "node:assert/strict"
import test from "node:test"

import { authorize, permissionsForOrganizationRole } from "@nms/auth"
import type { ActorPrincipal } from "@nms/auth"
import { generateWireGuardKeyPair } from "@nms/vpn"

import {
  TUNNEL_DEVICE_OS_FAMILY,
  TUNNEL_DEVICE_PERMISSION,
  buildIssuedTunnelDevice,
  findTunnelDeviceNameConflict,
  isTunnelOnlyDevice,
  persistOmitsPrivateKey,
  tunnelDeviceCreatedAuditData,
  tunnelDeviceNameConflictCopy,
  tunnelIdentityReissuePatch,
} from "./tunnel-device"

const sampleKeys = {
  privateKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  publicKey: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
}

function issued(
  overrides: Partial<Parameters<typeof buildIssuedTunnelDevice>[0]> = {}
) {
  return buildIssuedTunnelDevice({
    privateKey: sampleKeys.privateKey,
    publicKey: sampleKeys.publicKey,
    vpnIp: "10.80.10.11/32",
    serverPublicKey: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC=",
    serverIp: "192.0.2.1",
    endpoint: "vpn.example.com:51820",
    organizationName: "Acme Corp",
    deviceName: "UDM-Pro",
    ...overrides,
  })
}

test("stores only the public key when issuing a tunnel device", () => {
  const keyPair = generateWireGuardKeyPair()
  const result = issued({
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
  })

  assert.equal(result.persist.wireguardPublicKey, keyPair.publicKey)
  assert.equal(persistOmitsPrivateKey(result.persist, keyPair.privateKey), true)
  assert.equal("privateKey" in result.persist, false)
  assert.equal(
    JSON.stringify(result.persist).includes(keyPair.privateKey),
    false
  )
  assert.equal(
    result.config.includes(`PrivateKey = ${keyPair.privateKey}`),
    true
  )
})

test("client config uses device routes and keepalive 25, not the admin overlay", () => {
  const result = issued({
    routePolicyRoutes: ["10.1.0.0/24"],
  })

  assert.match(result.config, /Address = 10\.80\.10\.11\/32/)
  assert.match(result.config, /PersistentKeepalive = 25/)
  assert.match(result.config, /^DNS = 1\.1\.1\.1$/m)
  assert.match(result.config, /AllowedIPs = 192\.0\.2\.1\/32, 10\.1\.0\.0\/24/)
  assert.equal(result.config.includes("10.80.0.0/16"), false)
  assert.equal(result.config.includes("10.80.100."), false)
  assert.deepEqual(result.allowedIps, ["192.0.2.1/32", "10.1.0.0/24"])
  assert.match(result.filename, /\.conf$/)
  assert.ok(!result.filename.includes("/"))
})

test("network family is not an admin or linux pool name", () => {
  assert.equal(TUNNEL_DEVICE_OS_FAMILY, "network")
  assert.notEqual(TUNNEL_DEVICE_OS_FAMILY, "admin")
  assert.notEqual(TUNNEL_DEVICE_OS_FAMILY, "linux")
})

test("name collisions refuse instead of duplicating", () => {
  const existing = [
    { id: "dev-1", hostname: "UDM-Pro", displayName: "Office gateway" },
  ]
  const conflict = findTunnelDeviceNameConflict(existing, "udm-pro.")
  assert.equal(conflict?.reason, "exists")
  assert.deepEqual(conflict?.deviceIds, ["dev-1"])
  assert.match(tunnelDeviceNameConflictCopy("exists"), /already exists/)

  assert.equal(findTunnelDeviceNameConflict(existing, "core-switch"), null)

  const ambiguous = findTunnelDeviceNameConflict(
    [
      { id: "dev-1", hostname: "edge", displayName: "Edge" },
      { id: "dev-2", hostname: "EDGE.", displayName: "Other" },
    ],
    "edge"
  )
  assert.equal(ambiguous?.reason, "ambiguous")
  assert.equal(ambiguous?.deviceIds.length, 2)
})

test("display name is enough to catch a collision when hostname differs", () => {
  const conflict = findTunnelDeviceNameConflict(
    [{ id: "dev-1", hostname: "host-a", displayName: "UDM-Pro" }],
    "udm-pro"
  )
  assert.equal(conflict?.reason, "exists")
})

test("reissue patch replaces the public key and restores a revoked peer", () => {
  const patch = tunnelIdentityReissuePatch({
    vpnIpv4: "10.80.10.11/32",
    nextPublicKey: "NEWPUBLICKEY",
  })
  assert.equal(patch.wireguardPublicKey, "NEWPUBLICKEY")
  assert.equal(patch.vpnIpv4, "10.80.10.11/32")
  assert.equal(patch.lastHandshakeAt, null)
  assert.equal(patch.latestEndpoint, null)
  assert.equal(patch.serverPeerEnabled, true)
  assert.equal(patch.revokedAt, null)
  assert.equal("privateKey" in patch, false)
})

test("audit payloads fingerprint the public key and never include the private key", () => {
  const created = tunnelDeviceCreatedAuditData({
    vpnIpv4: "10.80.10.11/32",
    publicKey: sampleKeys.publicKey,
    routePolicyId: null,
    sshPort: 22,
    organization: "Acme",
  })
  const serialized = JSON.stringify(created)
  assert.equal(serialized.includes(sampleKeys.privateKey), false)
  assert.equal(created.wireguardFingerprint.length, 16)
  assert.equal(created.enrollment, "console_tunnel")
  assert.equal(created.sshPort, 22)
})

test("tunnel-only means no agent secret and no agent version", () => {
  assert.equal(
    isTunnelOnlyDevice({ hasCheckInSecret: false, agentVersion: null }),
    true
  )
  assert.equal(
    isTunnelOnlyDevice({ hasCheckInSecret: true, agentVersion: null }),
    false
  )
  assert.equal(
    isTunnelOnlyDevice({ hasCheckInSecret: false, agentVersion: "1.2.3" }),
    false
  )
})

function member(overrides: Partial<ActorPrincipal>): ActorPrincipal {
  return {
    id: "user-1",
    email: "ops@example.com",
    name: null,
    platformRole: "member",
    platformPermissions: [],
    permissions: [],
    organizationMemberships: [],
    siteMemberships: [],
    ...overrides,
  }
}

test("org admins may create tunnel devices; technicians may not", () => {
  const resource = {
    kind: "device" as const,
    organizationId: "org-1",
    siteId: null,
  }
  const admin = member({
    permissions: permissionsForOrganizationRole("admin"),
    organizationMemberships: [
      {
        id: "m-1",
        organizationId: "org-1",
        role: "admin",
        status: "active",
      },
    ],
  })
  const technician = member({
    permissions: permissionsForOrganizationRole("technician"),
    organizationMemberships: [
      {
        id: "m-1",
        organizationId: "org-1",
        role: "technician",
        status: "active",
      },
    ],
  })

  assert.equal(TUNNEL_DEVICE_PERMISSION, "device:enroll")
  assert.equal(
    authorize(admin, TUNNEL_DEVICE_PERMISSION, resource).allowed,
    true
  )
  assert.equal(
    authorize(technician, TUNNEL_DEVICE_PERMISSION, resource).allowed,
    false
  )
})
