import { eq } from "drizzle-orm"

import {
  DEFAULT_SSO_ORGANIZATION_ROLE,
  decideSsoUserLink,
  discoveryUrlForIssuer,
  emailDomain,
  isEmailDomainAllowed,
  resolveLegacySignInBlock,
  mapClaimsToRoles,
  parseDomainList,
  parseSsoClaimsMap,
  PLATFORM_SSO_CLIENT_ID_DEFAULT,
  PLATFORM_SSO_ISSUER_DEFAULT,
  PLATFORM_SSO_PROVIDER_ID_DEFAULT,
  type OrganizationRole,
  type SsoClaimsMap,
  type SsoProtocol,
} from "@nms/shared"
import {
  account,
  organizationMemberships,
  organizationSsoSettings,
  siteMemberships,
  user,
} from "@nms/db"
import { db } from "@nms/db/client"

const IDP_PROBE_TIMEOUT_MS = 3_000
const IDP_PROBE_CACHE_MS = 30_000

export type PlatformSsoConfig = {
  enabled: boolean
  required: boolean
  providerId: string
  protocol: SsoProtocol
  issuer: string
  discoveryUrl: string
  clientId: string
  clientSecret: string
  authorizationUrl: string
  tokenUrl: string
  userInfoUrl: string
  allowedDomains: string[]
  claimsMap: SsoClaimsMap
  defaultOrganizationId: string | null
  defaultOrganizationRole: OrganizationRole
  trustIdpMfa: boolean
  saml: {
    enabled: boolean
    providerId: string
    entryPoint: string
    cert: string
    audience: string
    metadataXml: string
  }
}

let cachedConfig: PlatformSsoConfig | null = null
let idpProbe: { at: number; url: string; available: boolean } | null = null

function envValue(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key]
  return typeof value === "string" ? value.trim() : ""
}

function isPlaceholderSecret(value: string) {
  return !value || /^(replace_me|changeme|secret)$/i.test(value)
}

function issuerEndpoints(issuer: string) {
  const base = issuer.replace(/\/+$/, "")
  return {
    issuer: base,
    discoveryUrl: discoveryUrlForIssuer(base),
    authorizationUrl: `${base}/protocol/openid-connect/auth`,
    tokenUrl: `${base}/protocol/openid-connect/token`,
    userInfoUrl: `${base}/protocol/openid-connect/userinfo`,
  }
}

export function platformSsoConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): PlatformSsoConfig {
  const issuer = envValue(env, "SSO_OIDC_ISSUER") || PLATFORM_SSO_ISSUER_DEFAULT
  const endpoints = issuerEndpoints(issuer)
  const discoveryUrl =
    envValue(env, "SSO_OIDC_DISCOVERY_URL") || endpoints.discoveryUrl
  const clientId =
    envValue(env, "SSO_OIDC_CLIENT_ID") || PLATFORM_SSO_CLIENT_ID_DEFAULT
  const clientSecret = envValue(env, "SSO_OIDC_CLIENT_SECRET")
  const samlEntryPoint = envValue(env, "SSO_SAML_ENTRY_POINT")
  const samlCert = envValue(env, "SSO_SAML_CERT")
  const oidcReady = Boolean(clientId) && !isPlaceholderSecret(clientSecret)

  return {
    enabled: oidcReady,
    required: envValue(env, "SSO_REQUIRED").toLowerCase() === "true",
    providerId:
      envValue(env, "SSO_OIDC_PROVIDER_ID") || PLATFORM_SSO_PROVIDER_ID_DEFAULT,
    protocol: "oidc",
    issuer: endpoints.issuer,
    discoveryUrl,
    clientId,
    clientSecret,
    authorizationUrl:
      envValue(env, "SSO_OIDC_AUTHORIZATION_URL") || endpoints.authorizationUrl,
    tokenUrl: envValue(env, "SSO_OIDC_TOKEN_URL") || endpoints.tokenUrl,
    userInfoUrl:
      envValue(env, "SSO_OIDC_USERINFO_URL") || endpoints.userInfoUrl,
    allowedDomains: parseDomainList(envValue(env, "SSO_ALLOWED_DOMAINS")),
    claimsMap: parseSsoClaimsMap(envValue(env, "SSO_CLAIMS_MAP")),
    defaultOrganizationId: envValue(env, "SSO_DEFAULT_ORGANIZATION_ID") || null,
    defaultOrganizationRole: DEFAULT_SSO_ORGANIZATION_ROLE,
    trustIdpMfa: envValue(env, "SSO_TRUST_IDP_MFA").toLowerCase() === "true",
    saml: {
      enabled: Boolean(samlEntryPoint && samlCert),
      providerId: envValue(env, "SSO_SAML_PROVIDER_ID") || "sso-saml",
      entryPoint: samlEntryPoint,
      cert: samlCert,
      audience: envValue(env, "SSO_SAML_AUDIENCE"),
      metadataXml: envValue(env, "SSO_SAML_METADATA_XML"),
    },
  }
}

