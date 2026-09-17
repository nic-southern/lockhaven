import { z } from "zod"

import {
  alertKindSchema,
  auditSeveritySchema,
  type AlertKind,
  type AuditSeverity,
  type NotificationDeliveryEvent,
  type PlaybookAction,
} from "@nms/shared"

export {
  notificationChannelTypeSchema,
  notificationChannelTypes,
  notificationDeliveryEventSchema,
  notificationDeliveryEvents,
  notificationDeliveryStatusSchema,
  notificationDeliveryStatuses,
  type NotificationChannelType,
  type NotificationDeliveryEvent,
  type NotificationDeliveryStatus,
} from "@nms/shared"

export const WEBHOOK_PAYLOAD_VERSION = 1

export type EncryptedSecret = {
  ciphertext: string
  iv: string
  authTag: string
}

export const encryptedSecretSchema = z.object({
  ciphertext: z.string().min(1),
  iv: z.string().min(1),
  authTag: z.string().min(1),
})

export const emailChannelConfigSchema = z.object({
  addresses: z.array(z.string().email().max(320)).min(1).max(50),
})

export const webhookChannelConfigSchema = z.object({
  url: z.string().url().max(2048),
  secret: encryptedSecretSchema,
})

export type EmailChannelConfig = z.infer<typeof emailChannelConfigSchema>
export type WebhookChannelConfig = z.infer<typeof webhookChannelConfigSchema>
export type NotificationChannelConfig =
  | EmailChannelConfig
  | WebhookChannelConfig

export type AlertNotificationSnapshot = {
  id: string
  kind: AlertKind
  severity: AuditSeverity
  title: string
  status: string
  organizationId: string | null
  siteId: string | null
  deviceId: string | null
  detail: Record<string, unknown>
}

export type AccessRequestNotificationSnapshot = {
  id: string
  organizationId: string
  siteId: string
  deviceId: string
  deviceName: string
  siteName: string
  requesterName: string
  requesterEmail: string
  reason: string | null
  serviceType: string | null
  expiresAt: string
}

export type PlaybookRunNotificationSnapshot = {
  id: string
  organizationId: string
  siteId: string | null
  alertId: string
  alertKind: AlertKind
  playbookName: string
  action: PlaybookAction
  deviceName: string
  siteName: string | null
  expiresAt: string
}

export type TicketNotificationSnapshot = {
  title: string
  deviceId: string | null
  deviceName: string | null
  siteId: string | null
  siteName: string | null
  technicianName: string
  technicianEmail: string
  sessionId: string | null
  accessRequestId: string | null
  recordingUrl: string | null
  reason: string | null
  notes: string | null
  serviceType: string | null
}

export type AlertTicketContext = {
  deviceName?: string | null
  hostname?: string | null
  siteName?: string | null
  assetId?: string | null
  assetTag?: string | null
}

export type WebhookEnvelope = {
  version: typeof WEBHOOK_PAYLOAD_VERSION
  event: NotificationDeliveryEvent
  occurredAt: string
  alert: AlertNotificationSnapshot | null
  accessRequest: AccessRequestNotificationSnapshot | null
  playbookRun: PlaybookRunNotificationSnapshot | null
  ticket: TicketNotificationSnapshot | null
}

export function buildWebhookEnvelope(input: {
  event: NotificationDeliveryEvent
  occurredAt?: Date
  alert?: AlertNotificationSnapshot | null
  accessRequest?: AccessRequestNotificationSnapshot | null
  playbookRun?: PlaybookRunNotificationSnapshot | null
  ticket?: TicketNotificationSnapshot | null
}): WebhookEnvelope {
  return {
    version: WEBHOOK_PAYLOAD_VERSION,
    event: input.event,
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    alert: input.alert ?? null,
    accessRequest: input.accessRequest ?? null,
    playbookRun: input.playbookRun ?? null,
    ticket: input.ticket ?? null,
  }
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

/** Names the tickets ingest reads from `alert.detail`. */
export function mergeAlertTicketContext(
  detail: Record<string, unknown>,
  context: AlertTicketContext = {}
): Record<string, unknown> {
  const deviceName =
    nonEmptyString(context.deviceName) ??
    nonEmptyString(detail.deviceName) ??
    nonEmptyString(detail.device)
  const hostname =
    nonEmptyString(context.hostname) ?? nonEmptyString(detail.hostname)
  const siteName =
    nonEmptyString(context.siteName) ??
    nonEmptyString(detail.siteName) ??
    nonEmptyString(detail.site)
  const assetId =
    nonEmptyString(context.assetId) ?? nonEmptyString(detail.assetId)
  const assetTag =
    nonEmptyString(context.assetTag) ?? nonEmptyString(detail.assetTag)

  return {
    ...detail,
    ...(deviceName ? { deviceName } : {}),
    ...(hostname ? { hostname } : {}),
    ...(siteName ? { siteName } : {}),
    ...(assetId ? { assetId } : {}),
    ...(assetTag ? { assetTag } : {}),
  }
}

export function serializeWebhookBody(envelope: WebhookEnvelope) {
  return JSON.stringify(envelope)
}

export const alertSnapshotSchema = z.object({
  id: z.string().uuid(),
  kind: alertKindSchema,
  severity: auditSeveritySchema,
  title: z.string(),
  status: z.string(),
  organizationId: z.string().uuid().nullable(),
  siteId: z.string().uuid().nullable(),
  deviceId: z.string().uuid().nullable(),
  detail: z.record(z.string(), z.unknown()),
})
