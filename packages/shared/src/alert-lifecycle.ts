import {
  AGENT_STALE_MINUTES_DEFAULT,
  alertKindDefaultSeverity,
  CONCENTRATOR_PROBE_AUTO_RESOLVE_HOURS,
  DEVICE_OFFLINE_ALERT_HOURS,
  DISK_FULL_FREE_BYTES_DEFAULT,
  DISK_FULL_USED_PERCENT_DEFAULT,
  type AlertKind,
  type AlertStatus,
  type AuditSeverity,
} from "./events"

export const CONCENTRATOR_PROBE_AUTO_RESOLVE_MS =
  CONCENTRATOR_PROBE_AUTO_RESOLVE_HOURS * 60 * 60 * 1000

export const maintenanceWindowRecurrences = ["none", "weekly"] as const
export type MaintenanceWindowRecurrence =
  (typeof maintenanceWindowRecurrences)[number]

export type AlertPolicyThresholds = {
  offlineHours?: number
  /** `disk_full`: used percentage at or above which a disk counts as full. */
  diskUsedPercent?: number
  /** `disk_full`: free bytes below which a disk counts as full; 0 disables. */
  diskFreeBytes?: number
  /** `agent_stale`: minutes without a check-in before the agent is stale. */
  agentStaleMinutes?: number
}

export type AlertPolicyFields = {
  organizationId: string
  siteId: string | null
  kind: AlertKind
  enabled: boolean
  severity: AuditSeverity | null
  escalateAfterMinutes: number | null
  thresholds: AlertPolicyThresholds
}

export type EffectiveAlertPolicy = {
  kind: AlertKind
  enabled: boolean
  severity: AuditSeverity
  escalateAfterMinutes: number | null
  offlineHours: number
  diskUsedPercent: number
  diskFreeBytes: number
  agentStaleMinutes: number
  source: "site" | "org" | "default"
}

export type MaintenanceWindowMatchInput = {
  organizationId: string
  siteId: string | null
  deviceId: string | null
  startsAt: Date
  endsAt: Date
  timeZone: string
  recurrence: MaintenanceWindowRecurrence
}

export type AlertScopeTarget = {
  organizationId: string | null
  siteId: string | null
  deviceId: string | null
}

export type EscalationCandidate = {
  id: string
  kind: AlertKind
  status: AlertStatus
  organizationId: string | null
  siteId: string | null
  firstSeenAt: Date
  snoozedUntil: Date | null
  escalatedAt: Date | null
  inMaintenanceWindow?: boolean
  /** Quiet offline kinds stay held while the site is closed. */
  inClosedHours?: boolean
}

type ZonedParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  weekday: number
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

export const MAX_WEEKLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export function isValidTimeZone(timeZone: string) {
  if (!timeZone || timeZone.length > 64) return false
  try {
    Intl.DateTimeFormat("en-US", { timeZone })
    return true
  } catch {
    return false
  }
}

/** One-shot and weekly windows must have a positive span; weekly repeats cannot last a week. */
export function isValidMaintenanceWindowSpan(
  startsAt: Date,
  endsAt: Date,
  recurrence: MaintenanceWindowRecurrence
) {
  const durationMs = endsAt.getTime() - startsAt.getTime()
  if (durationMs <= 0) return false
  if (recurrence === "weekly" && durationMs >= MAX_WEEKLY_WINDOW_MS) {
    return false
  }
  return true
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
  const bag: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {}
  for (const part of formatter.formatToParts(date)) {
    bag[part.type] = part.value
  }
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour) % 24,
    minute: Number(bag.minute),
    second: Number(bag.second),
    weekday: WEEKDAY_INDEX[bag.weekday ?? "Sun"] ?? 0,
  }
}

/** Milliseconds to add to UTC to get wall time in `timeZone` at `date`. */
function timeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = zonedParts(date, timeZone)
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  )
  return asUtc - date.getTime()
}

/** Instant corresponding to a wall-clock time in `timeZone`. */
export function fromZonedTime(
  parts: Omit<ZonedParts, "weekday">,
  timeZone: string
) {
  const utcGuess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  )
  const first = new Date(
    utcGuess - timeZoneOffsetMs(new Date(utcGuess), timeZone)
  )
  const secondOffset = timeZoneOffsetMs(first, timeZone)
  const firstOffset = timeZoneOffsetMs(new Date(utcGuess), timeZone)
  if (secondOffset === firstOffset) return first
  return new Date(utcGuess - secondOffset)
}

