import { TRPCError } from "@trpc/server"
import { and, asc, count, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { z } from "zod"

import {
  auditEvents,
  devices,
  enrollmentTokens,
  organizations,
  routePolicies,
  sites,
  vpnIdentities,
} from "@nms/db"
import {
  analyzeRoutes,
  entriesFromRoutes,
  routePolicyColorSchema,
  routePolicyEntriesSchema,
  type RoutePolicyEntry,
} from "@nms/shared"

import { actorOrganizationIds, assertAuthorized } from "../access"
import { writeAuditEvent } from "../audit"
import type { ApiContext } from "../context"
import { adminProcedure, createTRPCRouter } from "../trpc"

const routePolicyInputBase = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional().nullable(),
  color: routePolicyColorSchema.optional().nullable(),
  entries: routePolicyEntriesSchema.optional(),
  /** Legacy shape kept for older clients; ignored when `entries` is given. */
  routes: z.array(z.string().min(1)).optional(),
})

const routePolicyCreateInput = routePolicyInputBase.extend({
  organizationId: z.string().uuid(),
  isDefault: z.boolean().optional(),
})

const routePolicyUpdateInput = routePolicyInputBase.extend({
  id: z.string().uuid(),
  isDefault: z.boolean().optional(),
})

const routePolicyPreviewInput = z.object({
  id: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional().nullable(),
  entries: routePolicyEntriesSchema,
})

function vpnCidr() {
  return process.env.VPN_CIDR ?? null
}

function entriesFromInput(input: {
  entries?: RoutePolicyEntry[]
  routes?: string[]
}): RoutePolicyEntry[] {
  if (input.entries) {
    return input.entries
  }
  return entriesFromRoutes(input.routes ?? [])
}

/**
 * Validates entries and returns the canonical routes to persist. Errors are
 * rejected as a BAD_REQUEST carrying the first problem so the client can
 * surface it without a round trip through the preview endpoint.
 */
function prepareEntries(entries: RoutePolicyEntry[]) {
  const analysis = analyzeRoutes(entries, { vpnCidr: vpnCidr() })
  if (analysis.errorCount > 0) {
    const first = analysis.issues.find((issue) => issue.severity === "error")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: first?.message ?? "One or more routes are invalid.",
    })
  }
  if (analysis.normalizedRoutes.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Add at least one route.",
    })
  }

  const normalizedEntries: RoutePolicyEntry[] = analysis.routes
    .filter((route) => route.parsed)
    .map((route) => ({
      cidr: route.parsed!.cidr,
      label: route.entry.label?.trim() || null,
      comment: route.entry.comment?.trim() || null,
    }))

  return { entries: normalizedEntries, routes: analysis.normalizedRoutes }
}

async function loadPolicy(ctx: ApiContext, id: string) {
  const [policy] = await ctx.db
    .select()
    .from(routePolicies)
    .where(eq(routePolicies.id, id))
  if (!policy) {
    throw new TRPCError({ code: "NOT_FOUND" })
  }
  return policy
}

function assertCanManage(
  ctx: ApiContext,
  organizationId: string | null | undefined
) {
  if (organizationId) {
    assertAuthorized(ctx.actor, "organization:admin", {
      kind: "organization",
      organizationId,
    })
  } else {
    assertAuthorized(ctx.actor, "organization:admin", { kind: "platform" })
  }
}

function assertCanView(ctx: ApiContext, organizationId: string | null) {
  const organizationIds = actorOrganizationIds(ctx.actor)
  if (organizationIds === null) {
    return
  }
  if (!organizationId || !organizationIds.includes(organizationId)) {
    throw new TRPCError({ code: "FORBIDDEN" })
  }
}

