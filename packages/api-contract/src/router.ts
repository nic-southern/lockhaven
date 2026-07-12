import { createHash, randomUUID } from "node:crypto"

import { TRPCError } from "@trpc/server"
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm"
import { z } from "zod"

import {
  adminProcedure,
  createTRPCRouter,
  permissionProcedure,
  publicProcedure,
} from "./trpc"
import { actorOrganizationIds, actorSiteIds, assertAuthorized } from "./access"
import { hashPassword } from "@nms/auth"
import {
  adminVpnProfiles,
  auditEvents,
  account,
  devices,
  enrollmentTokens,
  managementServiceCredentials,
  managementServices,
  organizationMemberships,
  organizations,
  organizationSshCredentials,
  remoteSessions,
  routePolicies,
  siteMemberships,
  siteSshCredentials,
  sites,
  vpnIdentities,
  user,
} from "@nms/db"
import {
  decryptSecret,
  deriveOpenSshPublicKeyFromPrivateKey,
  encryptSecret,
  generateSiteSshKeyPair,
  guacamoleConfigSchema,
  GuacamoleRemoteAccessProvider,
  buildNativeAppUrl,
  type EncryptedSecret,
} from "@nms/remote-access"
import {
  enrollmentTokenCreateSchema,
  enrollmentTokenUpdateSchema,
  remoteSessionRequestSchema,
} from "@nms/shared"
import {
  allocateVpnIpv4,
  buildAdminClientConfig,
  generateWireGuardKeyPair,
  normalizeVpnIpv4,
} from "@nms/vpn"
import {
  normalizeRouteValues,
  permissionForServiceType,
  serviceConnectionDefaults,
  siteBelongsToOrganization,
} from "./helpers"
import type { ApiContext } from "./context"

function hashEnrollmentToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

function makeEnrollmentToken() {
  return `nms_enroll_${randomUUID().replaceAll("-", "")}`
}

const guacamoleProvider = new GuacamoleRemoteAccessProvider(
  guacamoleConfigSchema.parse({
    baseUrl:
      process.env.GUACAMOLE_BASE_URL ?? "https://guac.example.com/guacamole/",
    databaseUrl:
      process.env.GUACAMOLE_DATABASE_URL ??
      "postgresql://guacamole:replace_me@guacamole-db:5432/guacamole_db",
  })
)

function getCredentialSecret() {
  const secret = process.env.REMOTE_CREDENTIALS_KEY

  if (!secret) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Missing remote credential secret",
    })
  }

  return secret
}

function encryptVncPassword(password: string) {
  return encryptSecret(password, getCredentialSecret())
}

function decryptVncPassword(payload: EncryptedSecret) {
  return decryptSecret(payload, getCredentialSecret())
}

function encryptRemoteSecret(secret: string) {
  return encryptSecret(secret, getCredentialSecret())
}

function decryptRemoteSecret(payload: EncryptedSecret) {
  return decryptSecret(payload, getCredentialSecret())
}

function requireVpnServerConfig() {
  const serverPublicKey = process.env.VPN_SERVER_PUBLIC_KEY
  const hostname = process.env.VPN_PUBLIC_HOSTNAME ?? "vpn.example.com"
  const port = Number(process.env.VPN_PUBLIC_PORT ?? 51820)

  if (!serverPublicKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "VPN server is not configured",
    })
  }

  return {
    serverPublicKey,
    endpoint: `${hostname}:${port}`,
  }
}

function adminVpnConfigFilename(organizationName: string, vpnIpv4: string) {
  const safeName = organizationName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  const address = normalizeVpnIpv4(vpnIpv4).replaceAll(".", "-")
  return `lockhaven-admin-${safeName || "org"}-${address}.conf`
}

function serializeAdminVpnProfile(
  profile: typeof adminVpnProfiles.$inferSelect
) {
  return {
    id: profile.id,
    organizationId: profile.organizationId,
    userId: profile.userId,
    vpnIpv4: normalizeVpnIpv4(String(profile.vpnIpv4)),
    wireguardPublicKey: profile.wireguardPublicKey,
    label: profile.label,
    serverPeerEnabled: profile.serverPeerEnabled,
    lastHandshakeAt: profile.lastHandshakeAt,
    latestEndpoint: profile.latestEndpoint,
    rxBytes: profile.rxBytes,
    txBytes: profile.txBytes,
    revokedAt: profile.revokedAt,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  }
}

function requireActor(actor: ApiContext["actor"]) {
  if (!actor) {
    throw new TRPCError({ code: "UNAUTHORIZED" })
  }

  return actor
}

function decodePasswordRecord(
  record: typeof managementServiceCredentials.$inferSelect | null
) {
  if (!record) {
    return null
  }

  return decryptVncPassword({
    ciphertext: record.passwordCiphertext,
    iv: record.passwordIv,
    authTag: record.passwordAuthTag,
  })
}

function decodeSshCredentialRecord(
  record: typeof managementServiceCredentials.$inferSelect | null
) {
  if (
    !record?.usernameCiphertext ||
    !record.usernameIv ||
    !record.usernameAuthTag
  ) {
    return { username: null, privateKey: null }
  }

  return {
    username: decryptRemoteSecret({
      ciphertext: record.usernameCiphertext,
      iv: record.usernameIv,
      authTag: record.usernameAuthTag,
    }),
    privateKey: decryptRemoteSecret({
      ciphertext: record.passwordCiphertext,
      iv: record.passwordIv,
      authTag: record.passwordAuthTag,
    }),
  }
}

function decodeSiteSshCredentialRecord(
  record: typeof siteSshCredentials.$inferSelect | null
) {
  if (!record) {
    return { username: null, privateKey: null, publicKey: null }
  }

  return {
    username: decryptRemoteSecret({
      ciphertext: record.usernameCiphertext,
      iv: record.usernameIv,
      authTag: record.usernameAuthTag,
    }),
    privateKey: decryptRemoteSecret({
      ciphertext: record.passwordCiphertext,
      iv: record.passwordIv,
      authTag: record.passwordAuthTag,
    }),
    publicKey: record.publicKey,
  }
}

function buildEncryptedSshCredentialFields(
  username: string,
  privateKey: string
) {
  const encryptedUsername = encryptRemoteSecret(username)
  const encryptedPrivateKey = encryptRemoteSecret(privateKey)

  return {
    passwordCiphertext: encryptedPrivateKey.ciphertext,
    passwordIv: encryptedPrivateKey.iv,
    passwordAuthTag: encryptedPrivateKey.authTag,
    usernameCiphertext: encryptedUsername.ciphertext,
    usernameIv: encryptedUsername.iv,
    usernameAuthTag: encryptedUsername.authTag,
  }
}

async function upsertSiteSshCredential(
  db: ApiContext["db"],
  siteId: string,
  username: string,
  privateKey: string,
  publicKey: string
) {
  const fields = buildEncryptedSshCredentialFields(username, privateKey)

  const [record] = await db
    .insert(siteSshCredentials)
    .values({
      siteId,
      ...fields,
      publicKey,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: siteSshCredentials.siteId,
      set: {
        ...fields,
        publicKey,
        updatedAt: new Date(),
      },
    })
    .returning()

  return record
}

async function ensureSiteSshCredential(
  db: ApiContext["db"],
  site: typeof sites.$inferSelect
) {
  const [existing] = await db
    .select()
    .from(siteSshCredentials)
    .where(eq(siteSshCredentials.siteId, site.id))

  if (existing) {
    return existing
  }

  const keyPair = generateSiteSshKeyPair(
    site.name.replaceAll(/\s+/g, "-").toLowerCase()
  )
  const record = await upsertSiteSshCredential(
    db,
    site.id,
    "root",
    keyPair.privateKey,
    keyPair.publicKey
  )

  await db.insert(auditEvents).values({
    organizationId: site.organizationId,
    eventType: "site_ssh_credential_generated",
    eventData: { siteId: site.id, reason: "auto" },
  })

  return record
}

async function upsertOrganizationSshCredential(
  db: ApiContext["db"],
  organizationId: string,
  username: string,
  privateKey: string,
  publicKey: string
) {
  const fields = buildEncryptedSshCredentialFields(username, privateKey)

  const [record] = await db
    .insert(organizationSshCredentials)
    .values({
      organizationId,
      ...fields,
      publicKey,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: organizationSshCredentials.organizationId,
      set: {
        ...fields,
        publicKey,
        updatedAt: new Date(),
      },
    })
    .returning()

  return record
}

async function ensureOrganizationSshCredential(
  db: ApiContext["db"],
  organization: typeof organizations.$inferSelect
) {
  const [existing] = await db
    .select()
    .from(organizationSshCredentials)
    .where(eq(organizationSshCredentials.organizationId, organization.id))

  if (existing) {
    return existing
  }

  const keyPair = generateSiteSshKeyPair(
    organization.name.replaceAll(/\s+/g, "-").toLowerCase()
  )
  const record = await upsertOrganizationSshCredential(
    db,
    organization.id,
    "root",
    keyPair.privateKey,
    keyPair.publicKey
  )

  await db.insert(auditEvents).values({
    organizationId: organization.id,
    eventType: "site_ssh_credential_generated",
    eventData: {
      organizationId: organization.id,
      scope: "imaging",
      reason: "auto",
    },
  })

  return record
}

