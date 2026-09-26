import { and, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm"

import { hasPermission } from "@nms/auth"
import {
  alerts,
  assets,
  auditEvents,
  deviceModels,
  devicePackages,
  devices,
  infrastructureAccessGrants,
  organizations,
  remoteSessions,
  sites,
  user,
  vpnIdentities,
} from "@nms/db"
import {
  DEFAULT_ARO_PER_YEAR,
  emptyMorningRiskSummary,
  summarizeAssetRisk,
  type DeviceConnectivity,
  type MorningOpsRiskSummary,
} from "@nms/shared"

import { actorOrganizationIds, actorSiteIds } from "../access"
import { connectivityExpression, offlineServiceCount } from "../device-sql"
import {
  combineConditions,
  deviceScopeCondition,
  eventScopeCondition,
  inventoryScopeCondition,
} from "../scope"
import { createTRPCRouter, permissionProcedure } from "../trpc"

const ATTENTION_LIMIT = 8
const ACTIVITY_LIMIT = 8

/**
 * A device needs attention when it is enrolled but unreachable, or reachable
 * while one of its enabled services is down. Pending and revoked devices are
 * expected states and are excluded.
 */
const needsAttentionCondition = () =>
  and(
    isNull(vpnIdentities.revokedAt),
    isNull(devices.archivedAt),
    sql`${devices.status} <> 'pending'`,
    or(
      sql`${connectivityExpression()} in ('offline', 'never')`,
      sql`${offlineServiceCount()} > 0`
    )
  )

function alertScope(actor: Parameters<typeof eventScopeCondition>[0]) {
  return eventScopeCondition(actor, {
    organizationId: alerts.organizationId,
    siteId: alerts.siteId,
    deviceId: alerts.deviceId,
  })
}

export const dashboardRouter = createTRPCRouter({
  summary: permissionProcedure("device:view").query(async ({ ctx }) => {
    const scope = deviceScopeCondition(ctx.actor)
    const organizationIds = actorOrganizationIds(ctx.actor)
    const siteIds = actorSiteIds(ctx.actor) ?? []

    const empty = {
      devices: {
        total: 0,
        online: 0,
        offline: 0,
        never: 0,
        revoked: 0,
        pending: 0,
        needsAttention: 0,
      },
      sessions: { last24h: 0, active: 0 },
      organizations: 0,
      sites: 0,
      attention: [] as Array<{
        id: string
        displayName: string
        hostname: string | null
        siteName: string | null
        connectivity: DeviceConnectivity
        offlineServices: number
        lastHandshakeAt: Date | null
        lastSeenAt: Date | null
      }>,
      activity: [] as Array<{
        id: string
        eventType: string
        createdAt: Date
        actorName: string | null
        actorEmail: string | null
        deviceId: string | null
        deviceName: string | null
        eventData: Record<string, unknown>
      }>,
      generatedAt: new Date(),
    }

    if (scope.kind === "none") {
      return empty
    }

    const where = scope.kind === "where" ? scope.condition : undefined
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000)

    const scopedDeviceIds = ctx.db
      .select({ id: devices.id })
      .from(devices)
      .where(where)

    const [
      [totals],
      connectivityRows,
      [attentionCount],
      attentionRows,
      [sessionRows],
      [orgCount],
      [siteCount],
      activityRows,
    ] = await Promise.all([
      ctx.db
        .select({
          total: count(),
          pending: sql<number>`count(*) filter (where ${devices.status} = 'pending')::int`,
        })
        .from(devices)
        .leftJoin(vpnIdentities, eq(vpnIdentities.deviceId, devices.id))
        .where(where),
      ctx.db
        .select({ value: connectivityExpression(), total: count() })
        .from(devices)
        .leftJoin(vpnIdentities, eq(vpnIdentities.deviceId, devices.id))
        .where(and(where, isNull(devices.archivedAt)))
        .groupBy(connectivityExpression()),
      ctx.db
        .select({ total: count() })
        .from(devices)
        .leftJoin(vpnIdentities, eq(vpnIdentities.deviceId, devices.id))
        .where(and(where, needsAttentionCondition())),
      ctx.db
        .select({
          id: devices.id,
          displayName: devices.displayName,
          hostname: devices.hostname,
          siteName: sites.name,
          connectivity: connectivityExpression(),
          offlineServices: offlineServiceCount(),
          lastHandshakeAt: vpnIdentities.lastHandshakeAt,
          lastSeenAt: devices.lastSeenAt,
        })
        .from(devices)
        .leftJoin(sites, eq(sites.id, devices.siteId))
        .leftJoin(vpnIdentities, eq(vpnIdentities.deviceId, devices.id))
        .where(and(where, needsAttentionCondition()))
        .orderBy(
          desc(
            sql`coalesce(${vpnIdentities.lastHandshakeAt}, ${devices.lastSeenAt})`
          )
        )
        .limit(ATTENTION_LIMIT),
      ctx.db
        .select({
          last24h: sql<number>`count(*) filter (where ${remoteSessions.startedAt} >= ${since24h})::int`,
          active: sql<number>`count(*) filter (where ${remoteSessions.endedAt} is null and ${remoteSessions.startedAt} >= ${since24h})::int`,
        })
        .from(remoteSessions)
        .where(inArray(remoteSessions.deviceId, scopedDeviceIds)),
      organizationIds === null
        ? ctx.db.select({ total: count() }).from(organizations)
        : Promise.resolve([{ total: organizationIds.length }]),
      organizationIds === null
        ? ctx.db.select({ total: count() }).from(sites)
        : organizationIds.length > 0
          ? ctx.db
              .select({ total: count() })
              .from(sites)
              .where(inArray(sites.organizationId, organizationIds))
          : Promise.resolve([{ total: siteIds.length }]),
      ctx.db
        .select({
          id: auditEvents.id,
          eventType: auditEvents.eventType,
          createdAt: auditEvents.createdAt,
          actorName: user.name,
          actorEmail: user.email,
          deviceId: auditEvents.deviceId,
          deviceName: devices.displayName,
          eventData: auditEvents.eventData,
        })
        .from(auditEvents)
        .leftJoin(user, eq(user.id, auditEvents.actorUserId))
        .leftJoin(devices, eq(devices.id, auditEvents.deviceId))
        .where(
          organizationIds === null
            ? undefined
            : or(
                organizationIds.length > 0
                  ? inArray(auditEvents.organizationId, organizationIds)
                  : sql`false`,
                inArray(auditEvents.deviceId, scopedDeviceIds)
              )
        )
        .orderBy(desc(auditEvents.createdAt))
        .limit(ACTIVITY_LIMIT),
    ])

    const byConnectivity = Object.fromEntries(
      connectivityRows.map((row) => [row.value, Number(row.total)])
    ) as Partial<Record<DeviceConnectivity, number>>

    return {
      ...empty,
      devices: {
        total: Number(totals?.total ?? 0),
        online: byConnectivity.online ?? 0,
        offline: byConnectivity.offline ?? 0,
        never: byConnectivity.never ?? 0,
        revoked: byConnectivity.revoked ?? 0,
        pending: Number(totals?.pending ?? 0),
        needsAttention: Number(attentionCount?.total ?? 0),
      },
      sessions: {
        last24h: Number(sessionRows?.last24h ?? 0),
        active: Number(sessionRows?.active ?? 0),
      },
      organizations: Number(orgCount?.total ?? 0),
      sites: Number(siteCount?.total ?? 0),
      attention: attentionRows,
      activity: activityRows,
      generatedAt: new Date(),
    }
  }),

  /**
   * One-shot morning ops slice: open alerts, install-now devices, offline /
   * quiet agents, expected loss totals, recent sessions, and live
   * infrastructure grants. No new tables — reuses existing sources.
   */
  morningOps: permissionProcedure("device:view").query(async ({ ctx }) => {
    const deviceScope = deviceScopeCondition(ctx.actor)
    const alertsScope = alertScope(ctx.actor)
    const canViewRisk =
      ctx.actor != null && hasPermission(ctx.actor.permissions, "audit:view")
    const now = new Date()
    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)

    const empty = {
      alerts: {
        open: 0,
        acknowledged: 0,
        critical: 0,
        warning: 0,
        notice: 0,
        info: 0,
        agentStale: 0,
      },
      devices: {
        total: 0,
        online: 0,
        offline: 0,
        never: 0,
        needsAttention: 0,
      },
      patches: { deviceCount: 0, packageCount: 0 },
      risk: null as MorningOpsRiskSummary | null,
      sessions: { last24h: 0, active: 0 },
      liveInfrastructureGrants: 0,
      generatedAt: now,
    }

    if (deviceScope.kind === "none" && alertsScope.kind === "none") {
      return {
        ...empty,
        risk: canViewRisk ? emptyMorningRiskSummary() : null,
      }
    }

    const deviceWhere =
      deviceScope.kind === "where" ? deviceScope.condition : undefined
    const alertWhere =
      alertsScope.kind === "where" ? alertsScope.condition : undefined

    const scopedDeviceIds = ctx.db
      .select({ id: devices.id })
      .from(devices)
      .where(deviceWhere)

    const unresolved = sql`${alerts.status} <> 'resolved' and ${alerts.status} <> 'suppressed'`
    const openUnsnoozed = sql`${alerts.status} = 'open' and (${alerts.snoozedUntil} is null or ${alerts.snoozedUntil} <= ${now})`

    const alertCountsPromise =
      alertsScope.kind === "none"
        ? Promise.resolve([
            {
              open: 0,
              acknowledged: 0,
              critical: 0,
              warning: 0,
              notice: 0,
              info: 0,
              agentStale: 0,
            },
          ])
        : ctx.db
            .select({
              open: sql<number>`count(*) filter (where ${openUnsnoozed})::int`,
              acknowledged: sql<number>`count(*) filter (where ${alerts.status} = 'acknowledged')::int`,
              critical: sql<number>`count(*) filter (where ${alerts.severity} = 'critical')::int`,
              warning: sql<number>`count(*) filter (where ${alerts.severity} = 'warning')::int`,
              notice: sql<number>`count(*) filter (where ${alerts.severity} = 'notice')::int`,
              info: sql<number>`count(*) filter (where ${alerts.severity} = 'info')::int`,
              agentStale: sql<number>`count(*) filter (where ${alerts.kind} = 'agent_stale')::int`,
            })
            .from(alerts)
            .where(and(alertWhere, unresolved))

    const deviceTotalsPromise = (async () => {
      if (deviceScope.kind === "none") {
        return {
          total: 0,
          online: 0,
          offline: 0,
          never: 0,
          needsAttention: 0,
        }
      }
      const [[totals], connectivityRows, [attentionCount]] = await Promise.all([
        ctx.db
          .select({
            total: count(),
          })
          .from(devices)
          .leftJoin(vpnIdentities, eq(vpnIdentities.deviceId, devices.id))
          .where(deviceWhere),
        ctx.db
          .select({ value: connectivityExpression(), total: count() })
          .from(devices)
          .leftJoin(vpnIdentities, eq(vpnIdentities.deviceId, devices.id))
          .where(and(deviceWhere, isNull(devices.archivedAt)))
          .groupBy(connectivityExpression()),
        ctx.db
          .select({ total: count() })
          .from(devices)
          .leftJoin(vpnIdentities, eq(vpnIdentities.deviceId, devices.id))
          .where(and(deviceWhere, needsAttentionCondition())),
      ])
      const byConnectivity = Object.fromEntries(
        connectivityRows.map((row) => [row.value, Number(row.total)])
      ) as Partial<Record<DeviceConnectivity, number>>
      return {
        total: Number(totals?.total ?? 0),
        online: byConnectivity.online ?? 0,
        offline: byConnectivity.offline ?? 0,
        never: byConnectivity.never ?? 0,
        needsAttention: Number(attentionCount?.total ?? 0),
      }
    })()

    const patchPromise =
      deviceScope.kind === "none"
        ? Promise.resolve([{ packageCount: 0, deviceCount: 0 }])
        : ctx.db
            .select({
              packageCount: sql<number>`count(*)::int`,
              deviceCount: sql<number>`count(distinct ${devicePackages.deviceId})::int`,
            })
            .from(devicePackages)
            .innerJoin(devices, eq(devices.id, devicePackages.deviceId))
            .where(
              and(
                deviceWhere,
                isNull(devices.archivedAt),
                eq(devicePackages.installImmediately, true)
              )
            )

    const sessionsPromise =
      deviceScope.kind === "none"
        ? Promise.resolve([{ last24h: 0, active: 0 }])
        : ctx.db
            .select({
              last24h: sql<number>`count(*) filter (where ${remoteSessions.startedAt} >= ${since24h})::int`,
              active: sql<number>`count(*) filter (where ${remoteSessions.endedAt} is null and ${remoteSessions.startedAt} >= ${since24h})::int`,
            })
            .from(remoteSessions)
            .where(inArray(remoteSessions.deviceId, scopedDeviceIds))

    const liveGrantsPromise =
      deviceScope.kind === "none"
        ? Promise.resolve([{ total: 0 }])
        : ctx.db
            .select({ total: count() })
            .from(infrastructureAccessGrants)
            .innerJoin(
              devices,
              eq(devices.id, infrastructureAccessGrants.deviceId)
            )
            .where(
              and(
                deviceWhere,
                eq(infrastructureAccessGrants.status, "active"),
                isNull(infrastructureAccessGrants.revokedAt),
                sql`${infrastructureAccessGrants.expiresAt} > ${now}`
              )
            )

    const riskPromise: Promise<MorningOpsRiskSummary | null> = (async () => {
      if (!canViewRisk) return null
      const inventoryScope = inventoryScopeCondition(ctx.actor, {
        organizationId: assets.organizationId,
        siteId: assets.siteId,
      })
      if (inventoryScope.kind === "none") {
        return { ...emptyMorningRiskSummary(), available: true }
      }
      const conditions = combineConditions([
        inventoryScope.kind === "where" ? inventoryScope.condition : undefined,
      ])
      const rows = await ctx.db
        .select({
          id: assets.id,
          tag: assets.tag,
          status: assets.status,
          siteId: assets.siteId,
          organizationId: assets.organizationId,
          assetPurchaseCost: assets.purchaseCost,
          deviceId: devices.id,
          siteName: sites.name,
          organizationName: organizations.name,
          deviceModelName: deviceModels.name,
          modelReplacementCost: deviceModels.replacementCost,
          modelPurchaseCost: deviceModels.purchaseCost,
        })
        .from(assets)
        .innerJoin(organizations, eq(organizations.id, assets.organizationId))
        .leftJoin(sites, eq(sites.id, assets.siteId))
        .leftJoin(deviceModels, eq(deviceModels.id, assets.deviceModelId))
        .leftJoin(devices, eq(devices.assetId, assets.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
      const summary = summarizeAssetRisk(
        rows.map((row) => ({
          id: row.id,
          tag: row.tag,
          status: row.status,
          linked: Boolean(row.deviceId),
          siteId: row.siteId,
          siteName: row.siteName,
          organizationId: row.organizationId,
          organizationName: row.organizationName,
          deviceModelName: row.deviceModelName,
          modelReplacementCost: row.modelReplacementCost,
          modelPurchaseCost: row.modelPurchaseCost,
          assetPurchaseCost: row.assetPurchaseCost,
        })),
        DEFAULT_ARO_PER_YEAR
      )
      return {
        available: true,
        inServiceLinkedCount: summary.inServiceLinkedCount,
        withCostCount: summary.withCostCount,
        noCostCount: summary.noCostCount,
        totalReplacementValue: summary.totalReplacementValue,
        totalExpectedLoss: summary.totalExpectedLoss,
        totalAnnualExpectedLoss: summary.totalAnnualExpectedLoss,
        aroPerYear: summary.aroPerYear,
      }
    })()

    const [
      alertCountRows,
      deviceCounts,
      patchCountRows,
      sessionCountRows,
      liveGrantRows,
      risk,
    ] = await Promise.all([
      alertCountsPromise,
      deviceTotalsPromise,
      patchPromise,
      sessionsPromise,
      liveGrantsPromise,
      riskPromise,
    ])

    const alertCounts = alertCountRows[0]
    const patchCounts = patchCountRows[0]
    const sessionCounts = sessionCountRows[0]
    const liveGrants = liveGrantRows[0]

    return {
      alerts: {
        open: Number(alertCounts?.open ?? 0),
        acknowledged: Number(alertCounts?.acknowledged ?? 0),
        critical: Number(alertCounts?.critical ?? 0),
        warning: Number(alertCounts?.warning ?? 0),
        notice: Number(alertCounts?.notice ?? 0),
        info: Number(alertCounts?.info ?? 0),
        agentStale: Number(alertCounts?.agentStale ?? 0),
      },
      devices: {
        total: Number(deviceCounts.total ?? 0),
        online: Number(deviceCounts.online ?? 0),
        offline: Number(deviceCounts.offline ?? 0),
        never: Number(deviceCounts.never ?? 0),
        needsAttention: Number(deviceCounts.needsAttention ?? 0),
      },
      patches: {
        deviceCount: Number(patchCounts?.deviceCount ?? 0),
        packageCount: Number(patchCounts?.packageCount ?? 0),
      },
      risk,
      sessions: {
        last24h: Number(sessionCounts?.last24h ?? 0),
        active: Number(sessionCounts?.active ?? 0),
      },
      liveInfrastructureGrants: Number(liveGrants?.total ?? 0),
      generatedAt: new Date(),
    }
  }),
})
