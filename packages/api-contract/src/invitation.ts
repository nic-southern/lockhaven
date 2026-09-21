import { z } from "zod"

import {
  siteGrantSchema,
  type OrganizationRole,
  type SiteGrant,
} from "@nms/shared"

export type InvitationLifetime = {
  acceptedAt: Date | null
  revokedAt: Date | null
  expiresAt: Date
}

/** An invite can be accepted only while it is unused, unrevoked, and unexpired. */
export function isInvitationOpen<T extends InvitationLifetime>(
  invitation: T | null | undefined,
  now: Date
): invitation is T {
  if (!invitation) return false
  if (invitation.acceptedAt || invitation.revokedAt) return false
  return invitation.expiresAt.getTime() >= now.getTime()
}

/**
 * Resending an invite replaces a pending one only when the actor manages that
 * invite's organization. Platform-wide actors (`null`) may replace any of them.
 * Other organizations' invites, including platform invites, stay in place.
 */
export function canSupersedeInvitation(
  manageableOrganizationIds: string[] | null,
  invitation: { organizationId: string | null }
) {
  if (manageableOrganizationIds === null) return true
  if (!invitation.organizationId) return false
  return manageableOrganizationIds.includes(invitation.organizationId)
}

/** Org admins can invite members, but only an owner can hand out the owner role. */
export function canGrantOrganizationRole(input: {
  platformWide: boolean
  actorRole: OrganizationRole | null
  role: OrganizationRole | null
}) {
  if (input.role !== "owner") return true
  if (input.platformWide) return true
  return input.actorRole === "owner"
}

export function normalizeInvitationSiteGrants(
  value: unknown
): SiteGrant[] | null {
  const parsed = z.array(siteGrantSchema).safeParse(value)
  if (!parsed.success) return null
  const seen = new Set<string>()
  for (const grant of parsed.data) {
    if (seen.has(grant.siteId)) return null
    seen.add(grant.siteId)
  }
  return parsed.data
}

export function siteGrantsBelongToOrganization(
  matchedSites: { id: string; organizationId: string }[],
  grants: { siteId: string }[],
  organizationId: string | null
) {
  if (grants.length === 0) return true
  if (!organizationId) return false
  if (matchedSites.length !== grants.length) return false
  const expected = new Set(grants.map((grant) => grant.siteId))
  return matchedSites.every(
    (site) => expected.has(site.id) && site.organizationId === organizationId
  )
}

type DbErrorFields = {
  code?: unknown
  constraint?: unknown
  table?: unknown
  message?: unknown
  cause?: unknown
}

function collectDbErrors(error: unknown, seen: Set<unknown>): DbErrorFields[] {
  if (!error || typeof error !== "object" || seen.has(error)) return []
  seen.add(error)
  const fields = error as DbErrorFields
  return [fields, ...collectDbErrors(fields.cause, seen)]
}

/** Maps only the account email uniqueness failure, not other constraint errors. */
export function isUserEmailConflict(error: unknown) {
  return collectDbErrors(error, new Set()).some((fields) => {
    if (fields.code !== "23505") return false
    const constraint =
      typeof fields.constraint === "string" ? fields.constraint : ""
    const table = typeof fields.table === "string" ? fields.table : ""
    const message = typeof fields.message === "string" ? fields.message : ""
    return (
      constraint === "user_email_unique" ||
      message.includes("user_email_unique") ||
      (table === "user" && message.toLowerCase().includes("email"))
    )
  })
}
