import { TRPCError } from "@trpc/server"
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { z } from "zod"

import { alerts, assets, devices, organizations, sites, user } from "@nms/db"
import { alertKindLabels, isAlertSnoozed, type AlertKind } from "@nms/shared"

import { assertAuthorized, requireActor } from "../access"
import { writeAuditEvent } from "../audit"
import { enqueueAlertNotifications } from "../alert-deliveries"
import type { ApiContext } from "../context"
import { markHubTicketsDoneForAlert } from "../hub-tickets"
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

const SUMMARY_LIMIT = 6

const acknowledgedBy = alias(user, "acknowledged_by")
const resolvedBy = alias(user, "resolved_by")
const snoozedBy = alias(user, "snoozed_by")

function parseDate(values: string[] | undefined) {
  const raw = values?.[0]
  if (!raw) return undefined
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function alertScope(actor: ApiContext["actor"]) {
  return eventScopeCondition(actor, {
    organizationId: alerts.organizationId,
    siteId: alerts.siteId,
    deviceId: alerts.deviceId,
  })
}

function buildAlertConditions(
  query: ResolvedListQuery,
  scope: ScopeCondition,
  now = new Date()
) {
  const from = parseDate(query.filters.from)
  const to = parseDate(query.filters.to)
  const snoozed = query.filters.snoozed ?? []
  const wantsSnoozed = snoozed.includes("yes")
  const wantsUnsnoozed = snoozed.includes("no")
  return combineConditions([
    scope.kind === "where" ? scope.condition : undefined,
    query.filters.status
      ? inArray(sql`${alerts.status}::text`, query.filters.status)
      : undefined,
    query.filters.severity
      ? inArray(sql`${alerts.severity}::text`, query.filters.severity)
      : undefined,
    query.filters.kind
      ? inArray(sql`${alerts.kind}::text`, query.filters.kind)
      : undefined,
    query.filters.organizationId
      ? inArray(alerts.organizationId, query.filters.organizationId)
      : undefined,
    query.filters.siteId
      ? inArray(alerts.siteId, query.filters.siteId)
      : undefined,
    query.filters.deviceId
      ? inArray(alerts.deviceId, query.filters.deviceId)
      : undefined,
    wantsSnoozed && !wantsUnsnoozed
      ? and(
          sql`${alerts.snoozedUntil} > ${now}`,
          sql`${alerts.status} <> 'resolved'`
        )
      : undefined,
    wantsUnsnoozed && !wantsSnoozed
      ? or(isNull(alerts.snoozedUntil), lte(alerts.snoozedUntil, now))
      : undefined,
    from ? gte(alerts.lastSeenAt, from) : undefined,
    to ? lte(alerts.lastSeenAt, to) : undefined,
    query.search
      ? or(
          ilike(alerts.title, likePattern(query.search)),
          ilike(sql`${alerts.detail}::text`, likePattern(query.search)),
          ilike(devices.displayName, likePattern(query.search)),
          ilike(devices.hostname, likePattern(query.search)),
          ilike(sites.name, likePattern(query.search))
        )
      : undefined,
  ])
}

const sortColumns = {
  lastSeenAt: alerts.lastSeenAt,
  firstSeenAt: alerts.firstSeenAt,
  severity: sql`case ${alerts.severity} when 'critical' then 0 when 'warning' then 1 when 'notice' then 2 else 3 end`,
  status: alerts.status,
  kind: alerts.kind,
  occurrences: alerts.occurrences,
  title: alerts.title,
  deviceName: devices.displayName,
  siteName: sites.name,
}

function alertBase(ctx: ApiContext) {
  return ctx.db
    .select({
      id: alerts.id,
      kind: alerts.kind,
      severity: alerts.severity,
      status: alerts.status,
      title: alerts.title,
      detail: alerts.detail,
      occurrences: alerts.occurrences,
      firstSeenAt: alerts.firstSeenAt,
      lastSeenAt: alerts.lastSeenAt,
      organizationId: alerts.organizationId,
      organizationName: organizations.name,
      siteId: alerts.siteId,
      siteName: sites.name,
      deviceId: alerts.deviceId,
      deviceName: devices.displayName,
      deviceHostname: devices.hostname,
      assetId: alerts.assetId,
      assetTag: assets.tag,
      acknowledgedAt: alerts.acknowledgedAt,
      acknowledgedByName: acknowledgedBy.name,
      acknowledgedByEmail: acknowledgedBy.email,
      resolvedAt: alerts.resolvedAt,
      resolvedByName: resolvedBy.name,
      resolvedByEmail: resolvedBy.email,
      snoozedUntil: alerts.snoozedUntil,
      snoozedByName: snoozedBy.name,
      snoozedByEmail: snoozedBy.email,
      escalatedAt: alerts.escalatedAt,
    })
    .from(alerts)
    .leftJoin(devices, eq(devices.id, alerts.deviceId))
    .leftJoin(assets, eq(assets.id, alerts.assetId))
    .leftJoin(sites, eq(sites.id, alerts.siteId))
    .leftJoin(organizations, eq(organizations.id, alerts.organizationId))
    .leftJoin(
      acknowledgedBy,
      eq(acknowledgedBy.id, alerts.acknowledgedByUserId)
    )
    .leftJoin(resolvedBy, eq(resolvedBy.id, alerts.resolvedByUserId))
    .leftJoin(snoozedBy, eq(snoozedBy.id, alerts.snoozedByUserId))
}

async function loadAlertForUpdate(ctx: ApiContext, id: string) {
  const [row] = await ctx.db
    .select({
      id: alerts.id,
      kind: alerts.kind,
      status: alerts.status,
      title: alerts.title,
      severity: alerts.severity,
      organizationId: alerts.organizationId,
      siteId: alerts.siteId,
      deviceId: alerts.deviceId,
      assetId: alerts.assetId,
      detail: alerts.detail,
      snoozedUntil: alerts.snoozedUntil,
      dedupeKey: alerts.dedupeKey,
    })
    .from(alerts)
    .where(eq(alerts.id, id))
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND" })
  }
  if (row.organizationId) {
    assertAuthorized(ctx.actor, "device:update", {
      kind: "device",
      organizationId: row.organizationId,
      siteId: row.siteId,
    })
  } else {
    assertAuthorized(ctx.actor, "device:update", { kind: "platform" })
  }
  return row
}

