import { TRPCError } from "@trpc/server"
import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { z } from "zod"

import { authorize, type ActorPrincipal } from "@nms/auth"
import {
  agentReleases,
  assets,
  auditEvents,
  devices,
  managementServiceCredentials,
  managementServices,
  organizations,
  routePolicies,
  sites,
  user,
  vpnIdentities,
} from "@nms/db"
import {
  customFieldValuesSchema,
  deviceBulkActionSchema,
  deviceConnectivityStates,
  deviceStatuses,
  deviceTagsSchema,
  entriesFromRoutes,
  parseDeviceBulkCsv,
  archivedDeviceIsPresent,
  isAgentBehind,
  normalizeAgentPlatform,
  pickDesiredRelease,
  resolveAgentChannel,
  resolveDeviceArchiveScope,
  type AgentReleasePick,
  type DeviceConnectivity,
  type DeviceStatus,
} from "@nms/shared"
import { buildClientAllowedIps, normalizeVpnIpv4 } from "@nms/vpn"

import { assertAuthorized } from "../access"
import { writeAuditEvent } from "../audit"
import {
  requestDeviceInfrastructureAccess,
  revokeDeviceInfrastructureAccess,
  setDeviceInfrastructure,
} from "../infrastructure-access"
import { syncArchivedDeviceAlerts } from "../alerts"
import type { ApiContext } from "../context"
import {
  connectivityExpression,
  enabledServiceTypes,
  onlineServiceCount,
} from "../device-sql"
import { siteBelongsToOrganization } from "../helpers"
import { deviceBehindSql } from "../fleet-sql"
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
  notes: z.string().trim().max(4000).optional().nullable(),
  assetId: z.string().uuid().optional().nullable(),
  customFields: customFieldValuesSchema.optional(),
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
    notes: devices.notes,
    assetId: devices.assetId,
    assetTag: assets.tag,
    customFields: devices.customFields,
    status: devices.status,
    lastSeenAt: devices.lastSeenAt,
    createdAt: devices.createdAt,
    hostnameChangeAllowedAt: devices.hostnameChangeAllowedAt,
    archivedAt: devices.archivedAt,
    archivedByUserId: devices.archivedByUserId,
    infrastructure: devices.infrastructure,
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
    .leftJoin(organizations, eq(organizations.id, devices.organizationId))
    .leftJoin(vpnIdentities, eq(vpnIdentities.deviceId, devices.id))
    .leftJoin(routePolicies, eq(routePolicies.id, vpnIdentities.routePolicyId))
    .leftJoin(assets, eq(assets.id, devices.assetId))
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

/**
 * Archived devices are hidden by default; the `archived` filter opens them
 * up (`all`) or narrows to them (`yes`). See `resolveDeviceArchiveScope`.
 */
function archivedFilter(values: readonly string[] | undefined) {
  switch (resolveDeviceArchiveScope(values)) {
    case "archived":
      return isNotNull(devices.archivedAt)
    case "all":
      return undefined
    default:
      return isNull(devices.archivedAt)
  }
}

