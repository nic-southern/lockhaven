import assert from "node:assert/strict"
import test from "node:test"

import { matchExistingDevice, type AttachCandidate } from "./agent-attach"
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
