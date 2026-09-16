import { randomUUID } from "node:crypto"

import { TRPCError } from "@trpc/server"
import { eq } from "drizzle-orm"
import { z } from "zod"

import { organizationSsoSettings, ssoProvider } from "@nms/db"
import {
  getPlatformSsoConfig,
  matchOrgSsoSettings,
  probeOidcDiscovery,
} from "@nms/auth"
import {
  decryptSecret,
  encryptSecret,
  type EncryptedSecret,
} from "@nms/remote-access"
import {
  discoveryUrlForIssuer,
  localSignInBlock,
  organizationRoles,
  parseDomainList,
  parseSsoClaimsMap,
  ssoProtocolSchema,
  ssoClaimsMapSchema,
} from "@nms/shared"

import { assertAuthorized } from "../access"
import { writeAuditEvent } from "../audit"
import type { ApiContext } from "../context"
import { adminProcedure, createTRPCRouter, publicProcedure } from "../trpc"

function getCredentialSecret() {
  const secret = process.env.REMOTE_CREDENTIALS_KEY
  if (!secret) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "We couldn't save those settings.",
    })
  }
  return secret
}

function authBaseUrl() {
  return (
    process.env.BETTER_AUTH_URL ??
    process.env.NEXTAUTH_URL ??
    process.env.APP_BASE_URL ??
    "http://localhost:3000"
  ).replace(/\/+$/, "")
}

function orgProviderId(organizationId: string) {
  return `org-${organizationId}`
}

const upsertInput = z.object({
  organizationId: z.string().uuid(),
  enabled: z.boolean(),
  required: z.boolean(),
  protocol: ssoProtocolSchema,
  usePlatformIdp: z.boolean(),
  allowedDomains: z.array(z.string().min(1).max(253)).max(50),
  trustIdpMfa: z.boolean(),
  claimsMap: ssoClaimsMapSchema,
  defaultOrganizationRole: z.enum(organizationRoles),
  issuer: z.string().trim().max(500).nullable().optional(),
  discoveryUrl: z.string().trim().max(800).nullable().optional(),
  clientId: z.string().trim().max(200).nullable().optional(),
  clientSecret: z.string().max(500).nullable().optional(),
  samlEntryPoint: z.string().trim().max(800).nullable().optional(),
  samlCertificate: z.string().max(16_000).nullable().optional(),
  samlAudience: z.string().trim().max(800).nullable().optional(),
  samlMetadataXml: z.string().max(200_000).nullable().optional(),
})

function publicSettings(
  row: typeof organizationSsoSettings.$inferSelect | null,
  organizationId: string
) {
  if (!row) {
    return {
      organizationId,
      enabled: false,
      required: false,
      protocol: "oidc" as const,
      usePlatformIdp: true,
      allowedDomains: [] as string[],
      trustIdpMfa: false,
      claimsMap: parseSsoClaimsMap({}),
      defaultOrganizationRole: "technician" as const,
      providerId: null as string | null,
      issuer: null as string | null,
      discoveryUrl: null as string | null,
      clientId: null as string | null,
      hasClientSecret: false,
      samlEntryPoint: null as string | null,
      samlCertificate: null as string | null,
      samlAudience: null as string | null,
      samlMetadataXml: null as string | null,
      spAcsUrl: null as string | null,
      spMetadataUrl: null as string | null,
    }
  }

  const providerId = row.providerId ?? orgProviderId(organizationId)
  return {
    organizationId: row.organizationId,
    enabled: row.enabled,
    required: row.required,
    protocol: row.protocol,
    usePlatformIdp: row.usePlatformIdp,
    allowedDomains: parseDomainList(row.allowedDomains),
    trustIdpMfa: row.trustIdpMfa,
    claimsMap: parseSsoClaimsMap(row.claimsMap),
    defaultOrganizationRole: row.defaultOrganizationRole,
    providerId: row.providerId,
    issuer: row.issuer,
    discoveryUrl: row.discoveryUrl,
    clientId: row.clientId,
    hasClientSecret: Boolean(row.clientSecret),
    samlEntryPoint: row.samlEntryPoint,
    samlCertificate: row.samlCertificate,
    samlAudience: row.samlAudience,
    samlMetadataXml: row.samlMetadataXml,
    spAcsUrl: `${authBaseUrl()}/api/auth/sso/saml2/callback/${providerId}`,
    spMetadataUrl: `${authBaseUrl()}/api/auth/sso/saml2/sp/metadata?providerId=${encodeURIComponent(providerId)}`,
  }
}