/** Translates a resolved list query into WHERE conditions for the devices join. */
function buildDeviceConditions(
  query: ResolvedListQuery,
  scope: ReturnType<typeof deviceScopeCondition>,
  releases: AgentReleasePick[]
) {
  const statusFilter = query.filters.status?.filter((value) =>
    (deviceStatuses as readonly string[]).includes(value)
  ) as DeviceStatus[] | undefined
  const connectivityFilter = query.filters.connectivity?.filter((value) =>
    (deviceConnectivityStates as readonly string[]).includes(value)
  ) as DeviceConnectivity[] | undefined
  const behindFilter = query.filters.behind?.filter(
    (value) => value === "true" || value === "false"
  )
  const behindExpr = deviceBehindSql(releases)

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
    behindFilter && behindFilter.length === 1 && behindFilter[0] === "true"
      ? behindExpr
      : undefined,
    behindFilter && behindFilter.length === 1 && behindFilter[0] === "false"
      ? sql`not (${behindExpr})`
      : undefined,
    archivedFilter(query.filters.archived),
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

async function loadReleasePicks(ctx: ApiContext): Promise<AgentReleasePick[]> {
  return ctx.db
    .select({
      version: agentReleases.version,
      channel: agentReleases.channel,
      platform: agentReleases.platform,
      downloadUrl: agentReleases.downloadUrl,
      sha256: agentReleases.sha256,
    })
    .from(agentReleases)
}

async function deviceReleaseTarget(
  ctx: ApiContext,
  record: {
    id: string
    osFamily: string | null
    architecture: string | null
    agentVersion: string | null
  }
) {
  const [releases, [channels]] = await Promise.all([
    loadReleasePicks(ctx),
    ctx.db
      .select({
        organizationChannel: organizations.agentChannel,
        siteChannel: sites.agentChannel,
      })
      .from(devices)
      .innerJoin(organizations, eq(organizations.id, devices.organizationId))
      .leftJoin(sites, eq(sites.id, devices.siteId))
      .where(eq(devices.id, record.id))
      .limit(1),
  ])
  const desired = pickDesiredRelease(
    releases,
    resolveAgentChannel(channels?.siteChannel, channels?.organizationChannel),
    normalizeAgentPlatform(record.osFamily, record.architecture)
  )
  return {
    desiredAgentVersion: desired?.version ?? null,
    agentBehind: Boolean(
      desired && isAgentBehind(record.agentVersion, desired.version)
    ),
  }
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

async function applyDeviceArchive(
  ctx: {
    db: Pick<ApiContext["db"], "insert" | "select" | "update">
    actor: ApiContext["actor"]
    request?: ApiContext["request"]
  },
  device: typeof devices.$inferSelect,
  archived: boolean,
  now: Date,
  bulk = false
) {
  const currentlyArchived = Boolean(device.archivedAt)
  if (currentlyArchived === archived) {
    return device
  }

  const [identity] = await ctx.db
    .select({
      lastHandshakeAt: vpnIdentities.lastHandshakeAt,
      latestEndpoint: vpnIdentities.latestEndpoint,
    })
    .from(vpnIdentities)
    .where(eq(vpnIdentities.deviceId, device.id))

  const [record] = await ctx.db
    .update(devices)
    .set({
      archivedAt: archived ? now : null,
      archivedByUserId: archived ? (ctx.actor?.id ?? null) : null,
      updatedAt: now,
    })
    .where(eq(devices.id, device.id))
    .returning()

  await writeAuditEvent(ctx, {
    eventType: archived ? "device_archived" : "device_unarchived",
    organizationId: device.organizationId,
    deviceId: device.id,
    eventData: {
      deviceId: device.id,
      archived,
      bulk,
    },
  })

  await syncArchivedDeviceAlerts({
    deviceId: device.id,
    organizationId: device.organizationId,
    siteId: device.siteId,
    displayName: device.displayName || device.hostname || "Device",
    archived,
    present: archivedDeviceIsPresent({
      archivedAt: archived ? now : null,
      lastHandshakeAt: identity?.lastHandshakeAt,
      lastSeenAt: device.lastSeenAt,
      now,
    }),
    source: "archive",
    endpoint: identity?.latestEndpoint ?? null,
  })

  return record ?? device
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

      const releases = await loadReleasePicks(ctx)
      const conditions = buildDeviceConditions(query, scope, releases)
      const where = conditions.length > 0 ? and(...conditions) : undefined

      const [[totalRow], rows] = await Promise.all([
        ctx.db
          .select({ total: count() })
          .from(devices)
          .leftJoin(sites, eq(sites.id, devices.siteId))
          .leftJoin(organizations, eq(organizations.id, devices.organizationId))
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
   * the current filters, so options never disappear while narrowing. The one
   * exception is the archive scope: archived devices are hidden from the
   * list by default, so they stay out of the counts until the caller asks
   * for them. The `archived` breakdown itself always covers the whole scope
   * so the "show archived" control can say how many there are.
   */
  facets: permissionProcedure("device:view")
    .input(
      z
        .object({
          archived: z.array(z.string().max(16)).max(4).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
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
        behind: [] as Array<{ value: string; count: number }>,
        archived: [] as Array<{ value: string; count: number }>,
      }
      if (scope.kind === "none") {
        return empty
      }
      const scopeWhere = scope.kind === "where" ? scope.condition : undefined
      const archiveCondition = archivedFilter(input?.archived)
      const where =
        scopeWhere && archiveCondition
          ? and(scopeWhere, archiveCondition)
          : (archiveCondition ?? scopeWhere)

      const grouped = <T extends SQL>(expression: T) =>
        ctx.db
          .select({ value: expression, total: count() })
          .from(devices)
          .leftJoin(sites, eq(sites.id, devices.siteId))
          .leftJoin(organizations, eq(organizations.id, devices.organizationId))
          .leftJoin(vpnIdentities, eq(vpnIdentities.deviceId, devices.id))
          .where(where)
          .groupBy(expression)

      const releases = await loadReleasePicks(ctx)
      const behindExpr = deviceBehindSql(releases)

      const [
        statusRows,
        connectivityRows,
        siteRows,
        osRows,
        policyRows,
        tagRows,
        agentRows,
        behindRows,
        archivedRows,
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
              left join ${organizations} on ${organizations.id} = ${devices.organizationId}
              left join ${vpnIdentities} on ${vpnIdentities.deviceId} = ${devices.id}
              cross join unnest(${devices.tags}) as tag
              ${where ? sql`where ${where}` : sql``}
              group by tag`
          )
          .then((result) => result.rows),
        grouped(sql<string>`coalesce(${devices.agentVersion}, 'unknown')`),
        grouped(
          sql<string>`case when ${behindExpr} then 'true' else 'false' end`
        ),
        ctx.db
          .select({
            value: sql<string>`case when ${devices.archivedAt} is not null then 'yes' else 'no' end`,
            total: count(),
          })
          .from(devices)
          .where(scopeWhere)
          .groupBy(
            sql`case when ${devices.archivedAt} is not null then 'yes' else 'no' end`
          ),
      ])

      const plain = (rows: Array<{ value: string; total: number }>) =>
        rows
          .map((row) => ({
            value: String(row.value),
            count: Number(row.total),
          }))
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
        behind: plain(behindRows),
        archived: plain(archivedRows),
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
      const releases = await loadReleasePicks(ctx)
      const conditions = buildDeviceConditions(query, scope, releases)
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

      const releaseTarget = await deviceReleaseTarget(ctx, record)

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

      const [[enrollmentEvent], [routePolicy], [lastTouched]] =
        await Promise.all([
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
                  entries: routePolicies.entries,
                  color: routePolicies.color,
                })
                .from(routePolicies)
                .where(eq(routePolicies.id, identity.routePolicyId))
                .limit(1)
            : Promise.resolve([null]),
          ctx.db
            .select({
              at: auditEvents.createdAt,
              userId: auditEvents.actorUserId,
              name: user.name,
              email: user.email,
              eventType: auditEvents.eventType,
            })
            .from(auditEvents)
            .innerJoin(user, eq(user.id, auditEvents.actorUserId))
            .where(
              and(
                eq(auditEvents.deviceId, record.id),
                isNotNull(auditEvents.actorUserId)
              )
            )
            .orderBy(desc(auditEvents.createdAt))
            .limit(1),
        ])

      return {
        ...record,
        ...releaseTarget,
        enrolledAt: enrollmentEvent?.createdAt ?? record.createdAt,
        lastTouched: lastTouched
          ? {
              at: lastTouched.at,
              userId: lastTouched.userId,
              name: lastTouched.name,
              email: lastTouched.email,
              eventType: lastTouched.eventType,
            }
          : null,
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
  /**
   * What the tunnel actually publishes to this device: the concentrator
   * address plus the assigned policy, in the same order the client config
   * lists them.
   */
  effectiveRoutes: permissionProcedure("device:view")
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const device = await loadDevice(ctx, input.id)
      assertAuthorized(ctx.actor, "device:view", {
        kind: "device",
        organizationId: device.organizationId,
        siteId: device.siteId,
      })

      const [identity] = await ctx.db
        .select({
          routePolicyId: vpnIdentities.routePolicyId,
          revokedAt: vpnIdentities.revokedAt,
        })
        .from(vpnIdentities)
        .where(eq(vpnIdentities.deviceId, device.id))

      const [policy] = identity?.routePolicyId
        ? await ctx.db
            .select({
              id: routePolicies.id,
              name: routePolicies.name,
              routes: routePolicies.routes,
              entries: routePolicies.entries,
              color: routePolicies.color,
            })
            .from(routePolicies)
            .where(eq(routePolicies.id, identity.routePolicyId))
        : [null]

      const serverIp = process.env.VPN_SERVER_IP ?? null
      const policyRoutes = policy?.routes ?? []
      const entries =
        policy && policy.entries.length > 0
          ? policy.entries
          : entriesFromRoutes(policyRoutes)

      return {
        hasIdentity: Boolean(identity),
        revoked: Boolean(identity?.revokedAt),
        tunnelCidr: process.env.VPN_CIDR ?? null,
        tunnelRoute: serverIp ? `${normalizeVpnIpv4(serverIp)}/32` : null,
        policy: policy ? { ...policy, entries } : null,
        allowedIps: serverIp
          ? buildClientAllowedIps({ serverIp, routePolicyRoutes: policyRoutes })
          : policyRoutes,
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
      if (input.notes !== undefined) patch.notes = input.notes
      if (input.customFields !== undefined) {
        patch.customFields = input.customFields
      }
      if (input.assetId !== undefined) {
        if (input.assetId) {
          const [asset] = await ctx.db
            .select()
            .from(assets)
            .where(eq(assets.id, input.assetId))
          if (!asset || asset.organizationId !== existing.organizationId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "That asset belongs to a different organization.",
            })
          }
        }
        patch.assetId = input.assetId
      }

      if (Object.keys(patch).length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST" })
      }

      if (patch.assetId) {
        await ctx.db
          .update(devices)
          .set({ assetId: null, updatedAt: new Date() })
          .where(
            and(
              eq(devices.assetId, patch.assetId),
              sql`${devices.id} <> ${existing.id}`
            )
          )
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
          notes: input.notes ?? existing.notes,
          assetId: input.assetId ?? existing.assetId,
        },
      })

      return record ?? null
    }),
  /**
   * Opens a 24-hour window in which the device may check in under a new
   * hostname. Outside that window a renamed device is refused, since the
   * same symptom is what a copied check-in secret looks like.
   */
  allowHostnameChange: permissionProcedure("device:update")
    .input(z.object({ id: z.string().uuid(), allow: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await loadDevice(ctx, input.id)
      assertAuthorized(ctx.actor, "device:update", {
        kind: "device",
        organizationId: existing.organizationId,
        siteId: existing.siteId,
      })

      const now = new Date()
      const [record] = await ctx.db
        .update(devices)
        .set({
          hostnameChangeAllowedAt: input.allow ? now : null,
          updatedAt: now,
        })
        .where(eq(devices.id, input.id))
        .returning({
          id: devices.id,
          hostnameChangeAllowedAt: devices.hostnameChangeAllowedAt,
        })

      await writeAuditEvent(ctx, {
        eventType: "device_hostname_change_allowed",
        organizationId: existing.organizationId,
        deviceId: existing.id,
        eventData: {
          deviceId: existing.id,
          hostname: existing.hostname,
          allowed: input.allow,
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
  setArchived: permissionProcedure("device:update")
    .input(
      z.object({
        id: z.string().uuid(),
        archived: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const device = await loadDevice(ctx, input.id)
      assertAuthorized(ctx.actor, "device:update", {
        kind: "device",
        organizationId: device.organizationId,
        siteId: device.siteId,
      })
      return applyDeviceArchive(ctx, device, input.archived, new Date())
    }),
  setInfrastructure: permissionProcedure("device:update")
    .input(
      z.object({
        id: z.string().uuid(),
        infrastructure: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const device = await loadDevice(ctx, input.id)
      assertAuthorized(ctx.actor, "device:update", {
        kind: "device",
        organizationId: device.organizationId,
        siteId: device.siteId,
      })
      return setDeviceInfrastructure(ctx, device, input.infrastructure)
    }),
  requestInfrastructureAccess: permissionProcedure("device:view")
    .input(
      z.object({
        deviceId: z.string().uuid(),
        minutes: z.number().int().optional(),
        reason: z.string().trim().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const device = await loadDevice(ctx, input.deviceId)
      assertAuthorized(ctx.actor, "device:view", {
        kind: "device",
        organizationId: device.organizationId,
        siteId: device.siteId,
      })
      return requestDeviceInfrastructureAccess(ctx, device, {
        minutes: input.minutes,
        reason: input.reason,
      })
    }),
  revokeInfrastructureAccess: permissionProcedure("device:view")
    .input(z.object({ deviceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const device = await loadDevice(ctx, input.deviceId)
      assertAuthorized(ctx.actor, "device:view", {
        kind: "device",
        organizationId: device.organizationId,
        siteId: device.siteId,
      })
      return revokeDeviceInfrastructureAccess(ctx, device)
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
        const scoped = { db: tx, actor: ctx.actor }

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
          case "archive":
          case "unarchive": {
            for (const device of allowed) {
              await applyDeviceArchive(
                scoped,
                device,
                input.action === "archive",
                now,
                true
              )
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
  importCsv: permissionProcedure("device:update")
    .input(
      z.object({
        organizationId: z.string().uuid(),
        csv: z.string().max(1_000_000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertAuthorized(ctx.actor, "device:update", {
        kind: "device",
        organizationId: input.organizationId,
        siteId: null,
      })
      const parsed = parseDeviceBulkCsv(input.csv)
      const errors = [...parsed.errors]
      let updated = 0

      const siteRows = await ctx.db
        .select({ id: sites.id, name: sites.name })
        .from(sites)
        .where(eq(sites.organizationId, input.organizationId))
      const assetRows = await ctx.db
        .select({ id: assets.id, tag: assets.tag })
        .from(assets)
        .where(eq(assets.organizationId, input.organizationId))

      for (const row of parsed.rows) {
        let device: typeof devices.$inferSelect | undefined
        if (row.id) {
          const [match] = await ctx.db
            .select()
            .from(devices)
            .where(
              and(
                eq(devices.id, row.id),
                eq(devices.organizationId, input.organizationId)
              )
            )
          device = match
        } else if (row.serial) {
          const [match] = await ctx.db
            .select()
            .from(devices)
            .where(
              and(
                eq(devices.organizationId, input.organizationId),
                sql`replace(upper(coalesce(${devices.serialNumber}, '')), '-', '') = ${row.serial.replace(/[\s-]+/g, "").toUpperCase()}`
              )
            )
            .limit(1)
          device = match
        } else if (row.hostname) {
          const [match] = await ctx.db
            .select()
            .from(devices)
            .where(
              and(
                eq(devices.organizationId, input.organizationId),
                ilike(devices.hostname, row.hostname)
              )
            )
            .limit(1)
          device = match
        }

        if (!device) {
          errors.push({ row: row.row, message: "Device was not found." })
          continue
        }
        if (
          !canActOn(ctx.actor, "device:update", {
            organizationId: device.organizationId,
            siteId: device.siteId,
          })
        ) {
          errors.push({ row: row.row, message: "No access to that device." })
          continue
        }

        let siteId = device.siteId
        if (row.site) {
          const site = /^[0-9a-f-]{36}$/i.test(row.site)
            ? siteRows.find((entry) => entry.id === row.site)
            : siteRows.find(
                (entry) => entry.name.toLowerCase() === row.site!.toLowerCase()
              )
          if (!site) {
            errors.push({ row: row.row, message: "Site was not found." })
            continue
          }
          siteId = site.id
        }

        let assetId = device.assetId
        if (row.assetTag) {
          const asset = assetRows.find(
            (entry) => entry.tag.toLowerCase() === row.assetTag!.toLowerCase()
          )
          if (!asset) {
            errors.push({ row: row.row, message: "Asset tag was not found." })
            continue
          }
          assetId = asset.id
        }

        const patch: Partial<typeof devices.$inferInsert> = {
          updatedAt: new Date(),
        }
        if (row.displayName) patch.displayName = row.displayName
        if (row.notes !== null) patch.notes = row.notes
        if (row.tags.length > 0) patch.tags = row.tags
        if (row.site) patch.siteId = siteId
        if (row.assetTag) patch.assetId = assetId

        if (Object.keys(patch).length <= 1) {
          continue
        }

        await ctx.db.update(devices).set(patch).where(eq(devices.id, device.id))
        await writeAuditEvent(ctx, {
          eventType: "device_updated",
          organizationId: device.organizationId,
          deviceId: device.id,
          eventData: { deviceId: device.id, bulk: true, row: row.row },
        })
        updated += 1
      }

      await writeAuditEvent(ctx, {
        eventType: "inventory_imported",
        organizationId: input.organizationId,
        eventData: {
          kind: "devices",
          updated,
          errorCount: errors.length,
        },
      })

      return { created: 0, updated, skipped: errors.length, errors }
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
