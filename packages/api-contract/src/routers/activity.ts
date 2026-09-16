import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
} from "drizzle-orm"

import { z } from "zod"

import { auditEvents, devices, organizations, sites, user } from "@nms/db"

import { actorOrganizationIds, actorSiteIds, assertAuthorized } from "../access"
import type { ApiContext } from "../context"
import {
  buildOrderBy,
  likePattern,
  listQuerySchema,
  paginate,
  resolveListQuery,
  type ResolvedListQuery,
} from "../list"
import {
  combineConditions,
  eventScopeCondition,
  type ScopeCondition,
} from "../scope"
import { createTRPCRouter, permissionProcedure } from "../trpc"

const EXPORT_MAX_ROWS = 5000

const auditListInput = z.object({
  organizationId: z.string().uuid().optional(),
  deviceId: z.string().uuid().optional(),
})

function parseDate(values: string[] | undefined) {
  const raw = values?.[0]
  if (!raw) return undefined
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function auditScope(actor: ApiContext["actor"]) {
  return eventScopeCondition(actor, {
    organizationId: auditEvents.organizationId,
    siteId: auditEvents.siteId,
    deviceId: auditEvents.deviceId,
  })
}

function buildAuditConditions(query: ResolvedListQuery, scope: ScopeCondition) {
  const from = parseDate(query.filters.from)
  const to = parseDate(query.filters.to)

  return combineConditions([
    scope.kind === "where" ? scope.condition : undefined,
    query.filters.eventType
      ? inArray(auditEvents.eventType, query.filters.eventType)
      : undefined,
    query.filters.severity
      ? inArray(sql`${auditEvents.severity}::text`, query.filters.severity)
      : undefined,
    query.filters.organizationId
      ? inArray(auditEvents.organizationId, query.filters.organizationId)
      : undefined,
    query.filters.siteId
      ? inArray(auditEvents.siteId, query.filters.siteId)
      : undefined,
    query.filters.deviceId
      ? inArray(auditEvents.deviceId, query.filters.deviceId)
      : undefined,
    query.filters.actorUserId
      ? inArray(auditEvents.actorUserId, query.filters.actorUserId)
      : undefined,
    from ? gte(auditEvents.createdAt, from) : undefined,
    to ? lte(auditEvents.createdAt, to) : undefined,
    query.search
      ? or(
          ilike(auditEvents.eventType, likePattern(query.search)),
          ilike(sql`${auditEvents.eventData}::text`, likePattern(query.search)),
          ilike(sql`host(${auditEvents.actorIp})`, likePattern(query.search)),
          ilike(user.name, likePattern(query.search)),
          ilike(user.email, likePattern(query.search)),
          ilike(devices.displayName, likePattern(query.search)),
          ilike(sites.name, likePattern(query.search))
        )
      : undefined,
  ])
}

const sortColumns = {
  createdAt: auditEvents.createdAt,
  eventType: auditEvents.eventType,
  severity: sql`case ${auditEvents.severity} when 'critical' then 0 when 'warning' then 1 when 'notice' then 2 else 3 end`,
  actorName: user.name,
  actorUserId: user.name,
  organizationName: organizations.name,
  organizationId: organizations.name,
  siteName: sites.name,
  siteId: sites.name,
  deviceName: devices.displayName,
  deviceId: devices.displayName,
}

function auditBase(ctx: ApiContext) {
  return ctx.db
    .select({
      id: auditEvents.id,
      actorUserId: auditEvents.actorUserId,
      actorName: user.name,
      actorEmail: user.email,
      actorIp: auditEvents.actorIp,
      userAgent: auditEvents.userAgent,
      organizationId: auditEvents.organizationId,
      organizationName: organizations.name,
      siteId: auditEvents.siteId,
      siteName: sites.name,
      deviceId: auditEvents.deviceId,
      deviceName: devices.displayName,
      eventType: auditEvents.eventType,
      severity: auditEvents.severity,
      eventData: auditEvents.eventData,
      createdAt: auditEvents.createdAt,
    })
    .from(auditEvents)
    .leftJoin(user, eq(user.id, auditEvents.actorUserId))
    .leftJoin(devices, eq(devices.id, auditEvents.deviceId))
    .leftJoin(organizations, eq(organizations.id, auditEvents.organizationId))
    .leftJoin(sites, eq(sites.id, auditEvents.siteId))
}

export const auditRouter = createTRPCRouter({
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
  page: permissionProcedure("audit:view")
    .input(listQuerySchema.optional())
    .query(async ({ ctx, input }) => {
      const query = resolveListQuery(input, { defaultLimit: 50 })
      const scope = auditScope(ctx.actor)
      if (scope.kind === "none") {
        return paginate([], query, 0)
      }

      const conditions = buildAuditConditions(query, scope)
      const where = conditions.length > 0 ? and(...conditions) : undefined

      const [[totalRow], rows] = await Promise.all([
        ctx.db
          .select({ total: count() })
          .from(auditEvents)
          .leftJoin(user, eq(user.id, auditEvents.actorUserId))
          .leftJoin(devices, eq(devices.id, auditEvents.deviceId))
          .leftJoin(sites, eq(sites.id, auditEvents.siteId))
          .where(where),
        auditBase(ctx)
          .where(where)
          .orderBy(
            ...buildOrderBy(query.sort, sortColumns, [
              desc(auditEvents.createdAt),
              desc(auditEvents.id),
            ])
          )
          .limit(query.limit + 1)
          .offset(query.offset),
      ])

      return paginate(rows, query, Number(totalRow?.total ?? 0))
    }),
  /** Same filters as `page`, capped, for CSV download. */
  export: permissionProcedure("audit:view")
    .input(listQuerySchema.omit({ cursor: true, limit: true }).optional())
    .query(async ({ ctx, input }) => {
      const query = resolveListQuery(
        { ...input, limit: EXPORT_MAX_ROWS },
        { defaultLimit: EXPORT_MAX_ROWS, maxLimit: EXPORT_MAX_ROWS }
      )
      const scope = auditScope(ctx.actor)
      if (scope.kind === "none") {
        return { rows: [], truncated: false }
      }
      const conditions = buildAuditConditions(query, scope)
      const rows = await auditBase(ctx)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(
          ...buildOrderBy(query.sort, sortColumns, [
            desc(auditEvents.createdAt),
            desc(auditEvents.id),
          ])
        )
        .limit(EXPORT_MAX_ROWS + 1)
      return {
        rows: rows.slice(0, EXPORT_MAX_ROWS),
        truncated: rows.length > EXPORT_MAX_ROWS,
      }
    }),
  /**
   * Filter options with counts across the actor's scope. Counts ignore the
   * active filters so options never vanish while narrowing.
   */
  facets: permissionProcedure("audit:view").query(async ({ ctx }) => {
    const scope = auditScope(ctx.actor)
    const empty = {
      eventType: [] as Array<{ value: string; count: number }>,
      severity: [] as Array<{ value: string; count: number }>,
      siteId: [] as Array<{ value: string; label: string; count: number }>,
      actorUserId: [] as Array<{
        value: string
        label: string
        count: number
      }>,
    }
    if (scope.kind === "none") {
      return empty
    }
    const where = scope.kind === "where" ? scope.condition : undefined

    const [eventTypeRows, severityRows, siteRows, actorRows] =
      await Promise.all([
        ctx.db
          .select({ value: auditEvents.eventType, total: count() })
          .from(auditEvents)
          .where(where)
          .groupBy(auditEvents.eventType)
          .orderBy(auditEvents.eventType),
        ctx.db
          .select({ value: auditEvents.severity, total: count() })
          .from(auditEvents)
          .where(where)
          .groupBy(auditEvents.severity),
        ctx.db
          .select({
            value: auditEvents.siteId,
            label: sites.name,
            total: count(),
          })
          .from(auditEvents)
          .innerJoin(sites, eq(sites.id, auditEvents.siteId))
          .where(where)
          .groupBy(auditEvents.siteId, sites.name)
          .orderBy(sites.name),
        ctx.db
          .select({
            value: auditEvents.actorUserId,
            name: user.name,
            email: user.email,
            total: count(),
          })
          .from(auditEvents)
          .innerJoin(user, eq(user.id, auditEvents.actorUserId))
          .where(where)
          .groupBy(auditEvents.actorUserId, user.name, user.email)
          .orderBy(user.name),
      ])

    return {
      eventType: eventTypeRows.map((row) => ({
        value: row.value,
        count: Number(row.total),
      })),
      severity: severityRows.map((row) => ({
        value: row.value,
        count: Number(row.total),
      })),
      siteId: siteRows.flatMap((row) =>
        row.value
          ? [{ value: row.value, label: row.label, count: Number(row.total) }]
          : []
      ),
      actorUserId: actorRows.flatMap((row) =>
        row.value
          ? [
              {
                value: row.value,
                label: row.name || row.email,
                count: Number(row.total),
              },
            ]
          : []
      ),
    }
  }),
  eventTypes: permissionProcedure("audit:view").query(async ({ ctx }) => {
    const rows = await ctx.db
      .selectDistinct({ eventType: auditEvents.eventType })
      .from(auditEvents)
      .orderBy(auditEvents.eventType)
    return rows.map((row) => row.eventType)
  }),
})