export function getPlatformSsoConfig() {
  cachedConfig ??= platformSsoConfigFromEnv()
  return cachedConfig
}

export function resetPlatformSsoConfigCache() {
  cachedConfig = null
  idpProbe = null
}

export type PlatformSignInTarget = {
  providerId: string | null
  signInMethod: "oauth2" | "sso" | null
  protocol: SsoProtocol | null
}

/** Company identity provider used when Sign in with SSO is clicked with no email. */
export function platformSignInTarget(
  platform: PlatformSsoConfig
): PlatformSignInTarget {
  if (platform.enabled) {
    return {
      providerId: platform.providerId,
      signInMethod: "oauth2",
      protocol: "oidc",
    }
  }
  if (platform.saml.enabled) {
    return {
      providerId: platform.saml.providerId,
      signInMethod: "sso",
      protocol: "saml",
    }
  }
  return { providerId: null, signInMethod: null, protocol: null }
}

type OrgSsoStartRow = {
  enabled: boolean
  protocol: SsoProtocol
  usePlatformIdp: boolean
  providerId: string | null
}

/**
 * Default Sign in with SSO target when the user has not typed an email.
 * Company OpenID wins. A single organization provider is used only when the
 * company provider is not ready.
 */
export function publicSsoStartTarget(
  platform: PlatformSsoConfig,
  rows: OrgSsoStartRow[] = []
): PlatformSignInTarget {
  const company = platformSignInTarget(platform)
  if (company.providerId) {
    return company
  }

  const enabled = rows.filter((row) => row.enabled)
  const dedicated = enabled.filter(
    (row) => !row.usePlatformIdp && Boolean(row.providerId)
  )
  if (dedicated.length === 1) {
    const row = dedicated[0]
    return {
      providerId: row.providerId,
      signInMethod: "sso",
      protocol: row.protocol,
    }
  }

  if (enabled.length > 0) {
    return {
      providerId: platform.providerId,
      signInMethod: "oauth2",
      protocol: "oidc",
    }
  }

  return company
}

export function decodeJwtPayload(
  token: string | null | undefined
): Record<string, unknown> | null {
  if (!token) {
    return null
  }
  const parts = token.split(".")
  if (parts.length < 2) {
    return null
  }
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8")
    const parsed: unknown = JSON.parse(json)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null
    }
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

export async function probeOidcDiscovery(
  discoveryUrl: string
): Promise<boolean> {
  const now = Date.now()
  if (
    idpProbe &&
    idpProbe.url === discoveryUrl &&
    now - idpProbe.at < IDP_PROBE_CACHE_MS
  ) {
    return idpProbe.available
  }

  try {
    const response = await fetch(discoveryUrl, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(IDP_PROBE_TIMEOUT_MS),
      headers: { accept: "application/json" },
    })
    const available = response.ok
    idpProbe = { at: now, url: discoveryUrl, available }
    return available
  } catch {
    idpProbe = { at: now, url: discoveryUrl, available: false }
    return false
  }
}

export type EffectiveSsoPolicy = {
  organizationId: string | null
  providerId: string
  protocol: SsoProtocol
  signInMethod: "oauth2" | "sso"
  required: boolean
  trustIdpMfa: boolean
  allowedDomains: string[]
  claimsMap: SsoClaimsMap
  defaultOrganizationRole: OrganizationRole
  usePlatformIdp: boolean
}

export async function loadOrgSsoSettings() {
  return db.select().from(organizationSsoSettings)
}

