/**
 * Infrastructure devices stay closed until a platform administrator requests
 * access. The allow is time-boxed. Callers must treat `expiresAt` as the
 * source of truth even if a stored status has not been updated yet.
 */

export const INFRASTRUCTURE_ACCESS_DEFAULT_MINUTES = 30
export const INFRASTRUCTURE_ACCESS_MAX_MINUTES = 120

export const infrastructureAccessStatuses = [
  "active",
  "expired",
  "revoked",
] as const

export type InfrastructureAccessStatus =
  (typeof infrastructureAccessStatuses)[number]

export type InfrastructureGrantView = {
  id?: string
  requestedByUserId: string
  status: string
  expiresAt: Date
  revokedAt: Date | null
}

export type InfrastructureAccessCode =
  | "allowed"
  | "unchanged"
  | "not_platform_admin"
  | "not_infrastructure"
  | "denied"
  | "expired"

export function canManageInfrastructureAccess(
  platformRole: string | null | undefined
) {
  return platformRole === "owner" || platformRole === "admin"
}

export function resolveInfrastructureAccessMinutes(
  minutes?: number | null
): { ok: true; minutes: number } | { ok: false; message: string } {
  if (minutes == null) {
    return { ok: true, minutes: INFRASTRUCTURE_ACCESS_DEFAULT_MINUTES }
  }
  if (
    !Number.isInteger(minutes) ||
    minutes < 1 ||
    minutes > INFRASTRUCTURE_ACCESS_MAX_MINUTES
  ) {
    return { ok: false, message: "Choose a duration up to 2 hours." }
  }
  return { ok: true, minutes }
}

export function infrastructureAccessExpiresAt(now: Date, minutes: number) {
  return new Date(now.getTime() + minutes * 60 * 1000)
}

/** Live only while status is active, it was not revoked, and the clock has not passed `expiresAt`. */
export function infrastructureGrantIsLive(
  grant: Pick<InfrastructureGrantView, "status" | "expiresAt" | "revokedAt">,
  now: Date
) {
  if (grant.status !== "active") return false
  if (grant.revokedAt) return false
  return grant.expiresAt.getTime() > now.getTime()
}

export function liveInfrastructureGrant(
  grants: readonly InfrastructureGrantView[],
  actorId: string,
  now: Date
) {
  let match: InfrastructureGrantView | null = null
  for (const grant of grants) {
    if (grant.requestedByUserId !== actorId) continue
    if (!infrastructureGrantIsLive(grant, now)) continue
    if (!match || grant.expiresAt.getTime() > match.expiresAt.getTime()) {
      match = grant
    }
  }
  return match
}

export function decideInfrastructureAccess(input: {
  action: "classify" | "request" | "connect"
  platformRole: string | null | undefined
  infrastructure: boolean
  actorId?: string
  grants?: readonly InfrastructureGrantView[]
  now: Date
}): {
  allowed: boolean
  code: InfrastructureAccessCode
  grantId: string | null
} {
  const platformAdmin = canManageInfrastructureAccess(input.platformRole)

  if (input.action === "classify") {
    return platformAdmin
      ? { allowed: true, code: "allowed", grantId: null }
      : { allowed: false, code: "not_platform_admin", grantId: null }
  }

  if (input.action === "request") {
    if (!platformAdmin) {
      return { allowed: false, code: "not_platform_admin", grantId: null }
    }
    if (!input.infrastructure) {
      return { allowed: false, code: "not_infrastructure", grantId: null }
    }
    return { allowed: true, code: "allowed", grantId: null }
  }

  if (!input.infrastructure) {
    return { allowed: true, code: "unchanged", grantId: null }
  }
  if (!platformAdmin) {
    return { allowed: false, code: "not_platform_admin", grantId: null }
  }

  const actorId = input.actorId ?? ""
  const grants = input.grants ?? []
  const live = liveInfrastructureGrant(grants, actorId, input.now)
  if (live) {
    return { allowed: true, code: "allowed", grantId: live.id ?? null }
  }

  const hadGrant = grants.some((grant) => grant.requestedByUserId === actorId)
  return {
    allowed: false,
    code: hadGrant ? "expired" : "denied",
    grantId: null,
  }
}

export function infrastructureAccessDeniedMessage(
  code: InfrastructureAccessCode
) {
  switch (code) {
    case "not_platform_admin":
      return "Only a platform administrator can do this."
    case "not_infrastructure":
      return "This device is not marked as infrastructure."
    default:
      return "Request access before connecting. Access is closed."
  }
}

export type InfrastructureForwardDevice = {
  organizationId: string
  vpnIpv4: string
  infrastructure: boolean
  reachable: boolean
}

export type InfrastructureForwardGrant = InfrastructureGrantView & {
  organizationId: string
  vpnIpv4: string
}

/**
 * Destinations an administrator may reach. Ordinary devices stay as they are.
 * An infrastructure device is included only for the person who holds a live
 * grant.
 */
export function adminForwardDeviceIps(input: {
  devices: readonly InfrastructureForwardDevice[]
  grants: readonly InfrastructureForwardGrant[]
  adminUserId: string
  organizationId: string
  now: Date
}) {
  const destinations: string[] = []
  for (const device of input.devices) {
    if (device.organizationId !== input.organizationId) continue
    if (!device.reachable) continue
    if (!device.infrastructure) {
      destinations.push(device.vpnIpv4)
      continue
    }
    const live = input.grants.some(
      (grant) =>
        grant.organizationId === input.organizationId &&
        grant.vpnIpv4 === device.vpnIpv4 &&
        grant.requestedByUserId === input.adminUserId &&
        infrastructureGrantIsLive(grant, input.now)
    )
    if (live) destinations.push(device.vpnIpv4)
  }
  return destinations
}

/** Open sessions on infrastructure devices end once the grant is no longer live. */
export function infrastructureSessionNeedsClose(input: {
  infrastructure: boolean
  adminUserId: string
  deviceId: string
  grants: readonly (InfrastructureGrantView & { deviceId: string })[]
  now: Date
}) {
  if (!input.infrastructure) return false
  return !input.grants.some(
    (grant) =>
      grant.deviceId === input.deviceId &&
      grant.requestedByUserId === input.adminUserId &&
      infrastructureGrantIsLive(grant, input.now)
  )
}
