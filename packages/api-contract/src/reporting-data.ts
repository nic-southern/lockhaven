import { and, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm"

import {
  alerts,
  auditEvents,
  deviceUptimeDaily,
  devices,
  organizations,
  remoteSessions,
  sites,
  user,
} from "@nms/db"
import type { db as dbClient } from "@nms/db/client"
import {
  aggregateMttaMttr,
  formatDurationMs,
  formatUptimeRatio,
  reportRangeLabel,
  reportTypeLabels,
  toCsv,
  type ReportType,
} from "@nms/shared"
import type { AnyPgColumn } from "drizzle-orm/pg-core"

import type { ScopeCondition } from "./scope"
import { combineConditions } from "./scope"

export const REPORT_EXPORT_MAX_ROWS = 5000

export type ReportDb = typeof dbClient

export type ReportFilter = {
  from: Date
  to: Date
  organizationId?: string
  siteId?: string
  scope?: ScopeCondition
}

function scoped(scope: ScopeCondition | undefined): SQL | undefined {
  if (!scope || scope.kind === "all") return undefined
  if (scope.kind === "none") return sql`false`
  return scope.condition
}

function filterConditions(
  filter: ReportFilter,
  organizationColumn: AnyPgColumn,
  siteColumn: AnyPgColumn
) {
  return combineConditions([
    scoped(filter.scope),
    filter.organizationId
      ? eq(organizationColumn, filter.organizationId)
      : undefined,
    filter.siteId ? eq(siteColumn, filter.siteId) : undefined,
  ])
}

export type UptimeDeviceRow = {
  deviceId: string
  deviceName: string
  hostname: string | null
  organizationId: string
  organizationName: string
  siteId: string | null
  siteName: string | null
  onlineMs: number
  observedMs: number
  sampleCount: number
  uptimeRatio: number
}

export type UptimeSiteRow = {
  siteId: string | null
  siteName: string
  organizationId: string
  organizationName: string
  deviceCount: number
  onlineMs: number
  observedMs: number
  uptimeRatio: number
}

export type UptimeReport = {
  from: Date
  to: Date
  rangeLabel: string
  devices: UptimeDeviceRow[]
  sites: UptimeSiteRow[]
  truncated: boolean
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "bigint") return Number(value)
  if (typeof value === "string" && value !== "") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export async function loadUptimeReport(
  db: ReportDb,
  filter: ReportFilter
): Promise<UptimeReport> {
  const conditions = combineConditions([
    gte(deviceUptimeDaily.day, filter.from),
    lt(deviceUptimeDaily.day, filter.to),
    ...filterConditions(filter, devices.organizationId, devices.siteId),
  ])

  const rows = await db
    .select({
      deviceId: devices.id,
      deviceName: devices.displayName,
      hostname: devices.hostname,
      organizationId: devices.organizationId,
      organizationName: organizations.name,
      siteId: devices.siteId,
      siteName: sites.name,
      onlineMs: sql<number>`coalesce(sum(${deviceUptimeDaily.onlineMs}), 0)`,
      observedMs: sql<number>`coalesce(sum(${deviceUptimeDaily.observedMs}), 0)`,
      sampleCount: sql<number>`coalesce(sum(${deviceUptimeDaily.sampleCount}), 0)`,
    })
    .from(deviceUptimeDaily)
    .innerJoin(devices, eq(devices.id, deviceUptimeDaily.deviceId))
    .innerJoin(organizations, eq(organizations.id, devices.organizationId))
    .leftJoin(sites, eq(sites.id, devices.siteId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(
      devices.id,
      devices.displayName,
      devices.hostname,
      devices.organizationId,
      organizations.name,
      devices.siteId,
      sites.name
    )
    .orderBy(organizations.name, sites.name, devices.displayName)
    .limit(REPORT_EXPORT_MAX_ROWS + 1)

  const truncated = rows.length > REPORT_EXPORT_MAX_ROWS
  const devicesOut: UptimeDeviceRow[] = rows
    .slice(0, REPORT_EXPORT_MAX_ROWS)
    .map((row) => {
      const onlineMs = numberValue(row.onlineMs)
      const observedMs = numberValue(row.observedMs)
      return {
        deviceId: row.deviceId,
        deviceName: row.deviceName,
        hostname: row.hostname,
        organizationId: row.organizationId,
        organizationName: row.organizationName,
        siteId: row.siteId,
        siteName: row.siteName,
        onlineMs,
        observedMs,
        sampleCount: numberValue(row.sampleCount),
        uptimeRatio: observedMs > 0 ? onlineMs / observedMs : 0,
      }
    })

  const siteMap = new Map<string, UptimeSiteRow>()
  for (const row of devicesOut) {
    const key = `${row.organizationId}:${row.siteId ?? "none"}`
    const current = siteMap.get(key)
    if (current) {
      current.deviceCount += 1
      current.onlineMs += row.onlineMs
      current.observedMs += row.observedMs
      current.uptimeRatio =
        current.observedMs > 0 ? current.onlineMs / current.observedMs : 0
    } else {
      siteMap.set(key, {
        siteId: row.siteId,
        siteName: row.siteName ?? "Unassigned",
        organizationId: row.organizationId,
        organizationName: row.organizationName,
        deviceCount: 1,
        onlineMs: row.onlineMs,
        observedMs: row.observedMs,
        uptimeRatio: row.uptimeRatio,
      })
    }
  }

  return {
    from: filter.from,
    to: filter.to,
    rangeLabel: reportRangeLabel(filter.from, filter.to),
    devices: devicesOut,
    sites: [...siteMap.values()],
    truncated,
  }
}

export type SessionTechnicianRow = {
  technicianId: string
  technicianName: string | null
  technicianEmail: string
  sessionCount: number
  deviceCount: number
  durationMs: number
}

export type SessionReport = {
  from: Date
  to: Date
  rangeLabel: string
  technicians: SessionTechnicianRow[]
  sessionCount: number
  truncated: boolean
}

export async function loadSessionReport(
  db: ReportDb,
  filter: ReportFilter
): Promise<SessionReport> {
  const conditions = combineConditions([
    gte(remoteSessions.startedAt, filter.from),
    lt(remoteSessions.startedAt, filter.to),
    ...filterConditions(filter, devices.organizationId, devices.siteId),
  ])

  const rows = await db
    .select({
      technicianId: remoteSessions.adminUserId,
      technicianName: user.name,
      technicianEmail: user.email,
      sessionCount: sql<number>`count(*)::int`,
      deviceCount: sql<number>`count(distinct ${remoteSessions.deviceId})::int`,
      durationMs: sql<number>`coalesce(sum(extract(epoch from (coalesce(${remoteSessions.endedAt}, now()) - ${remoteSessions.startedAt})) * 1000), 0)`,
    })
    .from(remoteSessions)
    .innerJoin(devices, eq(devices.id, remoteSessions.deviceId))
    .innerJoin(user, eq(user.id, remoteSessions.adminUserId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(remoteSessions.adminUserId, user.name, user.email)
    .orderBy(desc(sql`count(*)`), user.email)
    .limit(REPORT_EXPORT_MAX_ROWS + 1)

  const truncated = rows.length > REPORT_EXPORT_MAX_ROWS
  const technicians = rows.slice(0, REPORT_EXPORT_MAX_ROWS).map((row) => ({
    technicianId: row.technicianId,
    technicianName: row.technicianName,
    technicianEmail: row.technicianEmail,
    sessionCount: numberValue(row.sessionCount),
    deviceCount: numberValue(row.deviceCount),
    durationMs: numberValue(row.durationMs),
  }))

  return {
    from: filter.from,
    to: filter.to,
    rangeLabel: reportRangeLabel(filter.from, filter.to),
    technicians,
    sessionCount: technicians.reduce((sum, row) => sum + row.sessionCount, 0),
    truncated,
  }
}

export type AlertKindStat = {
  kind: string
  count: number
  acknowledgedCount: number
  resolvedCount: number
  mttaMs: number | null
  mttrMs: number | null
}

export type AlertReport = {
  from: Date
  to: Date
  rangeLabel: string
  count: number
  acknowledgedCount: number
  resolvedCount: number
  openCount: number
  mttaMs: number | null
  mttrMs: number | null
  byKind: AlertKindStat[]
  bySeverity: Array<{ severity: string; count: number }>
}

export async function loadAlertReport(
  db: ReportDb,
  filter: ReportFilter
): Promise<AlertReport> {
  const conditions = combineConditions([
    gte(alerts.firstSeenAt, filter.from),
    lt(alerts.firstSeenAt, filter.to),
    ...filterConditions(filter, alerts.organizationId, alerts.siteId),
  ])

  const rows = await db
    .select({
      kind: alerts.kind,
      severity: alerts.severity,
      status: alerts.status,
      firstSeenAt: alerts.firstSeenAt,
      acknowledgedAt: alerts.acknowledgedAt,
      resolvedAt: alerts.resolvedAt,
    })
    .from(alerts)
    .where(conditions.length > 0 ? and(...conditions) : undefined)

  const totals = aggregateMttaMttr(rows)
  const byKindMap = new Map<string, typeof rows>()
  const bySeverity = new Map<string, number>()
  let openCount = 0

  for (const row of rows) {
    const kindRows = byKindMap.get(row.kind) ?? []
    kindRows.push(row)
    byKindMap.set(row.kind, kindRows)
    bySeverity.set(row.severity, (bySeverity.get(row.severity) ?? 0) + 1)
    if (row.status !== "resolved") openCount += 1
  }

  return {
    from: filter.from,
    to: filter.to,
    rangeLabel: reportRangeLabel(filter.from, filter.to),
    count: totals.count,
    acknowledgedCount: totals.acknowledgedCount,
    resolvedCount: totals.resolvedCount,
    openCount,
    mttaMs: totals.mttaMs,
    mttrMs: totals.mttrMs,
    byKind: [...byKindMap.entries()].map(([kind, kindRows]) => ({
      kind,
      ...aggregateMttaMttr(kindRows),
    })),
    bySeverity: [...bySeverity.entries()].map(([severity, count]) => ({
      severity,
      count,
    })),
  }
}

export type AccessLogRow = {
  id: string
  createdAt: Date
  eventType: string
  severity: string
  actorName: string | null
  actorEmail: string | null
  organizationName: string | null
  siteName: string | null
  deviceName: string | null
}

export type AccessLogReport = {
  from: Date
  to: Date
  rangeLabel: string
  rows: AccessLogRow[]
  truncated: boolean
}

export async function loadAccessLogReport(
  db: ReportDb,
  filter: ReportFilter
): Promise<AccessLogReport> {
  const conditions = combineConditions([
    gte(auditEvents.createdAt, filter.from),
    lt(auditEvents.createdAt, filter.to),
    ...filterConditions(filter, auditEvents.organizationId, auditEvents.siteId),
  ])

  const rows = await db
    .select({
      id: auditEvents.id,
      createdAt: auditEvents.createdAt,
      eventType: auditEvents.eventType,
      severity: auditEvents.severity,
      actorName: user.name,
      actorEmail: user.email,
      organizationName: organizations.name,
      siteName: sites.name,
      deviceName: devices.displayName,
    })
    .from(auditEvents)
    .leftJoin(user, eq(user.id, auditEvents.actorUserId))
    .leftJoin(organizations, eq(organizations.id, auditEvents.organizationId))
    .leftJoin(sites, eq(sites.id, auditEvents.siteId))
    .leftJoin(devices, eq(devices.id, auditEvents.deviceId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditEvents.createdAt))
    .limit(REPORT_EXPORT_MAX_ROWS + 1)

  const truncated = rows.length > REPORT_EXPORT_MAX_ROWS
  return {
    from: filter.from,
    to: filter.to,
    rangeLabel: reportRangeLabel(filter.from, filter.to),
    rows: rows.slice(0, REPORT_EXPORT_MAX_ROWS),
    truncated,
  }
}

function fileStamp(from: Date, to: Date) {
  const start = from.toISOString().slice(0, 10)
  const end = new Date(to.getTime() - 1).toISOString().slice(0, 10)
  return `${start}-${end}`
}

export function csvForUptime(report: UptimeReport) {
  return toCsv(report.devices, [
    { header: "Organization", value: (row) => row.organizationName },
    { header: "Site", value: (row) => row.siteName ?? "Unassigned" },
    { header: "Device", value: (row) => row.deviceName },
    { header: "Hostname", value: (row) => row.hostname },
    { header: "Uptime", value: (row) => formatUptimeRatio(row.uptimeRatio) },
    { header: "Online", value: (row) => formatDurationMs(row.onlineMs) },
    { header: "Observed", value: (row) => formatDurationMs(row.observedMs) },
    { header: "Samples", value: (row) => row.sampleCount },
  ])
}

export function csvForSessions(report: SessionReport) {
  return toCsv(report.technicians, [
    { header: "Technician", value: (row) => row.technicianName },
    { header: "Email", value: (row) => row.technicianEmail },
    { header: "Sessions", value: (row) => row.sessionCount },
    { header: "Devices", value: (row) => row.deviceCount },
    { header: "Time", value: (row) => formatDurationMs(row.durationMs) },
  ])
}

export function csvForAlerts(report: AlertReport) {
  return toCsv(report.byKind, [
    { header: "Kind", value: (row) => row.kind },
    { header: "Opened", value: (row) => row.count },
    { header: "Acknowledged", value: (row) => row.acknowledgedCount },
    { header: "Resolved", value: (row) => row.resolvedCount },
    { header: "MTTA", value: (row) => formatDurationMs(row.mttaMs) },
    { header: "MTTR", value: (row) => formatDurationMs(row.mttrMs) },
  ])
}

export function csvForAccessLog(report: AccessLogReport) {
  return toCsv(report.rows, [
    { header: "Time", value: (row) => row.createdAt.toISOString() },
    { header: "Event", value: (row) => row.eventType },
    { header: "Severity", value: (row) => row.severity },
    { header: "Actor", value: (row) => row.actorName ?? row.actorEmail },
    { header: "Organization", value: (row) => row.organizationName },
    { header: "Site", value: (row) => row.siteName },
    { header: "Device", value: (row) => row.deviceName },
  ])
}

export async function buildReportCsv(
  db: ReportDb,
  type: ReportType,
  filter: ReportFilter
) {
  const label = reportTypeLabels[type]
  if (type === "uptime") {
    const report = await loadUptimeReport(db, filter)
    return {
      filename: `uptime-${fileStamp(filter.from, filter.to)}.csv`,
      csv: csvForUptime(report),
      rangeLabel: report.rangeLabel,
      label,
      summary: `${report.devices.length} devices`,
    }
  }
  if (type === "sessions") {
    const report = await loadSessionReport(db, filter)
    return {
      filename: `sessions-${fileStamp(filter.from, filter.to)}.csv`,
      csv: csvForSessions(report),
      rangeLabel: report.rangeLabel,
      label,
      summary: `${report.sessionCount} sessions`,
    }
  }
  if (type === "alerts") {
    const report = await loadAlertReport(db, filter)
    return {
      filename: `alerts-${fileStamp(filter.from, filter.to)}.csv`,
      csv: csvForAlerts(report),
      rangeLabel: report.rangeLabel,
      label,
      summary: `${report.count} alerts`,
    }
  }
  const report = await loadAccessLogReport(db, filter)
  return {
    filename: `access-${fileStamp(filter.from, filter.to)}.csv`,
    csv: csvForAccessLog(report),
    rangeLabel: report.rangeLabel,
    label,
    summary: `${report.rows.length} events`,
  }
}
