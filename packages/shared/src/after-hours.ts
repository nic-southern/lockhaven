import { z } from "zod"

import { DEVICE_ONLINE_WINDOW_MS } from "./domain"
import { agentCommandKindLabels, type DeviceCommandStatus } from "./fleet"
import {
  parsePlaybookAction,
  playbookActionSchema,
  type PlaybookAction,
} from "./playbooks"
import { siteOpenState, type SiteHoursFields } from "./site-hours"
import { type AgentCommandKind } from "./telemetry"

/**
 * After-hours runs dispatch the same closed Hub→agent whitelist as playbooks
 * and fleet. Steps outside it are dropped, never executed.
 */
export const AFTER_HOURS_DEFAULT_STEPS: readonly PlaybookAction[] = [
  "update",
  "reboot",
]

export const AFTER_HOURS_MAX_STEPS = 3

/**
 * A site closes at most once per venue day. Anything sooner than this after
 * the last run is treated as the same close (an hours edit, a worker restart).
 */
export const AFTER_HOURS_MIN_INTERVAL_MS = 8 * 60 * 60 * 1000

/**
 * A device that was just told to restart drops off the tunnel on purpose.
 * Offline and flapping stay quiet for this long after the restart is sent.
 */
export const PLANNED_REBOOT_GRACE_MS = 20 * 60 * 1000

export const afterHoursStepsSchema = z
  .array(playbookActionSchema)
  .max(AFTER_HOURS_MAX_STEPS)
  .transform((steps) => sanitizeAfterHoursSteps(steps))

export const afterHoursRunStatuses = [
  "pending_approval",
  "queued",
  "skipped",
  "denied",
  "expired",
] as const
export type AfterHoursRunStatus = (typeof afterHoursRunStatuses)[number]
export const afterHoursRunStatusSchema = z.enum(afterHoursRunStatuses)

export const afterHoursRunStatusLabels: Record<AfterHoursRunStatus, string> = {
  pending_approval: "Needs review",
  queued: "Queued",
  skipped: "Skipped",
  denied: "Declined",
  expired: "Expired",
}

export const afterHoursDeviceOutcomes = [
  "queued",
  "archived",
  "offline",
  "revoked",
  "not_enrolled",
  "open_command",
] as const
export type AfterHoursDeviceOutcome = (typeof afterHoursDeviceOutcomes)[number]

export const afterHoursDeviceOutcomeLabels: Record<
  AfterHoursDeviceOutcome,
  string
> = {
  queued: "Queued",
  archived: "Archived",
  offline: "Already offline",
  revoked: "Access revoked",
  not_enrolled: "Not enrolled",
  open_command: "Same action already waiting",
}

export type AfterHoursDeviceResult = {
  deviceId: string
  deviceName: string
  outcome: AfterHoursDeviceOutcome
  commandIds: string[]
}

export const afterHoursStepLabels: Record<PlaybookAction, string> =
  agentCommandKindLabels

/** Keep only whitelisted steps, in the order given, without repeats. */
export function sanitizeAfterHoursSteps(
  values: readonly unknown[] | null | undefined
): PlaybookAction[] {
  if (!values) return []
  const steps: PlaybookAction[] = []
  for (const value of values) {
    if (typeof value !== "string") continue
    const step = parsePlaybookAction(value)
    if (!step || steps.includes(step)) continue
    steps.push(step)
    if (steps.length >= AFTER_HOURS_MAX_STEPS) break
  }
  return steps
}

export type AfterHoursSiteFields = SiteHoursFields & {
  afterHoursEnabled: boolean
  afterHoursSteps: readonly unknown[] | null | undefined
}

export type AfterHoursDecision =
  | { kind: "fire"; steps: PlaybookAction[]; open: false }
  | {
      kind: "idle"
      reason:
        | "opted_out"
        | "no_steps"
        | "hours_not_set"
        | "no_previous_state"
        | "still_open"
        | "still_closed"
        | "just_ran"
      open: boolean | null
    }

/**
 * Fires exactly once per close: only on an open→closed transition, and only
 * when nothing already ran for this close. A site that is already closed
 * when it opts in (or on the first tick after a restart) waits for the next
 * close. Holidays closed all day never transition, so they never fire.
 */
