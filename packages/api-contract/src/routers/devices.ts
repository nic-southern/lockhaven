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
  type SQL,
} from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { z } from "zod"

import { authorize, type ActorPrincipal } from "@nms/auth"
import {
  auditEvents,
  devices,
  managementServiceCredentials,
  managementServices,
  routePolicies,
  sites,
  vpnIdentities,
} from "@nms/db"
import {
  deviceBulkActionSchema,
  deviceConnectivityStates,
  deviceStatuses,
  deviceTagsSchema,
  type DeviceConnectivity,
  type DeviceStatus,
} from "@nms/shared"

import { assertAuthorized } from "../access"
import { writeAuditEvent, type AuditContext } from "../audit"
import type { ApiContext } from "../context"
import {
  connectivityExpression,
  enabledServiceTypes,
  onlineServiceCount,
} from "../device-sql"
import { siteBelongsToOrganization } from "../helpers"
import {
  buildOrderBy,
  likePattern,
  listQuerySchema,
  paginate,
  resolveListQuery,
  type ResolvedListQuery,
} from "../list"
import { combineConditions, deviceScopeCondition } from "../scope"
import { createTRPCRouter, permissionProcedure } from "../trpc"

const EXPORT_MAX_ROWS = 5000

const deviceUpdateInput = z.object({
  id: z.string().uuid(),
  displayName: z.string().trim().min(1).max(120).optional(),
  hostname: z.string().trim().min(1).max(253).optional().nullable(),
  siteId: z.string().uuid().optional().nullable(),
})

const deviceRoutePolicyInput = z.object({
  id: z.string().uuid(),
  routePolicyId: z.string().uuid().nullable(),
})

const deviceTagsInput = z.object({
  id: z.string().uuid(),
  tags: deviceTagsSchema,
})

function deviceRowSelection() {
  return {
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
    agentVersion: devices.agentVersion,
    tags: devices.tags,
    status: devices.status,
    lastSeenAt: devices.lastSeenAt,
    createdAt: devices.createdAt,
    vpnIpv4: vpnIdentities.vpnIpv4,
    vpnRoutePolicyId: vpnIdentities.routePolicyId,
    vpnRoutePolicyName: routePolicies.name,
    vpnLastHandshakeAt: vpnIdentities.lastHandshakeAt,
    vpnLatestEndpoint: vpnIdentities.latestEndpoint,
    vpnRxBytes: vpnIdentities.rxBytes,
    vpnTxBytes: vpnIdentities.txBytes,
    vpnRevokedAt: vpnIdentities.revokedAt,
    connectivity: connectivityExpression(),
    enabledServiceTypes: enabledServiceTypes(),
    onlineServiceCount: onlineServiceCount(),
  }
}

function deviceBase(ctx: ApiContext) {
  return ctx.db
    .select(deviceRowSelection())
    .from(devices)
    .leftJoin(sites, eq(sites.id, devices.siteId))
    .leftJoin(vpnIdentities, eq(vpnIdentities.deviceId, devices.id))
    .leftJoin(routePolicies, eq(routePolicies.id, vpnIdentities.routePolicyId))
}

function withNone(values: string[], column: AnyPgColumn) {
  const concrete = values.filter((value) => value !== "none")
  if (values.includes("none")) {
    return concrete.length > 0
      ? or(isNull(column), inArray(column, concrete))
      : isNull(column)
  }
  return inArray(column, concrete)
}

