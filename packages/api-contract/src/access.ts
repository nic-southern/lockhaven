import { TRPCError } from "@trpc/server"

import { authorize, type ActorPrincipal, type AuthorizationResource } from "@nms/auth"
import type { Permission } from "@nms/shared"

export function assertAuthorized(
  actor: ActorPrincipal | null,
  permission: Permission,
  resource: AuthorizationResource
) {
  if (!actor) {
    throw new TRPCError({ code: "UNAUTHORIZED" })
  }

  const decision = authorize(actor, permission, resource)

  if (!decision.allowed) {
    throw new TRPCError({ code: "FORBIDDEN" })
  }

  return decision
}

export function actorOrganizationIds(actor: ActorPrincipal | null) {
  if (!actor) {
    return []
  }

  if (actor.platformRole === "owner" || actor.platformRole === "admin") {
    return null
  }

  return actor.organizationMemberships
    .filter((membership) => membership.status === "active")
    .map((membership) => membership.organizationId)
}

export function actorSiteIds(actor: ActorPrincipal | null) {
  if (!actor) {
    return []
  }

  if (actor.platformRole === "owner" || actor.platformRole === "admin") {
    return null
  }

  const siteIds = new Set(
    actor.siteMemberships
      .filter((membership) => membership.status === "active")
      .map((membership) => membership.siteId)
  )

  for (const membership of actor.organizationMemberships) {
    if (membership.status !== "active") continue
    if (membership.organizationId) {
      // Organization membership grants access to all sites under that org.
      // The router resolves that scope when it joins sites back to organizations.
      continue
    }
  }

  return [...siteIds]
}

export function isPlatformOwner(actor: ActorPrincipal | null) {
  return actor?.platformRole === "owner"
}
