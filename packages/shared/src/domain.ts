import { z } from "zod"

import { checkInModulesSchema } from "./agent-modules"
import {
  checkInCommandResultsSchema,
  checkInMetricsSchema,
  checkInPackagesSchema,
  checkInTitlesSchema,
} from "./telemetry"

export const deviceStatuses = [
  "pending",
  "enrolled",
  "vpn_online",
  "service_online",
  "degraded",
  "offline",
  "revoked",
] as const

export type DeviceStatus = (typeof deviceStatuses)[number]

export const serviceTypes = ["vnc", "rdp", "ssh", "winrm_https"] as const
export type ServiceType = (typeof serviceTypes)[number]

export const permissions = [
  "device:view",
  "device:create",
  "device:update",
  "device:enroll",
  "device:revoke_vpn",
  "device:start_vnc",
  "device:start_rdp",
  "device:start_ssh",
  "organization:admin",
  "site:admin",
  "audit:view",
  "vpn:admin_profile",
  "credential:reveal",
  "device:delete",
  "user:manage",
] as const

export type Permission = (typeof permissions)[number]

export const platformRoles = ["owner", "admin", "member"] as const
export type PlatformRole = (typeof platformRoles)[number]

export const organizationRoles = [
  "owner",
  "admin",
  "operator",
  "technician",
  "viewer",
] as const
export type OrganizationRole = (typeof organizationRoles)[number]

export const siteRoles = ["operator", "technician", "viewer"] as const
export type SiteRole = (typeof siteRoles)[number]

export const membershipStatuses = ["active", "suspended"] as const
export type MembershipStatus = (typeof membershipStatuses)[number]

export const uiScopes = ["admin", "technician"] as const
export type UiScope = (typeof uiScopes)[number]

export const MIN_PASSWORD_LENGTH = 12

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, "Use at least 12 characters.")
  .max(256)

export const siteGrantSchema = z.object({
  siteId: z.string().uuid(),
  role: z.enum(siteRoles),
})
export type SiteGrant = z.infer<typeof siteGrantSchema>

export const userInviteSchema = z.object({
  email: z.string().email().max(320),
  name: z.string().trim().min(1).max(120),
  platformRole: z.enum(platformRoles).default("member"),
  organizationId: z.string().uuid().nullable().default(null),
  organizationRole: z.enum(organizationRoles).nullable().default(null),
  siteGrants: z.array(siteGrantSchema).max(200).default([]),
})
export type UserInviteInput = z.infer<typeof userInviteSchema>

export const invitationAcceptSchema = z.object({
  token: z.string().min(20).max(200),
  name: z.string().trim().min(1).max(120),
  password: passwordSchema,
})

export const routePolicySchema = z.object({
  name: z.string().min(1),
  routes: z.array(z.string().min(1)),
  description: z.string().optional(),
})

export const organizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  status: z.string().default("active"),
  createdAt: z.coerce.date(),
})

export const siteSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string().min(1),
  timezone: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.coerce.date(),
})

export const adminUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable().optional(),
  role: z.string().default("admin"),
  status: z.string().default("active"),
  createdAt: z.coerce.date(),
})

export const deviceSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  siteId: z.string().uuid().nullable().optional(),
  hostname: z.string().nullable().optional(),
  displayName: z.string().min(1),
  osFamily: z.string().nullable().optional(),
  osVersion: z.string().nullable().optional(),
  architecture: z.string().nullable().optional(),
  serialNumber: z.string().nullable().optional(),
  status: z.enum(deviceStatuses).default("pending"),
  lastSeenAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
})

export const managementServiceSchema = z.object({
  id: z.string().uuid(),
  deviceId: z.string().uuid(),
  serviceType: z.enum(serviceTypes),
  protocol: z.string().default("tcp"),
  port: z.number().int().positive(),
  enabled: z.boolean().default(true),
  healthStatus: z.string().default("unknown"),
  lastCheckedAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
})

export const serviceDefaults = {
  vnc: {
    protocol: "tcp",
    port: 5900,
  },
  rdp: {
    protocol: "tcp",
    port: 3389,
  },
  ssh: {
    protocol: "tcp",
    port: 22,
  },
  winrm_https: {
    protocol: "tcp",
    port: 5986,
  },
} as const satisfies Record<ServiceType, { protocol: "tcp"; port: number }>

export const vncServiceDefaults = serviceDefaults.vnc

export const enrollmentTokenCreateSchema = z
  .object({
    organizationId: z.string().uuid(),
    siteId: z.string().uuid().optional().nullable(),
    routePolicyId: z.string().uuid().optional().nullable(),
    siteWide: z.boolean().default(false),
    expiresAt: z.coerce.date().nullable().optional(),
    maxUses: z.number().int().positive().default(1),
  })
  .superRefine((value, ctx) => {
    if (value.siteId && !value.expiresAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "Site tokens require an expiration date.",
      })
    }
  })

export const enrollmentTokenUpdateSchema = enrollmentTokenCreateSchema.extend({
  id: z.string().uuid(),
})

