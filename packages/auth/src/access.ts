import type { Permission } from "@nms/shared"

export type PlatformRole = "owner" | "admin"
export type OrganizationRole = "owner" | "admin" | "operator" | "viewer"
export type SiteRole = "operator" | "viewer"
export type MembershipStatus = "active" | "suspended"

export type OrganizationMembership = {
  id: string
  organizationId: string
  role: OrganizationRole
  status: MembershipStatus
}

export type SiteMembership = {
  id: string
  siteId: string
  organizationId: string
  role: SiteRole
  status: MembershipStatus
}

export type ActorPrincipal = {
  id: string
  email: string
  name: string | null
  platformRole: PlatformRole
  platformPermissions: Permission[]
  permissions: Permission[]
  organizationMemberships: OrganizationMembership[]
  siteMemberships: SiteMembership[]
}

export type AdminPrincipal = ActorPrincipal

export type AuthorizationResource =
  | { kind: "platform" }
  | { kind: "organization"; organizationId: string }
  | { kind: "site"; organizationId: string; siteId: string }
  | { kind: "device"; organizationId: string; siteId: string | null }
  | {
      kind: "service"
      organizationId: string
      siteId: string | null
      deviceId: string
      serviceId: string
      serviceType: string
    }
  | {
      kind: "routePolicy"
      organizationId: string | null
    }
  | {
      kind: "enrollmentToken"
      organizationId: string
      siteId: string | null
    }
  | {
      kind: "audit"
      organizationId: string | null
      deviceId: string | null
    }
  | { kind: "userManagement"; organizationId: string }

export type AuthorizationDecision =
  | { allowed: true; reason: string }
  | { allowed: false; reason: string }

const platformOwnerPermissions: Permission[] = [
  "device:view",
  "device:create",
  "device:update",
  "device:enroll",
  "device:revoke_vpn",
  "device:start_vnc",
  "device:start_rdp",
  "device:start_ssh",
  "organization:admin",
  "site:admin",
  "audit:view",
  "vpn:admin_profile",
]

const platformAdminPermissions: Permission[] = [
  "device:view",
  "device:create",
  "device:update",
  "device:enroll",
  "device:revoke_vpn",
  "device:start_vnc",
  "device:start_rdp",
  "device:start_ssh",
  "organization:admin",
  "site:admin",
  "audit:view",
  "vpn:admin_profile",
]

const organizationRolePermissions: Record<OrganizationRole, Permission[]> = {
  owner: [
    "device:view",
    "device:create",
    "device:update",
    "device:enroll",
    "device:revoke_vpn",
    "device:start_vnc",
    "device:start_rdp",
    "device:start_ssh",
    "organization:admin",
    "site:admin",
    "audit:view",
    "vpn:admin_profile",
  ],
  admin: [
    "device:view",
    "device:create",
    "device:update",
    "device:enroll",
    "device:revoke_vpn",
    "device:start_vnc",
    "device:start_rdp",
    "device:start_ssh",
    "organization:admin",
    "site:admin",
    "audit:view",
  ],
  operator: [
    "device:view",
    "device:update",
    "device:revoke_vpn",
    "device:start_vnc",
    "device:start_rdp",
    "device:start_ssh",
    "audit:view",
  ],
  viewer: ["device:view", "audit:view"],
}

const siteRolePermissions: Record<SiteRole, Permission[]> = {
  operator: [
    "device:view",
    "device:update",
    "device:revoke_vpn",
    "device:start_vnc",
    "device:start_rdp",
    "device:start_ssh",
    "audit:view",
  ],
  viewer: ["device:view", "audit:view"],
}

export function permissionsForRole(role: PlatformRole): Permission[] {
  return role === "owner" ? platformOwnerPermissions : platformAdminPermissions
}

export function permissionsForOrganizationRole(
  role: OrganizationRole
): Permission[] {
  return organizationRolePermissions[role]
}

export function permissionsForSiteRole(role: SiteRole): Permission[] {
  return siteRolePermissions[role]
}

export function hasPermission(
  permissions: Permission[],
  required: Permission
): boolean {
  return permissions.includes(required)
}

export function organizationMembershipFor(
  actor: ActorPrincipal,
  organizationId: string
) {
  return actor.organizationMemberships.find(
    (membership) =>
      membership.organizationId === organizationId &&
      membership.status === "active"
  )
}

export function siteMembershipFor(actor: ActorPrincipal, siteId: string) {
  return actor.siteMemberships.find(
    (membership) =>
      membership.siteId === siteId && membership.status === "active"
  )
}

export function actorOrganizations(actor: ActorPrincipal) {
  return actor.organizationMemberships
    .filter((membership) => membership.status === "active")
    .map((membership) => membership.organizationId)
}

export function actorSites(actor: ActorPrincipal) {
  return actor.siteMemberships
    .filter((membership) => membership.status === "active")
    .map((membership) => membership.siteId)
}

function allowsPlatformAccess(
  actor: ActorPrincipal,
  permission: Permission
): boolean {
  return hasPermission(actor.platformPermissions, permission)
}

function allowsOrganizationRole(
  membershipRole: OrganizationRole,
  permission: Permission
): boolean {
  return organizationRolePermissions[membershipRole].includes(permission)
}