/** Translates a resolved list query into WHERE conditions for the devices join. */
function buildDeviceConditions(
  query: ResolvedListQuery,
  scope: ReturnType<typeof deviceScopeCondition>
) {
  const statusFilter = query.filters.status?.filter((value) =>
    (deviceStatuses as readonly string[]).includes(value)
  ) as DeviceStatus[] | undefined
  const connectivityFilter = query.filters.connectivity?.filter((value) =>
    (deviceConnectivityStates as readonly string[]).includes(value)
  ) as DeviceConnectivity[] | undefined

  return combineConditions([
    scope.kind === "where" ? scope.condition : undefined,
    query.filters.id ? inArray(devices.id, query.filters.id) : undefined,
    query.filters.organizationId
      ? inArray(devices.organizationId, query.filters.organizationId)
      : undefined,
    query.filters.siteId
      ? withNone(query.filters.siteId, devices.siteId)
      : undefined,
    statusFilter && statusFilter.length > 0
      ? inArray(devices.status, statusFilter)
      : undefined,
    connectivityFilter && connectivityFilter.length > 0
      ? inArray(connectivityExpression(), connectivityFilter)
      : undefined,
    query.filters.osFamily
      ? inArray(devices.osFamily, query.filters.osFamily)
      : undefined,
    query.filters.routePolicyId
      ? withNone(query.filters.routePolicyId, vpnIdentities.routePolicyId)
      : undefined,
    query.filters.tags
      ? sql`${devices.tags} && ${sql.param(query.filters.tags, devices.tags)}`
      : undefined,
    query.filters.agentVersion
      ? inArray(devices.agentVersion, query.filters.agentVersion)
      : undefined,
    query.search
      ? or(
          ilike(devices.displayName, likePattern(query.search)),
          ilike(devices.hostname, likePattern(query.search)),
          ilike(devices.serialNumber, likePattern(query.search)),
          ilike(sites.name, likePattern(query.search)),
          ilike(sql`host(${vpnIdentities.vpnIpv4})`, likePattern(query.search)),
          sql`exists (select 1 from unnest(${devices.tags}) as tag where tag ilike ${likePattern(query.search)})`
        )
      : undefined,
  ])
}

const sortColumns = {
  displayName: devices.displayName,
  hostname: devices.hostname,
  siteName: sites.name,
  osFamily: devices.osFamily,
  status: devices.status,
  lastSeenAt: devices.lastSeenAt,
  createdAt: devices.createdAt,
  vpnIpv4: vpnIdentities.vpnIpv4,
  vpnLastHandshakeAt: vpnIdentities.lastHandshakeAt,
  vpnRoutePolicyName: routePolicies.name,
  agentVersion: devices.agentVersion,
}

async function loadDevice(ctx: ApiContext, id: string) {
  const [record] = await ctx.db.select().from(devices).where(eq(devices.id, id))
  if (!record) {
    throw new TRPCError({ code: "NOT_FOUND" })
  }
  return record
}

async function assertSiteInOrganization(
  ctx: ApiContext,
  siteId: string,
  organizationId: string
) {
  const [site] = await ctx.db.select().from(sites).where(eq(sites.id, siteId))
  if (
    !site ||
    !siteBelongsToOrganization(site.organizationId, organizationId)
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "That site belongs to a different organization.",
    })
  }
  return site
}

async function assertRoutePolicyUsable(
  ctx: ApiContext,
  routePolicyId: string,
  organizationId: string
) {
  const [policy] = await ctx.db
    .select()
    .from(routePolicies)
    .where(eq(routePolicies.id, routePolicyId))
  if (!policy) {
    throw new TRPCError({ code: "BAD_REQUEST" })
  }
  if (policy.organizationId && policy.organizationId !== organizationId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "That route policy belongs to a different organization.",
    })
  }
  return policy
}

function canActOn(
  actor: ActorPrincipal | null,
  permission: Parameters<typeof authorize>[1],
  device: { organizationId: string; siteId: string | null }
) {
  if (!actor) return false
  return authorize(actor, permission, {
    kind: "device",
    organizationId: device.organizationId,
    siteId: device.siteId,
  }).allowed
}

