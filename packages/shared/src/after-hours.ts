import { z } from "zod"

import { DEVICE_ONLINE_WINDOW_MS } from "./domain"
import type { DeviceCommandStatus } from "./fleet"
import type { PlaybookRunStatus, PlaybookSkipReason } from "./playbooks"
import { siteOpenState, type SiteHoursFields } from "./site-hours"
import type { AgentCommandKind } from "./telemetry"

/**
 * After-close maintenance runs the same closed command whitelist as every
 * other Hub -> agent path, in a fixed order: update the agent first, then
 * restart the device once the update has settled. Nothing else is dispatched.
 */
export const afterHoursSteps = [
  "update",
  "reboot",
] as const satisfies readonly AgentCommandKind[]
export type AfterHoursStep = (typeof afterHoursSteps)[number]

export const AFTER_HOURS_START_AFTER_MINUTES_DEFAULT = 30
export const AFTER_HOURS_START_AFTER_MINUTES_MAX = 720
/** Do not start a run when the floor reopens sooner than this. */
export const AFTER_HOURS_MIN_REMAINING_MINUTES = 60
/** A sent update that is never acknowledged still lets the restart proceed after this long. */
export const AFTER_HOURS_UPDATE_SETTLE_MINUTES = 30
/** A device must have talked to Hub this recently to receive after-close work. */
export const AFTER_HOURS_REACHABLE_WINDOW_MS = Math.max(
  DEVICE_ONLINE_WINDOW_MS,
  10 * 60 * 1000
)
const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000
const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS

export const afterHoursRunStatuses = [
  "pending_approval",
  "running",
  "completed",
  "denied",
  "expired",
  "cancelled",
] as const
export type AfterHoursRunStatus = (typeof afterHoursRunStatuses)[number]
export const afterHoursRunStatusSchema = z.enum(afterHoursRunStatuses)

export const afterHoursRunStatusLabels: Record<AfterHoursRunStatus, string> = {
  pending_approval: "Needs review",
  running: "In progress",
  completed: "Completed",
  denied: "Declined",
  expired: "Expired",
  cancelled: "Cancelled",
}

export const afterHoursScheduleInputSchema = z.object({
  siteId: z.string().uuid(),
  enabled: z.boolean(),
  startAfterMinutes: z
    .number()
    .int()
    .min(0)
    .max(AFTER_HOURS_START_AFTER_MINUTES_MAX)
    .default(AFTER_HOURS_START_AFTER_MINUTES_DEFAULT),
})
export type AfterHoursScheduleInput = z.infer<
  typeof afterHoursScheduleInputSchema
>

export type AfterHoursRunSummary = {
  devices: number
  updated: number
  restarted: number
  skippedOffline: number
  skippedArchived: number
  cancelled: number
  notReached: number
}

function floorToMinute(ms: number) {
  return Math.floor(ms / MINUTE_MS) * MINUTE_MS
}

/**
 * Binary-search the minute where the floor flips between `openMs` (open) and
 * `closedMs` (closed). Both bounds are minute-aligned and at most an hour apart,
 * so at most one transition is expected between them.
 */
function refineTransition(
  site: SiteHoursFields,
  openMs: number,
  closedMs: number
) {
  let open = openMs
  let closed = closedMs
  while (Math.abs(closed - open) > MINUTE_MS) {
    const mid = floorToMinute((open + closed) / 2)
    if (mid === open || mid === closed) break
    if (siteOpenState(site, new Date(mid)) === true) {
      open = mid
    } else {
      closed = mid
    }
  }
  return { open, closed }
}

/**
 * When the current closed stretch began: the most recent minute the floor
 * flipped from open to closed. `null` while open, without a schedule, or when
 * the site has been closed longer than the lookback (a long holiday closure).
 */
export function siteClosedSince(
  site: SiteHoursFields | null | undefined,
  now: Date
): Date | null {
  if (!site || siteOpenState(site, now) !== false) return null
  const limit = now.getTime() - LOOKBACK_MS
  let closedAt = floorToMinute(now.getTime())
  let probe = closedAt - HOUR_MS
  while (probe >= limit) {
    const state = siteOpenState(site, new Date(probe))
    if (state === null) return null
    if (state === true) {
      return new Date(refineTransition(site, probe, closedAt).closed)
    }
    closedAt = probe
    probe -= HOUR_MS
  }
  return null
}

/**
 * The next minute the floor opens after `now`. `null` while open, without a
 * schedule, or when no opening is found within the lookahead.
 */
