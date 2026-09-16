import { and, count, eq, gte, inArray, or, sql, type SQL } from "drizzle-orm"
import { z } from "zod"

import {
  adminVpnProfiles,
  connectionDaily,
  connectionEvents,
  devices,
  sites,
  user,
} from "@nms/db"
import {
  FLOW_RETENTION_DAYS_DEFAULT,
  type ConnectionDirection,
  type ConnectionProtocol,
  type ConnectionVerdict,
} from "@nms/shared"

import { assertAuthorized } from "../access"
import type { ApiContext } from "../context"
import {
  likePattern,
  listQuerySchema,
  paginate,
  resolveListQuery,
  type ResolvedListQuery,
} from "../list"
import { combineConditions, eventScopeCondition } from "../scope"
import { createTRPCRouter, permissionProcedure } from "../trpc"

const EXPORT_MAX_ROWS = 5000
const DAY_MS = 24 * 60 * 60 * 1000

function rawRetentionMs() {
  const parsed = Number(process.env.FLOW_RETENTION_DAYS)
  const days =
    Number.isInteger(parsed) && parsed > 0
      ? parsed
      : FLOW_RETENTION_DAYS_DEFAULT
  return days * DAY_MS
}

function parseDate(values: string[] | undefined) {
  const raw = values?.[0]
  if (!raw) return undefined
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/** Column handles shared by the raw and daily tables. */
type FlowSource = {
  table: typeof connectionEvents | typeof connectionDaily
  raw: boolean
}

/**
 * Raw events give exact, up-to-the-minute answers but are only retained for
 * a month; daily rollups cover the long tail. Ranges that fit inside raw
 * retention read the raw table so the log reflects the last ingest run.
 */
function chooseSource(from: Date | undefined, now = new Date()): FlowSource {
  const raw =
    Boolean(from) && now.getTime() - from!.getTime() <= rawRetentionMs()
  return raw
    ? { table: connectionEvents, raw: true }
    : { table: connectionDaily, raw: false }
}

export type ConnectionLogRow = {
  subjectKey: string
  deviceId: string | null
  deviceName: string | null
  deviceHostname: string | null
  adminProfileId: string | null
  adminLabel: string | null
  adminUserName: string | null
  adminUserEmail: string | null
  organizationId: string | null
  siteId: string | null
  siteName: string | null
  srcIp: string | null
  direction: ConnectionDirection
  verdict: ConnectionVerdict
  protocol: ConnectionProtocol
  dstIp: string
  dstPort: number
  connections: number
  bytes: number
  firstSeenAt: Date
  lastSeenAt: Date
}

const sortExpressions: Record<string, SQL> = {
  lastSeenAt: sql`agg.last_seen_at`,
  firstSeenAt: sql`agg.first_seen_at`,
  connections: sql`agg.connections`,
  bytes: sql`agg.bytes`,
  deviceName: sql`coalesce(d.display_name, p.label, u.email, agg.subject_key)`,
  dstIp: sql`agg.dst_ip`,
  dstPort: sql`agg.dst_port`,
  verdict: sql`agg.verdict`,
  protocol: sql`agg.protocol`,
}

function buildSourceConditions(
  query: ResolvedListQuery,
  source: FlowSource,
  scopeCondition: SQL | undefined,
  from: Date | undefined,
  to: Date | undefined
) {
  const { table } = source
  const timeColumn = source.raw
    ? sql`${connectionEvents.occurredAt}`
    : sql`${connectionDaily.day}`
  return combineConditions([
    scopeCondition,
    query.filters.deviceId
      ? inArray(sql`${table.deviceId}`, query.filters.deviceId)
      : undefined,
    query.filters.adminProfileId
      ? inArray(sql`${table.adminProfileId}`, query.filters.adminProfileId)
      : undefined,
    query.filters.siteId
      ? inArray(sql`${table.siteId}`, query.filters.siteId)
      : undefined,
    query.filters.organizationId
      ? inArray(sql`${table.organizationId}`, query.filters.organizationId)
      : undefined,
    query.filters.verdict
      ? inArray(sql`${table.verdict}`, query.filters.verdict)
      : undefined,
    query.filters.protocol
      ? inArray(sql`${table.protocol}`, query.filters.protocol)
      : undefined,
    query.filters.direction
      ? inArray(sql`${table.direction}`, query.filters.direction)
      : undefined,
    query.filters.subject?.length
      ? or(
          ...query.filters.subject.map((kind) =>
            kind === "device"
              ? sql`${table.deviceId} is not null`
              : kind === "admin"
                ? sql`${table.adminProfileId} is not null`
                : sql`(${table.deviceId} is null and ${table.adminProfileId} is null)`
          )
        )
      : undefined,
    from
      ? source.raw
        ? gte(connectionEvents.occurredAt, from)
        : gte(connectionDaily.day, startOfUtcDay(from))
      : undefined,
    to ? sql`${timeColumn} <= ${to}` : undefined,
  ])
}

function startOfUtcDay(date: Date) {
  const day = new Date(date)
  day.setUTCHours(0, 0, 0, 0)
  return day
}

/** One row per subject + destination, summed over the selected window. */
function aggregateSql(source: FlowSource, where: SQL | undefined) {
  const whereSql = where ? sql`where ${where}` : sql``
  if (source.raw) {
    return sql`
      select
        coalesce('device:' || device_id::text, 'admin:' || admin_profile_id::text, 'ip:' || host(src_ip)) as subject_key,
        device_id,
        admin_profile_id,
        max(organization_id::text)::uuid as organization_id,
        max(site_id::text)::uuid as site_id,
        direction,
        verdict,
        protocol,
        dst_ip,
        coalesce(dst_port, 0) as dst_port,
        count(*)::int as connections,
        coalesce(sum(bytes), 0)::bigint as bytes,
        min(occurred_at) as first_seen_at,
        max(occurred_at) as last_seen_at
      from ${connectionEvents}
      ${whereSql}
      group by 1, 2, 3, 6, 7, 8, 9, 10
    `
  }
  return sql`
    select
      subject_key,
      device_id,
      admin_profile_id,
      max(organization_id::text)::uuid as organization_id,
      max(site_id::text)::uuid as site_id,
      direction,
      verdict,
      protocol,
      dst_ip,
      dst_port,
      sum(connections)::int as connections,
      coalesce(sum(bytes), 0)::bigint as bytes,
      min(first_seen_at) as first_seen_at,
      max(last_seen_at) as last_seen_at
    from ${connectionDaily}
    ${whereSql}
    group by 1, 2, 3, 6, 7, 8, 9, 10
  `
}

function joinedSql(inner: SQL, outerWhere: SQL | undefined) {
  return sql`
    from (${inner}) agg
    left join ${devices} d on d.id = agg.device_id
    left join ${sites} s on s.id = agg.site_id
    left join ${adminVpnProfiles} p on p.id = agg.admin_profile_id
    left join ${user} u on u.id = p.user_id
    ${outerWhere ? sql`where ${outerWhere}` : sql``}
  `
}

function outerSearch(search: string) {
  if (!search) return undefined
  const pattern = likePattern(search)
  return sql`(
    d.display_name ilike ${pattern}
    or d.hostname ilike ${pattern}
    or p.label ilike ${pattern}
    or u.email ilike ${pattern}
    or host(agg.dst_ip) ilike ${pattern}
    or agg.subject_key ilike ${pattern}
  )`
}

type AggregateRecord = {
  subject_key: string
  device_id: string | null
  admin_profile_id: string | null
  organization_id: string | null
  site_id: string | null
  direction: ConnectionDirection
  verdict: ConnectionVerdict
  protocol: ConnectionProtocol
  dst_ip: string
  dst_port: number
  connections: number
  bytes: string | number
  first_seen_at: string | Date
  last_seen_at: string | Date
  device_name: string | null
  device_hostname: string | null
  site_name: string | null
  admin_label: string | null
  admin_user_name: string | null
  admin_user_email: string | null
}

function toRow(record: AggregateRecord): ConnectionLogRow {
  return {
    subjectKey: record.subject_key,
    deviceId: record.device_id,
    deviceName: record.device_name,
    deviceHostname: record.device_hostname,
    adminProfileId: record.admin_profile_id,
    adminLabel: record.admin_label,
    adminUserName: record.admin_user_name,
    adminUserEmail: record.admin_user_email,
    organizationId: record.organization_id,
    siteId: record.site_id,
    siteName: record.site_name,
    srcIp: record.subject_key.startsWith("ip:")
      ? record.subject_key.slice(3)
      : null,
    direction: record.direction,
    verdict: record.verdict,
    protocol: record.protocol,
    dstIp: String(record.dst_ip),
    dstPort: Number(record.dst_port),
    connections: Number(record.connections),
    bytes: Number(record.bytes),
    firstSeenAt: new Date(record.first_seen_at),
    lastSeenAt: new Date(record.last_seen_at),
  }
}

const selectColumns = sql`
  agg.*,
  d.display_name as device_name,
  d.hostname as device_hostname,
  s.name as site_name,
  p.label as admin_label,
  u.name as admin_user_name,
  u.email as admin_user_email
`

function orderBySql(query: ResolvedListQuery) {
  const parts = query.sort
    .filter((entry) => sortExpressions[entry.id])
    .map((entry) =>
      entry.desc
        ? sql`${sortExpressions[entry.id]} desc nulls last`
        : sql`${sortExpressions[entry.id]} asc nulls last`
    )
  parts.push(sql`agg.last_seen_at desc`, sql`agg.connections desc`)
  return sql.join(parts, sql`, `)
}

async function runConnectionLog(
  ctx: ApiContext,
  query: ResolvedListQuery,
  options: { limit: number; offset: number; withTotal: boolean }
) {
  const from = parseDate(query.filters.from)
  const to = parseDate(query.filters.to)
  const source = chooseSource(from)
  const scope = eventScopeCondition(ctx.actor, {
    organizationId: source.table.organizationId,
    siteId: source.table.siteId,
    deviceId: source.table.deviceId,
  })
  if (scope.kind === "none") {
    return { rows: [] as ConnectionLogRow[], total: 0 }
  }

  const conditions = buildSourceConditions(
    query,
    source,
    scope.kind === "where" ? scope.condition : undefined,
    from,
    to
  )
  const inner = aggregateSql(
    source,
    conditions.length > 0 ? and(...conditions) : undefined
  )
  const joined = joinedSql(inner, outerSearch(query.search))

  const [rowsResult, totalResult] = await Promise.all([
    ctx.db.execute<AggregateRecord>(sql`
      select ${selectColumns}
      ${joined}
      order by ${orderBySql(query)}
      limit ${options.limit}
      offset ${options.offset}
    `),
    options.withTotal
      ? ctx.db.execute<{ total: number | string }>(
          sql`select count(*)::int as total ${joined}`
        )
      : Promise.resolve(null),
  ])

  return {
    rows: rowsResult.rows.map(toRow),
    total: Number(totalResult?.rows[0]?.total ?? rowsResult.rows.length),
  }
}

export const networkRouter = createTRPCRouter({
  /** Connection log grouped by source and destination for the chosen window. */
  page: permissionProcedure("device:view")
    .input(listQuerySchema.optional())
    .query(async ({ ctx, input }) => {
      const query = resolveListQuery(input, { defaultLimit: 50 })
      const { rows, total } = await runConnectionLog(ctx, query, {
        limit: query.limit + 1,
        offset: query.offset,
        withTotal: true,
      })
      return paginate(rows, query, total)
    }),
  export: permissionProcedure("device:view")
    .input(listQuerySchema.omit({ cursor: true, limit: true }).optional())
    .query(async ({ ctx, input }) => {
      const query = resolveListQuery(
        { ...input, limit: EXPORT_MAX_ROWS },
        { defaultLimit: EXPORT_MAX_ROWS, maxLimit: EXPORT_MAX_ROWS }
      )
      const { rows } = await runConnectionLog(ctx, query, {
        limit: EXPORT_MAX_ROWS + 1,
        offset: 0,
        withTotal: false,
      })
      return {
        rows: rows.slice(0, EXPORT_MAX_ROWS),
        truncated: rows.length > EXPORT_MAX_ROWS,
      }
    }),
  /** Filter options with counts over the rollup table, within scope. */
  facets: permissionProcedure("device:view").query(async ({ ctx }) => {
    const scope = eventScopeCondition(ctx.actor, {
      organizationId: connectionDaily.organizationId,
      siteId: connectionDaily.siteId,
      deviceId: connectionDaily.deviceId,
    })
    const empty = {
      verdict: [] as Array<{ value: string; count: number }>,
      protocol: [] as Array<{ value: string; count: number }>,
      direction: [] as Array<{ value: string; count: number }>,
      siteId: [] as Array<{ value: string; label: string; count: number }>,
      deviceId: [] as Array<{ value: string; label: string; count: number }>,
    }
    if (scope.kind === "none") {
      return empty
    }
    const where = scope.kind === "where" ? scope.condition : undefined
    const grouped = (expression: SQL) =>
      ctx.db
        .select({
          value: expression,
          total: sql<number>`coalesce(sum(${connectionDaily.connections}), 0)::int`,
        })
        .from(connectionDaily)
        .where(where)
        .groupBy(expression)

    const [verdictRows, protocolRows, directionRows, siteRows, deviceRows] =
      await Promise.all([
        grouped(sql`${connectionDaily.verdict}`),
        grouped(sql`${connectionDaily.protocol}`),
        grouped(sql`${connectionDaily.direction}`),
        ctx.db
          .select({
            value: connectionDaily.siteId,
            label: sites.name,
            total: sql<number>`coalesce(sum(${connectionDaily.connections}), 0)::int`,
          })
          .from(connectionDaily)
          .innerJoin(sites, eq(sites.id, connectionDaily.siteId))
          .where(where)
          .groupBy(connectionDaily.siteId, sites.name)
          .orderBy(sites.name),
        ctx.db
          .select({
            value: connectionDaily.deviceId,
            label: devices.displayName,
            total: sql<number>`coalesce(sum(${connectionDaily.connections}), 0)::int`,
          })
          .from(connectionDaily)
          .innerJoin(devices, eq(devices.id, connectionDaily.deviceId))
          .where(where)
          .groupBy(connectionDaily.deviceId, devices.displayName)
          .orderBy(devices.displayName),
      ])

    const plain = (rows: Array<{ value: unknown; total: number }>) =>
      rows.flatMap((row) =>
        row.value
          ? [{ value: String(row.value), count: Number(row.total) }]
          : []
      )
    const labelled = (
      rows: Array<{ value: string | null; label: string; total: number }>
    ) =>
      rows.flatMap((row) =>
        row.value
          ? [{ value: row.value, label: row.label, count: Number(row.total) }]
          : []
      )

    return {
      verdict: plain(verdictRows),
      protocol: plain(protocolRows),
      direction: plain(directionRows),
      siteId: labelled(siteRows),
      deviceId: labelled(deviceRows),
    }
  }),
  /**
   * Per-device connection summary for the Network tab: daily accepted/dropped
   * counts for a timeline plus totals for the same window.
   */
  deviceSummary: permissionProcedure("device:view")
    .input(
      z.object({
        deviceId: z.string().uuid(),
        days: z.number().int().min(1).max(90).default(14),
      })
    )
    .query(async ({ ctx, input }) => {
      const [device] = await ctx.db
        .select({
          id: devices.id,
          organizationId: devices.organizationId,
          siteId: devices.siteId,
        })
        .from(devices)
        .where(eq(devices.id, input.deviceId))
      if (!device) {
        return null
      }
      assertAuthorized(ctx.actor, "device:view", {
        kind: "device",
        organizationId: device.organizationId,
        siteId: device.siteId,
      })

      const now = new Date()
      const start = startOfUtcDay(
        new Date(now.getTime() - (input.days - 1) * DAY_MS)
      )
      const source = chooseSource(start, now)
      const dayExpression = source.raw
        ? sql<string>`(date_trunc('day', ${connectionEvents.occurredAt} at time zone 'UTC') at time zone 'UTC')`
        : sql<string>`${connectionDaily.day}`
      const countExpression = source.raw
        ? sql<number>`count(*)::int`
        : sql<number>`sum(${connectionDaily.connections})::int`
      const table = source.table

      const rows = await ctx.db
        .select({
          day: dayExpression,
          verdict: sql<ConnectionVerdict>`${table.verdict}`,
          direction: sql<ConnectionDirection>`${table.direction}`,
          connections: countExpression,
          bytes: sql<number>`coalesce(sum(${table.bytes}), 0)::bigint`,
          destinations: sql<number>`count(distinct (${table.dstIp}, ${table.dstPort}))::int`,
        })
        .from(table)
        .where(
          and(
            eq(sql`${table.deviceId}`, device.id),
            source.raw
              ? gte(connectionEvents.occurredAt, start)
              : gte(connectionDaily.day, start)
          )
        )
        .groupBy(dayExpression, sql`${table.verdict}`, sql`${table.direction}`)

      const buckets = new Map<
        string,
        { day: Date; accepted: number; dropped: number; bytes: number }
      >()
      for (let index = 0; index < input.days; index += 1) {
        const day = new Date(start.getTime() + index * DAY_MS)
        buckets.set(day.toISOString(), {
          day,
          accepted: 0,
          dropped: 0,
          bytes: 0,
        })
      }
      const totals = {
        accepted: 0,
        dropped: 0,
        hubDropped: 0,
        bytes: 0,
        destinations: 0,
      }
      for (const row of rows) {
        const key = new Date(row.day).toISOString()
        const bucket = buckets.get(key)
        const connections = Number(row.connections)
        const bytes = Number(row.bytes)
        if (bucket) {
          if (row.verdict === "accept") bucket.accepted += connections
          else bucket.dropped += connections
          bucket.bytes += bytes
        }
        if (row.verdict === "accept") totals.accepted += connections
        else {
          totals.dropped += connections
          if (row.direction === "hub") totals.hubDropped += connections
        }
        totals.bytes += bytes
        totals.destinations += Number(row.destinations)
      }

      return {
        days: input.days,
        from: start,
        series: [...buckets.values()],
        totals,
      }
    }),
  /** Counts of scoped connection rows, used by the page header. */
  summary: permissionProcedure("device:view").query(async ({ ctx }) => {
    const scope = eventScopeCondition(ctx.actor, {
      organizationId: connectionEvents.organizationId,
      siteId: connectionEvents.siteId,
      deviceId: connectionEvents.deviceId,
    })
    if (scope.kind === "none") {
      return { last24h: 0, dropped24h: 0, hubProbes24h: 0, lastEventAt: null }
    }
    const since = new Date(Date.now() - DAY_MS)
    const [row] = await ctx.db
      .select({
        total: count(),
        dropped: sql<number>`count(*) filter (where ${connectionEvents.verdict} = 'drop')::int`,
        hubProbes: sql<number>`count(*) filter (where ${connectionEvents.verdict} = 'drop' and ${connectionEvents.direction} = 'hub')::int`,
        lastEventAt: sql<Date | null>`max(${connectionEvents.occurredAt})`,
      })
      .from(connectionEvents)
      .where(
        and(
          scope.kind === "where" ? scope.condition : undefined,
          gte(connectionEvents.occurredAt, since)
        )
      )
    return {
      last24h: Number(row?.total ?? 0),
      dropped24h: Number(row?.dropped ?? 0),
      hubProbes24h: Number(row?.hubProbes ?? 0),
      lastEventAt: row?.lastEventAt ? new Date(row.lastEventAt) : null,
    }
  }),
})