function addCalendarDays(
  parts: Omit<ZonedParts, "weekday">,
  days: number
): Omit<ZonedParts, "weekday"> {
  const utc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day + days,
    parts.hour,
    parts.minute,
    parts.second
  )
  const date = new Date(utc)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  }
}

export function isMaintenanceWindowActive(
  window: MaintenanceWindowMatchInput,
  now: Date
) {
  if (
    !isValidMaintenanceWindowSpan(
      window.startsAt,
      window.endsAt,
      window.recurrence
    )
  ) {
    return false
  }
  if (!isValidTimeZone(window.timeZone)) {
    return (
      now.getTime() >= window.startsAt.getTime() &&
      now.getTime() < window.endsAt.getTime()
    )
  }
  if (window.recurrence === "none") {
    return (
      now.getTime() >= window.startsAt.getTime() &&
      now.getTime() < window.endsAt.getTime()
    )
  }
  if (now.getTime() < window.startsAt.getTime()) {
    return false
  }

  const durationMs = window.endsAt.getTime() - window.startsAt.getTime()
  const startParts = zonedParts(window.startsAt, window.timeZone)
  const nowParts = zonedParts(now, window.timeZone)
  let dayDelta = nowParts.weekday - startParts.weekday
  if (dayDelta < 0) dayDelta += 7

  const candidate = addCalendarDays(
    {
      year: nowParts.year,
      month: nowParts.month,
      day: nowParts.day,
      hour: startParts.hour,
      minute: startParts.minute,
      second: startParts.second,
    },
    -dayDelta
  )
  let occurrenceStart = fromZonedTime(candidate, window.timeZone)
  if (occurrenceStart.getTime() > now.getTime()) {
    occurrenceStart = fromZonedTime(
      addCalendarDays(candidate, -7),
      window.timeZone
    )
  }
  const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs)
  return (
    now.getTime() >= occurrenceStart.getTime() &&
    now.getTime() < occurrenceEnd.getTime()
  )
}

/**
 * Device windows beat site windows; site windows beat org-wide windows.
 * An org-wide window still covers every site and device in the organization.
 */
export function windowAppliesToTarget(
  window: Pick<
    MaintenanceWindowMatchInput,
    "organizationId" | "siteId" | "deviceId"
  >,
  target: AlertScopeTarget
) {
  if (
    !target.organizationId ||
    window.organizationId !== target.organizationId
  ) {
    return false
  }
  if (window.deviceId) {
    return Boolean(target.deviceId) && window.deviceId === target.deviceId
  }
  if (window.siteId) {
    return window.siteId === target.siteId
  }
  return true
}

export function findActiveMaintenanceWindow<
  T extends MaintenanceWindowMatchInput,
>(windows: T[], target: AlertScopeTarget, now: Date): T | null {
  const matching = windows.filter(
    (window) =>
      windowAppliesToTarget(window, target) &&
      isMaintenanceWindowActive(window, now)
  )
  if (matching.length === 0) return null
  matching.sort((left, right) => {
    const rank = (window: T) => (window.deviceId ? 0 : window.siteId ? 1 : 2)
    return rank(left) - rank(right)
  })
  return matching[0] ?? null
}

function firstDefined<T>(
  ...values: Array<T | null | undefined>
): T | undefined {
  for (const value of values) {
    if (value !== null && value !== undefined) return value
  }
  return undefined
}

/**
 * Site policy fields override organization fields; remaining gaps fall back
 * to the constants in `events.ts`.
 */