export function nextSiteOpenAt(
  site: SiteHoursFields | null | undefined,
  now: Date
): Date | null {
  if (!site || siteOpenState(site, now) !== false) return null
  const limit = now.getTime() + LOOKBACK_MS
  let closedAt = floorToMinute(now.getTime())
  let probe = closedAt + HOUR_MS
  while (probe <= limit) {
    const state = siteOpenState(site, new Date(probe))
    if (state === null) return null
    if (state === true) {
      return new Date(refineTransition(site, probe, closedAt).open)
    }
    closedAt = probe
    probe += HOUR_MS
  }
  return null
}

/** One run per site per closed stretch: the key is the moment the floor closed. */
export function afterHoursWindowKey(closedSince: Date) {
  return closedSince.toISOString()
}

export type AfterHoursSiteDecision =
  | { kind: "disabled" }
  | { kind: "no_schedule" }
  | { kind: "open" }
  | { kind: "not_yet"; startsAt: Date }
  | { kind: "too_close_to_open"; opensAt: Date }
  | { kind: "start"; windowKey: string; closedSince: Date }

export function decideAfterHoursSiteStart(input: {
  enabled: boolean
  siteOpen: boolean | null
  closedSince: Date | null
  nextOpenAt: Date | null
  startAfterMinutes: number
  now: Date
  minRemainingMinutes?: number
}): AfterHoursSiteDecision {
  if (!input.enabled) return { kind: "disabled" }
  if (input.siteOpen === null) return { kind: "no_schedule" }
  if (input.siteOpen === true) return { kind: "open" }
  if (!input.closedSince) return { kind: "no_schedule" }
  const startsAt = new Date(
    input.closedSince.getTime() + input.startAfterMinutes * MINUTE_MS
  )
  if (input.now.getTime() < startsAt.getTime()) {
    return { kind: "not_yet", startsAt }
  }
  const minRemainingMs =
    (input.minRemainingMinutes ?? AFTER_HOURS_MIN_REMAINING_MINUTES) * MINUTE_MS
  if (
    input.nextOpenAt &&
    input.nextOpenAt.getTime() - input.now.getTime() < minRemainingMs
  ) {
    return { kind: "too_close_to_open", opensAt: input.nextOpenAt }
  }
  return {
    kind: "start",
    windowKey: afterHoursWindowKey(input.closedSince),
    closedSince: input.closedSince,
  }
}

/** Approval requests expire at the next opening or the usual review window, whichever is first. */
export function afterHoursApprovalExpiresAt(
  defaultExpiresAt: Date,
  nextOpenAt: Date | null
) {
  if (nextOpenAt && nextOpenAt.getTime() < defaultExpiresAt.getTime()) {
    return nextOpenAt
  }
  return defaultExpiresAt
}

export type AfterHoursDeviceEligibility =
  | { eligible: true }
  | { eligible: false; reason: "device_archived" | "device_offline" }

/**
 * Archived devices are warehoused and never touched. A device must have
 * talked to Hub recently so the queued command reaches it tonight rather than
 * the next time it powers on, which could be during open hours.
 */
export function afterHoursDeviceEligibility(input: {
  archivedAt: Date | string | null | undefined
  status: string
  lastSeenAt: Date | string | null | undefined
  now: Date
  reachableWindowMs?: number
}): AfterHoursDeviceEligibility {
  if (input.archivedAt != null && input.archivedAt !== "") {
    return { eligible: false, reason: "device_archived" }
  }
  if (input.status === "revoked" || input.status === "pending") {
    return { eligible: false, reason: "device_offline" }
  }
  const seen =
    input.lastSeenAt == null ? NaN : new Date(input.lastSeenAt).getTime()
  if (!Number.isFinite(seen)) {
    return { eligible: false, reason: "device_offline" }
  }
  const windowMs = input.reachableWindowMs ?? AFTER_HOURS_REACHABLE_WINDOW_MS
  if (input.now.getTime() - seen > windowMs) {
    return { eligible: false, reason: "device_offline" }
  }
  return { eligible: true }
}

const TERMINAL_COMMAND_STATUSES: ReadonlySet<DeviceCommandStatus> = new Set([
  "succeeded",
  "failed",
  "refused",
  "cancelled",
])

export function isDeviceCommandTerminal(
  status: DeviceCommandStatus | null | undefined
) {
  return Boolean(status && TERMINAL_COMMAND_STATUSES.has(status))
}

