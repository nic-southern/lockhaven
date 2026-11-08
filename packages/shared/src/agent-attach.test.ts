import assert from "node:assert/strict"
import test from "node:test"

import {
  enrollmentIntentFromMatch,
  matchExistingDevice,
  type AttachCandidate,
} from "./agent-attach"
import { normalizeSerial } from "./assets"

const org = "11111111-1111-4111-8111-111111111111"
const site = "22222222-2222-4222-8222-222222222222"
const otherOrg = "33333333-3333-4333-8333-333333333333"

function device(
  overrides: Partial<AttachCandidate> & Pick<AttachCandidate, "id">
): AttachCandidate {
  return {
    organizationId: org,
    siteId: site,
    hostname: "kiosk-01",
    serialNumber: "ABC-123",
    status: "enrolled",
    wireguardPublicKey: "wg-kiosk-01",
    revokedAt: null,
    ...overrides,
  }
}

const inventory = device({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })

test("normalizeSerial ignores case, spaces, and dashes", () => {
  assert.equal(normalizeSerial("ab c-123"), "ABC123")
})

test("attaches an existing inventory device by serial", () => {
  const match = matchExistingDevice(
    [inventory],
    { hostname: "kiosk-01", serialNumber: "abc123" },
    { organizationId: org, siteId: site }
  )
  assert.deepEqual(match, {
    ok: true,
    deviceId: inventory.id,
    reason: "serial",
  })
})

test("attaches by hostname when serial on record is empty", () => {
  const match = matchExistingDevice(
    [device({ id: inventory.id, serialNumber: null })],
    { hostname: "kiosk-01.", serialNumber: "fresh-serial" },
    { organizationId: org, siteId: null }
  )
  assert.deepEqual(match, {
    ok: true,
    deviceId: inventory.id,
    reason: "hostname",
  })
})

test("attaches by wireguard public key", () => {
  const match = matchExistingDevice(
    [inventory],
    {
      hostname: "other",
      serialNumber: "other",
      wireguardPublicKey: "wg-kiosk-01",
    },
    { organizationId: org, siteId: null }
  )
  assert.equal(match.ok, true)
  if (match.ok) assert.equal(match.reason, "wireguard")
})

test("attaches by explicit device id", () => {
  const match = matchExistingDevice(
    [inventory],
    {
      hostname: "renamed",
      serialNumber: "other",
      deviceId: inventory.id,
    },
    { organizationId: org, siteId: site }
  )
  assert.deepEqual(match, {
    ok: true,
    deviceId: inventory.id,
    reason: "device_id",
  })
})

test("refuses a duplicate when two serials match", () => {
  const match = matchExistingDevice(
    [
      inventory,
      device({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        hostname: "kiosk-02",
      }),
    ],
    { hostname: "kiosk-99", serialNumber: "ABC-123" },
    { organizationId: org, siteId: null }
  )
  assert.deepEqual(match, { ok: false, reason: "ambiguous" })
})

test("does not create a match for a new hostname and serial", () => {
  const match = matchExistingDevice(
    [inventory],
    { hostname: "lab-07", serialNumber: "ZZZ-999" },
    { organizationId: org, siteId: null }
  )
  assert.deepEqual(match, { ok: false, reason: "not_found" })
})

test("refuses a device in another organization", () => {
  const match = matchExistingDevice(
    [inventory],
    {
      hostname: "kiosk-01",
      serialNumber: "ABC-123",
      deviceId: inventory.id,
    },
    { organizationId: otherOrg, siteId: null }
  )
  assert.deepEqual(match, { ok: false, reason: "out_of_scope" })
})

test("refuses a revoked device", () => {
  const match = matchExistingDevice(
    [device({ id: inventory.id, status: "revoked" })],
    { hostname: "kiosk-01", serialNumber: "ABC-123" },
    { organizationId: org, siteId: null }
  )
  assert.deepEqual(match, { ok: false, reason: "revoked" })
})

test("hostname match with a different stored serial is a conflict", () => {
  const match = matchExistingDevice(
    [inventory],
    { hostname: "kiosk-01", serialNumber: "OTHER-SERIAL" },
    { organizationId: org, siteId: null }
  )
  assert.deepEqual(match, { ok: false, reason: "hostname_conflict" })
})

test("site tokens may attach an unassigned device in the organization", () => {
  const unassigned = device({ id: inventory.id, siteId: null })
  const match = matchExistingDevice(
    [unassigned],
    { hostname: "kiosk-01", serialNumber: "ABC-123" },
    { organizationId: org, siteId: site }
  )
  assert.equal(match.ok, true)
})

const genericUuid = "03000200-0400-0500-0006-000700080009"
const uniqueUuid = "a1b2c3d4-e5f6-4789-abcd-ef1234567890"
const scope = { organizationId: org, siteId: site as string | null }

