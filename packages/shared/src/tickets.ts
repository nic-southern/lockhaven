import { z } from "zod"

import type { AuditSeverity } from "./events"

export const ticketStatuses = ["open", "in_progress", "done"] as const
export type TicketStatus = (typeof ticketStatuses)[number]
export const ticketStatusSchema = z.enum(ticketStatuses)

export const ticketStatusLabels: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
}

export const ticketPriorities = ["low", "medium", "high", "critical"] as const
export type TicketPriority = (typeof ticketPriorities)[number]
export const ticketPrioritySchema = z.enum(ticketPriorities)

export const ticketPriorityLabels: Record<TicketPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
}

/** Statuses that still need work. */
export const openTicketStatuses = ["open", "in_progress"] as const
export type OpenTicketStatus = (typeof openTicketStatuses)[number]

export function isOpenTicketStatus(
  status: TicketStatus
): status is OpenTicketStatus {
  return status === "open" || status === "in_progress"
}

/**
 * When a linked alert resolves, any Hub ticket still open moves to Done.
 */
export function statusAfterAlertResolved(status: TicketStatus): TicketStatus {
  return isOpenTicketStatus(status) ? "done" : status
}

/** Map alert severity onto ticket priority for create-from-alert. */
export function priorityFromAlertSeverity(
  severity: AuditSeverity | null | undefined
): TicketPriority {
  switch (severity) {
    case "critical":
      return "critical"
    case "warning":
      return "high"
    case "notice":
      return "medium"
    case "info":
    default:
      return "low"
  }
}

export function ticketTitleFromAlert(input: {
  title: string
  kindLabel?: string | null
}): string {
  const title = input.title.trim()
  if (title.length > 0) return title.slice(0, 240)
  const kind = input.kindLabel?.trim()
  if (kind) return kind.slice(0, 240)
  return "Alert"
}

/**
 * Whether create-from-alert should insert a new row. One open Hub ticket per
 * alert is enough; Done tickets do not block a new one if the alert reopens.
 */
export function shouldCreateTicketForAlert(
  existingStatuses: readonly TicketStatus[]
): boolean {
  return !existingStatuses.some((status) => isOpenTicketStatus(status))
}

export const ticketCommentBodySchema = z.string().trim().min(1).max(8000)

export const createTicketInputSchema = z.object({
  organizationId: z.string().uuid(),
  siteId: z.string().uuid().nullable().optional(),
  deviceId: z.string().uuid().nullable().optional(),
  alertId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(240),
  priority: ticketPrioritySchema.optional(),
  body: z.string().trim().max(8000).nullable().optional(),
})