export type AfterHoursStepRow = {
  status: PlaybookRunStatus
  skipReason: PlaybookSkipReason | null
  commandStatus: DeviceCommandStatus | null
  commandSentAt: Date | null
}

export type AfterHoursDeviceDecision =
  | { kind: "enqueue"; action: AfterHoursStep }
  | { kind: "skip"; action: AfterHoursStep; reason: PlaybookSkipReason }
  | { kind: "wait" }
  | { kind: "done" }

/**
 * Per device, per closed stretch: queue the update once, wait for it to
 * settle, then queue the restart once. A device that was not reachable when
 * the run started is skipped for the night and is not restarted.
 */
export function decideAfterHoursDeviceStep(input: {
  updateRun: AfterHoursStepRow | null
  rebootRun: AfterHoursStepRow | null
  eligibility: AfterHoursDeviceEligibility
  now: Date
  updateSettleMinutes?: number
}): AfterHoursDeviceDecision {
  if (!input.updateRun) {
    if (!input.eligibility.eligible) {
      return {
        kind: "skip",
        action: "update",
        reason: input.eligibility.reason,
      }
    }
    return { kind: "enqueue", action: "update" }
  }
  if (input.rebootRun) return { kind: "done" }
  if (input.updateRun.status !== "queued") return { kind: "done" }

  const settled =
    isDeviceCommandTerminal(input.updateRun.commandStatus) ||
    (input.updateRun.commandStatus === "sent" &&
      input.updateRun.commandSentAt != null &&
      input.now.getTime() - input.updateRun.commandSentAt.getTime() >=
        (input.updateSettleMinutes ?? AFTER_HOURS_UPDATE_SETTLE_MINUTES) *
          MINUTE_MS)
  if (!settled) return { kind: "wait" }
  if (!input.eligibility.eligible) return { kind: "wait" }
  return { kind: "enqueue", action: "reboot" }
}

export type AfterHoursSummaryRow = {
  deviceId: string | null
  action: string
  status: PlaybookRunStatus
  skipReason: PlaybookSkipReason | null
  commandStatus: DeviceCommandStatus | null
}

/** Outcome counts written to the run and to audit when the stretch ends. */
export function summarizeAfterHoursRun(
  rows: AfterHoursSummaryRow[],
  archivedDevices: number
): AfterHoursRunSummary {
  const devices = new Set(
    rows.map((row) => row.deviceId).filter((id): id is string => Boolean(id))
  )
  const summary: AfterHoursRunSummary = {
    devices: devices.size + archivedDevices,
    updated: 0,
    restarted: 0,
    skippedOffline: 0,
    skippedArchived: archivedDevices,
    cancelled: 0,
    notReached: 0,
  }
  for (const deviceId of devices) {
    const update = rows.find(
      (row) => row.deviceId === deviceId && row.action === "update"
    )
    const reboot = rows.find(
      (row) => row.deviceId === deviceId && row.action === "reboot"
    )
    if (update?.status === "skipped") {
      if (update.skipReason === "device_archived") {
        summary.skippedArchived += 1
      } else {
        summary.skippedOffline += 1
      }
      continue
    }
    if (update?.status === "cancelled" || reboot?.status === "cancelled") {
      summary.cancelled += 1
    }
    if (update?.commandStatus === "succeeded") summary.updated += 1
    if (reboot?.commandStatus === "succeeded") {
      summary.restarted += 1
    } else if (
      reboot?.status !== "cancelled" &&
      update?.status !== "cancelled"
    ) {
      summary.notReached += 1
    }
  }
  return summary
}

/** Every device either finished both steps or was skipped or cancelled. */
export function afterHoursRunIsSettled(rows: AfterHoursSummaryRow[]) {
  const devices = new Set(
    rows.map((row) => row.deviceId).filter((id): id is string => Boolean(id))
  )
  if (devices.size === 0) return true
  for (const deviceId of devices) {
    const update = rows.find(
      (row) => row.deviceId === deviceId && row.action === "update"
    )
    const reboot = rows.find(
      (row) => row.deviceId === deviceId && row.action === "reboot"
    )
    if (!update) return false
    if (update.status === "skipped" || update.status === "cancelled") continue
    if (!reboot) return false
    if (reboot.status === "cancelled" || reboot.status === "skipped") continue
    if (!isDeviceCommandTerminal(reboot.commandStatus)) return false
  }
  return true
}