async function syncBetterAuthProvider(
  ctx: ApiContext,
  row: typeof organizationSsoSettings.$inferSelect
) {
  const providerId = row.providerId ?? orgProviderId(row.organizationId)
  const domain = parseDomainList(row.allowedDomains).join(",")
  if (!row.enabled || row.usePlatformIdp || !row.issuer || !domain) {
    await ctx.db
      .delete(ssoProvider)
      .where(eq(ssoProvider.providerId, providerId))
    return
  }

  let oidcConfig: string | null = null
  let samlConfig: string | null = null
  if (row.protocol === "oidc") {
    if (!row.clientId || !row.clientSecret) {
      return
    }
    const secret = decryptSecret(
      row.clientSecret as EncryptedSecret,
      getCredentialSecret()
    )
    oidcConfig = JSON.stringify({
      issuer: row.issuer,
      clientId: row.clientId,
      clientSecret: secret,
      discoveryEndpoint: row.discoveryUrl ?? discoveryUrlForIssuer(row.issuer),
      pkce: true,
      scopes: ["openid", "profile", "email"],
      mapping: {
        id: "sub",
        email: "email",
        emailVerified: "email_verified",
        name: "name",
      },
    })
  } else {
    if (!row.samlEntryPoint || !row.samlCertificate) {
      return
    }
    samlConfig = JSON.stringify({
      issuer: row.issuer,
      entryPoint: row.samlEntryPoint,
      cert: row.samlCertificate,
      callbackUrl: `${authBaseUrl()}/api/auth/sso/saml2/callback/${providerId}`,
      audience: row.samlAudience || authBaseUrl(),
      wantAssertionsSigned: true,
      signatureAlgorithm: "sha256",
      digestAlgorithm: "sha256",
      identifierFormat:
        "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
      spMetadata: {
        entityID: authBaseUrl(),
        binding: "post",
      },
      ...(row.samlMetadataXml
        ? { idpMetadata: { metadata: row.samlMetadataXml } }
        : {}),
      mapping: {
        id: "nameID",
        email: "email",
        name: "displayName",
        emailVerified: "email_verified",
      },
    })
  }

  const [existing] = await ctx.db
    .select()
    .from(ssoProvider)
    .where(eq(ssoProvider.providerId, providerId))

  const values = {
    issuer: row.issuer,
    domain,
    oidcConfig,
    samlConfig,
    userId: ctx.actor?.id ?? existing?.userId ?? null,
    providerId,
    organizationId: row.organizationId,
  }

  if (existing) {
    await ctx.db
      .update(ssoProvider)
      .set(values)
      .where(eq(ssoProvider.id, existing.id))
    return
  }

  await ctx.db.insert(ssoProvider).values({
    id: randomUUID(),
    ...values,
  })
}