export function decideAfterHoursRun(input: {
  site: AfterHoursSiteFields
  previousOpen: boolean | null | undefined
  lastRunAt: Date | null | undefined
  now: Date
}): AfterHoursDecision {
  const open = siteOpenState(input.site, input.now)
  if (!input.site.afterHoursEnabled) {
    return { kind: "idle", reason: "opted_out", open }
  }
  const steps = sanitizeAfterHoursSteps(input.site.afterHoursSteps)
  if (steps.length === 0) {
    return { kind: "idle", reason: "no_steps", open }
  }
  if (open === null) {
    return { kind: "idle", reason: "hours_not_set", open }
  }
  if (open) {
    return { kind: "idle", reason: "still_open", open }
  }
  if (input.previousOpen == null) {
    return { kind: "idle", reason: "no_previous_state", open }
  }
  if (input.previousOpen === false) {
    return { kind: "idle", reason: "still_closed", open }
  }
  if (
    input.lastRunAt &&
    input.now.getTime() - input.lastRunAt.getTime() <
      AFTER_HOURS_MIN_INTERVAL_MS
  ) {
    return { kind: "idle", reason: "just_ran", open }
  }
  return { kind: "fire", steps, open: false }
}

export type AfterHoursDeviceCandidate = {
  id: string
  displayName: string | null
  hostname: string | null
  status: string
  archivedAt: Date | null
  lastSeenAt: Date | null
  lastHandshakeAt: Date | null
  revokedAt: Date | null
}

export type AfterHoursDeviceSelection = {
  eligible: AfterHoursDeviceCandidate[]
  skipped: Array<{
    device: AfterHoursDeviceCandidate
    outcome: Exclude<AfterHoursDeviceOutcome, "queued" | "open_command">
  }>
}

function recentlySeen(at: Date | null, now: Date) {
  return at !== null && now.getTime() - at.getTime() < DEVICE_ONLINE_WINDOW_MS
}

/**
 * A device is reachable when it checked in or handshook recently. Devices
 * that are archived, revoked, never enrolled, or already offline are left
 * alone: there is nothing to update or restart, and telling an offline
 * device to restart only queues a surprise for whenever it comes back.
 */
export function selectAfterHoursDevices(
  devices: readonly AfterHoursDeviceCandidate[],
  now: Date
): AfterHoursDeviceSelection {
  const selection: AfterHoursDeviceSelection = { eligible: [], skipped: [] }
  for (const device of devices) {
    if (device.archivedAt) {
      selection.skipped.push({ device, outcome: "archived" })
      continue
    }
    if (device.revokedAt || device.status === "revoked") {
      selection.skipped.push({ device, outcome: "revoked" })
      continue
    }
    if (device.status === "pending") {
      selection.skipped.push({ device, outcome: "not_enrolled" })
      continue
    }
    if (
      !recentlySeen(device.lastSeenAt, now) &&
      !recentlySeen(device.lastHandshakeAt, now)
    ) {
      selection.skipped.push({ device, outcome: "offline" })
      continue
    }
    selection.eligible.push(device)
  }
  return selection
}

export function afterHoursDeviceName(device: {
  displayName: string | null
  hostname: string | null
}) {
  return device.displayName || device.hostname || "Device"
}

export type PlannedRebootCommand = {
  kind: string
  status: DeviceCommandStatus | string
  sentAt: Date | null
  completedAt: Date | null
  createdAt?: Date | null
}

/**
 * When the most recent Hub-issued restart was handed to the agent inside the
 * grace window, the device is expected to drop off and come back. Only the
 * closed whitelist can produce these rows, so any `reboot` counts as planned.
 */
export function plannedRebootGraceUntil(
  commands: readonly PlannedRebootCommand[],
  now: Date,
  graceMs = PLANNED_REBOOT_GRACE_MS
): Date | null {
  let latest: number | null = null
  for (const command of commands) {
    if ((command.kind as AgentCommandKind) !== "reboot") continue
    if (command.status === "pending" || command.status === "cancelled") {
      continue
    }
    if (command.status === "refused" || command.status === "failed") continue
    // The agent restarts right after the check-in that delivered the command;
    // the acknowledgement only arrives once the device is back.
    const at = command.sentAt ?? command.completedAt
    if (!at) continue
    const until = at.getTime() + graceMs
    if (until <= now.getTime()) continue
    if (latest === null || until > latest) latest = until
  }
  return latest === null ? null : new Date(latest)
}

export function inPlannedRebootGrace(
  commands: readonly PlannedRebootCommand[],
  now: Date,
  graceMs = PLANNED_REBOOT_GRACE_MS
) {
  return plannedRebootGraceUntil(commands, now, graceMs) !== null
}

export function afterHoursStepsSummary(steps: readonly PlaybookAction[]) {
  if (steps.length === 0) return "No steps"
  return steps.map((step) => afterHoursStepLabels[step]).join(", then ")
}
