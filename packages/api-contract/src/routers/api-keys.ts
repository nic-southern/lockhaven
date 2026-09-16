import { TRPCError } from "@trpc/server"
import { and, desc, eq, inArray, isNull } from "drizzle-orm"
import { z } from "zod"

import { apiKeys, organizations } from "@nms/db"
import { permissions } from "@nms/shared"
import {
  generateApiKeySecret,
  hashApiKeySecret,
  apiKeyLookupPrefix,
  hasPlatformWideAccess,
  intersectPermissions,
} from "@nms/auth"

import {
  assertPlatformAdministrator,
  manageableOrganizationIds,
} from "../access"
import { writeAuditEvent } from "../audit"
import type { ApiContext } from "../context"
import { adminProcedure, createTRPCRouter } from "../trpc"

const createInput = z.object({
  name: z.string().trim().min(1).max(80),
  organizationId: z.string().uuid().nullable().optional(),
  permissions: z.array(z.enum(permissions)).min(1).max(permissions.length),
  expiresAt: z.coerce.date().nullable().optional(),
})

function publicApiKey(record: typeof apiKeys.$inferSelect) {
  return {
    id: record.id,
    name: record.name,
    prefix: record.prefix,
    organizationId: record.organizationId,
    permissions: record.permissions,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
    lastUsedAt: record.lastUsedAt,
    createdByUserId: record.createdByUserId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function assertCanCreateOrgKey(ctx: ApiContext, organizationId: string) {
  const actor = ctx.actor
  if (!actor) {
    throw new TRPCError({ code: "UNAUTHORIZED" })
  }
  if (hasPlatformWideAccess(actor)) {
    return
  }
  const manageable = manageableOrganizationIds(actor)
  if (manageable === null || manageable.includes(organizationId)) {
    return
  }
  throw new TRPCError({ code: "FORBIDDEN" })
}

function listScope(ctx: ApiContext) {
  const actor = ctx.actor
  if (!actor) {
    throw new TRPCError({ code: "UNAUTHORIZED" })
  }
  if (hasPlatformWideAccess(actor)) {
    return { kind: "all" as const }
  }
  const organizationIds = manageableOrganizationIds(actor) ?? []
  return { kind: "orgs" as const, organizationIds }
}

export const apiKeysRouter = createTRPCRouter({
  list: adminProcedure
    .input(
      z
        .object({
          organizationId: z.string().uuid().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const scope = listScope(ctx)
      const organizationId = input?.organizationId

      if (scope.kind === "orgs") {
        if (scope.organizationIds.length === 0) {
          return []
        }
        if (organizationId && !scope.organizationIds.includes(organizationId)) {
          throw new TRPCError({ code: "FORBIDDEN" })
        }
      }

      const filters = []
      if (organizationId) {
        filters.push(eq(apiKeys.organizationId, organizationId))
      } else if (scope.kind === "orgs") {
        filters.push(inArray(apiKeys.organizationId, scope.organizationIds))
      }

      const rows = await ctx.db
        .select({
          key: apiKeys,
          organizationName: organizations.name,
        })
        .from(apiKeys)
        .leftJoin(organizations, eq(organizations.id, apiKeys.organizationId))
        .where(filters.length > 0 ? and(...filters) : undefined)
        .orderBy(desc(apiKeys.createdAt))

      return rows.map(({ key, organizationName }) => ({
        ...publicApiKey(key),
        organizationName,
      }))
    }),
  create: adminProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    const actor = ctx.actor
    if (!actor) {
      throw new TRPCError({ code: "UNAUTHORIZED" })
    }

    const organizationId = input.organizationId ?? null
    if (organizationId) {
      assertCanCreateOrgKey(ctx, organizationId)
      const [organization] = await ctx.db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
      if (!organization) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }
    } else {
      assertPlatformAdministrator(actor)
    }

    const grants = intersectPermissions(actor.permissions, input.permissions)
    if (grants.length !== input.permissions.length) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "A key cannot grant more access than you have.",
      })
    }

    if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Choose an expiration in the future.",
      })
    }

    const secret = generateApiKeySecret()
    const prefix = apiKeyLookupPrefix(secret)
    const [record] = await ctx.db
      .insert(apiKeys)
      .values({
        name: input.name,
        prefix,
        secretHash: hashApiKeySecret(secret),
        createdByUserId: actor.id,
        organizationId,
        permissions: grants,
        expiresAt: input.expiresAt ?? null,
      })
      .returning()

    if (!record) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" })
    }

    await writeAuditEvent(ctx, {
      eventType: "api_key_created",
      organizationId,
      eventData: {
        apiKeyId: record.id,
        name: record.name,
        prefix: record.prefix,
        permissions: record.permissions,
        expiresAt: record.expiresAt?.toISOString() ?? null,
      },
    })

    return {
      key: secret,
      apiKey: publicApiKey(record),
    }
  }),
  revoke: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [record] = await ctx.db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.id, input.id))
      if (!record) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }

      const scope = listScope(ctx)
      if (scope.kind === "orgs") {
        if (!record.organizationId) {
          throw new TRPCError({ code: "FORBIDDEN" })
        }
        if (!scope.organizationIds.includes(record.organizationId)) {
          throw new TRPCError({ code: "FORBIDDEN" })
        }
      }

      if (record.revokedAt) {
        return publicApiKey(record)
      }

      const now = new Date()
      const [updated] = await ctx.db
        .update(apiKeys)
        .set({ revokedAt: now, updatedAt: now })
        .where(and(eq(apiKeys.id, record.id), isNull(apiKeys.revokedAt)))
        .returning()

      await writeAuditEvent(ctx, {
        eventType: "api_key_revoked",
        organizationId: record.organizationId,
        eventData: {
          apiKeyId: record.id,
          name: record.name,
          prefix: record.prefix,
        },
      })

      return publicApiKey(
        updated ?? { ...record, revokedAt: now, updatedAt: now }
      )
    }),
})
