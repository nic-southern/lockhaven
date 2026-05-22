import type { IncomingMessage } from "node:http"

import {
  eq,
  organizationMemberships,
  siteMemberships,
  sites,
  user,
} from "@nms/db"
import { db } from "@nms/db/client"

import {
  auth,
  type ActorPrincipal,
  permissionsForOrganizationRole,
  permissionsForRole,
  permissionsForSiteRole,
} from "./index"

export async function resolveAdminPrincipalFromRequest(
  req: IncomingMessage
): Promise<ActorPrincipal | null> {
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") {
      headers[key] = value
    } else if (Array.isArray(value) && value.length > 0) {
      headers[key] = value[0]
    }
  }

  const session = await auth.api.getSession({
    headers: new Headers(headers),
  })

  if (!session?.user.email) {
    return null
  }

  return resolveAdminPrincipalByEmail(session.user.email)
}

export async function resolveAdminPrincipalByEmail(
  email: string
): Promise<ActorPrincipal | null> {
  const [record] = await db
    .select()
    .from(user)
    .where(eq(user.email, email.toLowerCase()))

  if (!record || record.status !== "active") {
    return null
  }

  const [organizationMembershipRows, siteMembershipRows] = await Promise.all([
    db
      .select()
      .from(organizationMemberships)
      .where(eq(organizationMemberships.userId, record.id)),
    db
      .select({
        id: siteMemberships.id,
        siteId: siteMemberships.siteId,
        organizationId: sites.organizationId,
        userId: siteMemberships.userId,
        role: siteMemberships.role,
        status: siteMemberships.status,
        createdByUserId: siteMemberships.createdByUserId,
        createdAt: siteMemberships.createdAt,
        updatedAt: siteMemberships.updatedAt,
      })
      .from(siteMemberships)
      .innerJoin(sites, eq(sites.id, siteMemberships.siteId))
      .where(eq(siteMemberships.userId, record.id)),
  ])

  const platformPermissions = permissionsForRole(record.role)
  const effectivePermissions = new Set(platformPermissions)

  for (const membership of organizationMembershipRows) {
    if (membership.status !== "active") {
      continue
    }

    for (const permission of permissionsForOrganizationRole(membership.role)) {
      effectivePermissions.add(permission)
    }
  }

  for (const membership of siteMembershipRows) {
    if (membership.status !== "active") {
      continue
    }

    for (const permission of permissionsForSiteRole(membership.role)) {
      effectivePermissions.add(permission)
    }
  }

  return {
    id: record.id,
    email: record.email,
    name: record.name,
    platformRole: record.role,
    platformPermissions,
    permissions: [...effectivePermissions],
    organizationMemberships: organizationMembershipRows,
    siteMemberships: siteMembershipRows,
  }
}