export const ssoRouter = createTRPCRouter({
  status: publicProcedure.query(async ({ ctx }) => {
    const platform = getPlatformSsoConfig()
    let rows: Array<typeof organizationSsoSettings.$inferSelect> = []
    try {
      rows = await ctx.db.select().from(organizationSsoSettings)
    } catch {
      rows = []
    }
    const orgEnabled = rows.some((row) => row.enabled)
    const required =
      platform.required || rows.some((row) => row.enabled && row.required)
    const enabled = platform.enabled || platform.saml.enabled || orgEnabled
    const idpAvailable = platform.enabled
      ? await probeOidcDiscovery(platform.discoveryUrl)
      : enabled
        ? true
        : null
    const block = localSignInBlock({
      ssoRequired: platform.required,
      idpAvailable: idpAvailable ?? true,
    })
    return {
      enabled,
      required,
      passwordEnabled: !block.blocked,
      idpAvailable,
      unavailable: block.blocked && block.reason === "idp_unavailable",
      providerId: platform.enabled
        ? platform.providerId
        : platform.saml.enabled
          ? platform.saml.providerId
          : null,
      protocol: platform.enabled
        ? ("oidc" as const)
        : platform.saml.enabled
          ? ("saml" as const)
          : null,
      signInMethod: platform.enabled
        ? ("oauth2" as const)
        : platform.saml.enabled
          ? ("sso" as const)
          : null,
    }
  }),

  hint: publicProcedure
    .input(z.object({ email: z.string().email().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const platform = getPlatformSsoConfig()
      let rows: Array<typeof organizationSsoSettings.$inferSelect> = []
      try {
        rows = await ctx.db.select().from(organizationSsoSettings)
      } catch {
        rows = []
      }
      const email = input?.email?.toLowerCase() ?? null
      const policy = email ? matchOrgSsoSettings(email, rows, platform) : null
      return {
        signInMethod:
          policy?.signInMethod ?? (platform.enabled ? "oauth2" : null),
        providerId: policy?.providerId ?? null,
        required: policy?.required ?? platform.required,
      }
    }),

  get: adminProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertAuthorized(ctx.actor, "organization:admin", {
        kind: "organization",
        organizationId: input.organizationId,
      })
      const [row] = await ctx.db
        .select()
        .from(organizationSsoSettings)
        .where(eq(organizationSsoSettings.organizationId, input.organizationId))
      return {
        platform: {
          enabled: getPlatformSsoConfig().enabled,
          issuer: getPlatformSsoConfig().issuer,
          discoveryUrl: getPlatformSsoConfig().discoveryUrl,
          clientId: getPlatformSsoConfig().clientId,
          providerId: getPlatformSsoConfig().providerId,
          required: getPlatformSsoConfig().required,
          trustIdpMfa: getPlatformSsoConfig().trustIdpMfa,
          samlEnabled: getPlatformSsoConfig().saml.enabled,
        },
        settings: publicSettings(row ?? null, input.organizationId),
      }
    }),

  upsert: adminProcedure.input(upsertInput).mutation(async ({ ctx, input }) => {
    assertAuthorized(ctx.actor, "organization:admin", {
      kind: "organization",
      organizationId: input.organizationId,
    })

    const [existing] = await ctx.db
      .select()
      .from(organizationSsoSettings)
      .where(eq(organizationSsoSettings.organizationId, input.organizationId))

    const now = new Date()
    let clientSecret = existing?.clientSecret ?? null
    if (input.clientSecret) {
      clientSecret = encryptSecret(input.clientSecret, getCredentialSecret())
    }

    const providerId = input.usePlatformIdp
      ? null
      : (existing?.providerId ?? orgProviderId(input.organizationId))

    const values = {
      organizationId: input.organizationId,
      enabled: input.enabled,
      required: input.required,
      protocol: input.protocol,
      usePlatformIdp: input.usePlatformIdp,
      allowedDomains: parseDomainList(input.allowedDomains),
      trustIdpMfa: input.trustIdpMfa,
      claimsMap: parseSsoClaimsMap(input.claimsMap),
      defaultOrganizationRole: input.defaultOrganizationRole,
      providerId,
      issuer: input.issuer || null,
      discoveryUrl: input.discoveryUrl || null,
      clientId: input.clientId || null,
      clientSecret,
      samlEntryPoint: input.samlEntryPoint || null,
      samlCertificate: input.samlCertificate || null,
      samlAudience: input.samlAudience || null,
      samlMetadataXml: input.samlMetadataXml || null,
      updatedAt: now,
    }

    const [row] = existing
      ? await ctx.db
          .update(organizationSsoSettings)
          .set(values)
          .where(eq(organizationSsoSettings.id, existing.id))
          .returning()
      : await ctx.db
          .insert(organizationSsoSettings)
          .values({ ...values, createdAt: now })
          .returning()

    await syncBetterAuthProvider(ctx, row)
    await writeAuditEvent(ctx, {
      eventType: "sso_settings_updated",
      organizationId: input.organizationId,
      eventData: {
        enabled: row.enabled,
        required: row.required,
        protocol: row.protocol,
        usePlatformIdp: row.usePlatformIdp,
      },
    })

    return publicSettings(row, input.organizationId)
  }),
})