export const enrollmentRequestSchema = z.object({
  token: z.string().min(1),
  hostname: z.string().min(1),
  os_family: z.string().min(1),
  os_version: z.string().min(1),
  architecture: z.string().min(1),
  serial_number: z.string().min(1),
  wireguard_public_key: z.string().min(1),
  services: z.array(
    z.object({
      type: z.enum(serviceTypes),
      protocol: z.string().default("tcp"),
      port: z.number().int().positive(),
      /** Optional saved password for VNC/RDP (ignored for SSH). */
      password: z.string().min(1).optional(),
    })
  ),
})

export const enrollmentResponseSchema = z.object({
  device_id: z.string().uuid(),
  vpn_ipv4: z.string().min(1),
  check_in_secret: z.string().min(1),
  wireguard: z.object({
    server_public_key: z.string().min(1),
    endpoint: z.string().min(1),
    allowed_ips: z.array(z.string().min(1)),
    persistent_keepalive: z.number().int().positive(),
  }),
  ssh: z
    .object({
      username: z.string().min(1),
      public_key: z.string().min(1),
    })
    .nullable()
    .optional(),
})

export const agentAttachRequestSchema = z.object({
  token: z.string().min(1),
  hostname: z.string().min(1),
  os_family: z.string().min(1),
  os_version: z.string().min(1),
  architecture: z.string().min(1),
  serial_number: z.string().min(1),
  device_id: z.string().uuid().optional(),
  wireguard_public_key: z.string().min(1).optional(),
})

export const agentAttachResponseSchema = enrollmentResponseSchema.extend({
  attached: z.literal(true),
  tunnel_ready: z.boolean(),
})

export const checkInSchema = z.object({
  device_id: z.string().uuid(),
  check_in_secret: z.string().min(1),
  agent_version: z.string().min(1),
  hostname: z.string().min(1),
  os_family: z.string().min(1),
  os_version: z.string().min(1),
  vpn: z.object({
    interface_up: z.boolean(),
    vpn_ipv4: z.string().min(1),
  }),
  services: z.array(
    z.object({
      type: z.enum(serviceTypes),
      port: z.number().int().positive(),
      listening: z.boolean(),
    })
  ),
  metrics: checkInMetricsSchema.optional(),
  packages: checkInPackagesSchema.optional(),
  titles: checkInTitlesSchema.optional(),
  modules: checkInModulesSchema.optional(),
  command_results: checkInCommandResultsSchema.optional(),
})

/**
 * Hostnames compare case-insensitively and ignore a trailing dot, so a device
 * that starts reporting `KIOSK-01.` instead of `kiosk-01` is still itself.
 */
export function normalizeHostname(value: string | null | undefined) {
  if (!value) return null
  const trimmed = value.trim().replace(/\.+$/, "").toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

export function hostnamesMatch(
  expected: string | null | undefined,
  reported: string | null | undefined
) {
  return normalizeHostname(expected) === normalizeHostname(reported)
}

/**
 * Connectivity is derived from the WireGuard handshake rather than stored, so
 * lists and metrics agree on the same thresholds.
 */
export const deviceConnectivityStates = [
  "online",
  "offline",
  "never",
  "revoked",
] as const

export type DeviceConnectivity = (typeof deviceConnectivityStates)[number]

/** Handshakes older than this are treated as offline. */
export const DEVICE_ONLINE_WINDOW_MS = 3 * 60 * 1000

export const MAX_DEVICE_TAGS = 20
export const DEVICE_TAG_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,31}$/

export const deviceTagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    DEVICE_TAG_PATTERN,
    "Tags use lowercase letters, numbers, and . _ : - (max 32 characters)."
  )

export const deviceTagsSchema = z
  .array(deviceTagSchema)
  .max(MAX_DEVICE_TAGS)
  .transform((tags) => [...new Set(tags)].sort())

export const deviceBulkActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("assign_site"),
    ids: z.array(z.string().uuid()).min(1).max(500),
    siteId: z.string().uuid().nullable(),
  }),
  z.object({
    action: z.literal("assign_route_policy"),
    ids: z.array(z.string().uuid()).min(1).max(500),
    routePolicyId: z.string().uuid().nullable(),
  }),
  z.object({
    action: z.literal("add_tags"),
    ids: z.array(z.string().uuid()).min(1).max(500),
    tags: z.array(deviceTagSchema).min(1).max(MAX_DEVICE_TAGS),
  }),
  z.object({
    action: z.literal("remove_tags"),
    ids: z.array(z.string().uuid()).min(1).max(500),
    tags: z.array(deviceTagSchema).min(1).max(MAX_DEVICE_TAGS),
  }),
  z.object({
    action: z.literal("revoke_vpn"),
    ids: z.array(z.string().uuid()).min(1).max(500),
  }),
  z.object({
    action: z.literal("archive"),
    ids: z.array(z.string().uuid()).min(1).max(500),
  }),
  z.object({
    action: z.literal("unarchive"),
    ids: z.array(z.string().uuid()).min(1).max(500),
  }),
  z.object({
    action: z.literal("delete"),
    ids: z.array(z.string().uuid()).min(1).max(500),
  }),
])

