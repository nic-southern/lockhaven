import type { IncomingMessage } from "node:http"

import { count } from "drizzle-orm"

import {
  apiKeys,
  eq,
  organizationMemberships,
  passkey,
  siteMemberships,
  sites,
  user,
} from "@nms/db"
import { db } from "@nms/db/client"

import {
  actorForApiKey,
  apiKeyAccessState,
  apiKeyLookupPrefix,
  auth,
  isApiKeySecretFormat,
  type ActorPrincipal,
  permissionsForOrganizationRole,
  permissionsForRole,
  permissionsForSiteRole,
  uiScopeFor,
  verifyApiKeySecret,
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

  if (!record || record.status !== "active" || record.disabledAt) {
    return null
  }

  const [organizationMembershipRows, siteMembershipRows, [passkeyCountRow]] =
    await Promise.all([
      db
        .select()
        .from(organizationMemberships)
        .where(eq(organizationMemberships.userId, record.id)),
      db
        .select({
          id: siteMemberships.id,
          siteId: siteMemberships.siteId,
          siteName: sites.name,
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
      db
        .select({ total: count() })
        .from(passkey)
        .where(eq(passkey.userId, record.id)),
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

  const principal: ActorPrincipal = {
    id: record.id,
    email: record.email,
    name: record.name,
    platformRole: record.role,
    platformPermissions,
    permissions: [...effectivePermissions],
    organizationMemberships: organizationMembershipRows,
    siteMemberships: siteMembershipRows,
    security: {
      twoFactorEnabled: record.twoFactorEnabled,
      mustChangePassword: record.mustChangePassword,
      passkeyCount: Number(passkeyCountRow?.total ?? 0),
      lastLoginAt: record.lastLoginAt,
    },
    uiScope: "admin",
  }
  principal.uiScope = uiScopeFor(principal)

  return principal
}

const LAST_USED_TOUCH_MS = 60_000

export async function resolveAdminPrincipalById(
  userId: string
): Promise<ActorPrincipal | null> {
  const [record] = await db.select().from(user).where(eq(user.id, userId))
  if (!record?.email) {
    return null
  }
  return resolveAdminPrincipalByEmail(record.email)
}

/**
 * Resolves a bearer API key into an actor whose permissions are the intersection
 * of the key's grants and the owner's effective permissions.
 */
export async function resolveApiKeyPrincipal(
  secret: string
): Promise<ActorPrincipal | null> {
  if (!isApiKeySecretFormat(secret)) {
    return null
  }

  const prefix = apiKeyLookupPrefix(secret)
  const [record] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.prefix, prefix))

  if (!record) {
    return null
  }

  if (!verifyApiKeySecret(secret, record.secretHash)) {
    return null
  }

  if (apiKeyAccessState(record) !== "ok") {
    return null
  }

  const owner = await resolveAdminPrincipalById(record.createdByUserId)
  if (!owner) {
    return null
  }

  const actor = actorForApiKey(owner, {
    id: record.id,
    organizationId: record.organizationId,
    permissions: record.permissions,
  })

  const now = Date.now()
  const lastUsed = record.lastUsedAt?.getTime() ?? 0
  if (now - lastUsed >= LAST_USED_TOUCH_MS) {
    const touchedAt = new Date(now)
    void db
      .update(apiKeys)
      .set({ lastUsedAt: touchedAt, updatedAt: touchedAt })
      .where(eq(apiKeys.id, record.id))
      .catch(() => {
        // Auth still succeeds if the usage stamp cannot be written.
      })
  }

  return actor
}