export function matchOrgSsoSettings(
  email: string,
  rows: Array<{
    organizationId: string
    enabled: boolean
    required: boolean
    protocol: SsoProtocol
    usePlatformIdp: boolean
    allowedDomains: string[]
    trustIdpMfa: boolean
    claimsMap: SsoClaimsMap
    defaultOrganizationRole: OrganizationRole
    providerId: string | null
  }>,
  platform: PlatformSsoConfig
): EffectiveSsoPolicy | null {
  const domain = emailDomain(email)
  const matching = rows.filter(
    (row) =>
      row.enabled &&
      domain !== null &&
      isEmailDomainAllowed(email, row.allowedDomains)
  )
  const row = matching.find((entry) => entry.required) ?? matching[0] ?? null

  if (row) {
    const usePlatform = row.usePlatformIdp && platform.enabled
    const saml = row.protocol === "saml" && !usePlatform
    return {
      organizationId: row.organizationId,
      providerId: usePlatform
        ? platform.providerId
        : (row.providerId ?? platform.providerId),
      protocol: usePlatform ? "oidc" : row.protocol,
      signInMethod: saml ? "sso" : "oauth2",
      required: row.required || platform.required,
      trustIdpMfa: row.trustIdpMfa || platform.trustIdpMfa,
      allowedDomains: parseDomainList([
        ...row.allowedDomains,
        ...platform.allowedDomains,
      ]),
      claimsMap:
        Object.keys(row.claimsMap.values ?? {}).length > 0
          ? parseSsoClaimsMap(row.claimsMap)
          : platform.claimsMap,
      defaultOrganizationRole: row.defaultOrganizationRole,
      usePlatformIdp: usePlatform,
    }
  }

  if (!platform.enabled && !platform.saml.enabled) {
    return null
  }

  return {
    organizationId: platform.defaultOrganizationId,
    providerId:
      platform.saml.enabled && !platform.enabled
        ? platform.saml.providerId
        : platform.providerId,
    protocol: platform.enabled ? "oidc" : "saml",
    signInMethod: platform.enabled ? "oauth2" : "sso",
    required: platform.required,
    trustIdpMfa: platform.trustIdpMfa,
    allowedDomains: platform.allowedDomains,
    claimsMap: platform.claimsMap,
    defaultOrganizationRole: platform.defaultOrganizationRole,
    usePlatformIdp: true,
  }
}

export async function effectiveSsoForEmail(email: string | null) {
  const platform = getPlatformSsoConfig()
  const rows = await loadOrgSsoSettings()
  const requiredAnywhere =
    platform.required || rows.some((row) => row.enabled && row.required)

  if (!email) {
    return {
      platform,
      policy: null as EffectiveSsoPolicy | null,
      requiredAnywhere,
    }
  }

  return {
    platform,
    policy: matchOrgSsoSettings(email, rows, platform),
    requiredAnywhere,
  }
}

export async function localSignInBlockedForEmail(email: string | null) {
  const platform = getPlatformSsoConfig()
  const rows = await loadOrgSsoSettings()
  const policy = email ? matchOrgSsoSettings(email, rows, platform) : null
  const block = resolveLegacySignInBlock({
    platformRequired: platform.required,
    matchedPolicyRequired: Boolean(policy?.required),
    idpAvailable: true,
  })
  if (!block.blocked) {
    return block
  }

  const discoveryUrl =
    policy?.usePlatformIdp === false && policy.protocol === "saml"
      ? null
      : platform.discoveryUrl
  const idpAvailable = discoveryUrl
    ? await probeOidcDiscovery(discoveryUrl)
    : true
  return resolveLegacySignInBlock({
    platformRequired: platform.required,
    matchedPolicyRequired: Boolean(policy?.required),
    idpAvailable,
  })
}

export function trustedSsoProviderIds(config = getPlatformSsoConfig()) {
  const ids = [config.providerId]
  if (config.saml.enabled) {
    ids.push(config.saml.providerId)
  }
  return ids
}

export async function claimsFromUserAccounts(userId: string) {
  const accounts = await db
    .select({
      providerId: account.providerId,
      idToken: account.idToken,
    })
    .from(account)
    .where(eq(account.userId, userId))

  const trusted = new Set(trustedSsoProviderIds())
  const ssoAccount =
    accounts.find((row) => trusted.has(row.providerId)) ??
    accounts.find((row) => row.providerId !== "credential") ??
    null
  return decodeJwtPayload(ssoAccount?.idToken)
}