export type DeviceBulkAction = z.infer<typeof deviceBulkActionSchema>

export const remoteConnectionMethods = [
  "guacamole",
  "custom-novnc",
  "native",
] as const

export type RemoteConnectionMethod = (typeof remoteConnectionMethods)[number]

/** Connection method used when a session is opened in the browser. */
export const BROWSER_CONNECTION_METHOD: RemoteConnectionMethod = "guacamole"

export const remoteSessionRequestSchema = z.object({
  serviceId: z.string().uuid(),
  connectionMethod: z
    .enum(remoteConnectionMethods)
    .default(BROWSER_CONNECTION_METHOD),
  reason: z.string().trim().max(500).optional(),
  accessRequestId: z.string().uuid().optional(),
})

export const permissionSetSchema = z.array(z.enum(permissions))

export const auditEventTypeSchema = z.enum([
  "admin_login",
  "admin_login_failed",
  "admin_logout",
  "two_factor_enrolled",
  "two_factor_reset",
  "passkey_added",
  "passkey_removed",
  "password_changed",
  "session_revoked",
  "user_invited",
  "user_invitation_accepted",
  "user_invitation_revoked",
  "user_role_changed",
  "user_membership_changed",
  "user_site_access_changed",
  "user_suspended",
  "user_reactivated",
  "user_password_reset_forced",
  "credential_revealed",
  "organization_created",
  "device_created",
  "device_updated",
  "device_site_assigned",
  "device_route_policy_assigned",
  "device_tags_updated",
  "enrollment_token_created",
  "enrollment_token_updated",
  "enrollment_token_revoked",
  "enrollment_token_secret_rotated",
  "device_enrolled",
  "device_agent_attached",
  "vpn_peer_added",
  "vpn_peer_removed",
  "remote_session_started",
  "remote_session_ended",
  "remote_session_terminated",
  "device_revoked",
  "device_deleted",
  "device_archived",
  "device_unarchived",
  "site_created",
  "site_updated",
  "site_deleted",
  "site_ssh_credential_generated",
  "site_ssh_credential_set",
  "site_ssh_credential_cleared",
  "management_service_created",
  "management_service_updated",
  "management_service_deleted",
  "route_policy_created",
  "route_policy_updated",
  "route_policy_deleted",
  "route_policy_default_changed",
  "route_policy_devices_reassigned",
  "admin_vpn_created",
  "admin_vpn_reissued",
  "admin_vpn_revoked",
  "admin_vpn_updated",
  "admin_vpn_deleted",
  "admin_vpn_peer_added",
  "vpn_peer_up",
  "vpn_peer_down",
  "vpn_endpoint_changed",
  "firewall_synced",
  "firewall_sync_failed",
  "device_enroll_failed",
  "device_agent_attach_failed",
  "device_check_in_failed",
  "device_check_in_secret_mismatch",
  "device_check_in_hostname_mismatch",
  "device_hostname_changed",
  "device_hostname_change_allowed",
  "alert_raised",
  "alert_acknowledged",
  "alert_resolved",
  "alert_snoozed",
  "alert_escalated",
  "alert_policy_updated",
  "maintenance_window_created",
  "maintenance_window_updated",
  "maintenance_window_deleted",
  "notification_channel_created",
  "notification_channel_updated",
  "notification_channel_deleted",
  "notification_test_sent",
  "notification_delivery_retried",
  "ticket_opened",
  "api_key_created",
  "api_key_revoked",
  "access_request_created",
  "access_request_approved",
  "access_request_denied",
  "sso_settings_updated",
  "sso_login",
  "sso_login_failed",
  "report_schedule_created",
  "report_schedule_updated",
  "report_schedule_deleted",
  "report_schedule_sent",
  "agent_release_created",
  "agent_release_updated",
  "agent_release_deleted",
  "agent_channel_updated",
  "device_command_enqueued",
  "playbook_created",
  "playbook_updated",
  "playbook_deleted",
  "playbook_run_queued",
  "playbook_run_approved",
  "playbook_run_denied",
  "after_hours_run_requested",
  "after_hours_run_queued",
  "after_hours_run_skipped",
  "after_hours_run_approved",
  "after_hours_run_denied",
  "asset_created",
  "asset_updated",
  "asset_deleted",
  "asset_linked",
  "asset_unlinked",
  "custom_field_definition_created",
  "custom_field_definition_updated",
  "custom_field_definition_deleted",
  "inventory_imported",
  "agent_module_created",
  "agent_module_updated",
  "agent_module_deleted",
  "agent_module_assigned",
  "agent_module_unassigned",
  "device_module_payload_rejected",
])

export type AuditEventType = z.infer<typeof auditEventTypeSchema>
export const auditEventTypes = auditEventTypeSchema.options

export const routePolicyNames = {
  managementOnly: "management-only",
  futureUpdates: "future-updates",
} as const

export type RoutePolicyName =
  (typeof routePolicyNames)[keyof typeof routePolicyNames]
