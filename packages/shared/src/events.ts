import { z } from "zod"

import type { AuditEventType } from "./domain"

/**
 * Severity attached to every audit event so the Activity log can be
 * filtered to "things that need a human" without knowing every event type.
 */
export const auditSeverities = [
  "info",
  "notice",
  "warning",
  "critical",
] as const

export type AuditSeverity = (typeof auditSeverities)[number]

export const auditSeveritySchema = z.enum(auditSeverities)

const severityByEventType: Partial<Record<AuditEventType, AuditSeverity>> = {
  admin_login_failed: "warning",
  two_factor_reset: "notice",
  passkey_removed: "notice",
  password_changed: "notice",
  session_revoked: "notice",
  user_invited: "notice",
  user_role_changed: "notice",
  user_membership_changed: "notice",
  user_site_access_changed: "notice",
  user_suspended: "warning",
  user_password_reset_forced: "notice",
  credential_revealed: "notice",
  remote_session_terminated: "notice",
  device_revoked: "warning",
  device_deleted: "warning",
  vpn_peer_down: "notice",
  vpn_endpoint_changed: "notice",
  firewall_sync_failed: "critical",
  device_enroll_failed: "warning",
  device_check_in_failed: "warning",
  device_check_in_secret_mismatch: "critical",
  device_check_in_hostname_mismatch: "warning",
  device_hostname_changed: "notice",
  device_hostname_change_allowed: "notice",
  enrollment_token_revoked: "notice",
  route_policy_deleted: "notice",
  route_policy_devices_reassigned: "notice",
  alert_raised: "warning",
  alert_escalated: "warning",
  alert_snoozed: "notice",
  alert_policy_updated: "notice",
  maintenance_window_created: "notice",
  maintenance_window_updated: "notice",
  maintenance_window_deleted: "notice",
  notification_channel_created: "notice",
  notification_channel_updated: "notice",
  notification_channel_deleted: "notice",
  api_key_created: "notice",
  api_key_revoked: "notice",
  access_request_created: "notice",
  access_request_approved: "notice",
  access_request_denied: "notice",
  sso_settings_updated: "notice",
  sso_login_failed: "warning",
}

/** Default severity for an event type; explicit overrides win at write time. */
export function severityForEvent(eventType: AuditEventType): AuditSeverity {
  return severityByEventType[eventType] ?? "info"
}

export const alertKinds = [
  "new_endpoint",
  "peer_flapping",
  "device_offline",
  "firewall_sync_failed",
  "concentrator_probe",
  "check_in_secret_mismatch",
] as const

export type AlertKind = (typeof alertKinds)[number]

export const alertKindSchema = z.enum(alertKinds)

export const alertStatuses = [
  "open",
  "acknowledged",
  "suppressed",
  "resolved",
] as const

export type AlertStatus = (typeof alertStatuses)[number]

export const alertStatusSchema = z.enum(alertStatuses)

export const alertKindLabels: Record<AlertKind, string> = {
  new_endpoint: "New public endpoint",
  peer_flapping: "Tunnel flapping",
  device_offline: "Device offline",
  firewall_sync_failed: "Firewall sync failed",
  concentrator_probe: "Unexpected traffic to the hub",
  check_in_secret_mismatch: "Check-in secret rejected",
}

export const alertKindDefaultSeverity: Record<AlertKind, AuditSeverity> = {
  new_endpoint: "notice",
  peer_flapping: "warning",
  device_offline: "warning",
  firewall_sync_failed: "critical",
  concentrator_probe: "warning",
  check_in_secret_mismatch: "critical",
}

export const notificationChannelTypes = ["email", "webhook"] as const
export type NotificationChannelType = (typeof notificationChannelTypes)[number]
export const notificationChannelTypeSchema = z.enum(notificationChannelTypes)

export const notificationDeliveryEvents = [
  "alert.opened",
  "alert.resolved",
  "alert.escalated",
  "access.requested",
  "channel.test",
] as const
export type NotificationDeliveryEvent =
  (typeof notificationDeliveryEvents)[number]
export const notificationDeliveryEventSchema = z.enum(
  notificationDeliveryEvents
)

export const notificationDeliveryStatuses = [
  "pending",
  "sending",
  "sent",
  "failed",
] as const
export type NotificationDeliveryStatus =
  (typeof notificationDeliveryStatuses)[number]
export const notificationDeliveryStatusSchema = z.enum(
  notificationDeliveryStatuses
)

/** Hours a device must be silent before an offline alert opens. */
export const DEVICE_OFFLINE_ALERT_HOURS = 24

/** Hours a concentrator-probe alert may stay quiet before it auto-resolves. */
export const CONCENTRATOR_PROBE_AUTO_RESOLVE_HOURS = 24

/** Up/down transitions within the window that count as flapping. */
export const PEER_FLAP_THRESHOLD = 4
export const PEER_FLAP_WINDOW_MS = 15 * 60 * 1000

/** Peer samples older than this are pruned by the worker. */
export const PEER_SAMPLE_RETENTION_DAYS = 90

/** Minimum spacing between routine (non-transition) peer samples. */
export const PEER_SAMPLE_INTERVAL_MS = 60 * 60 * 1000

/** Raw connection events are pruned after this many days by default. */
export const FLOW_RETENTION_DAYS_DEFAULT = 30

/** Daily connection rollups are pruned after this many days by default. */
export const FLOW_ROLLUP_RETENTION_DAYS_DEFAULT = 365

export const connectionVerdicts = ["accept", "drop"] as const
export type ConnectionVerdict = (typeof connectionVerdicts)[number]

/**
 * Where a logged connection was headed: `hub` for traffic addressed to the
 * concentrator itself, `forward` for traffic routed on to another peer or
 * allowed network.
 */
export const connectionDirections = ["hub", "forward"] as const
export type ConnectionDirection = (typeof connectionDirections)[number]

export const connectionProtocols = ["tcp", "udp", "icmp", "other"] as const
export type ConnectionProtocol = (typeof connectionProtocols)[number]