type SimulatedDevice = AttachCandidate & {
  vpnIpv4: string
  checkInSecret: string
}

function simulateEnroll(
  listed: SimulatedDevice[],
  identity: {
    hostname: string
    serialNumber: string
    wireguardPublicKey: string
  }
) {
  const match = matchExistingDevice(listed, identity, scope)
  const intent = enrollmentIntentFromMatch(match)
  if (intent.action === "reject") {
    return { ok: false as const, reason: intent.reason }
  }
  if (intent.action === "create") {
    const created: SimulatedDevice = {
      id: "new-device",
      organizationId: org,
      siteId: site,
      hostname: identity.hostname,
      serialNumber: identity.serialNumber,
      status: "enrolled",
      wireguardPublicKey: identity.wireguardPublicKey,
      revokedAt: null,
      vpnIpv4: "10.80.30.99",
      checkInSecret: "fresh-secret",
    }
    listed.push(created)
    return {
      ok: true as const,
      action: "create" as const,
      deviceId: created.id,
      vpnIpv4: created.vpnIpv4,
      wireguardPublicKey: created.wireguardPublicKey,
      checkInSecret: created.checkInSecret,
    }
  }

  const existing = listed.find((row) => row.id === intent.deviceId)
  if (!existing) {
    return { ok: false as const, reason: "not_found" as const }
  }
  existing.wireguardPublicKey = identity.wireguardPublicKey
  existing.checkInSecret = "rotated-secret"
  return {
    ok: true as const,
    action: "reenroll" as const,
    deviceId: existing.id,
    vpnIpv4: existing.vpnIpv4,
    wireguardPublicKey: existing.wireguardPublicKey,
    checkInSecret: existing.checkInSecret,
    matchReason: intent.matchReason,
  }
}

test("generic DMI UUID is not enough to match without hostname", () => {
  const listed = device({
    id: inventory.id,
    hostname: "cab-aa-bb-cc-dd-ee-ff",
    serialNumber: genericUuid,
  })
  const match = matchExistingDevice(
    [listed],
    {
      hostname: "cab-11-22-33-44-55-66",
      serialNumber: genericUuid,
    },
    scope
  )
  assert.deepEqual(match, { ok: false, reason: "not_found" })
})

test("generic DMI UUID plus hostname matches the same cabinet", () => {
  const listed = device({
    id: inventory.id,
    hostname: "cab-aa-bb-cc-dd-ee-ff",
    serialNumber: genericUuid,
  })
  const match = matchExistingDevice(
    [listed],
    {
      hostname: "cab-aa-bb-cc-dd-ee-ff",
      serialNumber: genericUuid.toUpperCase(),
    },
    scope
  )
  assert.deepEqual(match, {
    ok: true,
    deviceId: inventory.id,
    reason: "serial_and_hostname",
  })
})

test("two cabinets sharing a generic UUID stay ambiguous when hostnames also collide", () => {
  const match = matchExistingDevice(
    [
      device({
        id: inventory.id,
        hostname: "cab-dup",
        serialNumber: genericUuid,
      }),
      device({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        hostname: "cab-dup",
        serialNumber: genericUuid,
      }),
    ],
    { hostname: "cab-dup", serialNumber: genericUuid },
    scope
  )
  assert.deepEqual(match, { ok: false, reason: "ambiguous" })
})

test("two cabinets sharing a generic UUID disambiguate by hostname", () => {
  const match = matchExistingDevice(
    [
      device({
        id: inventory.id,
        hostname: "cab-aa-bb-cc-dd-ee-ff",
        serialNumber: genericUuid,
      }),
      device({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        hostname: "cab-11-22-33-44-55-66",
        serialNumber: genericUuid,
      }),
    ],
    {
      hostname: "cab-11-22-33-44-55-66",
      serialNumber: genericUuid,
    },
    scope
  )
  assert.deepEqual(match, {
    ok: true,
    deviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    reason: "serial_and_hostname",
  })
})

test("a unique product_uuid still matches by serial when hostname changed", () => {
  const match = matchExistingDevice(
    [
      device({
        id: inventory.id,
        hostname: "old-name",
        serialNumber: uniqueUuid,
      }),
    ],
    { hostname: "new-name", serialNumber: uniqueUuid },
    scope
  )
  assert.deepEqual(match, {
    ok: true,
    deviceId: inventory.id,
    reason: "serial",
  })
})

