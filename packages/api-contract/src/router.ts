import { createHash, randomUUID } from "node:crypto"

import { TRPCError } from "@trpc/server"
import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm"
import { z } from "zod"

import {
  adminProcedure,
  createTRPCRouter,
  permissionProcedure,
  publicProcedure,
} from "./trpc"
import {
  actorOrganizationIds,
  actorSiteIds,
  assertAuthorized,
  manageableOrganizationIds,
} from "./access"
import { writeAuditEvent } from "./audit"
import { issueLaunchTicket, redeemLaunchTicket } from "./launch-ticket"
import { auditRouter } from "./routers/activity"
import { alertsRouter } from "./routers/alerts"
import { apiKeysRouter } from "./routers/api-keys"
import { alertPoliciesRouter } from "./routers/alert-policies"
import { assetsRouter } from "./routers/assets"
import { customFieldsRouter } from "./routers/custom-fields"
import { dashboardRouter } from "./routers/dashboard"
import { devicesRouter } from "./routers/devices"
import { maintenanceRouter } from "./routers/maintenance"
import { networkRouter } from "./routers/network"
import { notificationsRouter } from "./routers/notifications"
import { reportsRouter } from "./routers/reports"
import { fleetRouter } from "./routers/fleet"
import { playbooksRouter } from "./routers/playbooks"
import { routePoliciesRouter } from "./routers/route-policies"
import { sessionsPage } from "./routers/sessions-page"
import { sessionsTerminate } from "./routers/sessions-terminate"
import { accessRequestsRouter } from "./routers/access-requests"
import { systemRouter } from "./routers/system"
import { telemetryRouter } from "./routers/telemetry"
import { usersRouter } from "./routers/users"
import { ssoRouter } from "./routers/sso"
import { getRemoteAccessProvider } from "./remote-session-provider"
import {
  consumeAccessRequest,
  resolveSessionAccessGate,
} from "./session-access-gate"
import {
  buildOrderBy,
  likePattern,
  listQuerySchema,
  paginate,
  resolveListQuery,
} from "./list"
import { combineConditions, deviceScopeCondition } from "./scope"
import {
  adminVpnProfiles,
  auditEvents,
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
  buildNativeAppUrl,
  type EncryptedSecret,
} from "@nms/remote-access"
import {
  BROWSER_CONNECTION_METHOD,
  enrollmentTokenCreateSchema,
  enrollmentTokenUpdateSchema,
  membershipStatuses,
  organizationRoles,
  parseSiteBulkCsv,
  remoteSessionRequestSchema,
  siteBusinessHoursSchema,
  siteContactSchema,
  siteRoles,
  type ServiceType,
} from "@nms/shared"
import { recordingPathForConnection } from "@nms/shared/session-recording"
import {
  allocateVpnIpv4,
  buildAdminClientConfig,
  generateWireGuardKeyPair,
  normalizeVpnIpv4,
} from "@nms/vpn"
import {
  adminVpnConfigFilename,
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

function issueEnrollmentTokenSecret() {
  const token = makeEnrollmentToken()
  const encrypted = encryptRemoteSecret(token)
  return {
    token,
    tokenHash: hashEnrollmentToken(token),
    tokenCiphertext: encrypted.ciphertext,
    tokenIv: encrypted.iv,
    tokenAuthTag: encrypted.authTag,
  }
}

function decryptEnrollmentTokenSecret(row: {
  tokenCiphertext: string | null
  tokenIv: string | null
  tokenAuthTag: string | null
}) {
  if (!row.tokenCiphertext || !row.tokenIv || !row.tokenAuthTag) {
    return null
  }

  try {
    return decryptRemoteSecret({
      ciphertext: row.tokenCiphertext,
      iv: row.tokenIv,
      authTag: row.tokenAuthTag,
    })
  } catch {
    return null
  }
}

function publicEnrollmentTokenRecord(
  record: typeof enrollmentTokens.$inferSelect
) {
  return {
    id: record.id,
    organizationId: record.organizationId,
    siteId: record.siteId,
    siteWide: record.siteWide,
    routePolicyId: record.routePolicyId,
    expiresAt: record.expiresAt,
    maxUses: record.maxUses,
    uses: record.uses,
    createdByUserId: record.createdByUserId,
    createdAt: record.createdAt,
  }
}

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

const MAX_ADMIN_VPN_PROFILES_PER_ORG = 10

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
    allowSameUserAccess: profile.allowSameUserAccess,
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

function assertCanManageAdminVpnProfile(
  actor: ReturnType<typeof requireActor>,
  profile: typeof adminVpnProfiles.$inferSelect,
  action: string
) {
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
      message: `You can only ${action} your own admin VPN profiles`,
    })
  }
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
  address: z.string().trim().max(500).optional().nullable(),
  contacts: z.array(siteContactSchema).max(8).optional(),
  businessHours: siteBusinessHoursSchema.nullable().optional(),
  requireAccessReason: z.boolean().optional(),
  requireApproval: z.boolean().optional(),
})

