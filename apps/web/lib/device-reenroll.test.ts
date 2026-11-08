import assert from "node:assert/strict"
import test from "node:test"

import {
  enrollmentConflictResponse,
  fingerprintWireGuardPublicKey,
  vpnIdentityReenrollPatch,
} from "./device-reenroll"

test("fingerprint is a short stable digest of the tunnel public key", () => {
  const left = fingerprintWireGuardPublicKey("old-key")
  const right = fingerprintWireGuardPublicKey("new-key")
  assert.match(left, /^[0-9a-f]{16}$/)
  assert.match(right, /^[0-9a-f]{16}$/)
  assert.equal(left, fingerprintWireGuardPublicKey("old-key"))
  assert.notEqual(left, right)
})

test("re-enroll VPN patch keeps the address and rotates the public key", () => {
  assert.deepEqual(
    vpnIdentityReenrollPatch({
      vpnIpv4: "10.80.30.11",
      nextPublicKey: "wg-rotated",
    }),
    {
      vpnIpv4: "10.80.30.11",
      wireguardPublicKey: "wg-rotated",
      lastHandshakeAt: null,
      latestEndpoint: null,
    }
  )
})

test("conflict responses stay specific and never suggest attach for a unique match", () => {
  assert.deepEqual(enrollmentConflictResponse("ambiguous"), {
    status: 409,
    body: {
      error: "More than one listed device matches this host.",
      code: "ambiguous",
    },
  })
  assert.deepEqual(enrollmentConflictResponse("revoked"), {
    status: 409,
    body: {
      error: "This device was revoked and cannot enroll again.",
      code: "revoked",
    },
  })
  assert.deepEqual(enrollmentConflictResponse("hostname_conflict"), {
    status: 409,
    body: {
      error: "This hostname is already used by a different device.",
      code: "hostname_conflict",
    },
  })
})
