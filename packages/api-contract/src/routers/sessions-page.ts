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

import {
  devices,
  managementServices,
  remoteSessions,
  sites,
  user,
} from "@nms/db"
import { BROWSER_CONNECTION_METHOD } from "@nms/shared"

import {
  buildOrderBy,
  likePattern,
  listQuerySchema,
  paginate,
  resolveListQuery,
} from "../list"
import { combineConditions, deviceScopeCondition } from "../scope"
import { permissionProcedure } from "../trpc"

function parseDate(values: string[] | undefined) {
  const raw = values?.[0]
  if (!raw) return undefined
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/**
 * Cross-device remote session history. Scoped through the device the session
 * targeted, so technicians only see sessions on their own sites.
 */
export const sessionsPage = permissionProcedure("device:view")
  .input(listQuerySchema.optional())
  .query(async ({ ctx, input }) => {
    const query = resolveListQuery(input, { defaultLimit: 50 })
    const scope = deviceScopeCondition(ctx.actor)

    if (scope.kind === "none") {
      return paginate([], query, 0)
    }

    const from = parseDate(query.filters.from)
    const to = parseDate(query.filters.to)
    const activeOnly = query.filters.state?.includes("active")
    const endedOnly = query.filters.state?.includes("ended") && !activeOnly

    const conditions = combineConditions([
      scope.kind === "where" ? scope.condition : undefined,
      query.filters.deviceId
        ? inArray(remoteSessions.deviceId, query.filters.deviceId)
        : undefined,
      query.filters.siteId
        ? inArray(devices.siteId, query.filters.siteId)
        : undefined,
      query.filters.adminUserId
        ? inArray(remoteSessions.adminUserId, query.filters.adminUserId)
        : undefined,
      query.filters.serviceType
        ? inArray(
            sql`${managementServices.serviceType}::text`,
            query.filters.serviceType
          )
        : undefined,
      query.filters.connectionMethod
        ? inArray(
            remoteSessions.connectionMethod,
            query.filters.connectionMethod
          )
        : undefined,
      activeOnly ? isNull(remoteSessions.endedAt) : undefined,
      endedOnly ? sql`${remoteSessions.endedAt} is not null` : undefined,
      from ? gte(remoteSessions.startedAt, from) : undefined,
      to ? lte(remoteSessions.startedAt, to) : undefined,
      query.search
        ? or(
            ilike(devices.displayName, likePattern(query.search)),
            ilike(devices.hostname, likePattern(query.search)),
            ilike(user.email, likePattern(query.search)),
            ilike(user.name, likePattern(query.search))
          )
        : undefined,
    ])
    const where = conditions.length > 0 ? and(...conditions) : undefined

    const base = () =>
      ctx.db
        .select({
          id: remoteSessions.id,
          deviceId: remoteSessions.deviceId,
          deviceName: devices.displayName,
          deviceHostname: devices.hostname,
          siteName: sites.name,
          organizationId: devices.organizationId,
          serviceId: remoteSessions.managementServiceId,
          serviceType: managementServices.serviceType,
          servicePort: managementServices.port,
          actorId: remoteSessions.adminUserId,
          actorName: user.name,
          actorEmail: user.email,
          status: remoteSessions.status,
          connectionMethod: remoteSessions.connectionMethod,
          reason: remoteSessions.reason,
          recordingPath: remoteSessions.recordingPath,
          startedAt: remoteSessions.startedAt,
          endedAt: remoteSessions.endedAt,
          auditMetadata: remoteSessions.auditMetadata,
        })
        .from(remoteSessions)
        .innerJoin(devices, eq(devices.id, remoteSessions.deviceId))
        .leftJoin(sites, eq(sites.id, devices.siteId))
        .leftJoin(
          managementServices,
          eq(managementServices.id, remoteSessions.managementServiceId)
        )
        .leftJoin(user, eq(user.id, remoteSessions.adminUserId))

    const [[totalRow], rows] = await Promise.all([
      ctx.db
        .select({ total: count() })
        .from(remoteSessions)
        .innerJoin(devices, eq(devices.id, remoteSessions.deviceId))
        .leftJoin(
          managementServices,
          eq(managementServices.id, remoteSessions.managementServiceId)
        )
        .leftJoin(user, eq(user.id, remoteSessions.adminUserId))
        .where(where),
      base()
        .where(where)
        .orderBy(
          ...buildOrderBy(
            query.sort,
            {
              startedAt: remoteSessions.startedAt,
              endedAt: remoteSessions.endedAt,
              deviceName: devices.displayName,
              actorEmail: user.email,
              status: remoteSessions.status,
            },
            [desc(remoteSessions.startedAt), desc(remoteSessions.id)]
          )
        )
        .limit(query.limit + 1)
        .offset(query.offset),
    ])

    const items = rows.map((row) => {
      const { recordingPath, auditMetadata: _auditMetadata, ...rest } = row
      const hasRecording =
        Boolean(recordingPath) &&
        rest.connectionMethod === BROWSER_CONNECTION_METHOD
      return {
        ...rest,
        hasRecording,
        recordingPlayUrl: hasRecording
          ? `/api/sessions/${rest.id}/recording/play`
          : null,
        recordingDownloadUrl: hasRecording
          ? `/api/sessions/${rest.id}/recording`
          : null,
      }
    })

    return paginate(items, query, Number(totalRow?.total ?? 0))
  })
