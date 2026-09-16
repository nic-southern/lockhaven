import type {
  MembershipStatus,
  OrganizationRole,
  Permission,
  PlatformRole,
  SiteRole,
  UiScope,
} from "@nms/shared"

export type { MembershipStatus, OrganizationRole, PlatformRole, SiteRole }

export type OrganizationMembership = {
  id: string
  organizationId: string
  role: OrganizationRole
  status: MembershipStatus
}

export type SiteMembership = {
  id: string
  siteId: string
  siteName?: string
  organizationId: string
  role: SiteRole
  status: MembershipStatus
}

export type ActorSecurityState = {
  twoFactorEnabled: boolean
  mustChangePassword: boolean
  passkeyCount: number
  lastLoginAt: Date | null
  ssoMfaTrusted: boolean
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
  security?: ActorSecurityState
  uiScope?: UiScope
  /** Present when this actor was resolved from a bearer API key. */
  apiKeyId?: string
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

const fullAccessPermissions: Permission[] = [
  "device:view",
  "device:create",
  "device:update",
  "device:delete",
  "device:enroll",
  "device:revoke_vpn",
  "device:start_vnc",
  "device:start_rdp",
  "device:start_ssh",
  "credential:reveal",
  "organization:admin",
  "site:admin",
  "user:manage",
  "audit:view",
  "vpn:admin_profile",
]

const platformOwnerPermissions: Permission[] = [...fullAccessPermissions]

const platformAdminPermissions: Permission[] = [...fullAccessPermissions]

// Members hold no platform-wide permissions; everything comes from memberships.
const platformMemberPermissions: Permission[] = []

const technicianPermissions: Permission[] = [
  "device:view",
  "device:update",
  "device:start_vnc",
  "device:start_rdp",
  "device:start_ssh",
  "audit:view",
]

const operatorPermissions: Permission[] = [
  "device:view",
  "device:update",
  "device:revoke_vpn",
  "device:start_vnc",
  "device:start_rdp",
  "device:start_ssh",
  "credential:reveal",
  "audit:view",
]

const viewerPermissions: Permission[] = ["device:view", "audit:view"]

const organizationRolePermissions: Record<OrganizationRole, Permission[]> = {
  owner: [...fullAccessPermissions],
  admin: [
    "device:view",
    "device:create",
    "device:update",
    "device:delete",
    "device:enroll",
    "device:revoke_vpn",
    "device:start_vnc",
    "device:start_rdp",
    "device:start_ssh",
    "credential:reveal",
    "organization:admin",
    "site:admin",
    "user:manage",
    "audit:view",
  ],
  operator: [...operatorPermissions],
  technician: [...technicianPermissions],
  viewer: [...viewerPermissions],
}

const siteRolePermissions: Record<SiteRole, Permission[]> = {
  operator: [...operatorPermissions],
  technician: [...technicianPermissions],
  viewer: [...viewerPermissions],
}

const platformRolePermissions: Record<PlatformRole, Permission[]> = {
  owner: platformOwnerPermissions,
  admin: platformAdminPermissions,
  member: platformMemberPermissions,
}

export function permissionsForRole(role: PlatformRole): Permission[] {
  return platformRolePermissions[role] ?? platformMemberPermissions
}

/**
 * Platform owners and admins see every organization; members are scoped to
 * their memberships.
 */
export function hasPlatformWideAccess(actor: ActorPrincipal): boolean {
  return actor.platformRole === "owner" || actor.platformRole === "admin"
}

/**
 * Decides which console experience a user should get. Anyone with a
 * management-level permission anywhere gets the full admin shell; users whose
 * only grants are technician or viewer roles get the simplified scoped shell.
 */
export function uiScopeFor(actor: ActorPrincipal): UiScope {
  if (hasPlatformWideAccess(actor)) {
    return "admin"
  }

  const managementPermissions: Permission[] = [
    "organization:admin",
    "site:admin",
    "user:manage",
    "device:enroll",
    "device:create",
    "device:delete",
    "vpn:admin_profile",
  ]

  return managementPermissions.some((permission) =>
    actor.permissions.includes(permission)
  )
    ? "admin"
    : "technician"
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

/** Permissions that appear in both lists, preserving grant order. */
export function intersectPermissions(
  ownerPermissions: Permission[],
  grants: Permission[]
): Permission[] {
  const allowed = new Set(ownerPermissions)
  const seen = new Set<Permission>()
  const result: Permission[] = []
  for (const permission of grants) {
    if (!allowed.has(permission) || seen.has(permission)) {
      continue
    }
    seen.add(permission)
    result.push(permission)
  }
  return result
}

export type ApiKeyGrant = {
  id: string
  organizationId: string | null
  permissions: Permission[]
}

/**
 * Builds the actor used for bearer API key requests. Effective permissions are
 * the intersection of the key's grants and the owner's permissions. Org-scoped
 * keys never inherit platform-wide access.
 */
export function actorForApiKey(
  owner: ActorPrincipal,
  key: ApiKeyGrant
): ActorPrincipal {
  const permissions = intersectPermissions(owner.permissions, key.permissions)
  const platformPermissions = intersectPermissions(
    owner.platformPermissions,
    key.permissions
  )

  if (key.organizationId) {
    const existing = owner.organizationMemberships.filter(
      (membership) =>
        membership.organizationId === key.organizationId &&
        membership.status === "active"
    )
    const organizationMemberships =
      existing.length > 0
        ? existing
        : hasPlatformWideAccess(owner)
          ? [
              {
                id: `api-key:${key.id}`,
                organizationId: key.organizationId,
                role: "owner" as const,
                status: "active" as const,
              },
            ]
          : []
    const siteMemberships = owner.siteMemberships.filter(
      (membership) => membership.organizationId === key.organizationId
    )
    const principal: ActorPrincipal = {
      id: owner.id,
      email: owner.email,
      name: owner.name,
      platformRole: "member",
      platformPermissions: [],
      permissions,
      organizationMemberships,
      siteMemberships,
      apiKeyId: key.id,
    }
    principal.uiScope = uiScopeFor(principal)
    return principal
  }

  const principal: ActorPrincipal = {
    ...owner,
    platformPermissions,
    permissions,
    apiKeyId: key.id,
    security: undefined,
  }
  principal.uiScope = uiScopeFor(principal)
  return principal
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
  if (actor.apiKeyId && !hasPermission(actor.permissions, permission)) {
    return { allowed: false, reason: "api_key_grant" }
  }

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
