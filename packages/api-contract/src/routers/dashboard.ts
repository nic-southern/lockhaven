import { and, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm"

import {
  auditEvents,
  devices,
  organizations,
  remoteSessions,
  sites,
  user,
  vpnIdentities,
} from "@nms/db"
import type { DeviceConnectivity } from "@nms/shared"

import { actorOrganizationIds, actorSiteIds } from "../access"
import { connectivityExpression, offlineServiceCount } from "../device-sql"
import { deviceScopeCondition } from "../scope"
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
    sql`${devices.status} <> 'pending'`,
    or(
      sql`${connectivityExpression()} in ('offline', 'never')`,
      sql`${offlineServiceCount()} > 0`
    )
  )

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
        .where(where)
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
})