export const alertsRouter = createTRPCRouter({
  page: permissionProcedure("device:view")
    .input(listQuerySchema.optional())
    .query(async ({ ctx, input }) => {
      const query = resolveListQuery(input, { defaultLimit: 50 })
      const scope = alertScope(ctx.actor)
      if (scope.kind === "none") {
        return paginate([], query, 0)
      }
      const conditions = buildAlertConditions(query, scope)
      const where = conditions.length > 0 ? and(...conditions) : undefined

      const [[totalRow], rows] = await Promise.all([
        ctx.db
          .select({ total: count() })
          .from(alerts)
          .leftJoin(devices, eq(devices.id, alerts.deviceId))
          .leftJoin(sites, eq(sites.id, alerts.siteId))
          .where(where),
        alertBase(ctx)
          .where(where)
          .orderBy(
            ...buildOrderBy(query.sort, sortColumns, [
              desc(alerts.lastSeenAt),
              desc(alerts.id),
            ])
          )
          .limit(query.limit + 1)
          .offset(query.offset),
      ])
      return paginate(rows, query, Number(totalRow?.total ?? 0))
    }),
  facets: permissionProcedure("device:view").query(async ({ ctx }) => {
    const scope = alertScope(ctx.actor)
    const empty = {
      status: [] as Array<{ value: string; count: number }>,
      severity: [] as Array<{ value: string; count: number }>,
      kind: [] as Array<{ value: string; label: string; count: number }>,
      siteId: [] as Array<{ value: string; label: string; count: number }>,
      snoozed: 0,
    }
    if (scope.kind === "none") {
      return empty
    }
    const where = scope.kind === "where" ? scope.condition : undefined
    const now = new Date()
    const [statusRows, severityRows, kindRows, siteRows, snoozedRows] =
      await Promise.all([
        ctx.db
          .select({ value: alerts.status, total: count() })
          .from(alerts)
          .where(where)
          .groupBy(alerts.status),
        ctx.db
          .select({ value: alerts.severity, total: count() })
          .from(alerts)
          .where(where)
          .groupBy(alerts.severity),
        ctx.db
          .select({ value: alerts.kind, total: count() })
          .from(alerts)
          .where(where)
          .groupBy(alerts.kind),
        ctx.db
          .select({ value: alerts.siteId, label: sites.name, total: count() })
          .from(alerts)
          .innerJoin(sites, eq(sites.id, alerts.siteId))
          .where(where)
          .groupBy(alerts.siteId, sites.name)
          .orderBy(sites.name),
        ctx.db
          .select({ total: count() })
          .from(alerts)
          .where(
            and(
              where,
              sql`${alerts.snoozedUntil} > ${now}`,
              sql`${alerts.status} <> 'resolved'`
            )
          ),
      ])
    return {
      status: statusRows.map((row) => ({
        value: row.value,
        count: Number(row.total),
      })),
      severity: severityRows.map((row) => ({
        value: row.value,
        count: Number(row.total),
      })),
      kind: kindRows.map((row) => ({
        value: row.value,
        label: alertKindLabels[row.value as AlertKind] ?? row.value,
        count: Number(row.total),
      })),
      siteId: siteRows.flatMap((row) =>
        row.value
          ? [{ value: row.value, label: row.label, count: Number(row.total) }]
          : []
      ),
      snoozed: Number(snoozedRows[0]?.total ?? 0),
    }
  }),
  /** Open-alert counts plus the most urgent open alerts, for the Overview. */
  summary: permissionProcedure("device:view").query(async ({ ctx }) => {
    const scope = alertScope(ctx.actor)
    const empty = {
      open: 0,
      acknowledged: 0,
      critical: 0,
      warning: 0,
      items: [] as Awaited<ReturnType<typeof alertBase>>,
    }
    if (scope.kind === "none") {
      return empty
    }
    const where = scope.kind === "where" ? scope.condition : undefined
    const unresolved = sql`${alerts.status} <> 'resolved' and ${alerts.status} <> 'suppressed'`
    const notSnoozed = sql`(${alerts.snoozedUntil} is null or ${alerts.snoozedUntil} <= ${new Date()})`
    const [[counts], items] = await Promise.all([
      ctx.db
        .select({
          open: sql<number>`count(*) filter (where ${alerts.status} = 'open' and (${alerts.snoozedUntil} is null or ${alerts.snoozedUntil} <= now()))::int`,
          acknowledged: sql<number>`count(*) filter (where ${alerts.status} = 'acknowledged')::int`,
          critical: sql<number>`count(*) filter (where ${alerts.severity} = 'critical')::int`,
          warning: sql<number>`count(*) filter (where ${alerts.severity} = 'warning')::int`,
        })
        .from(alerts)
        .where(and(where, unresolved)),
      alertBase(ctx)
        .where(and(where, unresolved, notSnoozed))
        .orderBy(sortColumns.severity, desc(alerts.lastSeenAt))
        .limit(SUMMARY_LIMIT),
    ])
    return {
      open: Number(counts?.open ?? 0),
      acknowledged: Number(counts?.acknowledged ?? 0),
      critical: Number(counts?.critical ?? 0),
      warning: Number(counts?.warning ?? 0),
      items,
    }
  }),
  acknowledge: permissionProcedure("device:update")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const actor = requireActor(ctx.actor)
      const alert = await loadAlertForUpdate(ctx, input.id)
      if (alert.status !== "open") {
        return { id: alert.id, status: alert.status }
      }
      const now = new Date()
      await ctx.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(alerts)
          .set({
            status: "acknowledged",
            acknowledgedAt: now,
            acknowledgedByUserId: actor.id,
            updatedAt: now,
          })
          .where(and(eq(alerts.id, alert.id), eq(alerts.status, "open")))
          .returning({ id: alerts.id })
        if (!updated) return
        await writeAuditEvent(
          { ...ctx, db: tx },
          {
            eventType: "alert_acknowledged",
            organizationId: alert.organizationId,
            siteId: alert.siteId,
            deviceId: alert.deviceId,
            eventData: {
              alertId: alert.id,
              kind: alert.kind,
              title: alert.title,
              severity: alert.severity,
            },
          }
        )
      })
      return { id: alert.id, status: "acknowledged" as const }
    }),
  resolve: permissionProcedure("device:update")
    .input(
      z.object({
        id: z.string().uuid(),
        note: z.string().trim().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = requireActor(ctx.actor)
      const alert = await loadAlertForUpdate(ctx, input.id)
      if (alert.status === "resolved") {
        return { id: alert.id, status: alert.status }
      }
      const now = new Date()
      await ctx.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(alerts)
          .set({
            status: "resolved",
            resolvedAt: now,
            resolvedByUserId: actor.id,
            updatedAt: now,
          })
          .where(
            and(eq(alerts.id, alert.id), sql`${alerts.status} <> 'resolved'`)
          )
          .returning({ id: alerts.id })
        if (!updated) return
        await writeAuditEvent(
          { ...ctx, db: tx },
          {
            eventType: "alert_resolved",
            organizationId: alert.organizationId,
            siteId: alert.siteId,
            deviceId: alert.deviceId,
            eventData: {
              alertId: alert.id,
              kind: alert.kind,
              title: alert.title,
              severity: alert.severity,
              resolvedBy: "user",
              ...(input.note ? { note: input.note } : {}),
            },
          }
        )
        const resolvedAlert = {
          ...alert,
          status: "resolved" as const,
          resolvedAt: now,
          resolvedByUserId: actor.id,
          updatedAt: now,
        }
        await enqueueAlertNotifications(
          tx,
          resolvedAlert,
          "alert.resolved",
          now
        )
        await markHubTicketsDoneForAlert(tx, alert.id, now)
      })
      return { id: alert.id, status: "resolved" as const }
    }),
  snooze: permissionProcedure("device:update")
    .input(
      z
        .object({
          id: z.string().uuid(),
          hours: z
            .union([z.literal(1), z.literal(8), z.literal(24)])
            .optional(),
          until: z.coerce.date().optional(),
          clear: z.boolean().optional(),
        })
        .refine((value) => Boolean(value.clear || value.hours || value.until), {
          message: "Choose a snooze duration.",
        })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = requireActor(ctx.actor)
      const alert = await loadAlertForUpdate(ctx, input.id)
      if (alert.status === "resolved") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Resolved alerts cannot be snoozed.",
        })
      }
      const now = new Date()
      let snoozedUntil: Date | null = null
      if (!input.clear) {
        if (input.hours) {
          snoozedUntil = new Date(now.getTime() + input.hours * 60 * 60 * 1000)
        } else if (input.until) {
          snoozedUntil = input.until
        }
        if (!snoozedUntil || snoozedUntil.getTime() <= now.getTime()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Choose a time in the future.",
          })
        }
        const max = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)
        if (snoozedUntil.getTime() > max.getTime()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Snooze cannot last more than 90 days.",
          })
        }
      }

      await ctx.db.transaction(async (tx) => {
        await tx
          .update(alerts)
          .set({
            snoozedUntil,
            snoozedByUserId: snoozedUntil ? actor.id : null,
            updatedAt: now,
          })
          .where(eq(alerts.id, alert.id))
        await writeAuditEvent(
          { ...ctx, db: tx },
          {
            eventType: "alert_snoozed",
            organizationId: alert.organizationId,
            siteId: alert.siteId,
            deviceId: alert.deviceId,
            eventData: {
              alertId: alert.id,
              kind: alert.kind,
              title: alert.title,
              snoozedUntil: snoozedUntil?.toISOString() ?? null,
              cleared: Boolean(input.clear),
            },
          }
        )
      })
      return {
        id: alert.id,
        snoozedUntil,
        snoozed: Boolean(snoozedUntil && isAlertSnoozed(snoozedUntil, now)),
      }
    }),
})
