import { z } from "zod"

import { alertKindSchema, type AlertKind, type AlertStatus } from "./events"
import { agentCommandKindLabels, isAgentCommandKind } from "./fleet"
import { accessRequestTtlMs } from "./session-accountability"
import { shouldWaitForSiteClose } from "./site-hours"
import { agentCommandKinds, type AgentCommandKind } from "./telemetry"

/** Hub playbooks may only dispatch the same closed command whitelist as fleet. */
export const playbookActions = agentCommandKinds
export type PlaybookAction = AgentCommandKind
export const playbookActionSchema = z.enum(playbookActions)

export const playbookRunStatuses = [
  "pending_approval",
  "queued",
  "skipped",
  "denied",
  "cancelled",
  "expired",
  "failed",
] as const
export type PlaybookRunStatus = (typeof playbookRunStatuses)[number]
export const playbookRunStatusSchema = z.enum(playbookRunStatuses)

export const playbookSkipReasons = [
  "no_device",
  "unknown_action",
  "cooldown",
  "open_command",
  "not_open",
  "already_handled",
] as const
export type PlaybookSkipReason = (typeof playbookSkipReasons)[number]
export const playbookSkipReasonSchema = z.enum(playbookSkipReasons)

export const PLAYBOOK_COOLDOWN_MINUTES_DEFAULT = 60
export const PLAYBOOK_COOLDOWN_MINUTES_MAX = 10_080
export const PLAYBOOK_NAME_MAX = 80

export const playbookNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(PLAYBOOK_NAME_MAX)

export const playbookCooldownMinutesSchema = z
  .number()
  .int()
  .min(0)
  .max(PLAYBOOK_COOLDOWN_MINUTES_MAX)
  .default(PLAYBOOK_COOLDOWN_MINUTES_DEFAULT)

export const playbookActionLabels: Record<PlaybookAction, string> =
  agentCommandKindLabels

export const playbookRunStatusLabels: Record<PlaybookRunStatus, string> = {
  pending_approval: "Needs review",
  queued: "Queued",
  skipped: "Skipped",
  denied: "Declined",
  cancelled: "Cancelled",
  expired: "Expired",
  failed: "Failed",
}

export const playbookSkipReasonLabels: Record<PlaybookSkipReason, string> = {
  no_device: "No device on this alert",
  unknown_action: "That action is not allowed",
  cooldown: "Recently ran on this device",
  open_command: "The same action is already waiting",
  not_open: "Alert is not open",
  already_handled: "Already handled",
}

export function isPlaybookAction(value: string): value is PlaybookAction {
  return isAgentCommandKind(value)
}

/**
 * Refuse anything outside the closed whitelist, including shell, SSH, or
 * free-form script strings. Expanding the list is a Hub + client contract change.
 */
export function parsePlaybookAction(
  value: string | null | undefined
): PlaybookAction | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!isPlaybookAction(trimmed)) return null
  return trimmed
}

export type PlaybookMatchFields = {
  id?: string
  organizationId: string
  siteId: string | null
  alertKind: AlertKind
  action: string
  enabled: boolean
  requireApproval: boolean
  cooldownMinutes: number
}

/**
 * Site playbooks override organization playbooks for the same alert kind,
 * including when the site playbook is off (no fall-through).
 */
export function pickMatchingPlaybook(
  playbooks: PlaybookMatchFields[],
  alertKind: AlertKind,
  organizationId: string | null | undefined,
  siteId: string | null | undefined
): PlaybookMatchFields | null {
  if (!organizationId) return null
  const scoped = playbooks.filter(
    (playbook) =>
      playbook.alertKind === alertKind &&
      playbook.organizationId === organizationId &&
      (playbook.siteId === null || playbook.siteId === siteId)
  )
  const sitePlaybook = siteId
    ? scoped.find((playbook) => playbook.siteId === siteId)
    : undefined
  const chosen =
    sitePlaybook ?? scoped.find((playbook) => playbook.siteId === null) ?? null
  if (!chosen || !chosen.enabled) return null
  return chosen
}

