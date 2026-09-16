import { TRPCError } from "@trpc/server"

import {
  authorize,
  hasPlatformWideAccess,
  type ActorPrincipal,
  type AuthorizationResource,
} from "@nms/auth"
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

export function requireActor(actor: ActorPrincipal | null): ActorPrincipal {
  if (!actor) {
    throw new TRPCError({ code: "UNAUTHORIZED" })
  }
  return actor
}

/**
 * Organization ids the actor may see. `null` means unrestricted (platform
 * owner/admin); an empty array means no organization access at all.
 */
export function actorOrganizationIds(actor: ActorPrincipal | null) {
  if (!actor) {
    return []
  }

  if (hasPlatformWideAccess(actor)) {
    return null
  }

  return actor.organizationMemberships
    .filter((membership) => membership.status === "active")
    .map((membership) => membership.organizationId)
}

/**
 * Site ids granted directly through site memberships. Organization-level
 * memberships implicitly cover every site in that organization and are
 * resolved by callers through `actorOrganizationIds`.
 */
export function actorSiteIds(actor: ActorPrincipal | null) {
  if (!actor) {
    return []
  }

  if (hasPlatformWideAccess(actor)) {
    return null
  }

  return [
    ...new Set(
      actor.siteMemberships
        .filter((membership) => membership.status === "active")
        .map((membership) => membership.siteId)
    ),
  ]
}

export function isPlatformOwner(actor: ActorPrincipal | null) {
  return actor?.platformRole === "owner"
}

/**
 * Organizations where the actor can manage users: all of them for platform
 * owners/admins (`null`), otherwise organizations where they hold an
 * owner/admin membership.
 */
export function manageableOrganizationIds(actor: ActorPrincipal | null) {
  if (!actor) {
    return []
  }

  if (hasPlatformWideAccess(actor)) {
    return null
  }

  return actor.organizationMemberships
    .filter(
      (membership) =>
        membership.status === "active" &&
        (membership.role === "owner" || membership.role === "admin")
    )
    .map((membership) => membership.organizationId)
}
