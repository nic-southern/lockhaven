import { z } from "zod"

import {
  alertKindSchema,
  auditSeveritySchema,
  type AlertKind,
  type AuditSeverity,
  type NotificationDeliveryEvent,
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

export type WebhookEnvelope = {
  version: typeof WEBHOOK_PAYLOAD_VERSION
  event: NotificationDeliveryEvent
  occurredAt: string
  alert: AlertNotificationSnapshot | null
  accessRequest: AccessRequestNotificationSnapshot | null
}

export function buildWebhookEnvelope(input: {
  event: NotificationDeliveryEvent
  occurredAt?: Date
  alert?: AlertNotificationSnapshot | null
  accessRequest?: AccessRequestNotificationSnapshot | null
}): WebhookEnvelope {
  return {
    version: WEBHOOK_PAYLOAD_VERSION,
    event: input.event,
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    alert: input.alert ?? null,
    accessRequest: input.accessRequest ?? null,
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