test("fresh enroll creates a device when nothing matches", () => {
  const listed: SimulatedDevice[] = [
    {
      ...inventory,
      vpnIpv4: "10.80.30.11",
      checkInSecret: "existing",
    },
  ]
  const result = simulateEnroll(listed, {
    hostname: "lab-07",
    serialNumber: "ZZZ-999",
    wireguardPublicKey: "wg-new",
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.action, "create")
  assert.equal(result.vpnIpv4, "10.80.30.99")
  assert.equal(listed.length, 2)
})

test("re-enroll of a single match keeps the VPN address and rotates the key", () => {
  const listed: SimulatedDevice[] = [
    {
      ...inventory,
      vpnIpv4: "10.80.30.11",
      checkInSecret: "old-secret",
    },
  ]
  const result = simulateEnroll(listed, {
    hostname: "kiosk-01",
    serialNumber: "ABC-123",
    wireguardPublicKey: "wg-rotated",
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.action, "reenroll")
  assert.equal(result.deviceId, inventory.id)
  assert.equal(result.vpnIpv4, "10.80.30.11")
  assert.equal(result.wireguardPublicKey, "wg-rotated")
  assert.equal(result.checkInSecret, "rotated-secret")
  assert.equal(listed.length, 1)
  assert.equal(listed[0].wireguardPublicKey, "wg-rotated")
  assert.equal(listed[0].vpnIpv4, "10.80.30.11")
})

test("generic UUID re-enroll requires hostname and keeps the address", () => {
  const listed: SimulatedDevice[] = [
    {
      ...device({
        id: inventory.id,
        hostname: "cab-aa-bb-cc-dd-ee-ff",
        serialNumber: genericUuid,
        wireguardPublicKey: "wg-old",
      }),
      vpnIpv4: "10.80.30.40",
      checkInSecret: "old-secret",
    },
  ]
  const stolen = simulateEnroll(listed, {
    hostname: "cab-11-22-33-44-55-66",
    serialNumber: genericUuid,
    wireguardPublicKey: "wg-other-cabinet",
  })
  assert.deepEqual(stolen, {
    ok: true,
    action: "create",
    deviceId: "new-device",
    vpnIpv4: "10.80.30.99",
    wireguardPublicKey: "wg-other-cabinet",
    checkInSecret: "fresh-secret",
  })
  assert.equal(listed[0].wireguardPublicKey, "wg-old")
  assert.equal(listed[0].vpnIpv4, "10.80.30.40")

  const restored = simulateEnroll(listed.slice(0, 1), {
    hostname: "cab-aa-bb-cc-dd-ee-ff",
    serialNumber: genericUuid,
    wireguardPublicKey: "wg-new",
  })
  assert.equal(restored.ok, true)
  if (!restored.ok) return
  assert.equal(restored.action, "reenroll")
  assert.equal(restored.vpnIpv4, "10.80.30.40")
  assert.equal(restored.wireguardPublicKey, "wg-new")
})

test("ambiguous matches are rejected instead of re-enrolling one of them", () => {
  const listed: SimulatedDevice[] = [
    {
      ...inventory,
      vpnIpv4: "10.80.30.11",
      checkInSecret: "a",
    },
    {
      ...device({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        hostname: "kiosk-02",
      }),
      vpnIpv4: "10.80.30.12",
      checkInSecret: "b",
    },
  ]
  const result = simulateEnroll(listed, {
    hostname: "kiosk-99",
    serialNumber: "ABC-123",
    wireguardPublicKey: "wg-new",
  })
  assert.deepEqual(result, { ok: false, reason: "ambiguous" })
  assert.equal(listed[0].wireguardPublicKey, "wg-kiosk-01")
  assert.equal(listed[1].wireguardPublicKey, "wg-kiosk-01")
})

test("revoked devices stay rejected", () => {
  const listed: SimulatedDevice[] = [
    {
      ...device({ id: inventory.id, status: "revoked" }),
      vpnIpv4: "10.80.30.11",
      checkInSecret: "old",
    },
  ]
  const result = simulateEnroll(listed, {
    hostname: "kiosk-01",
    serialNumber: "ABC-123",
    wireguardPublicKey: "wg-new",
  })
  assert.deepEqual(result, { ok: false, reason: "revoked" })
  assert.equal(listed[0].wireguardPublicKey, "wg-kiosk-01")
})

test("enrollment intent re-enrolls a unique match and creates when none exists", () => {
  assert.deepEqual(
    enrollmentIntentFromMatch({
      ok: true,
      deviceId: inventory.id,
      reason: "serial",
    }),
    {
      action: "reenroll",
      deviceId: inventory.id,
      matchReason: "serial",
    }
  )
  assert.deepEqual(
    enrollmentIntentFromMatch({ ok: false, reason: "not_found" }),
    {
      action: "create",
    }
  )
  assert.deepEqual(
    enrollmentIntentFromMatch({ ok: false, reason: "ambiguous" }),
    { action: "reject", reason: "ambiguous" }
  )
  assert.deepEqual(
    enrollmentIntentFromMatch({ ok: false, reason: "revoked" }),
    { action: "reject", reason: "revoked" }
  )
})