export async function provisionSsoLogin(input: {
  userId: string
  email: string
  claims?: Record<string, unknown> | null
}) {
  const platform = getPlatformSsoConfig()
  const rows = await loadOrgSsoSettings()
  const policy = matchOrgSsoSettings(input.email, rows, platform)
  const allowedDomains = policy?.allowedDomains ?? platform.allowedDomains
  const [existing] = await db
    .select()
    .from(user)
    .where(eq(user.id, input.userId))

  if (!existing) {
    return { ok: false as const, reason: "missing_user" as const }
  }

  const claims =
    input.claims ?? (await claimsFromUserAccounts(input.userId)) ?? {}
  const decision = decideSsoUserLink({
    email: input.email,
    emailVerified: true,
    allowedDomains,
    existing: {
      id: existing.id,
      emailVerified: existing.emailVerified,
      status: existing.status,
      disabledAt: existing.disabledAt,
    },
  })

  if (decision.action === "reject" && decision.reason === "domain") {
    return { ok: false as const, reason: "domain" as const }
  }

  const mapped = mapClaimsToRoles({
    claims,
    claimsMap: policy?.claimsMap ?? platform.claimsMap,
    defaultOrganizationRole:
      policy?.defaultOrganizationRole ?? platform.defaultOrganizationRole,
  })
  const organizationId =
    policy?.organizationId ?? platform.defaultOrganizationId
  const trustIdpMfa = policy?.trustIdpMfa ?? platform.trustIdpMfa
  const now = new Date()

  await db
    .update(user)
    .set({
      emailVerified: true,
      ...(existing.role === "owner" || existing.role === "admin"
        ? {}
        : { role: "member" as const }),
      mustChangePassword: false,
      ssoMfaTrusted: trustIdpMfa,
      lastLoginAt: now,
      updatedAt: now,
    })
    .where(eq(user.id, input.userId))

  if (organizationId) {
    const memberships = await db
      .select()
      .from(organizationMemberships)
      .where(eq(organizationMemberships.userId, input.userId))
    const existingMembership = memberships.find(
      (row) => row.organizationId === organizationId
    )
    if (existingMembership) {
      await db
        .update(organizationMemberships)
        .set({
          role: mapped.organizationRole,
          status: "active",
          updatedAt: now,
        })
        .where(eq(organizationMemberships.id, existingMembership.id))
    } else {
      await db.insert(organizationMemberships).values({
        organizationId,
        userId: input.userId,
        role: mapped.organizationRole,
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  for (const grant of mapped.siteGrants) {
    const grants = await db
      .select()
      .from(siteMemberships)
      .where(eq(siteMemberships.userId, input.userId))
    const already = grants.some((row) => row.siteId === grant.siteId)
    if (!already) {
      await db.insert(siteMemberships).values({
        siteId: grant.siteId,
        userId: input.userId,
        role: grant.role,
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  return {
    ok: true as const,
    organizationId,
    organizationRole: mapped.organizationRole,
  }
}

export function ssoGenericOAuthConfig(config = getPlatformSsoConfig()) {
  if (!config.enabled) {
    return null
  }
  return {
    providerId: config.providerId,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    discoveryUrl: config.discoveryUrl,
    issuer: config.issuer,
    authorizationUrl: config.authorizationUrl,
    tokenUrl: config.tokenUrl,
    userInfoUrl: config.userInfoUrl,
    pkce: true,
    scopes: ["openid", "profile", "email"],
  }
}

export async function ssoUserInfoFromTokens(tokens: {
  accessToken?: string | null
  idToken?: string | null
}) {
  const config = getPlatformSsoConfig()
  const claims = decodeJwtPayload(tokens.idToken) ?? {}
  let profile: Record<string, unknown> = {}
  if (tokens.accessToken && config.userInfoUrl) {
    try {
      const response = await fetch(config.userInfoUrl, {
        headers: { authorization: `Bearer ${tokens.accessToken}` },
        signal: AbortSignal.timeout(IDP_PROBE_TIMEOUT_MS),
      })
      if (response.ok) {
        const body: unknown = await response.json()
        if (body && typeof body === "object" && !Array.isArray(body)) {
          profile = body as Record<string, unknown>
        }
      }
    } catch {
      // ID token claims are enough when userinfo is unreachable.
    }
  }

  const merged = { ...claims, ...profile }
  const email =
    typeof merged.email === "string" ? merged.email.toLowerCase() : ""
  const name =
    (typeof merged.name === "string" && merged.name) ||
    (typeof merged.preferred_username === "string" &&
      merged.preferred_username) ||
    email
  const id = typeof merged.sub === "string" ? merged.sub : email
  const emailVerified =
    merged.email_verified === true || merged.email_verified === "true"

  if (!email) {
    return { ok: false as const, reason: "unverified_email" as const }
  }

  const rows = await loadOrgSsoSettings()
  const policy = matchOrgSsoSettings(email, rows, config)
  const [existing] = await db
    .select({
      id: user.id,
      emailVerified: user.emailVerified,
      status: user.status,
      disabledAt: user.disabledAt,
    })
    .from(user)
    .where(eq(user.email, email))
  const decision = decideSsoUserLink({
    email,
    emailVerified: emailVerified || Boolean(existing?.emailVerified),
    allowedDomains: policy?.allowedDomains ?? config.allowedDomains,
    existing: existing ?? null,
  })
  if (decision.action === "reject") {
    return { ok: false as const, reason: decision.reason }
  }

  return {
    ok: true as const,
    user: {
      id,
      email,
      name: name || email,
      emailVerified,
    },
    claims: merged,
  }
}