/** Policies visible to the actor: their organizations plus shared (null org). */
function visibilityCondition(ctx: ApiContext) {
  const organizationIds = actorOrganizationIds(ctx.actor)
  if (organizationIds === null) {
    return { kind: "all" as const }
  }
  if (organizationIds.length === 0) {
    return { kind: "none" as const }
  }
  return {
    kind: "where" as const,
    condition: or(
      inArray(routePolicies.organizationId, organizationIds),
      isNull(routePolicies.organizationId)
    )!,
  }
}

const activeTokenCondition = and(
  or(
    isNull(enrollmentTokens.expiresAt),
    sql`${enrollmentTokens.expiresAt} > now()`
  ),
  sql`${enrollmentTokens.uses} < ${enrollmentTokens.maxUses}`
)

async function usageCounts(ctx: ApiContext, policyIds: string[]) {
  const deviceCounts = new Map<string, number>()
  const tokenCounts = new Map<string, number>()
  if (policyIds.length === 0) {
    return { deviceCounts, tokenCounts }
  }

  const [deviceRows, tokenRows] = await Promise.all([
    ctx.db
      .select({
        routePolicyId: vpnIdentities.routePolicyId,
        total: count(),
      })
      .from(vpnIdentities)
      .where(
        and(
          inArray(vpnIdentities.routePolicyId, policyIds),
          isNull(vpnIdentities.revokedAt)
        )
      )
      .groupBy(vpnIdentities.routePolicyId),
    ctx.db
      .select({
        routePolicyId: enrollmentTokens.routePolicyId,
        total: count(),
      })
      .from(enrollmentTokens)
      .where(
        and(
          inArray(enrollmentTokens.routePolicyId, policyIds),
          activeTokenCondition
        )
      )
      .groupBy(enrollmentTokens.routePolicyId),
  ])

  for (const row of deviceRows) {
    if (row.routePolicyId) deviceCounts.set(row.routePolicyId, row.total)
  }
  for (const row of tokenRows) {
    if (row.routePolicyId) tokenCounts.set(row.routePolicyId, row.total)
  }
  return { deviceCounts, tokenCounts }
}

async function otherPoliciesInOrganization(
  ctx: ApiContext,
  organizationId: string | null | undefined,
  excludeId?: string
) {
  const rows = await ctx.db
    .select({
      id: routePolicies.id,
      name: routePolicies.name,
      routes: routePolicies.routes,
    })
    .from(routePolicies)
    .where(
      organizationId
        ? or(
            eq(routePolicies.organizationId, organizationId),
            isNull(routePolicies.organizationId)
          )
        : isNull(routePolicies.organizationId)
    )
  return rows.filter((row) => row.id !== excludeId)
}

async function clearDefault(
  db: Pick<ApiContext["db"], "update">,
  organizationId: string | null,
  exceptId?: string
) {
  await db
    .update(routePolicies)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(
      and(
        organizationId
          ? eq(routePolicies.organizationId, organizationId)
          : isNull(routePolicies.organizationId),
        eq(routePolicies.isDefault, true),
        exceptId ? sql`${routePolicies.id} <> ${exceptId}` : undefined
      )
    )
}

