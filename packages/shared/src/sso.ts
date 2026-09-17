import { z } from "zod"

import {
  organizationRoles,
  siteRoles,
  type OrganizationRole,
  type SiteRole,
} from "./domain"

export const ssoProtocols = ["oidc", "saml"] as const
export type SsoProtocol = (typeof ssoProtocols)[number]
export const ssoProtocolSchema = z.enum(ssoProtocols)

export const ssoRoleAssignmentSchema = z.object({
  organizationRole: z.enum(organizationRoles).optional(),
  siteRole: z.enum(siteRoles).optional(),
  siteId: z.string().uuid().optional(),
})
export type SsoRoleAssignmentInput = z.infer<typeof ssoRoleAssignmentSchema>

export const ssoClaimsMapSchema = z.object({
  claim: z.string().trim().min(1).default("groups"),
  values: z.record(z.string(), ssoRoleAssignmentSchema).default({}),
})
export type SsoClaimsMap = z.infer<typeof ssoClaimsMapSchema>

export const DEFAULT_SSO_ORGANIZATION_ROLE: OrganizationRole = "technician"

export const PLATFORM_SSO_PROVIDER_ID_DEFAULT = "lockhaven"
export const PLATFORM_SSO_ISSUER_DEFAULT =
  "https://auth.newmarketsecurity.com/realms/nms"
export const PLATFORM_SSO_DISCOVERY_PATH = "/.well-known/openid-configuration"
export const PLATFORM_SSO_CLIENT_ID_DEFAULT = "lockhaven"

const ORGANIZATION_ROLE_RANK: Record<OrganizationRole, number> = {
  owner: 50,
  admin: 40,
  operator: 30,
  technician: 20,
  viewer: 10,
}

export function emailDomain(email: string): string | null {
  const trimmed = email.trim().toLowerCase()
  const at = trimmed.lastIndexOf("@")
  if (at <= 0 || at === trimmed.length - 1) {
    return null
  }
  return normalizeDomain(trimmed.slice(at + 1))
}

export function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^\.+/, "").replace(/\.+$/, "")
}

export function parseDomainList(value: string | string[] | null | undefined) {
  const parts = Array.isArray(value)
    ? value
    : (value ?? "")
        .split(/[,\s]+/)
        .map((part) => part.trim())
        .filter(Boolean)
  const unique = new Set<string>()
  for (const part of parts) {
    const domain = normalizeDomain(part)
    if (domain) {
      unique.add(domain)
    }
  }
  return [...unique]
}

export function isEmailDomainAllowed(
  email: string,
  allowedDomains: string[]
): boolean {
  if (allowedDomains.length === 0) {
    return false
  }
  const domain = emailDomain(email)
  if (!domain) {
    return false
  }
  return allowedDomains.some((allowed) => normalizeDomain(allowed) === domain)
}

export function parseSsoClaimsMap(value: unknown): SsoClaimsMap {
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) {
      return ssoClaimsMapSchema.parse({})
    }
    try {
      return ssoClaimsMapSchema.parse(JSON.parse(trimmed))
    } catch {
      return ssoClaimsMapSchema.parse({})
    }
  }
  return ssoClaimsMapSchema.parse(value ?? {})
}

export function claimValues(
  claims: Record<string, unknown>,
  path: string
): string[] {
  const segments = path.split(".").filter(Boolean)
  let current: unknown = claims
  for (const segment of segments) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return []
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return asStringList(current)
}

function asStringList(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) {
    return [value.trim()]
  }
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean)
  }
  return []
}

export function mapClaimsToRoles(input: {
  claims: Record<string, unknown>
  claimsMap: SsoClaimsMap
  defaultOrganizationRole?: OrganizationRole
}): {
  organizationRole: OrganizationRole
  siteGrants: Array<{ siteId: string; role: SiteRole }>
  matchedValues: string[]
} {
  const defaultRole =
    input.defaultOrganizationRole ?? DEFAULT_SSO_ORGANIZATION_ROLE
  const values = claimValues(input.claims, input.claimsMap.claim)
  const matchedValues: string[] = []
  let organizationRole: OrganizationRole | null = null
  const siteGrants = new Map<string, SiteRole>()

  for (const value of values) {
    const assignment = input.claimsMap.values[value]
    if (!assignment) {
      continue
    }
    matchedValues.push(value)
    if (assignment.organizationRole) {
      if (
        !organizationRole ||
        ORGANIZATION_ROLE_RANK[assignment.organizationRole] >
          ORGANIZATION_ROLE_RANK[organizationRole]
      ) {
        organizationRole = assignment.organizationRole
      }
    }
    if (assignment.siteId && assignment.siteRole) {
      const existing = siteGrants.get(assignment.siteId)
      if (
        !existing ||
        ORGANIZATION_ROLE_RANK[assignment.siteRole] >
          ORGANIZATION_ROLE_RANK[existing]
      ) {
        siteGrants.set(assignment.siteId, assignment.siteRole)
      }
    }
  }

  return {
    organizationRole: organizationRole ?? defaultRole,
    siteGrants: [...siteGrants.entries()].map(([siteId, role]) => ({
      siteId,
      role,
    })),
    matchedValues,
  }
}

export type SsoLinkDecision =
  | { action: "jit" }
  | { action: "link"; userId: string }
  | { action: "reject"; reason: "unverified_email" | "inactive" | "domain" }

export function decideSsoUserLink(input: {
  email: string
  emailVerified: boolean
  allowedDomains: string[]
  existing: {
    id: string
    emailVerified: boolean
    status: string
    disabledAt?: Date | null
  } | null
}): SsoLinkDecision {
  const domainAllowed =
    input.allowedDomains.length === 0
      ? Boolean(input.existing)
      : isEmailDomainAllowed(input.email, input.allowedDomains)
  if (!domainAllowed) {
    return { action: "reject", reason: "domain" }
  }

  if (!input.existing) {
    if (!input.emailVerified) {
      return { action: "reject", reason: "unverified_email" }
    }
    return { action: "jit" }
  }

  if (input.existing.status !== "active" || input.existing.disabledAt) {
    return { action: "reject", reason: "inactive" }
  }

  if (!input.existing.emailVerified && !input.emailVerified) {
    return { action: "reject", reason: "unverified_email" }
  }

  return { action: "link", userId: input.existing.id }
}

export type LocalSignInBlock =
  | { blocked: false }
  | {
      blocked: true
      reason: "sso_required" | "idp_unavailable"
    }

export function localSignInBlock(input: {
  ssoRequired: boolean
  idpAvailable: boolean | null
}): LocalSignInBlock {
  if (!input.ssoRequired) {
    return { blocked: false }
  }
  if (input.idpAvailable === false) {
    return { blocked: true, reason: "idp_unavailable" }
  }
  return { blocked: true, reason: "sso_required" }
}

/** Password and passkeys stay available until this identity must use SSO. */
export function resolveLegacySignInBlock(input: {
  platformRequired: boolean
  matchedPolicyRequired?: boolean
  idpAvailable: boolean | null
}): LocalSignInBlock {
  return localSignInBlock({
    ssoRequired: input.platformRequired || Boolean(input.matchedPolicyRequired),
    idpAvailable: input.idpAvailable,
  })
}

export function discoveryUrlForIssuer(issuer: string) {
  return `${issuer.replace(/\/+$/, "")}${PLATFORM_SSO_DISCOVERY_PATH}`
}

export function oidcIssuerFromDiscoveryUrl(discoveryUrl: string) {
  return discoveryUrl.replace(/\/\.well-known\/openid-configuration\/?$/, "")
}
