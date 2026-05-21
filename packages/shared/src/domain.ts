import { z } from "zod"

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
] as const

export type Permission = (typeof permissions)[number]

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

export const enrollmentTokenCreateSchema = z.object({
  organizationId: z.string().uuid(),
  siteId: z.string().uuid().optional().nullable(),
  routePolicyId: z.string().uuid().optional().nullable(),
  siteWide: z.boolean().default(false),
  expiresAt: z.coerce.date(),
  maxUses: z.number().int().positive().default(1),
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
})

export const remoteSessionRequestSchema = z.object({
  serviceId: z.string().uuid(),
  connectionMethod: z.enum(["guacamole", "custom-novnc"]).default("guacamole"),
})

export const permissionSetSchema = z.array(z.enum(permissions))

export const auditEventTypeSchema = z.enum([
  "admin_login",
  "organization_created",
  "device_created",
  "device_updated",
  "device_site_assigned",
  "enrollment_token_created",
  "enrollment_token_updated",
  "enrollment_token_revoked",
  "device_enrolled",
  "vpn_peer_added",
  "vpn_peer_removed",
  "remote_session_started",
  "remote_session_ended",
  "device_revoked",
  "site_created",
  "site_updated",
  "site_deleted",
  "management_service_created",
  "management_service_updated",
  "management_service_deleted",
  "route_policy_created",
  "route_policy_updated",
  "route_policy_deleted",
])

export const routePolicyNames = {
  managementOnly: "management-only",
  futureUpdates: "future-updates",
} as const

export type RoutePolicyName =
  (typeof routePolicyNames)[keyof typeof routePolicyNames]