export type PlaybookDecision =
  | { kind: "skip"; reason: PlaybookSkipReason }
  | { kind: "wait"; reason: "floor_open" }
  | { kind: "queue" }
  | { kind: "approve" }

const ACTIONABLE_ALERT_STATUSES: ReadonlySet<AlertStatus> = new Set([
  "open",
  "acknowledged",
])

const HANDLED_RUN_STATUSES: ReadonlySet<PlaybookRunStatus> = new Set([
  "pending_approval",
  "queued",
  "skipped",
  "denied",
  "cancelled",
  "failed",
])

export function isAlertActionableForPlaybook(
  status: AlertStatus,
  snoozedUntil: Date | null | undefined,
  now: Date
) {
  if (!ACTIONABLE_ALERT_STATUSES.has(status)) return false
  if (snoozedUntil && snoozedUntil.getTime() > now.getTime()) return false
  return true
}

export function isPlaybookInCooldown(
  lastQueuedAt: Date | null | undefined,
  cooldownMinutes: number,
  now: Date
) {
  if (!lastQueuedAt || cooldownMinutes <= 0) return false
  const elapsedMs = now.getTime() - lastQueuedAt.getTime()
  return elapsedMs < cooldownMinutes * 60 * 1000
}

export function decidePlaybookAction(input: {
  action: string
  requireApproval: boolean
  alertStatus: AlertStatus
  snoozedUntil: Date | null | undefined
  deviceId: string | null | undefined
  now: Date
  lastQueuedAt: Date | null | undefined
  cooldownMinutes: number
  hasOpenCommand: boolean
  existingRunStatus: PlaybookRunStatus | null | undefined
  siteOpen?: boolean | null
}): PlaybookDecision {
  if (
    input.existingRunStatus &&
    HANDLED_RUN_STATUSES.has(input.existingRunStatus)
  ) {
    return { kind: "skip", reason: "already_handled" }
  }
  if (
    !isAlertActionableForPlaybook(
      input.alertStatus,
      input.snoozedUntil,
      input.now
    )
  ) {
    return { kind: "skip", reason: "not_open" }
  }
  if (!parsePlaybookAction(input.action)) {
    return { kind: "skip", reason: "unknown_action" }
  }
  if (!input.deviceId) {
    return { kind: "skip", reason: "no_device" }
  }
  if (shouldWaitForSiteClose(input.action, input.siteOpen)) {
    return { kind: "wait", reason: "floor_open" }
  }
  if (
    isPlaybookInCooldown(input.lastQueuedAt, input.cooldownMinutes, input.now)
  ) {
    return { kind: "skip", reason: "cooldown" }
  }
  if (input.hasOpenCommand) {
    return { kind: "skip", reason: "open_command" }
  }
  return input.requireApproval ? { kind: "approve" } : { kind: "queue" }
}

export function playbookApprovalExpiresAt(now: Date, hours?: number) {
  return new Date(now.getTime() + accessRequestTtlMs(hours))
}

export function effectivePlaybookRunStatus(
  status: PlaybookRunStatus,
  expiresAt: Date | null | undefined,
  now: Date
): PlaybookRunStatus {
  if (
    status === "pending_approval" &&
    expiresAt &&
    expiresAt.getTime() <= now.getTime()
  ) {
    return "expired"
  }
  return status
}

export function canDecidePlaybookRun(
  status: PlaybookRunStatus,
  expiresAt: Date | null | undefined,
  now: Date
) {
  return (
    effectivePlaybookRunStatus(status, expiresAt, now) === "pending_approval"
  )
}

export const playbookInputSchema = z.object({
  organizationId: z.string().uuid(),
  siteId: z.string().uuid().nullable().optional(),
  name: playbookNameSchema,
  alertKind: alertKindSchema,
  action: playbookActionSchema,
  enabled: z.boolean().default(true),
  requireApproval: z.boolean().default(false),
  cooldownMinutes: playbookCooldownMinutesSchema,
})
