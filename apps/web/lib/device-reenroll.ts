import { createHash } from "node:crypto"

export function fingerprintWireGuardPublicKey(publicKey: string) {
  return createHash("sha256")
    .update(publicKey, "utf8")
    .digest("hex")
    .slice(0, 16)
}

export function vpnIdentityReenrollPatch(input: {
  vpnIpv4: string
  nextPublicKey: string
}) {
  return {
    vpnIpv4: input.vpnIpv4,
    wireguardPublicKey: input.nextPublicKey,
    lastHandshakeAt: null,
    latestEndpoint: null,
  }
}

export type EnrollmentConflictReason =
  | "ambiguous"
  | "hostname_conflict"
  | "revoked"
  | "wireguard_key_in_use"

const conflictCopy: Record<EnrollmentConflictReason, string> = {
  ambiguous: "More than one listed device matches this host.",
  hostname_conflict: "This hostname is already used by a different device.",
  revoked: "This device was revoked and cannot enroll again.",
  wireguard_key_in_use: "This tunnel key is already used by another device.",
}

export function isEnrollmentConflictReason(
  reason: string
): reason is EnrollmentConflictReason {
  return Object.hasOwn(conflictCopy, reason)
}

export function enrollmentConflictResponse(reason: EnrollmentConflictReason) {
  return {
    status: 409 as const,
    body: {
      error: conflictCopy[reason],
      code: reason,
    },
  }
}

export function reenrollAuditEventData(input: {
  tokenId: string
  matchReason: string
  vpnIpv4: string
  oldPublicKey: string
  newPublicKey: string
  organization: string
}) {
  return {
    tokenId: input.tokenId,
    match: input.matchReason,
    vpnIpv4: input.vpnIpv4,
    oldWireguardFingerprint: fingerprintWireGuardPublicKey(input.oldPublicKey),
    newWireguardFingerprint: fingerprintWireGuardPublicKey(input.newPublicKey),
    organization: input.organization,
    actor: "enrollment_token",
  }
}