export function resolveEffectiveAlertPolicy(
  kind: AlertKind,
  options: {
    sitePolicy?: AlertPolicyFields | null
    orgPolicy?: AlertPolicyFields | null
  }
): EffectiveAlertPolicy {
  const site =
    options.sitePolicy && options.sitePolicy.kind === kind
      ? options.sitePolicy
      : null
  const org =
    options.orgPolicy && options.orgPolicy.kind === kind
      ? options.orgPolicy
      : null
  const source: EffectiveAlertPolicy["source"] = site
    ? "site"
    : org
      ? "org"
      : "default"

  return {
    kind,
    enabled: site?.enabled ?? org?.enabled ?? true,
    severity:
      firstDefined(site?.severity, org?.severity) ??
      alertKindDefaultSeverity[kind],
    escalateAfterMinutes:
      firstDefined(site?.escalateAfterMinutes, org?.escalateAfterMinutes) ??
      null,
    offlineHours:
      firstDefined(
        site?.thresholds.offlineHours,
        org?.thresholds.offlineHours
      ) ?? DEVICE_OFFLINE_ALERT_HOURS,
    diskUsedPercent:
      firstDefined(
        site?.thresholds.diskUsedPercent,
        org?.thresholds.diskUsedPercent
      ) ?? DISK_FULL_USED_PERCENT_DEFAULT,
    diskFreeBytes:
      firstDefined(
        site?.thresholds.diskFreeBytes,
        org?.thresholds.diskFreeBytes
      ) ?? DISK_FULL_FREE_BYTES_DEFAULT,
    agentStaleMinutes:
      firstDefined(
        site?.thresholds.agentStaleMinutes,
        org?.thresholds.agentStaleMinutes
      ) ?? AGENT_STALE_MINUTES_DEFAULT,
    source,
  }
}

export function pickEffectiveAlertPolicy(
  rows: AlertPolicyFields[],
  kind: AlertKind,
  organizationId: string | null | undefined,
  siteId: string | null | undefined
): EffectiveAlertPolicy {
  if (!organizationId) {
    return resolveEffectiveAlertPolicy(kind, {})
  }
  const orgPolicy =
    rows.find(
      (row) =>
        row.organizationId === organizationId &&
        row.siteId === null &&
        row.kind === kind
    ) ?? null
  const sitePolicy = siteId
    ? (rows.find(
        (row) =>
          row.organizationId === organizationId &&
          row.siteId === siteId &&
          row.kind === kind
      ) ?? null)
    : null
  return resolveEffectiveAlertPolicy(kind, { sitePolicy, orgPolicy })
}

export function isAlertSnoozed(
  snoozedUntil: Date | null | undefined,
  now: Date
) {
  return Boolean(snoozedUntil && snoozedUntil.getTime() > now.getTime())
}

/**
 * Escalation only fires for open, unsnoozed alerts that have not already
 * been escalated, are not inside an active maintenance window, are not
 * held for closed site hours, and whose effective policy has a due delay.
 */
export function shouldEscalateAlert(
  alert: EscalationCandidate,
  policy: EffectiveAlertPolicy,
  now: Date
) {
  if (alert.status !== "open") return false
  if (alert.escalatedAt) return false
  if (alert.inMaintenanceWindow) return false
  if (alert.inClosedHours) return false
  if (isAlertSnoozed(alert.snoozedUntil, now)) return false
  if (policy.escalateAfterMinutes == null) return false
  if (policy.escalateAfterMinutes < 1) return false
  const dueAt =
    alert.firstSeenAt.getTime() + policy.escalateAfterMinutes * 60_000
  return now.getTime() >= dueAt
}

/**
 * Outbox deliveries are never created for held alerts. Opened and
 * escalated events also stay quiet while a snooze is in effect.
 */
export function shouldEnqueueAlertNotification(
  alert: {
    status: AlertStatus
    snoozedUntil?: Date | null
  },
  event: "alert.opened" | "alert.resolved" | "alert.escalated",
  now: Date
) {
  if (alert.status === "suppressed") return false
  if (event === "alert.escalated") {
    return alert.status === "open" && !isAlertSnoozed(alert.snoozedUntil, now)
  }
  if (event === "alert.opened") {
    return alert.status === "open" && !isAlertSnoozed(alert.snoozedUntil, now)
  }
  return alert.status === "resolved"
}

export function selectAlertsToEscalate(
  alerts: EscalationCandidate[],
  resolvePolicy: (alert: EscalationCandidate) => EffectiveAlertPolicy,
  now: Date
) {
  return alerts.filter((alert) =>
    shouldEscalateAlert(alert, resolvePolicy(alert), now)
  )
}

export function shouldAutoResolveConcentratorProbe(
  alert: {
    kind: AlertKind
    status: AlertStatus
    lastSeenAt: Date
  },
  now: Date
) {
  if (alert.kind !== "concentrator_probe") return false
  if (alert.status === "resolved") return false
  return (
    now.getTime() - alert.lastSeenAt.getTime() >=
    CONCENTRATOR_PROBE_AUTO_RESOLVE_MS
  )
}