function decodeOrganizationSshCredentialRecord(
  record: typeof organizationSshCredentials.$inferSelect | null
) {
  if (!record) {
    return { username: null, privateKey: null, publicKey: null }
  }

  return {
    username: decryptRemoteSecret({
      ciphertext: record.usernameCiphertext,
      iv: record.usernameIv,
      authTag: record.usernameAuthTag,
    }),
    privateKey: decryptRemoteSecret({
      ciphertext: record.passwordCiphertext,
      iv: record.passwordIv,
      authTag: record.passwordAuthTag,
    }),
    publicKey: record.publicKey,
  }
}

async function copySiteSshCredentialToService(
  db: ApiContext["db"],
  device: { siteId: string | null; organizationId: string },
  serviceId: string,
  serviceType: string
) {
  if (serviceType !== "ssh") {
    return
  }

  const [existingCredential] = await db
    .select()
    .from(managementServiceCredentials)
    .where(eq(managementServiceCredentials.managementServiceId, serviceId))

  if (existingCredential) {
    return
  }

  if (device.siteId) {
    const [siteCredential] = await db
      .select()
      .from(siteSshCredentials)
      .where(eq(siteSshCredentials.siteId, device.siteId))

    if (siteCredential) {
      await db.insert(managementServiceCredentials).values({
        managementServiceId: serviceId,
        passwordCiphertext: siteCredential.passwordCiphertext,
        passwordIv: siteCredential.passwordIv,
        passwordAuthTag: siteCredential.passwordAuthTag,
        usernameCiphertext: siteCredential.usernameCiphertext,
        usernameIv: siteCredential.usernameIv,
        usernameAuthTag: siteCredential.usernameAuthTag,
        updatedAt: new Date(),
      })
      return
    }
  }

  const [organizationCredential] = await db
    .select()
    .from(organizationSshCredentials)
    .where(eq(organizationSshCredentials.organizationId, device.organizationId))

  if (!organizationCredential) {
    return
  }

  await db.insert(managementServiceCredentials).values({
    managementServiceId: serviceId,
    passwordCiphertext: organizationCredential.passwordCiphertext,
    passwordIv: organizationCredential.passwordIv,
    passwordAuthTag: organizationCredential.passwordAuthTag,
    usernameCiphertext: organizationCredential.usernameCiphertext,
    usernameIv: organizationCredential.usernameIv,
    usernameAuthTag: organizationCredential.usernameAuthTag,
    updatedAt: new Date(),
  })
}

function mapSiteWithSshCredential(
  site: typeof sites.$inferSelect,
  credential: typeof siteSshCredentials.$inferSelect | null
) {
  const decoded = decodeSiteSshCredentialRecord(credential)

  return {
    ...site,
    hasSshCredential: Boolean(credential),
    sshUsername: decoded.username,
    sshPublicKey: decoded.publicKey,
  }
}

const serviceTypes = ["vnc", "rdp", "ssh", "winrm_https"] as const

const organizationCreateInput = z.object({
  name: z.string().min(1),
})

const siteCreateInput = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1),
  timezone: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
})

const siteUpdateInput = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  timezone: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
})

const deviceUpdateInput = z.object({
  id: z.string().uuid(),
  displayName: z.string().min(1).optional(),
  hostname: z.string().min(1).optional().nullable(),
  siteId: z.string().uuid().optional().nullable(),
})

const deviceRoutePolicyInput = z.object({
  id: z.string().uuid(),
  routePolicyId: z.string().uuid().nullable(),
})

const managementServiceCreateInput = z.object({
  deviceId: z.string().uuid(),
  serviceType: z.enum(serviceTypes),
  protocol: z.string().min(1).default("tcp"),
  port: z.number().int().positive(),
  enabled: z.boolean().default(true),
})

const managementServiceUpdateInput = z.object({
  id: z.string().uuid(),
  serviceType: z.enum(serviceTypes),
  protocol: z.string().min(1),
  port: z.number().int().positive(),
  enabled: z.boolean(),
})

const routePolicyCreateInput = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1),
  routes: z.array(z.string().min(1)).min(1),
  description: z.string().optional().nullable(),
})

const routePolicyUpdateInput = routePolicyCreateInput.extend({
  id: z.string().uuid(),
})

const enrollmentTokenInput = enrollmentTokenCreateSchema

const auditListInput = z.object({
  organizationId: z.string().uuid().optional(),
  deviceId: z.string().uuid().optional(),
})

const sessionCreateInput = remoteSessionRequestSchema.extend({
  deviceId: z.string().uuid(),
})

const organizationRoleValues = ["owner", "admin", "operator", "viewer"] as const
const siteRoleValues = ["operator", "viewer"] as const
const membershipStatusValues = ["active", "suspended"] as const

const accessOrganizationMembersInput = z.object({
  organizationId: z.string().uuid(),
})

const accessCreateUserInput = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  organizationRole: z.enum(organizationRoleValues),
  siteIds: z.array(z.string().uuid()).default([]),
  siteRole: z.enum(siteRoleValues).default("viewer"),
})

const accessOrganizationMembershipInput = z.object({
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(organizationRoleValues),
  status: z.enum(membershipStatusValues).default("active"),
})

const accessSiteMembershipInput = z.object({
  siteId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(siteRoleValues),
  status: z.enum(membershipStatusValues).default("active"),
})

const accessRouter = createTRPCRouter({
  me: adminProcedure.query(async ({ ctx }) => {
    const actor = ctx.actor

    if (!actor) {
      return null
    }

    return {
      id: actor.id,
      email: actor.email,
      name: actor.name,
      platformRole: actor.platformRole,
      permissions: actor.permissions,
      organizationMemberships: actor.organizationMemberships,
      siteMemberships: actor.siteMemberships,
      canManageUsers:
        actor.platformRole === "owner" ||
        actor.platformRole === "admin" ||
        actor.organizationMemberships.some(
          (membership) =>
            membership.status === "active" &&
            (membership.role === "owner" || membership.role === "admin")
        ),
    }
  }),
  organizationMembers: adminProcedure
    .input(accessOrganizationMembersInput)
    .query(async ({ ctx, input }) => {
      assertAuthorized(ctx.actor, "organization:admin", {
        kind: "organization",
        organizationId: input.organizationId,
      })

      const [organizationRecord] = await ctx.db
        .select()
        .from(organizations)
        .where(eq(organizations.id, input.organizationId))

      if (!organizationRecord) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }

      const members = await ctx.db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          platformRole: user.role,
          status: user.status,
          createdAt: user.createdAt,
          organizationMembershipId: organizationMemberships.id,
          organizationMembershipRole: organizationMemberships.role,
          organizationMembershipStatus: organizationMemberships.status,
        })
        .from(organizationMemberships)
        .innerJoin(user, eq(user.id, organizationMemberships.userId))
        .where(eq(organizationMemberships.organizationId, input.organizationId))
        .orderBy(desc(organizationMemberships.createdAt))

      const organizationSiteMembershipRows = await ctx.db
        .select({
          userId: siteMemberships.userId,
          siteId: siteMemberships.siteId,
          siteName: sites.name,
          role: siteMemberships.role,
          status: siteMemberships.status,
        })
        .from(siteMemberships)
        .innerJoin(sites, eq(sites.id, siteMemberships.siteId))
        .where(eq(sites.organizationId, input.organizationId))

      const siteMembershipsByUserId = new Map<
        string,
        Array<{
          siteId: string
          siteName: string
          role: string
          status: string
        }>
      >()

      for (const membership of organizationSiteMembershipRows) {
        const entries = siteMembershipsByUserId.get(membership.userId) ?? []
        entries.push({
          siteId: membership.siteId,
          siteName: membership.siteName,
          role: membership.role,
          status: membership.status,
        })
        siteMembershipsByUserId.set(membership.userId, entries)
      }

      return {
        organization: organizationRecord,
        members: members.map((member) => ({
          id: member.id,
          name: member.name,
          email: member.email,
          platformRole: member.platformRole,
          status: member.status,
          createdAt: member.createdAt,
          membership: {
            id: member.organizationMembershipId,
            role: member.organizationMembershipRole,
            status: member.organizationMembershipStatus,
          },
          siteMemberships: siteMembershipsByUserId.get(member.id) ?? [],
        })),
      }
    }),
  createUser: adminProcedure
    .input(accessCreateUserInput)
    .mutation(async ({ ctx, input }) => {
      assertAuthorized(ctx.actor, "organization:admin", {
        kind: "userManagement",
        organizationId: input.organizationId,
      })

      const [existingUser] = await ctx.db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, input.email.toLowerCase()))

      if (existingUser) {
        throw new TRPCError({ code: "CONFLICT" })
      }

      const now = new Date()
      const userId = randomUUID()
      const passwordHash = await hashPassword(input.password)
      const [createdUser] = await ctx.db
        .insert(user)
        .values({
          id: userId,
          name: input.name,
          email: input.email.toLowerCase(),
          emailVerified: true,
          role: "admin",
          status: "active",
          createdAt: now,
          updatedAt: now,
        })
        .returning()

      await ctx.db.insert(account).values({
        id: randomUUID(),
        userId: createdUser.id,
        accountId: createdUser.id,
        providerId: "credential",
        password: passwordHash,
        createdAt: now,
        updatedAt: now,
      })

      await ctx.db.insert(organizationMemberships).values({
        id: randomUUID(),
        organizationId: input.organizationId,
        userId: createdUser.id,
        role: input.organizationRole,
        status: "active",
        createdByUserId: ctx.actor?.id ?? null,
        createdAt: now,
        updatedAt: now,
      })

      const uniqueSiteIds = [...new Set(input.siteIds)]

      if (uniqueSiteIds.length > 0) {
        const [matchedSites] = await Promise.all([
          ctx.db
            .select({
              id: sites.id,
              organizationId: sites.organizationId,
            })
            .from(sites)
            .where(inArray(sites.id, uniqueSiteIds)),
        ])

        if (matchedSites.length !== uniqueSiteIds.length) {
          throw new TRPCError({ code: "BAD_REQUEST" })
        }

        if (
          matchedSites.some(
            (site) => site.organizationId !== input.organizationId
          )
        ) {
          throw new TRPCError({ code: "BAD_REQUEST" })
        }

        await ctx.db.insert(siteMemberships).values(
          uniqueSiteIds.map((siteId) => ({
            id: randomUUID(),
            siteId,
            userId: createdUser.id,
            role: input.siteRole,
            status: "active" as const,
            createdByUserId: ctx.actor?.id ?? null,
            createdAt: now,
            updatedAt: now,
          }))
        )
      }

      return createdUser
    }),
  updateOrganizationMembership: adminProcedure
    .input(accessOrganizationMembershipInput)
    .mutation(async ({ ctx, input }) => {
      assertAuthorized(ctx.actor, "organization:admin", {
        kind: "userManagement",
        organizationId: input.organizationId,
      })

      const [record] = await ctx.db
        .insert(organizationMemberships)
        .values({
          id: randomUUID(),
          organizationId: input.organizationId,
          userId: input.userId,
          role: input.role,
          status: input.status,
          createdByUserId: ctx.actor?.id ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            organizationMemberships.organizationId,
            organizationMemberships.userId,
          ],
          set: {
            role: input.role,
            status: input.status,
            updatedAt: new Date(),
            createdByUserId: ctx.actor?.id ?? null,
          },
        })
        .returning()

      return record
    }),
  updateSiteMembership: adminProcedure
    .input(accessSiteMembershipInput)
    .mutation(async ({ ctx, input }) => {
      const [site] = await ctx.db
        .select({ id: sites.id, organizationId: sites.organizationId })
        .from(sites)
        .where(eq(sites.id, input.siteId))

      if (!site) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }

      assertAuthorized(ctx.actor, "organization:admin", {
        kind: "userManagement",
        organizationId: site.organizationId,
      })

      const [record] = await ctx.db
        .insert(siteMemberships)
        .values({
          id: randomUUID(),
          siteId: input.siteId,
          userId: input.userId,
          role: input.role,
          status: input.status,
          createdByUserId: ctx.actor?.id ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [siteMemberships.siteId, siteMemberships.userId],
          set: {
            role: input.role,
            status: input.status,
            updatedAt: new Date(),
            createdByUserId: ctx.actor?.id ?? null,
          },
        })
        .returning()

      return record
    }),
})