const siteUpdateInput = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  timezone: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
  contacts: z.array(siteContactSchema).max(8).optional(),
  businessHours: siteBusinessHoursSchema.nullable().optional(),
  requireAccessReason: z.boolean().optional(),
  requireApproval: z.boolean().optional(),
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

const enrollmentTokenInput = enrollmentTokenCreateSchema

const sessionCreateInput = remoteSessionRequestSchema.extend({
  deviceId: z.string().uuid(),
})

const organizationRoleValues = organizationRoles
const siteRoleValues = siteRoles
const membershipStatusValues = membershipStatuses

const accessOrganizationMembersInput = z.object({
  organizationId: z.string().uuid(),
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
      uiScope: actor.uiScope ?? "admin",
      security: actor.security ?? {
        twoFactorEnabled: false,
        mustChangePassword: false,
        passkeyCount: 0,
        lastLoginAt: null,
      },
      canManageUsers: (() => {
        const manageable = manageableOrganizationIds(actor)
        return manageable === null || manageable.length > 0
      })(),
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
  organizationMembersPage: adminProcedure
    .input(accessOrganizationMembersInput.extend({ query: listQuerySchema }))
    .query(async ({ ctx, input }) => {
      assertAuthorized(ctx.actor, "organization:admin", {
        kind: "organization",
        organizationId: input.organizationId,
      })

      const query = resolveListQuery(input.query, { defaultLimit: 25 })
      const conditions = combineConditions([
        eq(organizationMemberships.organizationId, input.organizationId),
        query.filters.role
          ? inArray(
              organizationMemberships.role,
              query.filters.role.filter((value) =>
                (organizationRoleValues as readonly string[]).includes(value)
              ) as (typeof organizationRoleValues)[number][]
            )
          : undefined,
        query.filters.status
          ? inArray(
              organizationMemberships.status,
              query.filters.status.filter((value) =>
                (membershipStatusValues as readonly string[]).includes(value)
              ) as (typeof membershipStatusValues)[number][]
            )
          : undefined,
        query.search
          ? or(
              ilike(user.name, likePattern(query.search)),
              ilike(user.email, likePattern(query.search))
            )
          : undefined,
      ])
      const where = and(...conditions)

      const [[totalRow], rows] = await Promise.all([
        ctx.db
          .select({ total: count() })
          .from(organizationMemberships)
          .innerJoin(user, eq(user.id, organizationMemberships.userId))
          .where(where),
        ctx.db
          .select({
            id: user.id,
            name: user.name,
            email: user.email,
            platformRole: user.role,
            status: user.status,
            createdAt: user.createdAt,
            membershipId: organizationMemberships.id,
            membershipRole: organizationMemberships.role,
            membershipStatus: organizationMemberships.status,
          })
          .from(organizationMemberships)
          .innerJoin(user, eq(user.id, organizationMemberships.userId))
          .where(where)
          .orderBy(
            ...buildOrderBy(
              query.sort,
              {
                name: user.name,
                email: user.email,
                role: organizationMemberships.role,
                status: organizationMemberships.status,
                createdAt: organizationMemberships.createdAt,
              },
              [desc(organizationMemberships.createdAt), desc(user.id)]
            )
          )
          .limit(query.limit + 1)
          .offset(query.offset),
      ])

      const userIds = rows.map((row) => row.id)
      const siteRows =
        userIds.length > 0
          ? await ctx.db
              .select({
                userId: siteMemberships.userId,
                siteId: siteMemberships.siteId,
                siteName: sites.name,
                role: siteMemberships.role,
                status: siteMemberships.status,
              })
              .from(siteMemberships)
              .innerJoin(sites, eq(sites.id, siteMemberships.siteId))
              .where(
                and(
                  eq(sites.organizationId, input.organizationId),
                  inArray(siteMemberships.userId, userIds)
                )
              )
          : []

      const siteMembershipsByUserId = new Map<string, typeof siteRows>()
      for (const row of siteRows) {
        const entries = siteMembershipsByUserId.get(row.userId) ?? []
        entries.push(row)
        siteMembershipsByUserId.set(row.userId, entries)
      }

      return paginate(
        rows.map((row) => ({
          id: row.id,
          name: row.name,
          email: row.email,
          platformRole: row.platformRole,
          status: row.status,
          createdAt: row.createdAt,
          membership: {
            id: row.membershipId,
            role: row.membershipRole,
            status: row.membershipStatus,
          },
          siteMemberships: (siteMembershipsByUserId.get(row.id) ?? []).map(
            (entry) => ({
              siteId: entry.siteId,
              siteName: entry.siteName,
              role: entry.role,
              status: entry.status,
            })
          ),
        })),
        query,
        Number(totalRow?.total ?? 0)
      )
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

      await writeAuditEvent(ctx, {
        eventType: "user_membership_changed",
        organizationId: input.organizationId,
        eventData: {
          targetUserId: input.userId,
          role: input.role,
          status: input.status,
        },
      })

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

      await writeAuditEvent(ctx, {
        eventType: "user_site_access_changed",
        organizationId: site.organizationId,
        eventData: {
          targetUserId: input.userId,
          grants: [{ siteId: input.siteId, role: input.role }],
          status: input.status,
        },
      })

      return record
    }),
})

