import { createHash, randomBytes, randomUUID } from "node:crypto"

import { TRPCError } from "@trpc/server"
import {
  and,
  count,
  desc,
  eq,
  exists,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm"
import { z } from "zod"

import {
  hashPassword,
  hasPlatformWideAccess,
  type ActorPrincipal,
} from "@nms/auth"
import {
  account,
  auditEvents,
  organizationMemberships,
  organizations,
  passkey,
  session,
  siteMemberships,
  sites,
  twoFactor,
  user,
  userInvitations,
} from "@nms/db"
import {
  invitationAcceptSchema,
  invitationAlreadyPendingMessage,
  invitationEmailTakenMessage,
  invitationInvalidMessage,
  invitationRoleDeniedMessage,
  invitationTokenSchema,
  membershipStatuses,
  organizationRoles,
  platformRoles,
  siteGrantSchema,
  userInviteSchema,
  type PlatformRole,
} from "@nms/shared"
import {
  getAppBaseUrl,
  getProductName,
  inviteMailFromToken,
  sendTransactionalMail,
} from "@nms/notifications"

import { manageableOrganizationIds } from "../access"
import { writeAuditEvent } from "../audit"
import {
  canGrantOrganizationRole,
  canSupersedeInvitation,
  isInvitationOpen,
  isUserEmailConflict,
  normalizeInvitationSiteGrants,
  siteGrantsBelongToOrganization,
} from "../invitation"
import type { ApiContext } from "../context"
import {
  buildOrderBy,
  likePattern,
  listQuerySchema,
  paginate,
  resolveListQuery,
} from "../list"
import { adminProcedure, createTRPCRouter, publicProcedure } from "../trpc"

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000

function hashInvitationToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

function makeInvitationToken() {
  return randomBytes(32).toString("base64url")
}

function generateTemporaryPassword() {
  // 20 chars from a URL-safe alphabet: ~119 bits of entropy.
  return randomBytes(15).toString("base64url")
}

function requireActor(actor: ActorPrincipal | null): ActorPrincipal {
  if (!actor) {
    throw new TRPCError({ code: "UNAUTHORIZED" })
  }
  return actor
}

function requireUserManager(actor: ActorPrincipal | null) {
  const principal = requireActor(actor)
  const manageable = manageableOrganizationIds(principal)
  if (manageable !== null && manageable.length === 0) {
    throw new TRPCError({ code: "FORBIDDEN" })
  }
  return { actor: principal, manageable }
}

function requirePlatformOwner(actor: ActorPrincipal | null) {
  const principal = requireActor(actor)
  if (principal.platformRole !== "owner") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only platform owners can change platform roles.",
    })
  }
  return principal
}

async function loadTargetUser(ctx: ApiContext, userId: string) {
  const [record] = await ctx.db.select().from(user).where(eq(user.id, userId))
  if (!record) {
    throw new TRPCError({ code: "NOT_FOUND" })
  }

  const memberships = await ctx.db
    .select({
      organizationId: organizationMemberships.organizationId,
      role: organizationMemberships.role,
      status: organizationMemberships.status,
    })
    .from(organizationMemberships)
    .where(eq(organizationMemberships.userId, userId))

  return { record, memberships }
}

/**
 * Platform owners/admins manage anyone (admins cannot touch owners). Org
 * owners/admins can manage platform members who belong to one of their
 * organizations.
 */
async function assertCanManageUser(ctx: ApiContext, targetUserId: string) {
  const { actor, manageable } = requireUserManager(ctx.actor)
  const target = await loadTargetUser(ctx, targetUserId)

  if (hasPlatformWideAccess(actor)) {
    if (
      actor.platformRole === "admin" &&
      target.record.role === "owner" &&
      actor.id !== target.record.id
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Platform admins cannot modify platform owners.",
      })
    }
    return { actor, target, manageable }
  }

  if (target.record.role !== "member") {
    throw new TRPCError({ code: "FORBIDDEN" })
  }

  const shared = target.memberships.some((membership) =>
    (manageable ?? []).includes(membership.organizationId)
  )
  if (!shared) {
    throw new TRPCError({ code: "FORBIDDEN" })
  }

  return { actor, target, manageable }
}

function thrownTrpcError(error: unknown): TRPCError | null {
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current && typeof current === "object" && !seen.has(current)) {
    if (current instanceof TRPCError) return current
    seen.add(current)
    current = (current as { cause?: unknown }).cause
  }
  return null
}