export const devicesRouter = createTRPCRouter({
  list: permissionProcedure("device:view").query(async ({ ctx }) => {
    const scope = deviceScopeCondition(ctx.actor)
    if (scope.kind === "none") {
      return []
    }
    const query = deviceBase(ctx)
    return (
      scope.kind === "where" ? query.where(scope.condition) : query
    ).orderBy(desc(devices.createdAt))
  }),
  page: permissionProcedure("device:view")
    .input(listQuerySchema.optional())
    .query(async ({ ctx, input }) => {
      const query = resolveListQuery(input, { defaultLimit: 50 })
      const scope = deviceScopeCondition(ctx.actor)

      if (scope.kind === "none") {
        return paginate([], query, 0)
      }

      const conditions = buildDeviceConditions(query, scope)
      const where = conditions.length > 0 ? and(...conditions) : undefined

      const [[totalRow], rows] = await Promise.all([
        ctx.db
          .select({ total: count() })
          .from(devices)
          .leftJoin(sites, eq(sites.id, devices.siteId))
          .leftJoin(vpnIdentities, eq(vpnIdentities.deviceId, devices.id))
          .where(where),
        deviceBase(ctx)
          .where(where)
          .orderBy(
            ...buildOrderBy(query.sort, sortColumns, [
              desc(devices.createdAt),
              desc(devices.id),
            ])
          )
          .limit(query.limit + 1)
          .offset(query.offset),
      ])

      return paginate(rows, query, Number(totalRow?.total ?? 0))
    }),
  /**
   * Option counts for the filter bar. Counts reflect the actor's scope, not
   * the current filters, so options never disappear while narrowing.
   */
  facets: permissionProcedure("device:view").query(async ({ ctx }) => {
    const scope = deviceScopeCondition(ctx.actor)
    const empty = {
      status: [] as Array<{ value: string; count: number }>,
      connectivity: [] as Array<{ value: string; count: number }>,
      siteId: [] as Array<{ value: string; label: string; count: number }>,
      osFamily: [] as Array<{ value: string; count: number }>,
      routePolicyId: [] as Array<{
        value: string
        label: string
        count: number
      }>,
      tags: [] as Array<{ value: string; count: number }>,
      agentVersion: [] as Array<{ value: string; count: number }>,
    }
    if (scope.kind === "none") {
      return empty
    }
    const where = scope.kind === "where" ? scope.condition : undefined

    const grouped = <T extends SQL>(expression: T) =>
      ctx.db
        .select({ value: expression, total: count() })
        .from(devices)
        .leftJoin(sites, eq(sites.id, devices.siteId))
        .leftJoin(vpnIdentities, eq(vpnIdentities.deviceId, devices.id))
        .where(where)
        .groupBy(expression)

    const [
      statusRows,
      connectivityRows,
      siteRows,
      osRows,
      policyRows,
      tagRows,
      agentRows,
    ] = await Promise.all([
      grouped(sql<string>`${devices.status}::text`),
      grouped(connectivityExpression()),
      ctx.db
        .select({
          value: sql<string>`coalesce(${devices.siteId}::text, 'none')`,
          label: sql<string>`coalesce(${sites.name}, 'No site')`,
          total: count(),
        })
        .from(devices)
        .leftJoin(sites, eq(sites.id, devices.siteId))
        .leftJoin(vpnIdentities, eq(vpnIdentities.deviceId, devices.id))
        .where(where)
        .groupBy(devices.siteId, sites.name),
      grouped(sql<string>`coalesce(${devices.osFamily}, 'unknown')`),
      ctx.db
        .select({
          value: sql<string>`coalesce(${vpnIdentities.routePolicyId}::text, 'none')`,
          label: sql<string>`coalesce(${routePolicies.name}, 'No policy')`,
          total: count(),
        })
        .from(devices)
        .leftJoin(sites, eq(sites.id, devices.siteId))
        .leftJoin(vpnIdentities, eq(vpnIdentities.deviceId, devices.id))
        .leftJoin(
          routePolicies,
          eq(routePolicies.id, vpnIdentities.routePolicyId)
        )
        .where(where)
        .groupBy(vpnIdentities.routePolicyId, routePolicies.name),
      ctx.db
        .execute<{ value: string; total: number }>(
          sql`select tag as value, count(*)::int as total
              from ${devices}
              left join ${sites} on ${sites.id} = ${devices.siteId}
              left join ${vpnIdentities} on ${vpnIdentities.deviceId} = ${devices.id}
              cross join unnest(${devices.tags}) as tag
              ${where ? sql`where ${where}` : sql``}
              group by tag`
        )
        .then((result) => result.rows),
      grouped(sql<string>`coalesce(${devices.agentVersion}, 'unknown')`),
    ])

    const plain = (rows: Array<{ value: string; total: number }>) =>
      rows
        .map((row) => ({ value: String(row.value), count: Number(row.total) }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    const labelled = (
      rows: Array<{ value: string; label: string; total: number }>
    ) =>
      rows
        .map((row) => ({
          value: String(row.value),
          label: String(row.label),
          count: Number(row.total),
        }))
        .sort((a, b) => a.label.localeCompare(b.label))

    return {
      status: plain(statusRows),
      connectivity: plain(connectivityRows),
      siteId: labelled(siteRows),
      osFamily: plain(osRows),
      routePolicyId: labelled(policyRows),
      tags: plain(tagRows),
      agentVersion: plain(agentRows),
    }
  }),
  /** Same filters as `page`, capped, for CSV download. */
  export: permissionProcedure("device:view")
    .input(listQuerySchema.omit({ cursor: true, limit: true }).optional())
    .query(async ({ ctx, input }) => {
      const query = resolveListQuery(
        { ...input, limit: EXPORT_MAX_ROWS },
        { defaultLimit: EXPORT_MAX_ROWS, maxLimit: EXPORT_MAX_ROWS }
      )
      const scope = deviceScopeCondition(ctx.actor)
      if (scope.kind === "none") {
        return { rows: [], truncated: false }
      }
      const conditions = buildDeviceConditions(query, scope)
      const rows = await deviceBase(ctx)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(
          ...buildOrderBy(query.sort, sortColumns, [desc(devices.createdAt)])
        )
        .limit(EXPORT_MAX_ROWS + 1)
      return {
        rows: rows.slice(0, EXPORT_MAX_ROWS),
        truncated: rows.length > EXPORT_MAX_ROWS,
      }
    }),
  byId: permissionProcedure("device:view")
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [record] = await deviceBase(ctx).where(eq(devices.id, input.id))

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

      const [[enrollmentEvent], [routePolicy]] = await Promise.all([
        ctx.db
          .select({ createdAt: auditEvents.createdAt })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.deviceId, record.id),
              eq(auditEvents.eventType, "device_enrolled")
            )
          )
          .orderBy(desc(auditEvents.createdAt))
          .limit(1),
        identity?.routePolicyId
          ? ctx.db
              .select({
                id: routePolicies.id,
                name: routePolicies.name,
                routes: routePolicies.routes,
              })
              .from(routePolicies)
              .where(eq(routePolicies.id, identity.routePolicyId))
              .limit(1)
          : Promise.resolve([null]),
      ])

      return {
        ...record,
        enrolledAt: enrollmentEvent?.createdAt ?? record.createdAt,
        routePolicy: routePolicy ?? null,
        vpnIdentity: identity
          ? { ...identity, wireguardPresharedKey: undefined }
          : null,
        services: services.map(({ service, credential }) => ({
          ...service,
          hasSavedPassword: Boolean(credential),
        })),
      }
    }),
  update: permissionProcedure("device:update")
    .input(deviceUpdateInput)
    .mutation(async ({ ctx, input }) => {
      const existing = await loadDevice(ctx, input.id)

      assertAuthorized(ctx.actor, "device:update", {
        kind: "device",
        organizationId: existing.organizationId,
        siteId: existing.siteId,
      })

      if (input.siteId) {
        await assertSiteInOrganization(
          ctx,
          input.siteId,
          existing.organizationId
        )
      }

      const patch: Partial<typeof devices.$inferInsert> = {}
      if (input.displayName !== undefined) patch.displayName = input.displayName
      if (input.hostname !== undefined) patch.hostname = input.hostname
      if (input.siteId !== undefined) patch.siteId = input.siteId

      if (Object.keys(patch).length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST" })
      }

      const [record] = await ctx.db
        .update(devices)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(devices.id, input.id))
        .returning()

      await writeAuditEvent(ctx, {
        eventType:
          input.siteId !== undefined && input.siteId !== existing.siteId
            ? "device_site_assigned"
            : "device_updated",
        organizationId: existing.organizationId,
        deviceId: existing.id,
        eventData: {
          deviceId: existing.id,
          siteId: input.siteId ?? existing.siteId,
          previousSiteId: existing.siteId,
          displayName: input.displayName ?? existing.displayName,
          hostname: input.hostname ?? existing.hostname,
        },
      })

      return record ?? null
    }),
  setTags: permissionProcedure("device:update")
    .input(deviceTagsInput)
    .mutation(async ({ ctx, input }) => {
      const existing = await loadDevice(ctx, input.id)
      assertAuthorized(ctx.actor, "device:update", {
        kind: "device",
        organizationId: existing.organizationId,
        siteId: existing.siteId,
      })

      const [record] = await ctx.db
        .update(devices)
        .set({ tags: input.tags, updatedAt: new Date() })
        .where(eq(devices.id, input.id))
        .returning()

      await writeAuditEvent(ctx, {
        eventType: "device_tags_updated",
        organizationId: existing.organizationId,
        deviceId: existing.id,
        eventData: {
          deviceId: existing.id,
          tags: input.tags,
          previousTags: existing.tags,
        },
      })

      return record ?? null
    }),
  assignRoutePolicy: permissionProcedure("device:update")
    .input(deviceRoutePolicyInput)
    .mutation(async ({ ctx, input }) => {
      const device = await loadDevice(ctx, input.id)

      assertAuthorized(ctx.actor, "device:update", {
        kind: "device",
        organizationId: device.organizationId,
        siteId: device.siteId,
      })

      if (input.routePolicyId !== null) {
        await assertRoutePolicyUsable(
          ctx,
          input.routePolicyId,
          device.organizationId
        )
      }

      const [record] = await ctx.db
        .update(vpnIdentities)
        .set({ routePolicyId: input.routePolicyId })
        .where(eq(vpnIdentities.deviceId, input.id))
        .returning()

      if (!record) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This device has no tunnel identity yet.",
        })
      }

      await writeAuditEvent(ctx, {
        eventType: "device_route_policy_assigned",
        organizationId: device.organizationId,
        deviceId: device.id,
        eventData: { deviceId: device.id, routePolicyId: input.routePolicyId },
      })

      return record
    }),
  revokeVpn: permissionProcedure("device:revoke_vpn")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const device = await loadDevice(ctx, input.id)

      assertAuthorized(ctx.actor, "device:revoke_vpn", {
        kind: "device",
        organizationId: device.organizationId,
        siteId: device.siteId,
      })

      const [record] = await ctx.db
        .update(vpnIdentities)
        .set({ revokedAt: new Date(), serverPeerEnabled: false })
        .where(eq(vpnIdentities.deviceId, input.id))
        .returning()

      if (!record) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }

      await ctx.db
        .update(devices)
        .set({ status: "revoked", updatedAt: new Date() })
        .where(eq(devices.id, input.id))

      await writeAuditEvent(ctx, {
        eventType: "device_revoked",
        organizationId: device.organizationId,
        deviceId: input.id,
        eventData: { revoked: true },
      })

      return record
    }),
  delete: permissionProcedure("device:delete")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await loadDevice(ctx, input.id)

      assertAuthorized(ctx.actor, "device:delete", {
        kind: "device",
        organizationId: existing.organizationId,
        siteId: existing.siteId,
      })

      const [record] = await ctx.db
        .delete(devices)
        .where(eq(devices.id, input.id))
        .returning()

      await writeAuditEvent(ctx, {
        eventType: "device_deleted",
        organizationId: existing.organizationId,
        eventData: {
          deviceId: existing.id,
          displayName: existing.displayName,
          hostname: existing.hostname,
        },
      })

      return record ?? existing
    }),
  /**
   * Applies one action to many devices. Devices outside the actor's scope or
   * permission are skipped and reported rather than failing the whole batch.
   */
  bulk: permissionProcedure("device:update")
    .input(deviceBulkActionSchema)
    .mutation(async ({ ctx, input }) => {
      const permission =
        input.action === "delete"
          ? "device:delete"
          : input.action === "revoke_vpn"
            ? "device:revoke_vpn"
            : "device:update"

      const targets = await ctx.db
        .select()
        .from(devices)
        .where(inArray(devices.id, input.ids))

      const allowed = targets.filter((device) =>
        canActOn(ctx.actor, permission, device)
      )
      const skipped = input.ids.length - allowed.length
      if (allowed.length === 0) {
        return { updated: 0, skipped }
      }

      const organizationIds = [
        ...new Set(allowed.map((device) => device.organizationId)),
      ]

      if (input.action === "assign_site" && input.siteId) {
        if (organizationIds.length !== 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Pick devices from a single organization to assign a site.",
          })
        }
        await assertSiteInOrganization(ctx, input.siteId, organizationIds[0])
      }

      if (input.action === "assign_route_policy" && input.routePolicyId) {
        for (const organizationId of organizationIds) {
          await assertRoutePolicyUsable(
            ctx,
            input.routePolicyId,
            organizationId
          )
        }
      }

      const ids = allowed.map((device) => device.id)
      const now = new Date()

      await ctx.db.transaction(async (tx) => {
        const scoped: AuditContext = { db: tx, actor: ctx.actor }

        switch (input.action) {
          case "assign_site": {
            await tx
              .update(devices)
              .set({ siteId: input.siteId, updatedAt: now })
              .where(inArray(devices.id, ids))
            for (const device of allowed) {
              await writeAuditEvent(scoped, {
                eventType: "device_site_assigned",
                organizationId: device.organizationId,
                deviceId: device.id,
                eventData: {
                  deviceId: device.id,
                  siteId: input.siteId,
                  previousSiteId: device.siteId,
                  bulk: true,
                },
              })
            }
            break
          }
          case "assign_route_policy": {
            await tx
              .update(vpnIdentities)
              .set({ routePolicyId: input.routePolicyId })
              .where(inArray(vpnIdentities.deviceId, ids))
            for (const device of allowed) {
              await writeAuditEvent(scoped, {
                eventType: "device_route_policy_assigned",
                organizationId: device.organizationId,
                deviceId: device.id,
                eventData: {
                  deviceId: device.id,
                  routePolicyId: input.routePolicyId,
                  bulk: true,
                },
              })
            }
            break
          }
          case "add_tags":
          case "remove_tags": {
            for (const device of allowed) {
              const next =
                input.action === "add_tags"
                  ? [...new Set([...device.tags, ...input.tags])].sort()
                  : device.tags.filter((tag) => !input.tags.includes(tag))
              if (
                next.length === device.tags.length &&
                next.every((tag, index) => tag === device.tags[index])
              ) {
                continue
              }
              await tx
                .update(devices)
                .set({ tags: next, updatedAt: now })
                .where(eq(devices.id, device.id))
              await writeAuditEvent(scoped, {
                eventType: "device_tags_updated",
                organizationId: device.organizationId,
                deviceId: device.id,
                eventData: {
                  deviceId: device.id,
                  tags: next,
                  previousTags: device.tags,
                  bulk: true,
                },
              })
            }
            break
          }
          case "revoke_vpn": {
            await tx
              .update(vpnIdentities)
              .set({ revokedAt: now, serverPeerEnabled: false })
              .where(
                and(
                  inArray(vpnIdentities.deviceId, ids),
                  isNull(vpnIdentities.revokedAt)
                )
              )
            await tx
              .update(devices)
              .set({ status: "revoked", updatedAt: now })
              .where(inArray(devices.id, ids))
            for (const device of allowed) {
              await writeAuditEvent(scoped, {
                eventType: "device_revoked",
                organizationId: device.organizationId,
                deviceId: device.id,
                eventData: { revoked: true, bulk: true },
              })
            }
            break
          }
          case "delete": {
            await tx.delete(devices).where(inArray(devices.id, ids))
            for (const device of allowed) {
              await writeAuditEvent(scoped, {
                eventType: "device_deleted",
                organizationId: device.organizationId,
                eventData: {
                  deviceId: device.id,
                  displayName: device.displayName,
                  hostname: device.hostname,
                  bulk: true,
                },
              })
            }
            break
          }
        }
      })

      return { updated: ids.length, skipped }
    }),
  services: permissionProcedure("device:view")
    .input(z.object({ deviceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const device = await loadDevice(ctx, input.deviceId)

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
})