export const routePoliciesRouter = createTRPCRouter({
  list: adminProcedure.query(async ({ ctx }) => {
    const visibility = visibilityCondition(ctx)
    if (visibility.kind === "none") {
      return []
    }

    const baseQuery = ctx.db
      .select({
        id: routePolicies.id,
        organizationId: routePolicies.organizationId,
        organizationName: organizations.name,
        name: routePolicies.name,
        routes: routePolicies.routes,
        entries: routePolicies.entries,
        description: routePolicies.description,
        isDefault: routePolicies.isDefault,
        color: routePolicies.color,
        createdAt: routePolicies.createdAt,
        updatedAt: routePolicies.updatedAt,
      })
      .from(routePolicies)
      .leftJoin(
        organizations,
        eq(organizations.id, routePolicies.organizationId)
      )

    const policies =
      visibility.kind === "where"
        ? await baseQuery
            .where(visibility.condition)
            .orderBy(asc(routePolicies.name))
        : await baseQuery.orderBy(asc(routePolicies.name))

    const { deviceCounts, tokenCounts } = await usageCounts(
      ctx,
      policies.map((policy) => policy.id)
    )

    return policies.map((policy) => ({
      ...policy,
      entries:
        policy.entries.length > 0
          ? policy.entries
          : entriesFromRoutes(policy.routes),
      deviceCount: deviceCounts.get(policy.id) ?? 0,
      tokenCount: tokenCounts.get(policy.id) ?? 0,
    }))
  }),

  byId: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const policy = await loadPolicy(ctx, input.id)
      assertCanView(ctx, policy.organizationId)
      const { deviceCounts, tokenCounts } = await usageCounts(ctx, [policy.id])
      return {
        ...policy,
        entries:
          policy.entries.length > 0
            ? policy.entries
            : entriesFromRoutes(policy.routes),
        deviceCount: deviceCounts.get(policy.id) ?? 0,
        tokenCount: tokenCounts.get(policy.id) ?? 0,
      }
    }),

  /**
   * Validates a draft without saving it: format errors, reserved or public
   * ranges, tunnel-network overlap, and overlap with sibling policies.
   */
  preview: adminProcedure
    .input(routePolicyPreviewInput)
    .query(async ({ ctx, input }) => {
      let organizationId = input.organizationId ?? null
      if (input.id) {
        const policy = await loadPolicy(ctx, input.id)
        assertCanView(ctx, policy.organizationId)
        organizationId = policy.organizationId
      } else if (organizationId) {
        assertCanView(ctx, organizationId)
      }

      const otherPolicies = await otherPoliciesInOrganization(
        ctx,
        organizationId,
        input.id
      )
      const tunnelCidr = vpnCidr()
      const analysis = analyzeRoutes(input.entries, {
        vpnCidr: tunnelCidr,
        otherPolicies,
      })

      return {
        ...analysis,
        tunnelCidr,
      }
    }),

  /**
   * Which policies each site uses and how many devices are on each, so
   * admins can spot sites with no policy or inconsistent coverage.
   */
  allocation: adminProcedure.query(async ({ ctx }) => {
    const organizationIds = actorOrganizationIds(ctx.actor)
    if (organizationIds !== null && organizationIds.length === 0) {
      return { organizations: [] }
    }

    const scope =
      organizationIds === null
        ? undefined
        : inArray(devices.organizationId, organizationIds)

    const [rows, siteRows, organizationRows] = await Promise.all([
      ctx.db
        .select({
          organizationId: devices.organizationId,
          siteId: devices.siteId,
          routePolicyId: vpnIdentities.routePolicyId,
          total: count(),
        })
        .from(devices)
        .leftJoin(vpnIdentities, eq(vpnIdentities.deviceId, devices.id))
        .where(scope)
        .groupBy(
          devices.organizationId,
          devices.siteId,
          vpnIdentities.routePolicyId
        ),
      ctx.db
        .select({
          id: sites.id,
          organizationId: sites.organizationId,
          name: sites.name,
        })
        .from(sites)
        .where(
          organizationIds === null
            ? undefined
            : inArray(sites.organizationId, organizationIds)
        )
        .orderBy(asc(sites.name)),
      ctx.db
        .select({ id: organizations.id, name: organizations.name })
        .from(organizations)
        .where(
          organizationIds === null
            ? undefined
            : inArray(organizations.id, organizationIds)
        )
        .orderBy(asc(organizations.name)),
    ])

    type Cell = { routePolicyId: string | null; deviceCount: number }
    type SiteRow = {
      siteId: string | null
      siteName: string | null
      deviceCount: number
      policies: Cell[]
    }

    const byOrganization = new Map<
      string,
      { id: string; name: string; sites: Map<string | null, SiteRow> }
    >()

    for (const organization of organizationRows) {
      const siteMap = new Map<string | null, SiteRow>()
      for (const site of siteRows.filter(
        (entry) => entry.organizationId === organization.id
      )) {
        siteMap.set(site.id, {
          siteId: site.id,
          siteName: site.name,
          deviceCount: 0,
          policies: [],
        })
      }
      byOrganization.set(organization.id, {
        id: organization.id,
        name: organization.name,
        sites: siteMap,
      })
    }

    for (const row of rows) {
      const organization = byOrganization.get(row.organizationId)
      if (!organization) continue
      let site = organization.sites.get(row.siteId)
      if (!site) {
        site = {
          siteId: row.siteId,
          siteName: null,
          deviceCount: 0,
          policies: [],
        }
        organization.sites.set(row.siteId, site)
      }
      site.deviceCount += row.total
      site.policies.push({
        routePolicyId: row.routePolicyId,
        deviceCount: row.total,
      })
    }

    return {
      organizations: [...byOrganization.values()].map((organization) => ({
        id: organization.id,
        name: organization.name,
        sites: [...organization.sites.values()]
          .map((site) => ({
            ...site,
            policies: site.policies.sort(
              (a, b) => b.deviceCount - a.deviceCount
            ),
          }))
          .sort((a, b) => {
            if (a.siteId === null) return 1
            if (b.siteId === null) return -1
            return (a.siteName ?? "").localeCompare(b.siteName ?? "")
          }),
      })),
    }
  }),

  create: adminProcedure
    .input(routePolicyCreateInput)
    .mutation(async ({ ctx, input }) => {
      assertCanManage(ctx, input.organizationId)
      const prepared = prepareEntries(entriesFromInput(input))

      const record = await ctx.db.transaction(async (tx) => {
        if (input.isDefault) {
          await clearDefault(tx, input.organizationId)
        }
        const [created] = await tx
          .insert(routePolicies)
          .values({
            organizationId: input.organizationId,
            name: input.name,
            routes: prepared.routes,
            entries: prepared.entries,
            description: input.description ?? null,
            color: input.color ?? null,
            isDefault: input.isDefault ?? false,
          })
          .returning()

        await writeAuditEvent(
          { db: tx, actor: ctx.actor },
          {
            eventType: "route_policy_created",
            organizationId: input.organizationId,
            eventData: {
              routePolicyId: created.id,
              name: created.name,
              routes: created.routes,
              isDefault: created.isDefault,
            },
          }
        )
        return created
      })

      return record
    }),

  update: adminProcedure
    .input(routePolicyUpdateInput)
    .mutation(async ({ ctx, input }) => {
      const existing = await loadPolicy(ctx, input.id)
      assertCanManage(ctx, existing.organizationId)
      const prepared = prepareEntries(entriesFromInput(input))
      const isDefault = input.isDefault ?? existing.isDefault

      const record = await ctx.db.transaction(async (tx) => {
        if (isDefault && !existing.isDefault) {
          await clearDefault(tx, existing.organizationId, existing.id)
        }
        const [updated] = await tx
          .update(routePolicies)
          .set({
            name: input.name,
            routes: prepared.routes,
            entries: prepared.entries,
            description: input.description ?? null,
            color: input.color === undefined ? existing.color : input.color,
            isDefault,
            updatedAt: new Date(),
          })
          .where(eq(routePolicies.id, input.id))
          .returning()

        if (!updated) {
          throw new TRPCError({ code: "NOT_FOUND" })
        }

        await writeAuditEvent(
          { db: tx, actor: ctx.actor },
          {
            eventType: "route_policy_updated",
            organizationId: existing.organizationId,
            eventData: {
              routePolicyId: updated.id,
              name: updated.name,
              routes: updated.routes,
              previousRoutes: existing.routes,
              isDefault: updated.isDefault,
            },
          }
        )
        return updated
      })

      return record
    }),

  setDefault: adminProcedure
    .input(z.object({ id: z.string().uuid(), isDefault: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await loadPolicy(ctx, input.id)
      assertCanManage(ctx, existing.organizationId)

      await ctx.db.transaction(async (tx) => {
        if (input.isDefault) {
          await clearDefault(tx, existing.organizationId, existing.id)
        }
        await tx
          .update(routePolicies)
          .set({ isDefault: input.isDefault, updatedAt: new Date() })
          .where(eq(routePolicies.id, existing.id))
        await writeAuditEvent(
          { db: tx, actor: ctx.actor },
          {
            eventType: "route_policy_default_changed",
            organizationId: existing.organizationId,
            eventData: {
              routePolicyId: existing.id,
              name: existing.name,
              isDefault: input.isDefault,
            },
          }
        )
      })

      return { id: existing.id, isDefault: input.isDefault }
    }),

  /**
   * Moves every device on one policy to another (or to no policy). Used when
   * retiring a policy so devices never silently lose their routes.
   */
  reassignDevices: adminProcedure
    .input(
      z.object({
        fromId: z.string().uuid(),
        toId: z.string().uuid().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const from = await loadPolicy(ctx, input.fromId)
      assertCanManage(ctx, from.organizationId)
      const to = input.toId ? await loadPolicy(ctx, input.toId) : null
      if (
        to &&
        to.organizationId &&
        to.organizationId !== from.organizationId
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Both policies must belong to the same organization.",
        })
      }

      const moved = await ctx.db.transaction(async (tx) => {
        const rows = await tx
          .update(vpnIdentities)
          .set({ routePolicyId: input.toId })
          .where(eq(vpnIdentities.routePolicyId, from.id))
          .returning({ deviceId: vpnIdentities.deviceId })

        await writeAuditEvent(
          { db: tx, actor: ctx.actor },
          {
            eventType: "route_policy_devices_reassigned",
            organizationId: from.organizationId,
            eventData: {
              fromRoutePolicyId: from.id,
              fromName: from.name,
              toRoutePolicyId: to?.id ?? null,
              toName: to?.name ?? null,
              deviceCount: rows.length,
            },
          }
        )

        if (rows.length > 0) {
          await tx.insert(auditEvents).values(
            rows.map((row) => ({
              actorUserId: ctx.actor?.id ?? null,
              organizationId: from.organizationId,
              deviceId: row.deviceId,
              eventType: "device_route_policy_assigned" as const,
              eventData: {
                deviceId: row.deviceId,
                routePolicyId: to?.id ?? null,
                previousRoutePolicyId: from.id,
              },
            }))
          )
        }
        return rows.length
      })

      return { moved }
    }),

  delete: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        /** Move assigned devices here first; `null` leaves them without a policy. */
        reassignTo: z.string().uuid().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await loadPolicy(ctx, input.id)
      assertCanManage(ctx, existing.organizationId)
      const target = input.reassignTo
        ? await loadPolicy(ctx, input.reassignTo)
        : null
      if (
        target &&
        target.organizationId &&
        target.organizationId !== existing.organizationId
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "The replacement policy must belong to the same organization.",
        })
      }

      await ctx.db.transaction(async (tx) => {
        const moved = await tx
          .update(vpnIdentities)
          .set({ routePolicyId: target?.id ?? null })
          .where(eq(vpnIdentities.routePolicyId, existing.id))
          .returning({ deviceId: vpnIdentities.deviceId })

        await tx
          .update(enrollmentTokens)
          .set({ routePolicyId: target?.id ?? null })
          .where(eq(enrollmentTokens.routePolicyId, existing.id))

        await tx.delete(routePolicies).where(eq(routePolicies.id, existing.id))

        await writeAuditEvent(
          { db: tx, actor: ctx.actor },
          {
            eventType: "route_policy_deleted",
            organizationId: existing.organizationId,
            eventData: {
              routePolicyId: existing.id,
              name: existing.name,
              routes: existing.routes,
              reassignedTo: target?.id ?? null,
              reassignedToName: target?.name ?? null,
              deviceCount: moved.length,
            },
          }
        )
      })

      return existing
    }),
})