function assertOrganizationManageable(
  manageable: string[] | null,
  organizationId: string
) {
  if (manageable !== null && !manageable.includes(organizationId)) {
    throw new TRPCError({ code: "FORBIDDEN" })
  }
}

async function revokeAllSessions(ctx: ApiContext, userId: string) {
  const deleted = await ctx.db
    .delete(session)
    .where(eq(session.userId, userId))
    .returning({ id: session.id })
  return deleted.length
}

const userIdInput = z.object({ userId: z.string().min(1) })

const platformRoleFilter = (values: string[]) =>
  values.filter((value): value is PlatformRole =>
    (platformRoles as readonly string[]).includes(value)
  )

export const usersRouter = createTRPCRouter({
  list: adminProcedure
    .input(z.object({ query: listQuerySchema.optional() }).optional())
    .query(async ({ ctx, input }) => {
      const { manageable } = requireUserManager(ctx.actor)
      const query = resolveListQuery(input?.query, { defaultLimit: 25 })

      const scopeCondition =
        manageable === null
          ? undefined
          : exists(
              ctx.db
                .select({ id: organizationMemberships.id })
                .from(organizationMemberships)
                .where(
                  and(
                    eq(organizationMemberships.userId, user.id),
                    inArray(organizationMemberships.organizationId, manageable)
                  )
                )
            )

      const organizationFilter = query.filters.organizationId
        ? exists(
            ctx.db
              .select({ id: organizationMemberships.id })
              .from(organizationMemberships)
              .where(
                and(
                  eq(organizationMemberships.userId, user.id),
                  inArray(
                    organizationMemberships.organizationId,
                    query.filters.organizationId.filter((value) =>
                      manageable === null ? true : manageable.includes(value)
                    )
                  )
                )
              )
          )
        : undefined

      const twoFactorFilter = query.filters.twoFactor
        ? query.filters.twoFactor.includes("enabled") &&
          !query.filters.twoFactor.includes("disabled")
          ? eq(user.twoFactorEnabled, true)
          : query.filters.twoFactor.includes("disabled") &&
              !query.filters.twoFactor.includes("enabled")
            ? eq(user.twoFactorEnabled, false)
            : undefined
        : undefined

      const conditions = [
        scopeCondition,
        organizationFilter,
        twoFactorFilter,
        query.filters.platformRole &&
        platformRoleFilter(query.filters.platformRole).length > 0
          ? inArray(user.role, platformRoleFilter(query.filters.platformRole))
          : undefined,
        query.filters.status
          ? inArray(
              user.status,
              query.filters.status.filter((value) =>
                (membershipStatuses as readonly string[]).includes(value)
              )
            )
          : undefined,
        query.search
          ? or(
              ilike(user.name, likePattern(query.search)),
              ilike(user.email, likePattern(query.search))
            )
          : undefined,
      ].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))

      const where = conditions.length > 0 ? and(...conditions) : undefined

      const passkeyCount = ctx.db
        .select({ total: count() })
        .from(passkey)
        .where(eq(passkey.userId, user.id))

      const [[totalRow], rows] = await Promise.all([
        ctx.db.select({ total: count() }).from(user).where(where),
        ctx.db
          .select({
            id: user.id,
            name: user.name,
            email: user.email,
            platformRole: user.role,
            status: user.status,
            twoFactorEnabled: user.twoFactorEnabled,
            mustChangePassword: user.mustChangePassword,
            lastLoginAt: user.lastLoginAt,
            createdAt: user.createdAt,
            disabledAt: user.disabledAt,
            passkeyCount: sql<number>`(${passkeyCount})`.mapWith(Number),
          })
          .from(user)
          .where(where)
          .orderBy(
            ...buildOrderBy(
              query.sort,
              {
                name: user.name,
                email: user.email,
                platformRole: user.role,
                status: user.status,
                twoFactorEnabled: user.twoFactorEnabled,
                lastLoginAt: user.lastLoginAt,
                createdAt: user.createdAt,
              },
              [desc(user.createdAt), desc(user.id)]
            )
          )
          .limit(query.limit + 1)
          .offset(query.offset),
      ])

      const userIds = rows.map((row) => row.id)
      const [orgRows, siteRows] =
        userIds.length > 0
          ? await Promise.all([
              ctx.db
                .select({
                  userId: organizationMemberships.userId,
                  organizationId: organizationMemberships.organizationId,
                  organizationName: organizations.name,
                  role: organizationMemberships.role,
                  status: organizationMemberships.status,
                })
                .from(organizationMemberships)
                .innerJoin(
                  organizations,
                  eq(organizations.id, organizationMemberships.organizationId)
                )
                .where(inArray(organizationMemberships.userId, userIds)),
              ctx.db
                .select({
                  userId: siteMemberships.userId,
                  siteId: siteMemberships.siteId,
                  siteName: sites.name,
                  organizationId: sites.organizationId,
                  role: siteMemberships.role,
                  status: siteMemberships.status,
                })
                .from(siteMemberships)
                .innerJoin(sites, eq(sites.id, siteMemberships.siteId))
                .where(inArray(siteMemberships.userId, userIds)),
            ])
          : [[], []]

      const orgByUser = new Map<string, typeof orgRows>()
      for (const row of orgRows) {
        if (manageable !== null && !manageable.includes(row.organizationId)) {
          continue
        }
        orgByUser.set(row.userId, [...(orgByUser.get(row.userId) ?? []), row])
      }
      const siteByUser = new Map<string, typeof siteRows>()
      for (const row of siteRows) {
        if (manageable !== null && !manageable.includes(row.organizationId)) {
          continue
        }
        siteByUser.set(row.userId, [...(siteByUser.get(row.userId) ?? []), row])
      }

      return paginate(
        rows.map((row) => ({
          ...row,
          organizationMemberships: (orgByUser.get(row.id) ?? []).map(
            (entry) => ({
              organizationId: entry.organizationId,
              organizationName: entry.organizationName,
              role: entry.role,
              status: entry.status,
            })
          ),
          siteMemberships: (siteByUser.get(row.id) ?? []).map((entry) => ({
            siteId: entry.siteId,
            siteName: entry.siteName,
            organizationId: entry.organizationId,
            role: entry.role,
            status: entry.status,
          })),
        })),
        query,
        Number(totalRow?.total ?? 0)
      )
    }),

  get: adminProcedure.input(userIdInput).query(async ({ ctx, input }) => {
    const { target, manageable } = await assertCanManageUser(ctx, input.userId)

    const [orgRows, siteRows, sessionRows, passkeyRows, auditRows] =
      await Promise.all([
        ctx.db
          .select({
            organizationId: organizationMemberships.organizationId,
            organizationName: organizations.name,
            role: organizationMemberships.role,
            status: organizationMemberships.status,
          })
          .from(organizationMemberships)
          .innerJoin(
            organizations,
            eq(organizations.id, organizationMemberships.organizationId)
          )
          .where(eq(organizationMemberships.userId, input.userId)),
        ctx.db
          .select({
            siteId: siteMemberships.siteId,
            siteName: sites.name,
            organizationId: sites.organizationId,
            role: siteMemberships.role,
            status: siteMemberships.status,
          })
          .from(siteMemberships)
          .innerJoin(sites, eq(sites.id, siteMemberships.siteId))
          .where(eq(siteMemberships.userId, input.userId)),
        ctx.db
          .select({
            id: session.id,
            ipAddress: session.ipAddress,
            userAgent: session.userAgent,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            expiresAt: session.expiresAt,
          })
          .from(session)
          .where(
            and(
              eq(session.userId, input.userId),
              gt(session.expiresAt, new Date())
            )
          )
          .orderBy(desc(session.updatedAt)),
        ctx.db
          .select({
            id: passkey.id,
            name: passkey.name,
            deviceType: passkey.deviceType,
            backedUp: passkey.backedUp,
            createdAt: passkey.createdAt,
          })
          .from(passkey)
          .where(eq(passkey.userId, input.userId))
          .orderBy(desc(passkey.createdAt)),
        ctx.db
          .select({
            id: auditEvents.id,
            eventType: auditEvents.eventType,
            eventData: auditEvents.eventData,
            createdAt: auditEvents.createdAt,
          })
          .from(auditEvents)
          .where(
            or(
              eq(auditEvents.actorUserId, input.userId),
              sql`${auditEvents.eventData} ->> 'targetUserId' = ${input.userId}`
            )
          )
          .orderBy(desc(auditEvents.createdAt))
          .limit(25),
      ])

    const visible = <T extends { organizationId: string }>(rows: T[]) =>
      manageable === null
        ? rows
        : rows.filter((row) => manageable.includes(row.organizationId))

    return {
      id: target.record.id,
      name: target.record.name,
      email: target.record.email,
      platformRole: target.record.role,
      status: target.record.status,
      twoFactorEnabled: target.record.twoFactorEnabled,
      mustChangePassword: target.record.mustChangePassword,
      twoFactorEnforcedAt: target.record.twoFactorEnforcedAt,
      lastLoginAt: target.record.lastLoginAt,
      disabledAt: target.record.disabledAt,
      createdAt: target.record.createdAt,
      organizationMemberships: visible(orgRows),
      siteMemberships: visible(siteRows),
      sessions: sessionRows,
      passkeys: passkeyRows,
      recentActivity: auditRows,
    }
  }),

  invitations: adminProcedure.query(async ({ ctx }) => {
    const { manageable } = requireUserManager(ctx.actor)

    const rows = await ctx.db
      .select({
        id: userInvitations.id,
        email: userInvitations.email,
        name: userInvitations.name,
        platformRole: userInvitations.platformRole,
        organizationId: userInvitations.organizationId,
        organizationName: organizations.name,
        organizationRole: userInvitations.organizationRole,
        siteGrants: userInvitations.siteGrants,
        expiresAt: userInvitations.expiresAt,
        createdAt: userInvitations.createdAt,
        invitedByUserId: userInvitations.invitedByUserId,
      })
      .from(userInvitations)
      .leftJoin(
        organizations,
        eq(organizations.id, userInvitations.organizationId)
      )
      .where(
        and(
          isNull(userInvitations.acceptedAt),
          isNull(userInvitations.revokedAt),
          gt(userInvitations.expiresAt, new Date()),
          manageable === null
            ? undefined
            : inArray(userInvitations.organizationId, manageable)
        )
      )
      .orderBy(desc(userInvitations.createdAt))

    return rows
  }),

  invite: adminProcedure
    .input(userInviteSchema)
    .mutation(async ({ ctx, input }) => {
      const { actor, manageable } = requireUserManager(ctx.actor)
      const email = input.email.toLowerCase()

      if (input.platformRole !== "member") {
        requirePlatformOwner(actor)
      }

      if (input.platformRole === "member" && !input.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Members need an organization.",
        })
      }

      if (input.organizationId) {
        assertOrganizationManageable(manageable, input.organizationId)
        if (!input.organizationRole && input.siteGrants.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Choose an organization role or at least one site grant.",
          })
        }
        const actorRole =
          actor.organizationMemberships.find(
            (membership) =>
              membership.organizationId === input.organizationId &&
              membership.status === "active"
          )?.role ?? null
        if (
          !canGrantOrganizationRole({
            platformWide: hasPlatformWideAccess(actor),
            actorRole,
            role: input.organizationRole,
          })
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: invitationRoleDeniedMessage,
          })
        }
      }

      if (input.siteGrants.length > 0) {
        if (!input.organizationId) {
          throw new TRPCError({ code: "BAD_REQUEST" })
        }
        const siteIds = [
          ...new Set(input.siteGrants.map((grant) => grant.siteId)),
        ]
        const matched = await ctx.db
          .select({ id: sites.id, organizationId: sites.organizationId })
          .from(sites)
          .where(inArray(sites.id, siteIds))
        if (
          matched.length !== siteIds.length ||
          matched.some((site) => site.organizationId !== input.organizationId)
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Sites must belong to the selected organization.",
          })
        }
      }

      const [existingUser] = await ctx.db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, email))
      if (existingUser) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A user with this email already exists.",
        })
      }

      // Replace a pending invitation only when this actor manages it.
      // Another organization's invite, or a platform invite, stays valid.
      const pendingInvitations = await ctx.db
        .select({
          id: userInvitations.id,
          organizationId: userInvitations.organizationId,
        })
        .from(userInvitations)
        .where(
          and(
            eq(userInvitations.email, email),
            isNull(userInvitations.acceptedAt),
            isNull(userInvitations.revokedAt)
          )
        )
      if (
        pendingInvitations.some(
          (pending) => !canSupersedeInvitation(manageable, pending)
        )
      ) {
        throw new TRPCError({
          code: "CONFLICT",
          message: invitationAlreadyPendingMessage,
        })
      }
      if (pendingInvitations.length > 0) {
        await ctx.db
          .update(userInvitations)
          .set({ revokedAt: new Date() })
          .where(
            inArray(
              userInvitations.id,
              pendingInvitations.map((pending) => pending.id)
            )
          )
      }

      const token = makeInvitationToken()
      const expiresAt = new Date(Date.now() + INVITATION_TTL_MS)
      const [invitation] = await ctx.db
        .insert(userInvitations)
        .values({
          email,
          name: input.name,
          tokenHash: hashInvitationToken(token),
          platformRole: input.platformRole,
          organizationId: input.organizationId,
          organizationRole: input.organizationRole,
          siteGrants: input.siteGrants,
          invitedByUserId: actor.id,
          expiresAt,
        })
        .returning()

      await writeAuditEvent(ctx, {
        eventType: "user_invited",
        organizationId: input.organizationId,
        eventData: {
          invitationId: invitation.id,
          email,
          platformRole: input.platformRole,
          organizationRole: input.organizationRole,
          siteGrants: input.siteGrants,
        },
      })

      let emailSent = false
      try {
        const mail = inviteMailFromToken({
          name: input.name,
          token,
          baseUrl: getAppBaseUrl(),
          productName: getProductName(),
        })
        emailSent = await sendTransactionalMail({
          to: email,
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
        })
      } catch (error) {
        console.error("invite mail failed", error)
      }

      return {
        invitationId: invitation.id,
        token,
        expiresAt,
        emailSent,
      }
    }),

  revokeInvitation: adminProcedure
    .input(z.object({ invitationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { manageable } = requireUserManager(ctx.actor)
      const [invitation] = await ctx.db
        .select()
        .from(userInvitations)
        .where(eq(userInvitations.id, input.invitationId))
      if (!invitation) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }
      if (invitation.organizationId) {
        assertOrganizationManageable(manageable, invitation.organizationId)
      } else if (manageable !== null) {
        throw new TRPCError({ code: "FORBIDDEN" })
      }

      await ctx.db
        .update(userInvitations)
        .set({ revokedAt: new Date() })
        .where(eq(userInvitations.id, input.invitationId))

      await writeAuditEvent(ctx, {
        eventType: "user_invitation_revoked",
        organizationId: invitation.organizationId,
        eventData: { invitationId: invitation.id, email: invitation.email },
      })

      return { ok: true }
    }),

  invitationPreview: publicProcedure
    .input(z.object({ token: invitationTokenSchema }))
    .query(async ({ ctx, input }) => {
      const [invitation] = await ctx.db
        .select({
          email: userInvitations.email,
          name: userInvitations.name,
          expiresAt: userInvitations.expiresAt,
          acceptedAt: userInvitations.acceptedAt,
          revokedAt: userInvitations.revokedAt,
          organizationName: organizations.name,
        })
        .from(userInvitations)
        .leftJoin(
          organizations,
          eq(organizations.id, userInvitations.organizationId)
        )
        .where(eq(userInvitations.tokenHash, hashInvitationToken(input.token)))

      if (!isInvitationOpen(invitation, new Date())) {
        return { valid: false as const }
      }

      return {
        valid: true as const,
        email: invitation.email,
        name: invitation.name,
        organizationName: invitation.organizationName,
        expiresAt: invitation.expiresAt,
      }
    }),

  acceptInvitation: publicProcedure
    .input(invitationAcceptSchema)
    .mutation(async ({ ctx, input }) => {
      const [invitation] = await ctx.db
        .select({
          id: userInvitations.id,
          acceptedAt: userInvitations.acceptedAt,
          revokedAt: userInvitations.revokedAt,
          expiresAt: userInvitations.expiresAt,
        })
        .from(userInvitations)
        .where(eq(userInvitations.tokenHash, hashInvitationToken(input.token)))

      if (!isInvitationOpen(invitation, new Date())) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: invitationInvalidMessage,
        })
      }

      const userId = randomUUID()
      const passwordHash = await hashPassword(input.password)

      try {
        const email = await ctx.db.transaction(async (tx) => {
          const now = new Date()
          // Claim the row before creating the account. A revoke, expiry, or
          // second accept that lands first updates zero rows and stops here.
          // The account id is filled in after the user row exists.
          const [claimed] = await tx
            .update(userInvitations)
            .set({ acceptedAt: now })
            .where(
              and(
                eq(userInvitations.id, invitation.id),
                isNull(userInvitations.acceptedAt),
                isNull(userInvitations.revokedAt),
                gte(userInvitations.expiresAt, now)
              )
            )
            .returning({
              id: userInvitations.id,
              email: userInvitations.email,
              platformRole: userInvitations.platformRole,
              organizationId: userInvitations.organizationId,
              organizationRole: userInvitations.organizationRole,
              siteGrants: userInvitations.siteGrants,
              invitedByUserId: userInvitations.invitedByUserId,
            })

          if (!claimed) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: invitationInvalidMessage,
            })
          }

          const [existingUser] = await tx
            .select({ id: user.id })
            .from(user)
            .where(eq(user.email, claimed.email))
          if (existingUser) {
            throw new TRPCError({
              code: "CONFLICT",
              message: invitationEmailTakenMessage,
            })
          }

          const grants = normalizeInvitationSiteGrants(claimed.siteGrants)
          if (!grants) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: invitationInvalidMessage,
            })
          }
          if (grants.length > 0) {
            const matched = await tx
              .select({
                id: sites.id,
                organizationId: sites.organizationId,
              })
              .from(sites)
              .where(
                inArray(
                  sites.id,
                  grants.map((grant) => grant.siteId)
                )
              )
            if (
              !siteGrantsBelongToOrganization(
                matched,
                grants,
                claimed.organizationId
              )
            ) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: invitationInvalidMessage,
              })
            }
          }

          await tx.insert(user).values({
            id: userId,
            name: input.name,
            email: claimed.email,
            emailVerified: true,
            role: claimed.platformRole,
            status: "active",
            invitedBy: claimed.invitedByUserId,
            createdAt: now,
            updatedAt: now,
          })

          await tx.insert(account).values({
            id: randomUUID(),
            userId,
            accountId: userId,
            providerId: "credential",
            password: passwordHash,
            createdAt: now,
            updatedAt: now,
          })

          if (claimed.organizationId && claimed.organizationRole) {
            await tx.insert(organizationMemberships).values({
              organizationId: claimed.organizationId,
              userId,
              role: claimed.organizationRole,
              status: "active",
              createdByUserId: claimed.invitedByUserId,
              createdAt: now,
              updatedAt: now,
            })
          }

          if (grants.length > 0) {
            await tx.insert(siteMemberships).values(
              grants.map((grant) => ({
                siteId: grant.siteId,
                userId,
                role: grant.role,
                status: "active" as const,
                createdByUserId: claimed.invitedByUserId,
                createdAt: now,
                updatedAt: now,
              }))
            )
          }

          await tx
            .update(userInvitations)
            .set({ acceptedUserId: userId })
            .where(eq(userInvitations.id, claimed.id))

          await tx.insert(auditEvents).values({
            actorUserId: userId,
            organizationId: claimed.organizationId,
            eventType: "user_invitation_accepted",
            eventData: {
              invitationId: claimed.id,
              email: claimed.email,
              targetUserId: userId,
            },
          })

          return claimed.email
        })

        return { ok: true as const, email }
      } catch (error) {
        const trpcError = thrownTrpcError(error)
        if (trpcError) throw trpcError
        if (isUserEmailConflict(error)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: invitationEmailTakenMessage,
          })
        }
        throw error
      }
    }),

  updatePlatformRole: adminProcedure
    .input(userIdInput.extend({ role: z.enum(platformRoles) }))
    .mutation(async ({ ctx, input }) => {
      const actor = requirePlatformOwner(ctx.actor)
      const { record } = await loadTargetUser(ctx, input.userId)

      if (record.role === input.role) {
        return { ok: true }
      }

      if (record.role === "owner" && input.role !== "owner") {
        const [owners] = await ctx.db
          .select({ total: count() })
          .from(user)
          .where(and(eq(user.role, "owner"), eq(user.status, "active")))
        if (Number(owners?.total ?? 0) <= 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "At least one platform owner must remain.",
          })
        }
      }

      await ctx.db
        .update(user)
        .set({ role: input.role, updatedAt: new Date() })
        .where(eq(user.id, input.userId))

      await writeAuditEvent(ctx, {
        eventType: "user_role_changed",
        eventData: {
          targetUserId: input.userId,
          from: record.role,
          to: input.role,
          actorId: actor.id,
        },
      })

      return { ok: true }
    }),

  setOrganizationRole: adminProcedure
    .input(
      userIdInput.extend({
        organizationId: z.string().uuid(),
        role: z.enum(organizationRoles).nullable(),
        status: z.enum(membershipStatuses).default("active"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { actor, manageable } = await assertCanManageUser(ctx, input.userId)
      assertOrganizationManageable(manageable, input.organizationId)

      // Org admins (non-platform) cannot hand out owner roles.
      if (
        !hasPlatformWideAccess(actor) &&
        input.role === "owner" &&
        !actor.organizationMemberships.some(
          (membership) =>
            membership.organizationId === input.organizationId &&
            membership.role === "owner" &&
            membership.status === "active"
        )
      ) {
        throw new TRPCError({ code: "FORBIDDEN" })
      }

      if (input.role === null) {
        await ctx.db
          .delete(organizationMemberships)
          .where(
            and(
              eq(organizationMemberships.userId, input.userId),
              eq(organizationMemberships.organizationId, input.organizationId)
            )
          )
      } else {
        await ctx.db
          .insert(organizationMemberships)
          .values({
            organizationId: input.organizationId,
            userId: input.userId,
            role: input.role,
            status: input.status,
            createdByUserId: actor.id,
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
            },
          })
      }

      await writeAuditEvent(ctx, {
        eventType: "user_membership_changed",
        organizationId: input.organizationId,
        eventData: {
          targetUserId: input.userId,
          role: input.role,
          status: input.status,
        },
      })

      return { ok: true }
    }),

  setSiteRoles: adminProcedure
    .input(
      userIdInput.extend({
        organizationId: z.string().uuid(),
        grants: z.array(siteGrantSchema).max(200),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { actor, manageable } = await assertCanManageUser(ctx, input.userId)
      assertOrganizationManageable(manageable, input.organizationId)

      const organizationSites = await ctx.db
        .select({ id: sites.id })
        .from(sites)
        .where(eq(sites.organizationId, input.organizationId))
      const organizationSiteIds = new Set(organizationSites.map((s) => s.id))

      for (const grant of input.grants) {
        if (!organizationSiteIds.has(grant.siteId)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Sites must belong to the selected organization.",
          })
        }
      }

      const now = new Date()
      await ctx.db.transaction(async (tx) => {
        if (organizationSiteIds.size > 0) {
          await tx
            .delete(siteMemberships)
            .where(
              and(
                eq(siteMemberships.userId, input.userId),
                inArray(siteMemberships.siteId, [...organizationSiteIds])
              )
            )
        }
        if (input.grants.length > 0) {
          await tx.insert(siteMemberships).values(
            input.grants.map((grant) => ({
              siteId: grant.siteId,
              userId: input.userId,
              role: grant.role,
              status: "active" as const,
              createdByUserId: actor.id,
              createdAt: now,
              updatedAt: now,
            }))
          )
        }
      })

      await writeAuditEvent(ctx, {
        eventType: "user_site_access_changed",
        organizationId: input.organizationId,
        eventData: { targetUserId: input.userId, grants: input.grants },
      })

      return { ok: true }
    }),

  suspend: adminProcedure
    .input(userIdInput)
    .mutation(async ({ ctx, input }) => {
      const { actor, target } = await assertCanManageUser(ctx, input.userId)
      if (actor.id === target.record.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot suspend your own account.",
        })
      }

      const now = new Date()
      await ctx.db
        .update(user)
        .set({ status: "suspended", disabledAt: now, updatedAt: now })
        .where(eq(user.id, input.userId))
      const revoked = await revokeAllSessions(ctx, input.userId)

      await writeAuditEvent(ctx, {
        eventType: "user_suspended",
        eventData: { targetUserId: input.userId, sessionsRevoked: revoked },
      })

      return { ok: true }
    }),

  reactivate: adminProcedure
    .input(userIdInput)
    .mutation(async ({ ctx, input }) => {
      await assertCanManageUser(ctx, input.userId)

      await ctx.db
        .update(user)
        .set({ status: "active", disabledAt: null, updatedAt: new Date() })
        .where(eq(user.id, input.userId))

      await writeAuditEvent(ctx, {
        eventType: "user_reactivated",
        eventData: { targetUserId: input.userId },
      })

      return { ok: true }
    }),

  resetTwoFactor: adminProcedure
    .input(userIdInput)
    .mutation(async ({ ctx, input }) => {
      await assertCanManageUser(ctx, input.userId)

      const removedPasskeys = await ctx.db
        .delete(passkey)
        .where(eq(passkey.userId, input.userId))
        .returning({ id: passkey.id })
      await ctx.db.delete(twoFactor).where(eq(twoFactor.userId, input.userId))
      await ctx.db
        .update(user)
        .set({
          twoFactorEnabled: false,
          twoFactorEnforcedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(user.id, input.userId))
      const revoked = await revokeAllSessions(ctx, input.userId)

      await writeAuditEvent(ctx, {
        eventType: "two_factor_reset",
        eventData: {
          targetUserId: input.userId,
          passkeysRemoved: removedPasskeys.length,
          sessionsRevoked: revoked,
        },
      })

      return { ok: true }
    }),

  forcePasswordReset: adminProcedure
    .input(userIdInput)
    .mutation(async ({ ctx, input }) => {
      await assertCanManageUser(ctx, input.userId)

      const temporaryPassword = generateTemporaryPassword()
      const passwordHash = await hashPassword(temporaryPassword)
      const now = new Date()

      await ctx.db.transaction(async (tx) => {
        await tx
          .delete(account)
          .where(
            and(
              eq(account.userId, input.userId),
              eq(account.providerId, "credential")
            )
          )
        await tx.insert(account).values({
          id: randomUUID(),
          userId: input.userId,
          accountId: input.userId,
          providerId: "credential",
          password: passwordHash,
          createdAt: now,
          updatedAt: now,
        })
        await tx
          .update(user)
          .set({ mustChangePassword: true, updatedAt: now })
          .where(eq(user.id, input.userId))
      })
      const revoked = await revokeAllSessions(ctx, input.userId)

      await writeAuditEvent(ctx, {
        eventType: "user_password_reset_forced",
        eventData: { targetUserId: input.userId, sessionsRevoked: revoked },
      })

      return { temporaryPassword }
    }),

  revokeSessions: adminProcedure
    .input(userIdInput)
    .mutation(async ({ ctx, input }) => {
      await assertCanManageUser(ctx, input.userId)
      const revoked = await revokeAllSessions(ctx, input.userId)

      await writeAuditEvent(ctx, {
        eventType: "session_revoked",
        eventData: {
          targetUserId: input.userId,
          scope: "all",
          sessionsRevoked: revoked,
        },
      })

      return { revoked }
    }),

  revokeSession: adminProcedure
    .input(userIdInput.extend({ sessionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertCanManageUser(ctx, input.userId)
      const deleted = await ctx.db
        .delete(session)
        .where(
          and(eq(session.id, input.sessionId), eq(session.userId, input.userId))
        )
        .returning({ id: session.id })

      await writeAuditEvent(ctx, {
        eventType: "session_revoked",
        eventData: {
          targetUserId: input.userId,
          scope: "one",
          sessionId: input.sessionId,
          sessionsRevoked: deleted.length,
        },
      })

      return { revoked: deleted.length }
    }),

  /** Organizations the caller may assign users to, with their sites. */
  assignableOrganizations: adminProcedure.query(async ({ ctx }) => {
    const { actor, manageable } = requireUserManager(ctx.actor)
    const platformWide = hasPlatformWideAccess(actor)

    const orgRows = await ctx.db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(
        manageable === null ? undefined : inArray(organizations.id, manageable)
      )
      .orderBy(organizations.name)

    const orgIds = orgRows.map((row) => row.id)
    const siteRows =
      orgIds.length > 0
        ? await ctx.db
            .select({
              id: sites.id,
              name: sites.name,
              organizationId: sites.organizationId,
            })
            .from(sites)
            .where(inArray(sites.organizationId, orgIds))
            .orderBy(sites.name)
        : []

    return orgRows.map((organization) => ({
      ...organization,
      canAssignOwner:
        platformWide ||
        actor.organizationMemberships.some(
          (membership) =>
            membership.organizationId === organization.id &&
            membership.status === "active" &&
            membership.role === "owner"
        ),
      sites: siteRows.filter((site) => site.organizationId === organization.id),
    }))
  }),

  /** Summary counts for the Users page header. */
  summary: adminProcedure.query(async ({ ctx }) => {
    const { manageable } = requireUserManager(ctx.actor)
    const scope =
      manageable === null
        ? undefined
        : exists(
            ctx.db
              .select({ id: organizationMemberships.id })
              .from(organizationMemberships)
              .where(
                and(
                  eq(organizationMemberships.userId, user.id),
                  inArray(organizationMemberships.organizationId, manageable)
                )
              )
          )

    const [[totals], [pendingInvites]] = await Promise.all([
      ctx.db
        .select({
          total: count(),
          active: count(sql`case when ${user.status} = 'active' then 1 end`),
          withoutTwoFactor: count(
            sql`case when ${user.twoFactorEnabled} = false and ${user.status} = 'active' then 1 end`
          ),
          admins: count(
            sql`case when ${user.role} in ('owner', 'admin') then 1 end`
          ),
        })
        .from(user)
        .where(scope),
      ctx.db
        .select({ total: count() })
        .from(userInvitations)
        .where(
          and(
            isNull(userInvitations.acceptedAt),
            isNull(userInvitations.revokedAt),
            gt(userInvitations.expiresAt, new Date()),
            manageable === null
              ? undefined
              : inArray(userInvitations.organizationId, manageable)
          )
        ),
    ])

    return {
      total: Number(totals?.total ?? 0),
      active: Number(totals?.active ?? 0),
      withoutTwoFactor: Number(totals?.withoutTwoFactor ?? 0),
      admins: Number(totals?.admins ?? 0),
      pendingInvitations: Number(pendingInvites?.total ?? 0),
    }
  }),
})

export type UsersRouter = typeof usersRouter