export const appRouter = createTRPCRouter({
  access: accessRouter,
  health: publicProcedure.query(() => ({ ok: true })),
  organizations: createTRPCRouter({
    list: adminProcedure.query(async ({ ctx }) => {
      const organizationIds = actorOrganizationIds(ctx.actor)

      if (organizationIds === null) {
        return ctx.db
          .select()
          .from(organizations)
          .orderBy(desc(organizations.createdAt))
      }

      if (organizationIds.length === 0) {
        return []
      }

      return ctx.db
        .select()
        .from(organizations)
        .where(inArray(organizations.id, organizationIds))
        .orderBy(desc(organizations.createdAt))
    }),
    create: adminProcedure
      .input(organizationCreateInput)
      .mutation(async ({ ctx, input }) => {
        assertAuthorized(ctx.actor, "organization:admin", {
          kind: "platform",
        })

        const [record] = await ctx.db
          .insert(organizations)
          .values({ name: input.name })
          .returning()

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          organizationId: record.id,
          eventType: "organization_created",
          eventData: { organizationId: record.id, name: record.name },
        })

        return record
      }),
    imagingSsh: adminProcedure
      .input(z.object({ organizationId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        assertAuthorized(ctx.actor, "device:enroll", {
          kind: "enrollmentToken",
          organizationId: input.organizationId,
          siteId: null,
        })

        const [organization] = await ctx.db
          .select()
          .from(organizations)
          .where(eq(organizations.id, input.organizationId))

        if (!organization) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        const credential = await ensureOrganizationSshCredential(
          ctx.db,
          organization
        )
        const decoded = decodeOrganizationSshCredentialRecord(credential)

        return {
          organizationId: organization.id,
          sshUsername: decoded.username,
          sshPublicKey: decoded.publicKey,
        }
      }),
  }),
  sites: createTRPCRouter({
    list: adminProcedure.query(async ({ ctx }) => {
      const organizationIds = actorOrganizationIds(ctx.actor)
      const siteIds = actorSiteIds(ctx.actor) ?? []

      const query = ctx.db
        .select({
          site: sites,
          sshCredential: siteSshCredentials,
        })
        .from(sites)
        .leftJoin(siteSshCredentials, eq(siteSshCredentials.siteId, sites.id))

      if (organizationIds === null) {
        const rows = await query.orderBy(desc(sites.createdAt))
        return Promise.all(
          rows.map(async ({ site, sshCredential }) =>
            mapSiteWithSshCredential(
              site,
              sshCredential ?? (await ensureSiteSshCredential(ctx.db, site))
            )
          )
        )
      }

      const filters = []
      if (organizationIds.length > 0) {
        filters.push(inArray(sites.organizationId, organizationIds))
      }
      if (siteIds.length > 0) {
        filters.push(inArray(sites.id, siteIds))
      }

      if (filters.length === 0) {
        return []
      }

      const rows =
        filters.length === 1
          ? await query.where(filters[0]).orderBy(desc(sites.createdAt))
          : await query.where(or(...filters)).orderBy(desc(sites.createdAt))

      return Promise.all(
        rows.map(async ({ site, sshCredential }) =>
          mapSiteWithSshCredential(
            site,
            sshCredential ?? (await ensureSiteSshCredential(ctx.db, site))
          )
        )
      )
    }),
    create: adminProcedure
      .input(siteCreateInput)
      .mutation(async ({ ctx, input }) => {
        assertAuthorized(ctx.actor, "site:admin", {
          kind: "organization",
          organizationId: input.organizationId,
        })

        const [record] = await ctx.db.insert(sites).values(input).returning()
        const keyPair = generateSiteSshKeyPair(
          record.name.replaceAll(/\s+/g, "-").toLowerCase()
        )
        const sshCredential = await upsertSiteSshCredential(
          ctx.db,
          record.id,
          "root",
          keyPair.privateKey,
          keyPair.publicKey
        )

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          organizationId: record.organizationId,
          eventType: "site_created",
          eventData: { siteId: record.id, name: record.name },
        })
        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          organizationId: record.organizationId,
          eventType: "site_ssh_credential_generated",
          eventData: { siteId: record.id },
        })

        return mapSiteWithSshCredential(record, sshCredential)
      }),
    update: adminProcedure
      .input(siteUpdateInput)
      .mutation(async ({ ctx, input }) => {
        const [existing] = await ctx.db
          .select()
          .from(sites)
          .where(eq(sites.id, input.id))

        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        assertAuthorized(ctx.actor, "site:admin", {
          kind: "organization",
          organizationId: existing.organizationId,
        })

        const [record] = await ctx.db
          .update(sites)
          .set({
            name: input.name,
            timezone: input.timezone ?? null,
            notes: input.notes ?? null,
          })
          .where(eq(sites.id, input.id))
          .returning()

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          organizationId: existing.organizationId,
          eventType: "site_updated",
          eventData: { siteId: record.id, name: record.name },
        })

        const [sshCredential] = await ctx.db
          .select()
          .from(siteSshCredentials)
          .where(eq(siteSshCredentials.siteId, record.id))

        return mapSiteWithSshCredential(record, sshCredential ?? null)
      }),
    generateSshCredential: adminProcedure
      .input(
        z.object({
          siteId: z.string().uuid(),
          username: z.string().min(1).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const [existing] = await ctx.db
          .select()
          .from(sites)
          .where(eq(sites.id, input.siteId))

        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        assertAuthorized(ctx.actor, "site:admin", {
          kind: "organization",
          organizationId: existing.organizationId,
        })

        const username = input.username?.trim() || "root"
        const keyPair = generateSiteSshKeyPair(
          existing.name.replaceAll(/\s+/g, "-").toLowerCase()
        )
        const sshCredential = await upsertSiteSshCredential(
          ctx.db,
          existing.id,
          username,
          keyPair.privateKey,
          keyPair.publicKey
        )

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          organizationId: existing.organizationId,
          eventType: "site_ssh_credential_generated",
          eventData: { siteId: existing.id },
        })

        return mapSiteWithSshCredential(existing, sshCredential)
      }),
    setSshCredential: adminProcedure
      .input(
        z.object({
          siteId: z.string().uuid(),
          username: z.string().min(1),
          privateKey: z.string().min(1),
          publicKey: z.string().min(1).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const [existing] = await ctx.db
          .select()
          .from(sites)
          .where(eq(sites.id, input.siteId))

        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        assertAuthorized(ctx.actor, "site:admin", {
          kind: "organization",
          organizationId: existing.organizationId,
        })

        let publicKey = input.publicKey?.trim() || ""
        try {
          publicKey =
            publicKey ||
            deriveOpenSshPublicKeyFromPrivateKey(
              input.privateKey,
              existing.name.replaceAll(/\s+/g, "-").toLowerCase()
            )
        } catch {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "We couldn't read that private key. Paste a valid key, or include the matching public key.",
          })
        }

        const sshCredential = await upsertSiteSshCredential(
          ctx.db,
          existing.id,
          input.username.trim(),
          input.privateKey.trim(),
          publicKey
        )

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          organizationId: existing.organizationId,
          eventType: "site_ssh_credential_set",
          eventData: { siteId: existing.id },
        })

        return mapSiteWithSshCredential(existing, sshCredential)
      }),
    clearSshCredential: adminProcedure
      .input(z.object({ siteId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const [existing] = await ctx.db
          .select()
          .from(sites)
          .where(eq(sites.id, input.siteId))

        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        assertAuthorized(ctx.actor, "site:admin", {
          kind: "organization",
          organizationId: existing.organizationId,
        })

        await ctx.db
          .delete(siteSshCredentials)
          .where(eq(siteSshCredentials.siteId, input.siteId))

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          organizationId: existing.organizationId,
          eventType: "site_ssh_credential_cleared",
          eventData: { siteId: existing.id },
        })

        return mapSiteWithSshCredential(existing, null)
      }),
    delete: adminProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const [existing] = await ctx.db
          .select()
          .from(sites)
          .where(eq(sites.id, input.id))

        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        assertAuthorized(ctx.actor, "site:admin", {
          kind: "organization",
          organizationId: existing.organizationId,
        })

        const [record] = await ctx.db
          .delete(sites)
          .where(eq(sites.id, input.id))
          .returning()

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          organizationId: existing.organizationId,
          eventType: "site_deleted",
          eventData: { siteId: existing.id, name: existing.name },
        })

        return record ?? existing
      }),
  }),
  devices: createTRPCRouter({
    list: permissionProcedure("device:view").query(async ({ ctx }) => {
      const organizationIds = actorOrganizationIds(ctx.actor)
      const siteIds = actorSiteIds(ctx.actor) ?? []

      if (organizationIds !== null) {
        const filters = []
        if (organizationIds.length > 0) {
          filters.push(inArray(devices.organizationId, organizationIds))
        }
        if (siteIds.length > 0) {
          filters.push(inArray(devices.siteId, siteIds))
        }

        if (filters.length === 0) {
          return []
        }

        const query = ctx.db
          .select({
            id: devices.id,
            organizationId: devices.organizationId,
            siteId: devices.siteId,
            siteName: sites.name,
            hostname: devices.hostname,
            displayName: devices.displayName,
            osFamily: devices.osFamily,
            osVersion: devices.osVersion,
            architecture: devices.architecture,
            serialNumber: devices.serialNumber,
            status: devices.status,
            lastSeenAt: devices.lastSeenAt,
            createdAt: devices.createdAt,
            vpnIpv4: vpnIdentities.vpnIpv4,
            vpnRoutePolicyId: vpnIdentities.routePolicyId,
            vpnLastHandshakeAt: vpnIdentities.lastHandshakeAt,
            vpnLatestEndpoint: vpnIdentities.latestEndpoint,
            vpnRxBytes: vpnIdentities.rxBytes,
            vpnTxBytes: vpnIdentities.txBytes,
            vpnRevokedAt: vpnIdentities.revokedAt,
          })
          .from(devices)
          .leftJoin(sites, eq(sites.id, devices.siteId))
          .leftJoin(vpnIdentities, eq(vpnIdentities.deviceId, devices.id))

        return filters.length === 1
          ? query.where(filters[0]).orderBy(desc(devices.createdAt))
          : query.where(or(...filters)).orderBy(desc(devices.createdAt))
      }

      return ctx.db
        .select({
          id: devices.id,
          organizationId: devices.organizationId,
          siteId: devices.siteId,
          siteName: sites.name,
          hostname: devices.hostname,
          displayName: devices.displayName,
          osFamily: devices.osFamily,
          osVersion: devices.osVersion,
          architecture: devices.architecture,
          serialNumber: devices.serialNumber,
          status: devices.status,
          lastSeenAt: devices.lastSeenAt,
          createdAt: devices.createdAt,
          vpnIpv4: vpnIdentities.vpnIpv4,
          vpnRoutePolicyId: vpnIdentities.routePolicyId,
          vpnLastHandshakeAt: vpnIdentities.lastHandshakeAt,
          vpnLatestEndpoint: vpnIdentities.latestEndpoint,
          vpnRxBytes: vpnIdentities.rxBytes,
          vpnTxBytes: vpnIdentities.txBytes,
          vpnRevokedAt: vpnIdentities.revokedAt,
        })
        .from(devices)
        .leftJoin(sites, eq(sites.id, devices.siteId))
        .leftJoin(vpnIdentities, eq(vpnIdentities.deviceId, devices.id))
        .orderBy(desc(devices.createdAt))
    }),
    byId: permissionProcedure("device:view")
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const [record] = await ctx.db
          .select()
          .from(devices)
          .where(eq(devices.id, input.id))

        if (!record) {
          return null
        }

        assertAuthorized(ctx.actor, "device:view", {
          kind: "device",
          organizationId: record.organizationId,
          siteId: record.siteId,
        })

        const [identity] = await ctx.db
          .select()
          .from(vpnIdentities)
          .where(eq(vpnIdentities.deviceId, record.id))

        const services = await ctx.db
          .select({
            service: managementServices,
            credential: managementServiceCredentials,
          })
          .from(managementServices)
          .leftJoin(
            managementServiceCredentials,
            eq(
              managementServiceCredentials.managementServiceId,
              managementServices.id
            )
          )
          .where(eq(managementServices.deviceId, record.id))
          .orderBy(desc(managementServices.createdAt))

        return {
          ...record,
          vpnIdentity: identity ?? null,
          services: services.map(({ service, credential }) => ({
            ...service,
            hasSavedPassword: Boolean(credential),
          })),
        }
      }),
    update: permissionProcedure("device:update")
      .input(deviceUpdateInput)
      .mutation(async ({ ctx, input }) => {
        const [existing] = await ctx.db
          .select()
          .from(devices)
          .where(eq(devices.id, input.id))

        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        assertAuthorized(ctx.actor, "device:update", {
          kind: "device",
          organizationId: existing.organizationId,
          siteId: existing.siteId,
        })

        if (input.siteId !== undefined && input.siteId !== null) {
          const [site] = await ctx.db
            .select()
            .from(sites)
            .where(eq(sites.id, input.siteId))

          if (
            !site ||
            !siteBelongsToOrganization(
              site.organizationId,
              existing.organizationId
            )
          ) {
            throw new TRPCError({ code: "BAD_REQUEST" })
          }
        }

        const patch: Record<string, string | null> = {}

        if (input.displayName !== undefined) {
          patch.displayName = input.displayName
        }

        if (input.hostname !== undefined) {
          patch.hostname = input.hostname
        }

        if (input.siteId !== undefined) {
          patch.siteId = input.siteId
        }

        if (Object.keys(patch).length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST" })
        }

        const [record] = await ctx.db
          .update(devices)
          .set(patch)
          .where(eq(devices.id, input.id))
          .returning()

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          organizationId: existing.organizationId,
          deviceId: existing.id,
          eventType:
            input.siteId !== undefined
              ? "device_site_assigned"
              : "device_updated",
          eventData: {
            deviceId: existing.id,
            siteId: input.siteId ?? existing.siteId,
            displayName: input.displayName ?? existing.displayName,
            hostname: input.hostname ?? existing.hostname,
          },
        })

        return record ?? null
      }),
    assignRoutePolicy: permissionProcedure("device:update")
      .input(deviceRoutePolicyInput)
      .mutation(async ({ ctx, input }) => {
        const [device] = await ctx.db
          .select()
          .from(devices)
          .where(eq(devices.id, input.id))

        if (!device) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        assertAuthorized(ctx.actor, "device:update", {
          kind: "device",
          organizationId: device.organizationId,
          siteId: device.siteId,
        })

        if (input.routePolicyId !== null) {
          const [policy] = await ctx.db
            .select()
            .from(routePolicies)
            .where(eq(routePolicies.id, input.routePolicyId))

          if (!policy) {
            throw new TRPCError({ code: "BAD_REQUEST" })
          }

          if (
            policy.organizationId &&
            policy.organizationId !== device.organizationId
          ) {
            throw new TRPCError({ code: "BAD_REQUEST" })
          }
        }

        const [record] = await ctx.db
          .update(vpnIdentities)
          .set({
            routePolicyId: input.routePolicyId,
          })
          .where(eq(vpnIdentities.deviceId, input.id))
          .returning()

        if (!record) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          organizationId: device.organizationId,
          deviceId: device.id,
          eventType: "device_updated",
          eventData: {
            deviceId: device.id,
            routePolicyId: input.routePolicyId,
          },
        })

        return record
      }),
    revokeVpn: permissionProcedure("device:revoke_vpn")
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const [device] = await ctx.db
          .select()
          .from(devices)
          .where(eq(devices.id, input.id))

        if (!device) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        assertAuthorized(ctx.actor, "device:revoke_vpn", {
          kind: "device",
          organizationId: device.organizationId,
          siteId: device.siteId,
        })

        const [record] = await ctx.db
          .update(vpnIdentities)
          .set({
            revokedAt: new Date(),
            serverPeerEnabled: false,
          })
          .where(eq(vpnIdentities.deviceId, input.id))
          .returning()

        if (!record) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          organizationId: device.organizationId,
          deviceId: input.id,
          eventType: "device_revoked",
          eventData: { revoked: true },
        })

        return record
      }),
    delete: permissionProcedure("device:update")
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const [existing] = await ctx.db
          .select()
          .from(devices)
          .where(eq(devices.id, input.id))

        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        assertAuthorized(ctx.actor, "device:update", {
          kind: "device",
          organizationId: existing.organizationId,
          siteId: existing.siteId,
        })

        const [record] = await ctx.db
          .delete(devices)
          .where(eq(devices.id, input.id))
          .returning()

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          organizationId: existing.organizationId,
          eventType: "device_deleted",
          eventData: {
            deviceId: existing.id,
            displayName: existing.displayName,
            hostname: existing.hostname,
          },
        })

        return record ?? existing
      }),
    services: permissionProcedure("device:view")
      .input(z.object({ deviceId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const [device] = await ctx.db
          .select()
          .from(devices)
          .where(eq(devices.id, input.deviceId))

        if (!device) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        assertAuthorized(ctx.actor, "device:view", {
          kind: "device",
          organizationId: device.organizationId,
          siteId: device.siteId,
        })

        return ctx.db
          .select()
          .from(managementServices)
          .where(eq(managementServices.deviceId, input.deviceId))
          .orderBy(desc(managementServices.createdAt))
      }),
  }),
  managementServices: createTRPCRouter({
    list: permissionProcedure("device:view")
      .input(z.object({ deviceId: z.string().uuid().optional() }).optional())
      .query(async ({ ctx, input }) => {
        const organizationIds = actorOrganizationIds(ctx.actor)
        const siteIds = actorSiteIds(ctx.actor) ?? []

        const query = ctx.db
          .select({
            service: managementServices,
            credential: managementServiceCredentials,
          })
          .from(managementServices)
          .leftJoin(
            managementServiceCredentials,
            eq(
              managementServiceCredentials.managementServiceId,
              managementServices.id
            )
          )
          .leftJoin(devices, eq(devices.id, managementServices.deviceId))

        if (input?.deviceId) {
          const [device] = await ctx.db
            .select()
            .from(devices)
            .where(eq(devices.id, input.deviceId))

          if (!device) {
            return []
          }

          assertAuthorized(ctx.actor, "device:view", {
            kind: "device",
            organizationId: device.organizationId,
            siteId: device.siteId,
          })

          const rows = await query
            .where(eq(managementServices.deviceId, input.deviceId))
            .orderBy(desc(managementServices.createdAt))

          return rows.map(({ service, credential }) => ({
            ...service,
            hasSavedPassword: Boolean(credential),
          }))
        }

        if (organizationIds !== null) {
          const filters = []
          if (organizationIds.length > 0) {
            filters.push(inArray(devices.organizationId, organizationIds))
          }
          if (siteIds.length > 0) {
            filters.push(inArray(devices.siteId, siteIds))
          }

          if (filters.length === 0) {
            return []
          }

          const rows =
            filters.length === 1
              ? await query
                  .where(filters[0])
                  .orderBy(desc(managementServices.createdAt))
              : await query
                  .where(or(...filters))
                  .orderBy(desc(managementServices.createdAt))

          return rows.map(({ service, credential }) => ({
            ...service,
            hasSavedPassword: Boolean(credential),
          }))
        }

        const rows = await query.orderBy(desc(managementServices.createdAt))

        return rows.map(({ service, credential }) => ({
          ...service,
          hasSavedPassword: Boolean(credential),
        }))
      }),
    create: permissionProcedure("device:update")
      .input(managementServiceCreateInput)
      .mutation(async ({ ctx, input }) => {
        const [device] = await ctx.db
          .select()
          .from(devices)
          .where(eq(devices.id, input.deviceId))

        if (!device) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        assertAuthorized(ctx.actor, "device:update", {
          kind: "device",
          organizationId: device.organizationId,
          siteId: device.siteId,
        })

        const [existing] = await ctx.db
          .select()
          .from(managementServices)
          .where(
            and(
              eq(managementServices.deviceId, input.deviceId),
              eq(managementServices.serviceType, input.serviceType)
            )
          )

        if (existing) {
          throw new TRPCError({ code: "CONFLICT" })
        }

        const defaults = serviceConnectionDefaults(input.serviceType)
        const [record] = await ctx.db
          .insert(managementServices)
          .values({
            ...input,
            protocol: defaults.protocol,
            port: defaults.port,
          })
          .returning()

        await copySiteSshCredentialToService(
          ctx.db,
          device,
          record.id,
          record.serviceType
        )

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          organizationId: device.organizationId,
          deviceId: device.id,
          eventType: "management_service_created",
          eventData: {
            serviceId: record.id,
            serviceType: record.serviceType,
            port: record.port,
          },
        })

        return record
      }),
    update: permissionProcedure("device:update")
      .input(managementServiceUpdateInput)
      .mutation(async ({ ctx, input }) => {
        const [existing] = await ctx.db
          .select()
          .from(managementServices)
          .where(eq(managementServices.id, input.id))

        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        const [device] = await ctx.db
          .select()
          .from(devices)
          .where(eq(devices.id, existing.deviceId))

        if (!device) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        assertAuthorized(ctx.actor, "device:update", {
          kind: "device",
          organizationId: device.organizationId,
          siteId: device.siteId,
        })

        const [duplicate] = await ctx.db
          .select()
          .from(managementServices)
          .where(
            and(
              eq(managementServices.deviceId, existing.deviceId),
              eq(managementServices.serviceType, input.serviceType)
            )
          )

        if (duplicate && duplicate.id !== existing.id) {
          throw new TRPCError({ code: "CONFLICT" })
        }

        const defaults = serviceConnectionDefaults(input.serviceType)
        const [record] = await ctx.db
          .update(managementServices)
          .set({
            serviceType: input.serviceType,
            protocol: defaults.protocol,
            port: defaults.port,
            enabled: input.enabled,
          })
          .where(eq(managementServices.id, input.id))
          .returning()

        if (record.enabled && record.serviceType === "ssh") {
          await copySiteSshCredentialToService(
            ctx.db,
            device,
            record.id,
            record.serviceType
          )
        }

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          organizationId: device.organizationId,
          deviceId: device.id,
          eventType: "management_service_updated",
          eventData: {
            serviceId: record.id,
            serviceType: record.serviceType,
            port: record.port,
            enabled: record.enabled,
          },
        })

        return record
      }),
    delete: permissionProcedure("device:update")
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const [existing] = await ctx.db
          .select()
          .from(managementServices)
          .where(eq(managementServices.id, input.id))

        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        const [device] = await ctx.db
          .select()
          .from(devices)
          .where(eq(devices.id, existing.deviceId))

        if (!device) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        assertAuthorized(ctx.actor, "device:update", {
          kind: "device",
          organizationId: device.organizationId,
          siteId: device.siteId,
        })

        const [record] = await ctx.db
          .delete(managementServices)
          .where(eq(managementServices.id, input.id))
          .returning()

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          organizationId: device.organizationId,
          deviceId: device.id,
          eventType: "management_service_deleted",
          eventData: {
            serviceId: existing.id,
            serviceType: existing.serviceType,
          },
        })

        return record ?? existing
      }),
    setCredential: permissionProcedure("device:update")
      .input(
        z.object({
          id: z.string().uuid(),
          password: z.string().min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const [service] = await ctx.db
          .select()
          .from(managementServices)
          .where(eq(managementServices.id, input.id))

        if (!service) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        const [device] = await ctx.db
          .select()
          .from(devices)
          .where(eq(devices.id, service.deviceId))

        if (!device) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        assertAuthorized(ctx.actor, "device:update", {
          kind: "device",
          organizationId: device.organizationId,
          siteId: device.siteId,
        })

        if (service.serviceType !== "vnc" && service.serviceType !== "rdp") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Saved passwords are only supported for VNC and RDP services",
          })
        }

        const encrypted = encryptVncPassword(input.password)

        const [record] = await ctx.db
          .insert(managementServiceCredentials)
          .values({
            managementServiceId: input.id,
            passwordCiphertext: encrypted.ciphertext,
            passwordIv: encrypted.iv,
            passwordAuthTag: encrypted.authTag,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: managementServiceCredentials.managementServiceId,
            set: {
              passwordCiphertext: encrypted.ciphertext,
              passwordIv: encrypted.iv,
              passwordAuthTag: encrypted.authTag,
              updatedAt: new Date(),
            },
          })
          .returning()

        return record
      }),
    setSshCredential: permissionProcedure("device:update")
      .input(
        z.object({
          id: z.string().uuid(),
          username: z.string().min(1),
          privateKey: z.string().min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const [service] = await ctx.db
          .select()
          .from(managementServices)
          .where(eq(managementServices.id, input.id))

        if (!service) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        const [device] = await ctx.db
          .select()
          .from(devices)
          .where(eq(devices.id, service.deviceId))

        if (!device) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        assertAuthorized(ctx.actor, "device:update", {
          kind: "device",
          organizationId: device.organizationId,
          siteId: device.siteId,
        })

        if (service.serviceType !== "ssh") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Saved SSH keys are only supported for SSH services",
          })
        }

        const encryptedUsername = encryptRemoteSecret(input.username)
        const encryptedPrivateKey = encryptRemoteSecret(input.privateKey)

        const [record] = await ctx.db
          .insert(managementServiceCredentials)
          .values({
            managementServiceId: input.id,
            passwordCiphertext: encryptedPrivateKey.ciphertext,
            passwordIv: encryptedPrivateKey.iv,
            passwordAuthTag: encryptedPrivateKey.authTag,
            usernameCiphertext: encryptedUsername.ciphertext,
            usernameIv: encryptedUsername.iv,
            usernameAuthTag: encryptedUsername.authTag,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: managementServiceCredentials.managementServiceId,
            set: {
              passwordCiphertext: encryptedPrivateKey.ciphertext,
              passwordIv: encryptedPrivateKey.iv,
              passwordAuthTag: encryptedPrivateKey.authTag,
              usernameCiphertext: encryptedUsername.ciphertext,
              usernameIv: encryptedUsername.iv,
              usernameAuthTag: encryptedUsername.authTag,
              updatedAt: new Date(),
            },
          })
          .returning()

        return record
      }),
    clearCredential: permissionProcedure("device:update")
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const [service] = await ctx.db
          .select()
          .from(managementServices)
          .where(eq(managementServices.id, input.id))

        if (!service) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        const [device] = await ctx.db
          .select()
          .from(devices)
          .where(eq(devices.id, service.deviceId))

        if (!device) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        assertAuthorized(ctx.actor, "device:update", {
          kind: "device",
          organizationId: device.organizationId,
          siteId: device.siteId,
        })

        const [record] = await ctx.db
          .delete(managementServiceCredentials)
          .where(eq(managementServiceCredentials.managementServiceId, input.id))
          .returning()

        return record ?? null
      }),
  }),
  routePolicies: createTRPCRouter({
    list: adminProcedure.query(async ({ ctx }) => {
      const organizationIds = actorOrganizationIds(ctx.actor)

      if (organizationIds === null) {
        return ctx.db.select().from(routePolicies).orderBy(routePolicies.name)
      }

      if (organizationIds.length === 0) {
        return []
      }

      return ctx.db
        .select()
        .from(routePolicies)
        .where(inArray(routePolicies.organizationId, organizationIds))
        .orderBy(routePolicies.name)
    }),
    create: adminProcedure
      .input(routePolicyCreateInput)
      .mutation(async ({ ctx, input }) => {
        assertAuthorized(ctx.actor, "organization:admin", {
          kind: "organization",
          organizationId: input.organizationId,
        })

        const [record] = await ctx.db
          .insert(routePolicies)
          .values({
            organizationId: input.organizationId,
            name: input.name,
            routes: normalizeRouteValues(input.routes),
            description: input.description ?? null,
          })
          .returning()

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          eventType: "route_policy_created",
          eventData: {
            routePolicyId: record.id,
            name: record.name,
          },
        })

        return record
      }),
    update: adminProcedure
      .input(routePolicyUpdateInput)
      .mutation(async ({ ctx, input }) => {
        const [existing] = await ctx.db
          .select()
          .from(routePolicies)
          .where(eq(routePolicies.id, input.id))

        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        if (existing.organizationId) {
          assertAuthorized(ctx.actor, "organization:admin", {
            kind: "organization",
            organizationId: existing.organizationId,
          })
        } else {
          assertAuthorized(ctx.actor, "organization:admin", {
            kind: "platform",
          })
        }

        const [record] = await ctx.db
          .update(routePolicies)
          .set({
            organizationId: existing.organizationId,
            name: input.name,
            routes: normalizeRouteValues(input.routes),
            description: input.description ?? null,
          })
          .where(eq(routePolicies.id, input.id))
          .returning()

        if (!record) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          eventType: "route_policy_updated",
          eventData: {
            routePolicyId: record.id,
            name: record.name,
          },
        })

        return record
      }),
    delete: adminProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const [existing] = await ctx.db
          .select()
          .from(routePolicies)
          .where(eq(routePolicies.id, input.id))

        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        if (existing.organizationId) {
          assertAuthorized(ctx.actor, "organization:admin", {
            kind: "organization",
            organizationId: existing.organizationId,
          })
        } else {
          assertAuthorized(ctx.actor, "organization:admin", {
            kind: "platform",
          })
        }

        const [record] = await ctx.db
          .delete(routePolicies)
          .where(eq(routePolicies.id, input.id))
          .returning()

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          eventType: "route_policy_deleted",
          eventData: {
            routePolicyId: existing.id,
            name: existing.name,
          },
        })

        return record ?? existing
      }),
  }),
  enrollmentTokens: createTRPCRouter({
    list: adminProcedure.query(async ({ ctx }) => {
      const organizationIds = actorOrganizationIds(ctx.actor)

      const query = ctx.db
        .select({
          id: enrollmentTokens.id,
          organizationId: enrollmentTokens.organizationId,
          siteId: enrollmentTokens.siteId,
          siteWide: enrollmentTokens.siteWide,
          routePolicyId: enrollmentTokens.routePolicyId,
          expiresAt: enrollmentTokens.expiresAt,
          maxUses: enrollmentTokens.maxUses,
          uses: enrollmentTokens.uses,
          createdAt: enrollmentTokens.createdAt,
          organizationName: organizations.name,
          siteName: sites.name,
          routePolicyName: routePolicies.name,
        })
        .from(enrollmentTokens)
        .leftJoin(
          organizations,
          eq(organizations.id, enrollmentTokens.organizationId)
        )
        .leftJoin(sites, eq(sites.id, enrollmentTokens.siteId))
        .leftJoin(
          routePolicies,
          eq(routePolicies.id, enrollmentTokens.routePolicyId)
        )

      if (organizationIds === null) {
        return query.orderBy(desc(enrollmentTokens.createdAt))
      }

      if (organizationIds.length === 0) {
        return []
      }

      return query
        .where(inArray(enrollmentTokens.organizationId, organizationIds))
        .orderBy(desc(enrollmentTokens.createdAt))
    }),
    create: permissionProcedure("device:enroll")
      .input(enrollmentTokenInput)
      .mutation(async ({ ctx, input }) => {
        assertAuthorized(ctx.actor, "device:enroll", {
          kind: "enrollmentToken",
          organizationId: input.organizationId,
          siteId: input.siteId ?? null,
        })

        if (input.siteWide) {
          const activeTokens = await ctx.db
            .select({
              id: enrollmentTokens.id,
              expiresAt: enrollmentTokens.expiresAt,
            })
            .from(enrollmentTokens)
            .where(
              and(
                eq(enrollmentTokens.organizationId, input.organizationId),
                eq(enrollmentTokens.siteWide, true),
                input.siteId
                  ? eq(enrollmentTokens.siteId, input.siteId)
                  : isNull(enrollmentTokens.siteId)
              )
            )

          const hasActiveToken = activeTokens.some(
            (token) =>
              !token.expiresAt || token.expiresAt.getTime() > Date.now()
          )

          if (hasActiveToken) {
            throw new TRPCError({
              code: "CONFLICT",
              message: input.siteId
                ? "An active shared token already exists for this site."
                : "An active shared imaging token already exists for this organization.",
            })
          }
        }

        const rawToken = makeEnrollmentToken()
        const tokenHash = hashEnrollmentToken(rawToken)
        const expiresAt = input.siteId ? (input.expiresAt ?? null) : null

        if (!input.siteId) {
          const [organization] = await ctx.db
            .select()
            .from(organizations)
            .where(eq(organizations.id, input.organizationId))

          if (!organization) {
            throw new TRPCError({ code: "NOT_FOUND" })
          }

          await ensureOrganizationSshCredential(ctx.db, organization)
        }

        const [record] = await ctx.db
          .insert(enrollmentTokens)
          .values({
            organizationId: input.organizationId,
            siteId: input.siteId ?? null,
            siteWide: input.siteWide,
            routePolicyId: input.routePolicyId ?? null,
            expiresAt,
            maxUses: input.maxUses,
            tokenHash,
            createdByUserId: ctx.actor?.id ?? null,
          })
          .returning()

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          organizationId: input.organizationId,
          eventType: "enrollment_token_created",
          eventData: { tokenId: record.id },
        })

        return {
          token: rawToken,
          enrollmentToken: record,
        }
      }),
    update: permissionProcedure("device:enroll")
      .input(enrollmentTokenUpdateSchema)
      .mutation(async ({ ctx, input }) => {
        const [existing] = await ctx.db
          .select()
          .from(enrollmentTokens)
          .where(eq(enrollmentTokens.id, input.id))

        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        assertAuthorized(ctx.actor, "device:enroll", {
          kind: "enrollmentToken",
          organizationId: existing.organizationId,
          siteId: existing.siteId,
        })

        if (input.siteId) {
          const [site] = await ctx.db
            .select()
            .from(sites)
            .where(eq(sites.id, input.siteId))

          if (
            !site ||
            !siteBelongsToOrganization(
              site.organizationId,
              input.organizationId
            )
          ) {
            throw new TRPCError({ code: "BAD_REQUEST" })
          }
        }

        if (input.siteWide) {
          const activeTokens = await ctx.db
            .select({
              id: enrollmentTokens.id,
              expiresAt: enrollmentTokens.expiresAt,
            })
            .from(enrollmentTokens)
            .where(
              and(
                eq(enrollmentTokens.organizationId, input.organizationId),
                eq(enrollmentTokens.siteWide, true),
                input.siteId
                  ? eq(enrollmentTokens.siteId, input.siteId)
                  : isNull(enrollmentTokens.siteId)
              )
            )

          const hasActiveToken = activeTokens.some(
            (token) =>
              token.id !== input.id &&
              (!token.expiresAt || token.expiresAt.getTime() > Date.now())
          )

          if (hasActiveToken) {
            throw new TRPCError({
              code: "CONFLICT",
              message: input.siteId
                ? "An active shared token already exists for this site."
                : "An active shared imaging token already exists for this organization.",
            })
          }
        }

        const expiresAt = input.siteId ? (input.expiresAt ?? null) : null

        const [record] = await ctx.db
          .update(enrollmentTokens)
          .set({
            organizationId: input.organizationId,
            siteId: input.siteId ?? null,
            siteWide: input.siteWide,
            routePolicyId: input.routePolicyId ?? null,
            expiresAt,
            maxUses: input.maxUses,
          })
          .where(eq(enrollmentTokens.id, input.id))
          .returning()

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          organizationId: input.organizationId,
          eventType: "enrollment_token_updated",
          eventData: {
            tokenId: record.id,
            organizationId: input.organizationId,
            siteId: input.siteId ?? null,
            siteWide: input.siteWide,
            routePolicyId: input.routePolicyId ?? null,
            expiresAt: expiresAt?.toISOString() ?? null,
            maxUses: input.maxUses,
          },
        })

        return record
      }),
    revoke: permissionProcedure("device:enroll")
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const [existing] = await ctx.db
          .select()
          .from(enrollmentTokens)
          .where(eq(enrollmentTokens.id, input.id))

        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        assertAuthorized(ctx.actor, "device:enroll", {
          kind: "enrollmentToken",
          organizationId: existing.organizationId,
          siteId: existing.siteId,
        })

        const [record] = await ctx.db
          .delete(enrollmentTokens)
          .where(eq(enrollmentTokens.id, input.id))
          .returning()

        await ctx.db.insert(auditEvents).values({
          actorUserId: ctx.actor?.id,
          organizationId: existing.organizationId,
          eventType: "enrollment_token_revoked",
          eventData: {
            tokenId: existing.id,
          },
        })

        return record ?? existing
      }),
  }),
  audit: createTRPCRouter({
    list: permissionProcedure("audit:view")
      .input(auditListInput)
      .query(async ({ ctx, input }) => {
        if (input.organizationId) {
          assertAuthorized(ctx.actor, "audit:view", {
            kind: "organization",
            organizationId: input.organizationId,
          })

          return ctx.db
            .select()
            .from(auditEvents)
            .where(eq(auditEvents.organizationId, input.organizationId))
            .orderBy(desc(auditEvents.createdAt))
        }

        if (input.deviceId) {
          const [device] = await ctx.db
            .select()
            .from(devices)
            .where(eq(devices.id, input.deviceId))

          if (!device) {
            return []
          }

          assertAuthorized(ctx.actor, "audit:view", {
            kind: "device",
            organizationId: device.organizationId,
            siteId: device.siteId,
          })

          return ctx.db
            .select()
            .from(auditEvents)
            .where(eq(auditEvents.deviceId, input.deviceId))
            .orderBy(desc(auditEvents.createdAt))
        }

        const organizationIds = actorOrganizationIds(ctx.actor)
        const siteIds = actorSiteIds(ctx.actor) ?? []

        if (organizationIds === null) {
          return ctx.db
            .select()
            .from(auditEvents)
            .orderBy(desc(auditEvents.createdAt))
        }

        const filters = []

        if (organizationIds.length > 0) {
          filters.push(inArray(auditEvents.organizationId, organizationIds))
        }

        if (siteIds.length > 0) {
          const accessibleDeviceIds = await ctx.db
            .select({ id: devices.id })
            .from(devices)
            .where(inArray(devices.siteId, siteIds))

          const deviceIds = accessibleDeviceIds.map((entry) => entry.id)
          if (deviceIds.length > 0) {
            filters.push(inArray(auditEvents.deviceId, deviceIds))
          }
        }

        if (filters.length === 0) {
          return []
        }

        return filters.length === 1
          ? ctx.db
              .select()
              .from(auditEvents)
              .where(filters[0])
              .orderBy(desc(auditEvents.createdAt))
          : ctx.db
              .select()
              .from(auditEvents)
              .where(or(...filters))
              .orderBy(desc(auditEvents.createdAt))
      }),
  }),
  sessions: createTRPCRouter({
    create: permissionProcedure("device:view")
      .input(sessionCreateInput)
      .mutation(async ({ ctx, input }) => {
        const [serviceRow] = await ctx.db
          .select({
            service: managementServices,
            credential: managementServiceCredentials,
          })
          .from(managementServices)
          .leftJoin(
            managementServiceCredentials,
            eq(
              managementServiceCredentials.managementServiceId,
              managementServices.id
            )
          )
          .where(eq(managementServices.id, input.serviceId))

        if (!serviceRow) {
          return null
        }

        const { service, credential } = serviceRow
        const requiredPermission = permissionForServiceType(
          service.serviceType as "vnc" | "rdp" | "ssh" | "winrm_https"
        )

        if (
          service.serviceType !== "vnc" &&
          service.serviceType !== "rdp" &&
          service.serviceType !== "ssh"
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "This launch path only supports VNC, RDP, and SSH services",
          })
        }

        const [device] = await ctx.db
          .select()
          .from(devices)
          .where(eq(devices.id, input.deviceId))

        if (!device) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        assertAuthorized(ctx.actor, requiredPermission, {
          kind: "service",
          organizationId: device.organizationId,
          siteId: device.siteId,
          deviceId: device.id,
          serviceId: service.id,
          serviceType: service.serviceType,
        })

        const [identity] = await ctx.db
          .select()
          .from(vpnIdentities)
          .where(eq(vpnIdentities.deviceId, device.id))

        if (!identity) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Device is not connected",
          })
        }

        if (service.deviceId !== device.id) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Service does not belong to the selected device",
          })
        }

        const password =
          service.serviceType === "vnc" || service.serviceType === "rdp"
            ? decodePasswordRecord(credential)
            : null
        let sshCredential: {
          username: string | null
          privateKey: string | null
        } =
          service.serviceType === "ssh"
            ? decodeSshCredentialRecord(credential)
            : { username: null, privateKey: null }

        if (
          service.serviceType === "ssh" &&
          (!sshCredential.username || !sshCredential.privateKey) &&
          device.siteId
        ) {
          const [siteCredential] = await ctx.db
            .select()
            .from(siteSshCredentials)
            .where(eq(siteSshCredentials.siteId, device.siteId))

          const decodedSite = decodeSiteSshCredentialRecord(
            siteCredential ?? null
          )
          sshCredential = {
            username: sshCredential.username ?? decodedSite.username,
            privateKey: sshCredential.privateKey ?? decodedSite.privateKey,
          }
        }

        if (
          service.serviceType === "ssh" &&
          (!sshCredential.username || !sshCredential.privateKey)
        ) {
          const [organizationCredential] = await ctx.db
            .select()
            .from(organizationSshCredentials)
            .where(
              eq(
                organizationSshCredentials.organizationId,
                device.organizationId
              )
            )

          const decodedOrganization = decodeOrganizationSshCredentialRecord(
            organizationCredential ?? null
          )
          sshCredential = {
            username: sshCredential.username ?? decodedOrganization.username,
            privateKey:
              sshCredential.privateKey ?? decodedOrganization.privateKey,
          }
        }

        const host = normalizeVpnIpv4(String(identity.vpnIpv4))
        const actor = requireActor(ctx.actor)

        const canLaunchNative =
          input.connectionMethod === "native" &&
          ((service.serviceType === "vnc" && Boolean(password)) ||
            (service.serviceType === "ssh" && Boolean(sshCredential.username)))

        if (canLaunchNative) {
          let nativeUrl: string
          try {
            nativeUrl = buildNativeAppUrl({
              serviceType: service.serviceType as "vnc" | "ssh",
              hostname: host,
              port: service.port,
              password,
              username: sshCredential.username,
            })
          } catch (error) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                error instanceof Error
                  ? error.message
                  : "Could not build native launch link",
            })
          }

          const [record] = await ctx.db
            .insert(remoteSessions)
            .values({
              adminUserId: actor.id,
              deviceId: device.id,
              managementServiceId: input.serviceId,
              status: "starting",
              connectionMethod: "native",
              auditMetadata: {
                requestedBy: actor.email,
                serviceType: service.serviceType,
                nativeHost: host,
                nativePort: service.port,
              },
            })
            .returning()

          return {
            session: record,
            url: null,
            nativeUrl,
            mode: "native" as const,
          }
        }

        if (
          input.connectionMethod !== "guacamole" &&
          input.connectionMethod !== "native"
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Unsupported remote access provider",
          })
        }

        const launchId = randomUUID()

        const session = await guacamoleProvider.createSession({
          deviceId: device.id,
          serviceId: service.id,
          serviceType: service.serviceType,
          adminUserId: actor.id,
          connectionMethod: "guacamole",
          hostname: host,
          port: service.port,
          password,
          username: sshCredential.username,
          privateKey: sshCredential.privateKey,
          launchId,
        })

        const launchUrl = new URL(
          "/api/guacamole/launch",
          process.env.APP_BASE_URL ??
            process.env.BETTER_AUTH_URL ??
            "http://localhost:3000"
        )
        launchUrl.searchParams.set("target", session.url)

        const [record] = await ctx.db
          .insert(remoteSessions)
          .values({
            adminUserId: actor.id,
            deviceId: device.id,
            managementServiceId: input.serviceId,
            status: "starting",
            connectionMethod: "guacamole",
            auditMetadata: {
              requestedBy: actor.email,
              serviceType: service.serviceType,
              guacamoleSessionId: session.sessionId,
              guacamoleLaunchId: launchId,
              nativeRequested: input.connectionMethod === "native",
            },
          })
          .returning()

        return {
          session: record,
          url: launchUrl.toString(),
          nativeUrl: null,
          mode: "guacamole" as const,
        }
      }),
  }),
  adminVpn: createTRPCRouter({
    list: permissionProcedure("vpn:admin_profile").query(async ({ ctx }) => {
      const actor = requireActor(ctx.actor)
      const organizationIds = actorOrganizationIds(actor)

      if (organizationIds !== null && organizationIds.length === 0) {
        return []
      }

      const rows = await ctx.db
        .select({
          profile: adminVpnProfiles,
          organizationName: organizations.name,
          userName: user.name,
          userEmail: user.email,
        })
        .from(adminVpnProfiles)
        .innerJoin(
          organizations,
          eq(organizations.id, adminVpnProfiles.organizationId)
        )
        .innerJoin(user, eq(user.id, adminVpnProfiles.userId))
        .where(
          organizationIds === null
            ? undefined
            : inArray(adminVpnProfiles.organizationId, organizationIds)
        )
        .orderBy(desc(adminVpnProfiles.createdAt))

      return rows
        .filter((row) => {
          try {
            assertAuthorized(actor, "vpn:admin_profile", {
              kind: "organization",
              organizationId: row.profile.organizationId,
            })
            return true
          } catch {
            return false
          }
        })
        .map((row) => ({
          ...serializeAdminVpnProfile(row.profile),
          organizationName: row.organizationName,
          userName: row.userName,
          userEmail: row.userEmail,
          isOwnProfile: row.profile.userId === actor.id,
        }))
    }),
    create: permissionProcedure("vpn:admin_profile")
      .input(
        z.object({
          organizationId: z.string().uuid(),
          label: z.string().trim().min(1).max(120).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const actor = requireActor(ctx.actor)
        assertAuthorized(actor, "vpn:admin_profile", {
          kind: "organization",
          organizationId: input.organizationId,
        })

        const [organization] = await ctx.db
          .select()
          .from(organizations)
          .where(eq(organizations.id, input.organizationId))

        if (!organization) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        const [existing] = await ctx.db
          .select()
          .from(adminVpnProfiles)
          .where(
            and(
              eq(adminVpnProfiles.organizationId, input.organizationId),
              eq(adminVpnProfiles.userId, actor.id)
            )
          )

        if (existing && !existing.revokedAt && existing.serverPeerEnabled) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "An admin VPN profile already exists for this organization",
          })
        }

        const vpnConfig = requireVpnServerConfig()
        const keyPair = generateWireGuardKeyPair()
        const now = new Date()

        let profile: typeof adminVpnProfiles.$inferSelect
        let vpnIpv4: string

        if (existing) {
          vpnIpv4 = String(existing.vpnIpv4)
          const [updated] = await ctx.db
            .update(adminVpnProfiles)
            .set({
              wireguardPublicKey: keyPair.publicKey,
              label: input.label ?? existing.label,
              serverPeerEnabled: true,
              revokedAt: null,
              updatedAt: now,
            })
            .where(eq(adminVpnProfiles.id, existing.id))
            .returning()
          profile = updated
        } else {
          const existingAdminIps = await ctx.db
            .select({ vpnIpv4: adminVpnProfiles.vpnIpv4 })
            .from(adminVpnProfiles)
          vpnIpv4 = allocateVpnIpv4(
            existingAdminIps.map((row) => String(row.vpnIpv4)),
            { pool: "admin" }
          )

          const [created] = await ctx.db
            .insert(adminVpnProfiles)
            .values({
              organizationId: input.organizationId,
              userId: actor.id,
              vpnIpv4,
              wireguardPublicKey: keyPair.publicKey,
              label: input.label ?? null,
              serverPeerEnabled: true,
              revokedAt: null,
              createdAt: now,
              updatedAt: now,
            })
            .returning()
          profile = created
        }

        await ctx.db.insert(auditEvents).values({
          actorUserId: actor.id,
          organizationId: input.organizationId,
          eventType: existing ? "admin_vpn_reissued" : "admin_vpn_created",
          eventData: {
            profileId: profile.id,
            vpnIpv4: normalizeVpnIpv4(vpnIpv4),
          },
        })

        const config = buildAdminClientConfig({
          privateKey: keyPair.privateKey,
          vpnIp: vpnIpv4,
          serverPublicKey: vpnConfig.serverPublicKey,
          endpoint: vpnConfig.endpoint,
        })

        return {
          profile: serializeAdminVpnProfile(profile),
          config,
          filename: adminVpnConfigFilename(organization.name, vpnIpv4),
        }
      }),
    reissue: permissionProcedure("vpn:admin_profile")
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const actor = requireActor(ctx.actor)
        const [profile] = await ctx.db
          .select()
          .from(adminVpnProfiles)
          .where(eq(adminVpnProfiles.id, input.id))

        if (!profile) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        assertAuthorized(actor, "vpn:admin_profile", {
          kind: "organization",
          organizationId: profile.organizationId,
        })

        if (
          profile.userId !== actor.id &&
          actor.platformRole !== "owner" &&
          actor.platformRole !== "admin"
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You can only reissue your own admin VPN profile",
          })
        }

        const [organization] = await ctx.db
          .select()
          .from(organizations)
          .where(eq(organizations.id, profile.organizationId))

        if (!organization) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        const vpnConfig = requireVpnServerConfig()
        const keyPair = generateWireGuardKeyPair()
        const now = new Date()

        const [updated] = await ctx.db
          .update(adminVpnProfiles)
          .set({
            wireguardPublicKey: keyPair.publicKey,
            serverPeerEnabled: true,
            revokedAt: null,
            updatedAt: now,
          })
          .where(eq(adminVpnProfiles.id, profile.id))
          .returning()

        await ctx.db.insert(auditEvents).values({
          actorUserId: actor.id,
          organizationId: profile.organizationId,
          eventType: "admin_vpn_reissued",
          eventData: {
            profileId: profile.id,
            vpnIpv4: normalizeVpnIpv4(String(profile.vpnIpv4)),
          },
        })

        const config = buildAdminClientConfig({
          privateKey: keyPair.privateKey,
          vpnIp: String(profile.vpnIpv4),
          serverPublicKey: vpnConfig.serverPublicKey,
          endpoint: vpnConfig.endpoint,
        })

        return {
          profile: serializeAdminVpnProfile(updated),
          config,
          filename: adminVpnConfigFilename(
            organization.name,
            String(profile.vpnIpv4)
          ),
        }
      }),
    revoke: permissionProcedure("vpn:admin_profile")
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const actor = requireActor(ctx.actor)
        const [profile] = await ctx.db
          .select()
          .from(adminVpnProfiles)
          .where(eq(adminVpnProfiles.id, input.id))

        if (!profile) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        assertAuthorized(actor, "vpn:admin_profile", {
          kind: "organization",
          organizationId: profile.organizationId,
        })

        if (
          profile.userId !== actor.id &&
          actor.platformRole !== "owner" &&
          actor.platformRole !== "admin"
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You can only revoke your own admin VPN profile",
          })
        }

        const now = new Date()
        const [updated] = await ctx.db
          .update(adminVpnProfiles)
          .set({
            serverPeerEnabled: false,
            revokedAt: now,
            updatedAt: now,
          })
          .where(eq(adminVpnProfiles.id, profile.id))
          .returning()

        await ctx.db.insert(auditEvents).values({
          actorUserId: actor.id,
          organizationId: profile.organizationId,
          eventType: "admin_vpn_revoked",
          eventData: {
            profileId: profile.id,
            vpnIpv4: normalizeVpnIpv4(String(profile.vpnIpv4)),
          },
        })

        return serializeAdminVpnProfile(updated)
      }),
  }),
})

export type AppRouter = typeof appRouter