export const appRouter = createTRPCRouter({
  access: accessRouter,
  users: usersRouter,
  apiKeys: apiKeysRouter,
  notifications: notificationsRouter,
  sso: ssoRouter,
  reports: reportsRouter,
  fleet: fleetRouter,
  playbooks: playbooksRouter,
  assets: assetsRouter,
  customFields: customFieldsRouter,
  accessRequests: accessRequestsRouter,
  system: systemRouter,
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

        await writeAuditEvent(ctx, {
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

        const [record] = await ctx.db
          .insert(sites)
          .values({
            organizationId: input.organizationId,
            name: input.name,
            timezone: input.timezone ?? null,
            notes: input.notes ?? null,
            address: input.address ?? null,
            contacts: input.contacts ?? [],
            businessHours: input.businessHours ?? null,
            requireAccessReason: input.requireAccessReason ?? false,
            requireApproval: input.requireApproval ?? false,
          })
          .returning()
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

        await writeAuditEvent(ctx, {
          organizationId: record.organizationId,
          eventType: "site_created",
          eventData: { siteId: record.id, name: record.name },
        })
        await writeAuditEvent(ctx, {
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
            address: input.address ?? null,
            contacts: input.contacts ?? [],
            businessHours: input.businessHours ?? null,
            ...(input.requireAccessReason === undefined
              ? {}
              : { requireAccessReason: input.requireAccessReason }),
            ...(input.requireApproval === undefined
              ? {}
              : { requireApproval: input.requireApproval }),
          })
          .where(eq(sites.id, input.id))
          .returning()

        await writeAuditEvent(ctx, {
          organizationId: existing.organizationId,
          eventType: "site_updated",
          eventData: {
            siteId: record.id,
            name: record.name,
            requireAccessReason: record.requireAccessReason,
            requireApproval: record.requireApproval,
          },
        })

        const [sshCredential] = await ctx.db
          .select()
          .from(siteSshCredentials)
          .where(eq(siteSshCredentials.siteId, record.id))

        return mapSiteWithSshCredential(record, sshCredential ?? null)
      }),
    importCsv: adminProcedure
      .input(
        z.object({
          organizationId: z.string().uuid(),
          csv: z.string().max(1_000_000),
        })
      )
      .mutation(async ({ ctx, input }) => {
        assertAuthorized(ctx.actor, "site:admin", {
          kind: "organization",
          organizationId: input.organizationId,
        })
        const [organization] = await ctx.db
          .select({ id: organizations.id, name: organizations.name })
          .from(organizations)
          .where(eq(organizations.id, input.organizationId))
        if (!organization) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        const parsed = parseSiteBulkCsv(input.csv)
        const errors = [...parsed.errors]
        let created = 0

        const existingSites = await ctx.db
          .select({ id: sites.id, name: sites.name })
          .from(sites)
          .where(eq(sites.organizationId, input.organizationId))

        for (const row of parsed.rows) {
          const orgMatch =
            row.organization.toLowerCase() ===
              organization.name.toLowerCase() ||
            row.organization === organization.id
          if (!orgMatch) {
            errors.push({
              row: row.row,
              message: "Organization does not match this import.",
            })
            continue
          }
          if (
            existingSites.some(
              (site) => site.name.toLowerCase() === row.name.toLowerCase()
            )
          ) {
            errors.push({
              row: row.row,
              message: "A site with that name already exists.",
            })
            continue
          }

          const [record] = await ctx.db
            .insert(sites)
            .values({
              organizationId: input.organizationId,
              name: row.name,
              timezone: row.timezone,
              notes: row.notes,
              address: row.address,
              contacts: row.contact ? [row.contact] : [],
            })
            .returning()
          const keyPair = generateSiteSshKeyPair(
            record.name.replaceAll(/\s+/g, "-").toLowerCase()
          )
          await upsertSiteSshCredential(
            ctx.db,
            record.id,
            "root",
            keyPair.privateKey,
            keyPair.publicKey
          )
          existingSites.push({ id: record.id, name: record.name })
          created += 1
        }

        await writeAuditEvent(ctx, {
          organizationId: input.organizationId,
          eventType: "inventory_imported",
          eventData: {
            kind: "sites",
            created,
            errorCount: errors.length,
          },
        })

        return { created, updated: 0, skipped: errors.length, errors }
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

        await writeAuditEvent(ctx, {
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

        await writeAuditEvent(ctx, {
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

        await writeAuditEvent(ctx, {
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

        await writeAuditEvent(ctx, {
          organizationId: existing.organizationId,
          eventType: "site_deleted",
          eventData: { siteId: existing.id, name: existing.name },
        })

        return record ?? existing
      }),
  }),
  devices: devicesRouter,
  dashboard: dashboardRouter,
  network: networkRouter,
  alerts: alertsRouter,
  alertPolicies: alertPoliciesRouter,
  maintenance: maintenanceRouter,
  telemetry: telemetryRouter,
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
    page: permissionProcedure("device:view")
      .input(listQuerySchema.optional())
      .query(async ({ ctx, input }) => {
        const query = resolveListQuery(input, { defaultLimit: 50 })
        const scope = deviceScopeCondition(ctx.actor)

        if (scope.kind === "none") {
          return paginate([], query, 0)
        }

        const serviceTypeFilter = query.filters.serviceType?.filter((value) =>
          (serviceTypes as readonly string[]).includes(value)
        ) as ServiceType[] | undefined

        const conditions = combineConditions([
          scope.kind === "where" ? scope.condition : undefined,
          query.filters.deviceId
            ? inArray(managementServices.deviceId, query.filters.deviceId)
            : undefined,
          query.filters.siteId
            ? inArray(devices.siteId, query.filters.siteId)
            : undefined,
          serviceTypeFilter && serviceTypeFilter.length > 0
            ? inArray(managementServices.serviceType, serviceTypeFilter)
            : undefined,
          query.filters.enabled
            ? inArray(
                managementServices.enabled,
                query.filters.enabled.map((value) => value === "true")
              )
            : undefined,
          query.filters.healthStatus
            ? inArray(
                managementServices.healthStatus,
                query.filters.healthStatus
              )
            : undefined,
          query.search
            ? or(
                ilike(devices.displayName, likePattern(query.search)),
                ilike(devices.hostname, likePattern(query.search)),
                ilike(sites.name, likePattern(query.search))
              )
            : undefined,
        ])
        const where = conditions.length > 0 ? and(...conditions) : undefined

        const [[totalRow], rows] = await Promise.all([
          ctx.db
            .select({ total: count() })
            .from(managementServices)
            .innerJoin(devices, eq(devices.id, managementServices.deviceId))
            .leftJoin(sites, eq(sites.id, devices.siteId))
            .where(where),
          ctx.db
            .select({
              service: managementServices,
              credentialId: managementServiceCredentials.id,
              deviceName: devices.displayName,
              deviceHostname: devices.hostname,
              deviceStatus: devices.status,
              organizationId: devices.organizationId,
              siteId: devices.siteId,
              siteName: sites.name,
              vpnIpv4: vpnIdentities.vpnIpv4,
            })
            .from(managementServices)
            .innerJoin(devices, eq(devices.id, managementServices.deviceId))
            .leftJoin(sites, eq(sites.id, devices.siteId))
            .leftJoin(vpnIdentities, eq(vpnIdentities.deviceId, devices.id))
            .leftJoin(
              managementServiceCredentials,
              eq(
                managementServiceCredentials.managementServiceId,
                managementServices.id
              )
            )
            .where(where)
            .orderBy(
              ...buildOrderBy(
                query.sort,
                {
                  deviceName: devices.displayName,
                  siteName: sites.name,
                  serviceType: managementServices.serviceType,
                  port: managementServices.port,
                  enabled: managementServices.enabled,
                  healthStatus: managementServices.healthStatus,
                  lastCheckedAt: managementServices.lastCheckedAt,
                  createdAt: managementServices.createdAt,
                },
                [
                  desc(managementServices.createdAt),
                  desc(managementServices.id),
                ]
              )
            )
            .limit(query.limit + 1)
            .offset(query.offset),
        ])

        return paginate(
          rows.map((row) => ({
            ...row.service,
            hasSavedPassword: Boolean(row.credentialId),
            deviceName: row.deviceName,
            deviceHostname: row.deviceHostname,
            deviceStatus: row.deviceStatus,
            organizationId: row.organizationId,
            siteId: row.siteId,
            siteName: row.siteName,
            vpnIpv4: row.vpnIpv4 ? normalizeVpnIpv4(String(row.vpnIpv4)) : null,
          })),
          query,
          Number(totalRow?.total ?? 0)
        )
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

        await writeAuditEvent(ctx, {
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

        await writeAuditEvent(ctx, {
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

        await writeAuditEvent(ctx, {
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
  routePolicies: routePoliciesRouter,
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
          secretStored:
            sql<boolean>`(${enrollmentTokens.tokenCiphertext} is not null)`.mapWith(
              Boolean
            ),
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

        const issued = issueEnrollmentTokenSecret()
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
            tokenHash: issued.tokenHash,
            tokenCiphertext: issued.tokenCiphertext,
            tokenIv: issued.tokenIv,
            tokenAuthTag: issued.tokenAuthTag,
            createdByUserId: ctx.actor?.id ?? null,
          })
          .returning()

        await writeAuditEvent(ctx, {
          organizationId: input.organizationId,
          eventType: "enrollment_token_created",
          eventData: { tokenId: record.id },
        })

        return {
          token: issued.token,
          enrollmentToken: publicEnrollmentTokenRecord(record),
        }
      }),
    reveal: permissionProcedure("device:enroll")
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
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

        const token = decryptEnrollmentTokenSecret(existing)
        return {
          token,
          recoverable: token !== null,
        }
      }),
    rotateSecret: permissionProcedure("device:enroll")
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

        const issued = issueEnrollmentTokenSecret()
        const [record] = await ctx.db
          .update(enrollmentTokens)
          .set({
            tokenHash: issued.tokenHash,
            tokenCiphertext: issued.tokenCiphertext,
            tokenIv: issued.tokenIv,
            tokenAuthTag: issued.tokenAuthTag,
          })
          .where(eq(enrollmentTokens.id, input.id))
          .returning()

        await writeAuditEvent(ctx, {
          organizationId: existing.organizationId,
          eventType: "enrollment_token_secret_rotated",
          eventData: { tokenId: existing.id },
        })

        return {
          token: issued.token,
          enrollmentToken: publicEnrollmentTokenRecord(record),
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

        await writeAuditEvent(ctx, {
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

        return publicEnrollmentTokenRecord(record)
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

        await writeAuditEvent(ctx, {
          organizationId: existing.organizationId,
          eventType: "enrollment_token_revoked",
          eventData: {
            tokenId: existing.id,
          },
        })

        return publicEnrollmentTokenRecord(record ?? existing)
      }),
  }),
  audit: auditRouter,
  sessions: createTRPCRouter({
    page: sessionsPage,
    terminate: sessionsTerminate,
    launchRequirements: permissionProcedure("device:view")
      .input(z.object({ deviceId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const [device] = await ctx.db
          .select({
            id: devices.id,
            organizationId: devices.organizationId,
            siteId: devices.siteId,
            requireAccessReason: sites.requireAccessReason,
            requireApproval: sites.requireApproval,
          })
          .from(devices)
          .leftJoin(sites, eq(sites.id, devices.siteId))
          .where(eq(devices.id, input.deviceId))

        if (!device) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        assertAuthorized(ctx.actor, "device:view", {
          kind: "device",
          organizationId: device.organizationId,
          siteId: device.siteId,
        })

        return {
          requireAccessReason: Boolean(device.requireAccessReason),
          requireApproval: Boolean(device.requireApproval),
        }
      }),
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

        const gate = await resolveSessionAccessGate(ctx, {
          deviceId: device.id,
          organizationId: device.organizationId,
          siteId: device.siteId,
          serviceId: service.id,
          serviceType: service.serviceType,
          connectionMethod: input.connectionMethod,
          reason: input.reason,
          accessRequestId: input.accessRequestId,
          deviceName: device.displayName,
        })

        if (gate.kind === "pending") {
          return {
            session: null,
            url: null,
            nativeUrl: null,
            launchTicket: null,
            mode: "pending_approval" as const,
            request: {
              id: gate.request.id,
              status: gate.request.status,
              expiresAt: gate.request.expiresAt,
              reason: gate.request.reason,
            },
          }
        }

        const accessReason = gate.reason
        const accessRequestId = gate.accessRequestId

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
              reason: accessReason,
              recordingPath: null,
              auditMetadata: {
                requestedBy: actor.email,
                serviceType: service.serviceType,
                nativeHost: host,
                nativePort: service.port,
                reason: accessReason,
                accessRequestId,
              },
            })
            .returning()

          const launchTicket =
            service.serviceType === "vnc" && password
              ? await issueLaunchTicket(
                  {
                    userId: actor.id,
                    remoteSessionId: record.id,
                    deviceId: device.id,
                    serviceId: service.id,
                    serviceType: service.serviceType,
                    secretKind: "vnc_password",
                    secret: password,
                  },
                  getCredentialSecret()
                )
              : null

          await writeAuditEvent(ctx, {
            eventType: "remote_session_started",
            organizationId: device.organizationId,
            deviceId: device.id,
            eventData: {
              remoteSessionId: record.id,
              serviceId: service.id,
              serviceType: service.serviceType,
              connectionMethod: "native",
              reason: accessReason,
              accessRequestId,
            },
          })

          await consumeAccessRequest(ctx, accessRequestId, record.id)

          return {
            session: record,
            url: null,
            nativeUrl,
            launchTicket,
            mode: "native" as const,
            request: null,
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

        const session = await getRemoteAccessProvider().createSession({
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
            connectionMethod: BROWSER_CONNECTION_METHOD,
            reason: accessReason,
            recordingPath: recordingPathForConnection(session.sessionId),
            auditMetadata: {
              requestedBy: actor.email,
              serviceType: service.serviceType,
              guacamoleSessionId: session.sessionId,
              guacamoleLaunchId: launchId,
              nativeRequested: input.connectionMethod === "native",
              reason: accessReason,
              accessRequestId,
            },
          })
          .returning()

        await writeAuditEvent(ctx, {
          eventType: "remote_session_started",
          organizationId: device.organizationId,
          deviceId: device.id,
          eventData: {
            remoteSessionId: record.id,
            serviceId: service.id,
            serviceType: service.serviceType,
            connectionMethod: BROWSER_CONNECTION_METHOD,
            reason: accessReason,
            accessRequestId,
          },
        })

        await consumeAccessRequest(ctx, accessRequestId, record.id)

        return {
          session: record,
          url: launchUrl.toString(),
          nativeUrl: null,
          launchTicket: null,
          mode: BROWSER_CONNECTION_METHOD,
          request: null,
        }
      }),
    redeemLaunchTicket: adminProcedure
      .input(z.object({ ticket: z.string().min(20).max(200) }))
      .mutation(async ({ ctx, input }) => {
        const actor = requireActor(ctx.actor)
        const payload = await redeemLaunchTicket(
          input.ticket,
          getCredentialSecret()
        )

        if (!payload || payload.userId !== actor.id) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "This launch link has expired.",
          })
        }

        const [device] = await ctx.db
          .select({
            id: devices.id,
            organizationId: devices.organizationId,
            siteId: devices.siteId,
          })
          .from(devices)
          .where(eq(devices.id, payload.deviceId))

        if (!device) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        await writeAuditEvent(ctx, {
          eventType: "credential_revealed",
          organizationId: device.organizationId,
          deviceId: device.id,
          eventData: {
            remoteSessionId: payload.remoteSessionId,
            serviceId: payload.serviceId,
            serviceType: payload.serviceType,
            secretKind: payload.secretKind,
            via: "launch_ticket",
          },
        })

        return { secret: payload.secret, secretKind: payload.secretKind }
      }),
  }),
  adminVpn: createTRPCRouter({
    connectionStatus: permissionProcedure("vpn:admin_profile").query(
      async ({ ctx }) => {
        const actor = requireActor(ctx.actor)
        const profiles = await ctx.db
          .select({
            id: adminVpnProfiles.id,
            vpnIpv4: adminVpnProfiles.vpnIpv4,
            lastHandshakeAt: adminVpnProfiles.lastHandshakeAt,
            serverPeerEnabled: adminVpnProfiles.serverPeerEnabled,
            revokedAt: adminVpnProfiles.revokedAt,
          })
          .from(adminVpnProfiles)
          .where(
            and(
              eq(adminVpnProfiles.userId, actor.id),
              eq(adminVpnProfiles.serverPeerEnabled, true),
              isNull(adminVpnProfiles.revokedAt)
            )
          )

        const freshMs = 3 * 60 * 1000
        const now = Date.now()
        const connected = profiles.some((profile) => {
          if (!profile.lastHandshakeAt) {
            return false
          }
          return now - new Date(profile.lastHandshakeAt).getTime() < freshMs
        })

        return {
          connected,
          checkedAt: new Date(),
          profileCount: profiles.length,
        }
      }
    ),
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

        const activeCount = await ctx.db
          .select({ id: adminVpnProfiles.id })
          .from(adminVpnProfiles)
          .where(
            and(
              eq(adminVpnProfiles.organizationId, input.organizationId),
              eq(adminVpnProfiles.userId, actor.id),
              isNull(adminVpnProfiles.revokedAt)
            )
          )

        if (activeCount.length >= MAX_ADMIN_VPN_PROFILES_PER_ORG) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `You can have up to ${MAX_ADMIN_VPN_PROFILES_PER_ORG} active profiles for this organization. Revoke one to add another.`,
          })
        }

        const vpnConfig = requireVpnServerConfig()
        const keyPair = generateWireGuardKeyPair()
        const now = new Date()

        const existingAdminIps = await ctx.db
          .select({ vpnIpv4: adminVpnProfiles.vpnIpv4 })
          .from(adminVpnProfiles)
        const vpnIpv4 = allocateVpnIpv4(
          existingAdminIps.map((row) => String(row.vpnIpv4)),
          { pool: "admin" }
        )

        const [profile] = await ctx.db
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

        await writeAuditEvent(ctx, {
          organizationId: input.organizationId,
          eventType: "admin_vpn_created",
          eventData: {
            profileId: profile.id,
            vpnIpv4: normalizeVpnIpv4(vpnIpv4),
            label: profile.label,
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
          filename: adminVpnConfigFilename(
            organization.name,
            vpnIpv4,
            profile.label
          ),
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

        assertCanManageAdminVpnProfile(actor, profile, "reissue")

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

        await writeAuditEvent(ctx, {
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
            String(profile.vpnIpv4),
            profile.label
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

        assertCanManageAdminVpnProfile(actor, profile, "revoke")

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

        await writeAuditEvent(ctx, {
          organizationId: profile.organizationId,
          eventType: "admin_vpn_revoked",
          eventData: {
            profileId: profile.id,
            vpnIpv4: normalizeVpnIpv4(String(profile.vpnIpv4)),
            label: profile.label,
          },
        })

        return serializeAdminVpnProfile(updated)
      }),
    update: permissionProcedure("vpn:admin_profile")
      .input(
        z.object({
          id: z.string().uuid(),
          allowSameUserAccess: z.boolean(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const actor = requireActor(ctx.actor)
        const [profile] = await ctx.db
          .select()
          .from(adminVpnProfiles)
          .where(eq(adminVpnProfiles.id, input.id))

        if (!profile) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        assertCanManageAdminVpnProfile(actor, profile, "update")

        const now = new Date()
        const [updated] = await ctx.db
          .update(adminVpnProfiles)
          .set({
            allowSameUserAccess: input.allowSameUserAccess,
            updatedAt: now,
          })
          .where(eq(adminVpnProfiles.id, profile.id))
          .returning()

        await writeAuditEvent(ctx, {
          organizationId: profile.organizationId,
          eventType: "admin_vpn_updated",
          eventData: {
            profileId: profile.id,
            vpnIpv4: normalizeVpnIpv4(String(profile.vpnIpv4)),
            allowSameUserAccess: input.allowSameUserAccess,
          },
        })

        return serializeAdminVpnProfile(updated)
      }),
    delete: permissionProcedure("vpn:admin_profile")
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

        assertCanManageAdminVpnProfile(actor, profile, "delete")

        if (!profile.revokedAt) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Revoke the profile before deleting it",
          })
        }

        await ctx.db
          .delete(adminVpnProfiles)
          .where(eq(adminVpnProfiles.id, profile.id))

        await writeAuditEvent(ctx, {
          organizationId: profile.organizationId,
          eventType: "admin_vpn_deleted",
          eventData: {
            profileId: profile.id,
            vpnIpv4: normalizeVpnIpv4(String(profile.vpnIpv4)),
            label: profile.label,
          },
        })

        return { id: profile.id }
      }),
  }),
})

export type AppRouter = typeof appRouter