function allowsSiteRole(siteRole: SiteRole, permission: Permission): boolean {
  return siteRolePermissions[siteRole].includes(permission)
}

function resourceScopeReason(kind: string, scope: string) {
  return `${kind}:${scope}`
}

export function authorize(
  actor: ActorPrincipal,
  permission: Permission,
  resource: AuthorizationResource
): AuthorizationDecision {
  if (actor.platformRole === "owner") {
    return { allowed: true, reason: "platform_owner" }
  }

  if (
    actor.platformRole === "admin" &&
    allowsPlatformAccess(actor, permission)
  ) {
    return { allowed: true, reason: "platform_admin" }
  }

  switch (resource.kind) {
    case "platform":
      return {
        allowed: allowsPlatformAccess(actor, permission),
        reason: "platform",
      }

    case "organization": {
      const membership = organizationMembershipFor(
        actor,
        resource.organizationId
      )

      if (membership && allowsOrganizationRole(membership.role, permission)) {
        return {
          allowed: true,
          reason: resourceScopeReason("organization", membership.role),
        }
      }

      return {
        allowed: false,
        reason: "organization_scope",
      }
    }

    case "site": {
      const organizationMembership = organizationMembershipFor(
        actor,
        resource.organizationId
      )
      if (
        organizationMembership &&
        allowsOrganizationRole(organizationMembership.role, permission)
      ) {
        return {
          allowed: true,
          reason: resourceScopeReason(
            "organization",
            organizationMembership.role
          ),
        }
      }

      const siteMembership = siteMembershipFor(actor, resource.siteId)
      if (siteMembership && allowsSiteRole(siteMembership.role, permission)) {
        return {
          allowed: true,
          reason: resourceScopeReason("site", siteMembership.role),
        }
      }

      return {
        allowed: false,
        reason: "site_scope",
      }
    }

    case "device": {
      const siteMembership =
        resource.siteId !== null
          ? siteMembershipFor(actor, resource.siteId)
          : null
      if (siteMembership && allowsSiteRole(siteMembership.role, permission)) {
        return {
          allowed: true,
          reason: resourceScopeReason("site", siteMembership.role),
        }
      }

      const organizationMembership = organizationMembershipFor(
        actor,
        resource.organizationId
      )
      if (
        organizationMembership &&
        allowsOrganizationRole(organizationMembership.role, permission)
      ) {
        return {
          allowed: true,
          reason: resourceScopeReason(
            "organization",
            organizationMembership.role
          ),
        }
      }

      return {
        allowed: false,
        reason: "device_scope",
      }
    }

    case "service": {
      const deviceDecision = authorize(actor, permission, {
        kind: "device",
        organizationId: resource.organizationId,
        siteId: resource.siteId,
      })

      return deviceDecision.allowed
        ? {
            allowed: true,
            reason: resourceScopeReason("service", deviceDecision.reason),
          }
        : deviceDecision
    }

    case "enrollmentToken": {
      const organizationMembership = organizationMembershipFor(
        actor,
        resource.organizationId
      )

      if (
        organizationMembership &&
        allowsOrganizationRole(organizationMembership.role, permission)
      ) {
        return {
          allowed: true,
          reason: resourceScopeReason(
            "organization",
            organizationMembership.role
          ),
        }
      }

      return {
        allowed: false,
        reason: "enrollment_scope",
      }
    }

    case "routePolicy": {
      if (!resource.organizationId) {
        return {
          allowed: false,
          reason: "route_policy_scope",
        }
      }

      const organizationMembership = organizationMembershipFor(
        actor,
        resource.organizationId
      )

      if (
        organizationMembership &&
        allowsOrganizationRole(organizationMembership.role, permission)
      ) {
        return {
          allowed: true,
          reason: resourceScopeReason(
            "organization",
            organizationMembership.role
          ),
        }
      }

      return {
        allowed: false,
        reason: "route_policy_scope",
      }
    }

    case "audit": {
      if (resource.organizationId) {
        const organizationMembership = organizationMembershipFor(
          actor,
          resource.organizationId
        )

        if (
          organizationMembership &&
          allowsOrganizationRole(organizationMembership.role, permission)
        ) {
          return {
            allowed: true,
            reason: resourceScopeReason(
              "organization",
              organizationMembership.role
            ),
          }
        }
      }

      if (resource.deviceId) {
        const siteMembership = actor.siteMemberships.find(
          (membership) =>
            membership.status === "active" &&
            allowsSiteRole(membership.role, permission)
        )

        if (siteMembership) {
          return {
            allowed: true,
            reason: resourceScopeReason("site", siteMembership.role),
          }
        }
      }

      return {
        allowed: false,
        reason: "audit_scope",
      }
    }

    case "userManagement": {
      const organizationMembership = organizationMembershipFor(
        actor,
        resource.organizationId
      )

      if (
        organizationMembership &&
        allowsOrganizationRole(organizationMembership.role, permission)
      ) {
        return {
          allowed: true,
          reason: resourceScopeReason(
            "organization",
            organizationMembership.role
          ),
        }
      }

      return {
        allowed: false,
        reason: "user_management_scope",
      }
    }
  }
}
