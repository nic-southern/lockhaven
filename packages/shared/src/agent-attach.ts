import { hostnamesMatch } from "./domain"
import { normalizeSerial } from "./assets"

function serialsMatch(
  expected: string | null | undefined,
  reported: string | null | undefined
) {
  const left = normalizeSerial(expected)
  const right = normalizeSerial(reported)
  return left !== null && left === right
}

export type AttachCandidate = {
  id: string
  organizationId: string
  siteId: string | null
  hostname: string | null
  serialNumber: string | null
  status: string
  wireguardPublicKey: string | null
  revokedAt?: Date | string | null
}

export type AttachIdentity = {
  hostname: string
  serialNumber: string
  deviceId?: string
  wireguardPublicKey?: string
}

export type AttachTokenScope = {
  organizationId: string
  siteId: string | null
}

export type AttachMatchReason =
  | "device_id"
  | "wireguard"
  | "serial"
  | "hostname"

export type AttachRefusalReason =
  | "not_found"
  | "ambiguous"
  | "out_of_scope"
  | "revoked"
  | "hostname_conflict"

export type AttachMatch =
  | { ok: true; deviceId: string; reason: AttachMatchReason }
  | { ok: false; reason: AttachRefusalReason }

function siteInScope(candidate: AttachCandidate, scope: AttachTokenScope) {
  if (!scope.siteId) return true
  return candidate.siteId === scope.siteId || candidate.siteId === null
}

function isRevoked(candidate: AttachCandidate) {
  return candidate.status === "revoked" || Boolean(candidate.revokedAt)
}

function inOrg(candidate: AttachCandidate, scope: AttachTokenScope) {
  return candidate.organizationId === scope.organizationId
}

/**
 * Bind an agent to one existing Hub device. Callers pass every candidate that
 * might match; this function never creates a row.
 */
export function matchExistingDevice(
  candidates: AttachCandidate[],
  identity: AttachIdentity,
  scope: AttachTokenScope
): AttachMatch {
  const scoped = candidates.filter(
    (row) => inOrg(row, scope) && siteInScope(row, scope)
  )

  if (identity.deviceId) {
    const requested = candidates.filter((row) => row.id === identity.deviceId)
    const inScopeHits = scoped.filter((row) => row.id === identity.deviceId)
    if (requested.length > 0 && inScopeHits.length === 0) {
      return { ok: false, reason: "out_of_scope" }
    }
    if (inScopeHits.length === 1) {
      if (isRevoked(inScopeHits[0])) {
        return { ok: false, reason: "revoked" }
      }
      return { ok: true, deviceId: inScopeHits[0].id, reason: "device_id" }
    }
  }

  if (identity.wireguardPublicKey) {
    const hits = scoped.filter(
      (row) => row.wireguardPublicKey === identity.wireguardPublicKey
    )
    if (hits.length === 1) {
      if (isRevoked(hits[0])) return { ok: false, reason: "revoked" }
      return { ok: true, deviceId: hits[0].id, reason: "wireguard" }
    }
    if (hits.length > 1) return { ok: false, reason: "ambiguous" }
  }

  const serialHits = scoped.filter((row) =>
    serialsMatch(row.serialNumber, identity.serialNumber)
  )
  if (serialHits.length === 1) {
    if (isRevoked(serialHits[0])) return { ok: false, reason: "revoked" }
    return { ok: true, deviceId: serialHits[0].id, reason: "serial" }
  }
  if (serialHits.length > 1) return { ok: false, reason: "ambiguous" }

  const hostnameHits = scoped.filter((row) =>
    hostnamesMatch(row.hostname, identity.hostname)
  )
  if (hostnameHits.length === 1) {
    const hit = hostnameHits[0]
    if (isRevoked(hit)) return { ok: false, reason: "revoked" }
    if (
      hit.serialNumber &&
      identity.serialNumber &&
      !serialsMatch(hit.serialNumber, identity.serialNumber)
    ) {
      return { ok: false, reason: "hostname_conflict" }
    }
    return { ok: true, deviceId: hit.id, reason: "hostname" }
  }
  if (hostnameHits.length > 1) return { ok: false, reason: "ambiguous" }

  return { ok: false, reason: "not_found" }
}
