import { z } from "zod"

export const reportTypes = ["uptime", "sessions", "alerts", "access"] as const
export type ReportType = (typeof reportTypes)[number]
export const reportTypeSchema = z.enum(reportTypes)

export const reportCadences = ["weekly", "monthly"] as const
export type ReportCadence = (typeof reportCadences)[number]
export const reportCadenceSchema = z.enum(reportCadences)

export const reportTypeLabels: Record<ReportType, string> = {
  uptime: "Uptime",
  sessions: "Sessions",
  alerts: "Alerts",
  access: "Access log",
}

export const reportCadenceLabels: Record<ReportCadence, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
}

export const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Daily uptime rollups older than this are pruned with history retention. */
export const UPTIME_ROLLUP_RETENTION_DAYS = 365

export type UptimeSample = {
  sampledAt: Date
  online: boolean
}

export type DeviceUptimeDay = {
  onlineMs: number
  observedMs: number
  sampleCount: number
  uptimeRatio: number
}

export type AlertTiming = {
  firstSeenAt: Date
  acknowledgedAt: Date | null
  resolvedAt: Date | null
}

export type AlertTimingStats = {
  count: number
  acknowledgedCount: number
  resolvedCount: number
  mttaMs: number | null
  mttrMs: number | null
}

export type CsvColumn<T> = {
  header: string
  value: (row: T) => unknown
}

/** UTC midnight of the calendar day that contains `date`. */
export function utcDayStart(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  )
}

/** Exclusive UTC end of the calendar day that contains `date`. */
export function utcDayEnd(date: Date) {
  return new Date(utcDayStart(date).getTime() + MS_PER_DAY)
}

/** Monday 00:00 UTC of the ISO week that contains `date`. */
export function isoWeekStartUtc(date: Date) {
  const start = utcDayStart(date)
  const daysFromMonday = (start.getUTCDay() + 6) % 7
  return new Date(start.getTime() - daysFromMonday * MS_PER_DAY)
}

/** First instant of the UTC month that contains `date`. */
export function monthStartUtc(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

export function cadenceWindowStart(cadence: ReportCadence, now: Date) {
  return cadence === "weekly" ? isoWeekStartUtc(now) : monthStartUtc(now)
}

/**
 * Previous complete weekly or monthly window. Weekly is Monday–Monday UTC;
 * monthly is the previous calendar month.
 */
export function previousCadenceRange(cadence: ReportCadence, now: Date) {
  const windowStart = cadenceWindowStart(cadence, now)
  if (cadence === "weekly") {
    return {
      from: new Date(windowStart.getTime() - 7 * MS_PER_DAY),
      to: windowStart,
    }
  }
  return {
    from: new Date(
      Date.UTC(windowStart.getUTCFullYear(), windowStart.getUTCMonth() - 1, 1)
    ),
    to: windowStart,
  }
}

/**
 * A schedule is due once the current cadence window has started, it was
 * created before that window, and it has not already been sent in this window.
 */
export function isReportScheduleDue(input: {
  cadence: ReportCadence
  enabled: boolean
  createdAt: Date
  lastSentAt: Date | null
  now: Date
}) {
  if (!input.enabled) return false
  const windowStart = cadenceWindowStart(input.cadence, input.now)
  if (input.createdAt.getTime() > windowStart.getTime()) return false
  if (!input.lastSentAt) return true
  return input.lastSentAt.getTime() < windowStart.getTime()
}

function emptyUptime(): DeviceUptimeDay {
  return { onlineMs: 0, observedMs: 0, sampleCount: 0, uptimeRatio: 0 }
}

function ratio(onlineMs: number, observedMs: number) {
  if (observedMs <= 0) return 0
  return onlineMs / observedMs
}

/**
 * Step-function uptime over `[dayStart, dayEnd)`.
 *
 * Last known state continues across gaps. Time before the first observation
 * is counted only when `priorOnline` is known. `asOf` clips a partial day.
 */
export function computeDeviceUptimeForDay(input: {
  samples: readonly UptimeSample[]
  dayStart: Date
  dayEnd: Date
  priorOnline?: boolean | null
  asOf?: Date
}): DeviceUptimeDay {
  const endMs = Math.min(
    input.dayEnd.getTime(),
    input.asOf?.getTime() ?? input.dayEnd.getTime()
  )
  const startMs = input.dayStart.getTime()
  if (!(endMs > startMs)) return emptyUptime()

  const inDay = input.samples
    .filter((sample) => {
      const at = sample.sampledAt.getTime()
      return at >= startMs && at < endMs
    })
    .slice()
    .sort((a, b) => a.sampledAt.getTime() - b.sampledAt.getTime())

  let cursor = startMs
  let online: boolean | null = input.priorOnline ?? null

  if (online === null) {
    if (inDay.length === 0) return emptyUptime()
    cursor = inDay[0]!.sampledAt.getTime()
    online = inDay[0]!.online
  }

  let onlineMs = 0
  let observedMs = 0

  for (const sample of inDay) {
    const at = sample.sampledAt.getTime()
    if (at > cursor) {
      const delta = at - cursor
      observedMs += delta
      if (online) onlineMs += delta
      cursor = at
    }
    online = sample.online
  }

  if (online !== null && endMs > cursor) {
    const delta = endMs - cursor
    observedMs += delta
    if (online) onlineMs += delta
  }

  return {
    onlineMs,
    observedMs,
    sampleCount: inDay.length,
    uptimeRatio: ratio(onlineMs, observedMs),
  }
}

function average(values: number[]) {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * MTTA is acknowledge time minus first seen. MTTR is resolve time minus
 * first seen. Negative intervals (clock skew) are ignored.
 */
export function aggregateMttaMttr(
  alerts: readonly AlertTiming[]
): AlertTimingStats {
  const mtta: number[] = []
  const mttr: number[] = []
  let acknowledgedCount = 0
  let resolvedCount = 0

  for (const alert of alerts) {
    const first = alert.firstSeenAt.getTime()
    if (alert.acknowledgedAt) {
      acknowledgedCount += 1
      const delta = alert.acknowledgedAt.getTime() - first
      if (delta >= 0) mtta.push(delta)
    }
    if (alert.resolvedAt) {
      resolvedCount += 1
      const delta = alert.resolvedAt.getTime() - first
      if (delta >= 0) mttr.push(delta)
    }
  }

  return {
    count: alerts.length,
    acknowledgedCount,
    resolvedCount,
    mttaMs: average(mtta),
    mttrMs: average(mttr),
  }
}

export function csvCell(value: unknown) {
  if (value === null || value === undefined) return ""
  const text =
    value instanceof Date
      ? value.toISOString()
      : Array.isArray(value)
        ? value.join(" ")
        : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv<T>(rows: readonly T[], columns: Array<CsvColumn<T>>) {
  const lines = [columns.map((column) => csvCell(column.header)).join(",")]
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(column.value(row))).join(","))
  }
  return `${lines.join("\r\n")}\r\n`
}

export function formatUptimeRatio(value: number) {
  if (!Number.isFinite(value) || value < 0) return "—"
  return `${(value * 100).toFixed(1)}%`
}

export function formatDurationMs(ms: number | null | undefined) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—"
  if (ms < 1000) return `${Math.round(ms)}ms`
  const totalSeconds = Math.round(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
  }
  return `${seconds}s`
}

export function reportRangeLabel(from: Date, to: Date) {
  const start = utcDayStart(from).toISOString().slice(0, 10)
  const endInstant = new Date(to.getTime() - 1)
  const end = utcDayStart(endInstant).toISOString().slice(0, 10)
  return start === end ? start : `${start} to ${end}`
}
