import {
  boolean,
  inet,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { deviceStatuses, permissions, serviceTypes } from "@nms/shared"

export const statusEnum = pgEnum("device_status", deviceStatuses)
export const serviceTypeEnum = pgEnum("service_type", serviceTypes)
export const permissionEnum = pgEnum("permission", permissions)
export const platformRoleEnum = pgEnum("platform_role", ["owner", "admin"])
export const organizationRoleEnum = pgEnum("organization_role", [
  "owner",
  "admin",
  "operator",
  "viewer",
])
export const siteRoleEnum = pgEnum("site_role", ["operator", "viewer"])
export const membershipStatusEnum = pgEnum("membership_status", [
  "active",
  "suspended",
])

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: organizationRoleEnum("role").notNull(),
    status: membershipStatusEnum("status").notNull().default("active"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    organizationUserIdx: uniqueIndex(
      "organization_memberships_organization_user_idx"
    ).on(table.organizationId, table.userId),
  })
)

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: platformRoleEnum("role").notNull().default("admin"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("session_user_id_idx").on(table.userId)]
)

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    idToken: text("id_token"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("account_user_id_idx").on(table.userId)]
)

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const sites = pgTable("sites", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  timezone: text("timezone"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const siteMemberships = pgTable(
  "site_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: siteRoleEnum("role").notNull(),
    status: membershipStatusEnum("status").notNull().default("active"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    siteUserIdx: uniqueIndex("site_memberships_site_user_idx").on(
      table.siteId,
      table.userId
    ),
  })
)

export const devices = pgTable("devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  siteId: uuid("site_id").references(() => sites.id, { onDelete: "set null" }),
  hostname: text("hostname"),
  displayName: text("display_name").notNull(),
  osFamily: text("os_family"),
  osVersion: text("os_version"),
  architecture: text("architecture"),
  serialNumber: text("serial_number"),
  checkInSecretHash: text("check_in_secret_hash"),
  status: statusEnum("status").notNull().default("pending"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const routePolicies = pgTable(
  "route_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    routes: text("routes").array().notNull(),
    description: text("description"),
  },
  (table) => ({
    organizationNameIdx: uniqueIndex("route_policies_organization_name_idx").on(
      table.organizationId,
      table.name
    ),
  })
)

export const vpnIdentities = pgTable(
  "vpn_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id")
      .notNull()
      .unique()
      .references(() => devices.id, { onDelete: "cascade" }),
    vpnIpv4: inet("vpn_ipv4").notNull().unique(),
    wireguardPublicKey: text("wireguard_public_key").notNull().unique(),
    wireguardPresharedKey: text("wireguard_preshared_key"),
    routePolicyId: uuid("route_policy_id").references(() => routePolicies.id, {
      onDelete: "set null",
    }),
    serverPeerEnabled: boolean("server_peer_enabled").notNull().default(true),
    lastHandshakeAt: timestamp("last_handshake_at", { withTimezone: true }),
    latestEndpoint: text("latest_endpoint"),
    rxBytes: integer("rx_bytes").notNull().default(0),
    txBytes: integer("tx_bytes").notNull().default(0),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    wireguardPublicKeyIdx: uniqueIndex(
      "vpn_identities_wireguard_public_key_idx"
    ).on(table.wireguardPublicKey),
  })
)

export const managementServices = pgTable("management_services", {
  id: uuid("id").primaryKey().defaultRandom(),
  deviceId: uuid("device_id")
    .notNull()
    .references(() => devices.id, { onDelete: "cascade" }),
  serviceType: serviceTypeEnum("service_type").notNull(),
  protocol: text("protocol").notNull().default("tcp"),
  port: integer("port").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  healthStatus: text("health_status").notNull().default("unknown"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const managementServiceCredentials = pgTable(
  "management_service_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    managementServiceId: uuid("management_service_id")
      .notNull()
      .unique()
      .references(() => managementServices.id, { onDelete: "cascade" }),
    passwordCiphertext: text("password_ciphertext").notNull(),
    passwordIv: text("password_iv").notNull(),
    passwordAuthTag: text("password_auth_tag").notNull(),
    usernameCiphertext: text("username_ciphertext"),
    usernameIv: text("username_iv"),
    usernameAuthTag: text("username_auth_tag"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  }
)

export const siteSshCredentials = pgTable("site_ssh_credentials", {
  siteId: uuid("site_id")
    .primaryKey()
    .references(() => sites.id, { onDelete: "cascade" }),
  passwordCiphertext: text("password_ciphertext").notNull(),
  passwordIv: text("password_iv").notNull(),
  passwordAuthTag: text("password_auth_tag").notNull(),
  usernameCiphertext: text("username_ciphertext").notNull(),
  usernameIv: text("username_iv").notNull(),
  usernameAuthTag: text("username_auth_tag").notNull(),
  publicKey: text("public_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const enrollmentTokens = pgTable("enrollment_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  siteId: uuid("site_id").references(() => sites.id, { onDelete: "set null" }),
  siteWide: boolean("site_wide").notNull().default(false),
  tokenHash: text("token_hash").notNull().unique(),
  routePolicyId: uuid("route_policy_id").references(() => routePolicies.id, {
    onDelete: "set null",
  }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  maxUses: integer("max_uses").notNull().default(1),
  uses: integer("uses").notNull().default(0),
  createdByUserId: text("created_by_user_id").references(() => user.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const remoteSessions = pgTable("remote_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  adminUserId: text("admin_user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  deviceId: uuid("device_id")
    .notNull()
    .references(() => devices.id, { onDelete: "cascade" }),
  managementServiceId: uuid("management_service_id")
    .notNull()
    .references(() => managementServices.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  connectionMethod: text("connection_method").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  auditMetadata: jsonb("audit_metadata")
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
})

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorUserId: text("actor_user_id").references(() => user.id, {
    onDelete: "set null",
  }),
  organizationId: uuid("organization_id").references(() => organizations.id, {
    onDelete: "set null",
  }),
  deviceId: uuid("device_id").references(() => devices.id, {
    onDelete: "set null",
  }),
  eventType: text("event_type").notNull(),
  eventData: jsonb("event_data")
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export type Organization = typeof organizations.$inferSelect
export type OrganizationMembership = typeof organizationMemberships.$inferSelect
export type Site = typeof sites.$inferSelect
export type SiteMembership = typeof siteMemberships.$inferSelect
export type AuthUser = typeof user.$inferSelect
export type Device = typeof devices.$inferSelect
export type RoutePolicy = typeof routePolicies.$inferSelect
export type VpnIdentity = typeof vpnIdentities.$inferSelect
export type ManagementService = typeof managementServices.$inferSelect
export type ManagementServiceCredential =
  typeof managementServiceCredentials.$inferSelect
export type SiteSshCredential = typeof siteSshCredentials.$inferSelect
export type EnrollmentToken = typeof enrollmentTokens.$inferSelect
export type RemoteSession = typeof remoteSessions.$inferSelect
export type AuditEvent = typeof auditEvents.$inferSelect
