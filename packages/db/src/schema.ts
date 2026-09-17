import {
  bigint,
  boolean,
  date,
  doublePrecision,
  inet,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import {
  deviceStatuses,
  membershipStatuses,
  organizationRoles,
  permissions,
  platformRoles,
  serviceTypes,
  siteRoles,
  type AlertKind,
  type AlertStatus,
  type AuditSeverity,
  type NotificationChannelType,
  type NotificationDeliveryEvent,
  type NotificationDeliveryStatus,
  type Permission,
  type ConnectionDirection,
  type ConnectionProtocol,
  type ConnectionVerdict,
  type MaintenanceWindowRecurrence,
  type RoutePolicyColor,
  type RoutePolicyEntry,
  type SiteGrant,
  type ReportCadence,
  type ReportType,
  type SsoClaimsMap,
  type SsoProtocol,
  type AgentChannel,
  type AgentCommandKind,
  type AgentReleasePlatform,
  type AssetStatus,
  type CustomFieldAppliesTo,
  type CustomFieldType,
  type CustomFieldValues,
  type DeviceCommandStatus,
  type PlaybookAction,
  type PlaybookRunStatus,
  type PlaybookSkipReason,
  type SiteBusinessHours,
  type SiteContact,
} from "@nms/shared"

export const statusEnum = pgEnum("device_status", deviceStatuses)
export const serviceTypeEnum = pgEnum("service_type", serviceTypes)
export const permissionEnum = pgEnum("permission", permissions)
export const platformRoleEnum = pgEnum("platform_role", platformRoles)
export const organizationRoleEnum = pgEnum(
  "organization_role",
  organizationRoles
)
export const siteRoleEnum = pgEnum("site_role", siteRoles)
export const membershipStatusEnum = pgEnum(
  "membership_status",
  membershipStatuses
)

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  agentChannel: text("agent_channel")
    .$type<AgentChannel>()
    .notNull()
    .default("stable"),
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
  role: platformRoleEnum("role").notNull().default("member"),
  status: text("status").notNull().default("active"),
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  twoFactorEnforcedAt: timestamp("two_factor_enforced_at", {
    withTimezone: true,
  }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  invitedBy: text("invited_by"),
  ssoMfaTrusted: boolean("sso_mfa_trusted").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const twoFactor = pgTable(
  "two_factor",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    verified: boolean("verified").notNull().default(true),
  },
  (table) => [
    index("two_factor_user_id_idx").on(table.userId),
    index("two_factor_secret_idx").on(table.secret),
  ]
)

export const passkey = pgTable(
  "passkey",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull(),
    counter: integer("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: boolean("backed_up").notNull(),
    transports: text("transports"),
    aaguid: text("aaguid"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("passkey_user_id_idx").on(table.userId),
    uniqueIndex("passkey_credential_id_idx").on(table.credentialID),
  ]
)

export const rateLimit = pgTable(
  "rate_limit",
  {
    id: text("id").primaryKey(),
    key: text("key"),
    count: integer("count"),
    lastRequest: bigint("last_request", { mode: "number" }),
  },
  (table) => [index("rate_limit_key_idx").on(table.key)]
)

export const userInvitations = pgTable(
  "user_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    platformRole: platformRoleEnum("platform_role").notNull().default("member"),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    organizationRole: organizationRoleEnum("organization_role"),
    siteGrants: jsonb("site_grants")
      .$type<SiteGrant[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    invitedByUserId: text("invited_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    acceptedUserId: text("accepted_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("user_invitations_email_idx").on(table.email),
    index("user_invitations_organization_id_idx").on(table.organizationId),
  ]
)

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
  requireAccessReason: boolean("require_access_reason")
    .notNull()
    .default(false),
  requireApproval: boolean("require_approval").notNull().default(false),
  agentChannel: text("agent_channel").$type<AgentChannel>(),
  address: text("address"),
  contacts: jsonb("contacts")
    .$type<SiteContact[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  businessHours: jsonb("business_hours").$type<SiteBusinessHours>(),
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

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    siteId: uuid("site_id").references(() => sites.id, {
      onDelete: "set null",
    }),
    tag: text("tag").notNull(),
    vendor: text("vendor"),
    model: text("model"),
    serial: text("serial"),
    hostname: text("hostname"),
    status: text("status").$type<AssetStatus>().notNull().default("stock"),
    purchaseDate: date("purchase_date", { mode: "string" }),
    purchaseCost: numeric("purchase_cost", { precision: 12, scale: 2 }),
    warrantyExpiresOn: date("warranty_expires_on", { mode: "string" }),
    notes: text("notes"),
    customFields: jsonb("custom_fields")
      .$type<CustomFieldValues>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    organizationTagIdx: uniqueIndex("assets_organization_tag_idx").on(
      table.organizationId,
      table.tag
    ),
    organizationSerialIdx: uniqueIndex("assets_organization_serial_idx")
      .on(table.organizationId, table.serial)
      .where(sql`${table.serial} is not null`),
    organizationStatusIdx: index("assets_organization_status_idx").on(
      table.organizationId,
      table.status
    ),
    siteIdx: index("assets_site_idx").on(table.siteId),
    warrantyIdx: index("assets_warranty_expires_on_idx").on(
      table.warrantyExpiresOn
    ),
  })
)

export const customFieldDefinitions = pgTable(
  "custom_field_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    fieldType: text("field_type")
      .$type<CustomFieldType>()
      .notNull()
      .default("text"),
    appliesTo: text("applies_to")
      .$type<CustomFieldAppliesTo>()
      .notNull()
      .default("both"),
    required: boolean("required").notNull().default(false),
    options: text("options")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    organizationKeyIdx: uniqueIndex(
      "custom_field_definitions_organization_key_idx"
    ).on(table.organizationId, table.key),
  })
)

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    siteId: uuid("site_id").references(() => sites.id, {
      onDelete: "set null",
    }),
    hostname: text("hostname"),
    displayName: text("display_name").notNull(),
    osFamily: text("os_family"),
    osVersion: text("os_version"),
    architecture: text("architecture"),
    serialNumber: text("serial_number"),
    agentVersion: text("agent_version"),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    notes: text("notes"),
    assetId: uuid("asset_id").references(() => assets.id, {
      onDelete: "set null",
    }),
    customFields: jsonb("custom_fields")
      .$type<CustomFieldValues>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    checkInSecretHash: text("check_in_secret_hash"),
    /**
     * Set by an administrator to let the next check-in adopt a new hostname.
     * Cleared once used; check-ins reporting a different hostname are refused
     * while it is null.
     */
    hostnameChangeAllowedAt: timestamp("hostname_change_allowed_at", {
      withTimezone: true,
    }),
    status: statusEnum("status").notNull().default("pending"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedByUserId: text("archived_by_user_id").references(() => user.id, {
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
    organizationStatusIdx: index("devices_organization_status_idx").on(
      table.organizationId,
      table.status
    ),
    siteIdx: index("devices_site_idx").on(table.siteId),
    lastSeenIdx: index("devices_last_seen_idx").on(table.lastSeenAt),
    archivedAtIdx: index("devices_archived_at_idx")
      .on(table.archivedAt)
      .where(sql`${table.archivedAt} is not null`),
    tagsIdx: index("devices_tags_idx").using("gin", table.tags),
    organizationSerialIdx: index("devices_organization_serial_idx").on(
      table.organizationId,
      table.serialNumber
    ),
    organizationHostnameIdx: index("devices_organization_hostname_idx").on(
      table.organizationId,
      table.hostname
    ),
    assetIdx: uniqueIndex("devices_asset_id_idx")
      .on(table.assetId)
      .where(sql`${table.assetId} is not null`),
  })
)

export const routePolicies = pgTable(
  "route_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    /** Canonical CIDRs published to the tunnel; derived from `entries`. */
    routes: text("routes").array().notNull(),
    /** Routes with labels/comments for the Console. */
    entries: jsonb("entries")
      .$type<RoutePolicyEntry[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    description: text("description"),
    isDefault: boolean("is_default").notNull().default(false),
    color: text("color").$type<RoutePolicyColor>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    organizationNameIdx: uniqueIndex("route_policies_organization_name_idx").on(
      table.organizationId,
      table.name
    ),
    organizationDefaultIdx: uniqueIndex(
      "route_policies_organization_default_idx"
    )
      .on(table.organizationId)
      .where(sql`${table.isDefault} = true`),
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
    rxBytes: bigint("rx_bytes", { mode: "number" }).notNull().default(0),
    txBytes: bigint("tx_bytes", { mode: "number" }).notNull().default(0),
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

export const adminVpnProfiles = pgTable(
  "admin_vpn_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    vpnIpv4: inet("vpn_ipv4").notNull().unique(),
    wireguardPublicKey: text("wireguard_public_key").notNull().unique(),
    label: text("label"),
    serverPeerEnabled: boolean("server_peer_enabled").notNull().default(true),
    allowSameUserAccess: boolean("allow_same_user_access")
      .notNull()
      .default(false),
    lastHandshakeAt: timestamp("last_handshake_at", { withTimezone: true }),
    latestEndpoint: text("latest_endpoint"),
    rxBytes: bigint("rx_bytes", { mode: "number" }).notNull().default(0),
    txBytes: bigint("tx_bytes", { mode: "number" }).notNull().default(0),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    organizationUserIdx: index("admin_vpn_profiles_organization_user_idx").on(
      table.organizationId,
      table.userId
    ),
    wireguardPublicKeyIdx: uniqueIndex(
      "admin_vpn_profiles_wireguard_public_key_idx"
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

export const organizationSshCredentials = pgTable(
  "organization_ssh_credentials",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
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
  }
)

export const enrollmentTokens = pgTable("enrollment_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  siteId: uuid("site_id").references(() => sites.id, { onDelete: "set null" }),
  siteWide: boolean("site_wide").notNull().default(false),
  tokenHash: text("token_hash").notNull().unique(),
  tokenCiphertext: text("token_ciphertext"),
  tokenIv: text("token_iv"),
  tokenAuthTag: text("token_auth_tag"),
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

export const remoteSessions = pgTable(
  "remote_sessions",
  {
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
    reason: text("reason"),
    recordingPath: text("recording_path"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    auditMetadata: jsonb("audit_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (table) => ({
    startedAtIdx: index("remote_sessions_started_at_idx").on(table.startedAt),
    deviceIdx: index("remote_sessions_device_idx").on(table.deviceId),
  })
)

export const accessRequests = pgTable(
  "access_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    managementServiceId: uuid("management_service_id")
      .notNull()
      .references(() => managementServices.id, { onDelete: "cascade" }),
    requestedByUserId: text("requested_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    connectionMethod: text("connection_method").notNull(),
    reason: text("reason"),
    status: text("status").notNull().default("pending"),
    decidedByUserId: text("decided_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    remoteSessionId: uuid("remote_session_id").references(
      () => remoteSessions.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    pendingIdx: index("access_requests_pending_idx").on(
      table.status,
      table.expiresAt
    ),
    siteStatusIdx: index("access_requests_site_status_idx").on(
      table.siteId,
      table.status,
      table.createdAt
    ),
    requesterIdx: index("access_requests_requester_idx").on(
      table.requestedByUserId,
      table.status
    ),
    deviceIdx: index("access_requests_device_idx").on(
      table.deviceId,
      table.status
    ),
  })
)

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    siteId: uuid("site_id").references(() => sites.id, {
      onDelete: "set null",
    }),
    deviceId: uuid("device_id").references(() => devices.id, {
      onDelete: "set null",
    }),
    eventType: text("event_type").notNull(),
    severity: text("severity").$type<AuditSeverity>().notNull().default("info"),
    actorIp: inet("actor_ip"),
    userAgent: text("user_agent"),
    eventData: jsonb("event_data")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    createdAtIdx: index("audit_events_created_at_idx").on(table.createdAt),
    organizationCreatedIdx: index("audit_events_organization_created_idx").on(
      table.organizationId,
      table.createdAt
    ),
    deviceCreatedIdx: index("audit_events_device_created_idx").on(
      table.deviceId,
      table.createdAt
    ),
    eventTypeCreatedIdx: index("audit_events_event_type_created_idx").on(
      table.eventType,
      table.createdAt
    ),
    severityCreatedIdx: index("audit_events_severity_created_idx").on(
      table.severity,
      table.createdAt
    ),
  })
)

/**
 * Point-in-time tunnel readings per device: written on every transition
 * (up, down, endpoint change) and at least hourly while online, so the
 * Console can draw traffic and endpoint history.
 */
export const vpnPeerSamples = pgTable(
  "vpn_peer_samples",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    sampledAt: timestamp("sampled_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    online: boolean("online").notNull(),
    endpoint: text("endpoint"),
    lastHandshakeAt: timestamp("last_handshake_at", { withTimezone: true }),
    rxBytes: bigint("rx_bytes", { mode: "number" }).notNull().default(0),
    txBytes: bigint("tx_bytes", { mode: "number" }).notNull().default(0),
    /** Why the sample was taken: `up`, `down`, `endpoint`, or `interval`. */
    reason: text("reason").notNull().default("interval"),
  },
  (table) => ({
    deviceSampledIdx: index("vpn_peer_samples_device_sampled_idx").on(
      table.deviceId,
      table.sampledAt
    ),
    sampledAtIdx: index("vpn_peer_samples_sampled_at_idx").on(table.sampledAt),
  })
)

export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    siteId: uuid("site_id").references(() => sites.id, {
      onDelete: "set null",
    }),
    deviceId: uuid("device_id").references(() => devices.id, {
      onDelete: "cascade",
    }),
    assetId: uuid("asset_id").references(() => assets.id, {
      onDelete: "set null",
    }),
    kind: text("kind").$type<AlertKind>().notNull(),
    severity: text("severity").$type<AuditSeverity>().notNull(),
    status: text("status").$type<AlertStatus>().notNull().default("open"),
    title: text("title").notNull(),
    detail: jsonb("detail")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** Stable key so the same condition never opens twice while unresolved. */
    dedupeKey: text("dedupe_key").notNull(),
    occurrences: integer("occurrences").notNull().default(1),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedByUserId: text("acknowledged_by_user_id").references(
      () => user.id,
      { onDelete: "set null" }
    ),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByUserId: text("resolved_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    snoozedByUserId: text("snoozed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    openDedupeIdx: uniqueIndex("alerts_open_dedupe_idx")
      .on(table.dedupeKey)
      .where(sql`${table.status} <> 'resolved'`),
    statusSeverityIdx: index("alerts_status_severity_idx").on(
      table.status,
      table.severity,
      table.lastSeenAt
    ),
    organizationStatusIdx: index("alerts_organization_status_idx").on(
      table.organizationId,
      table.status
    ),
    deviceIdx: index("alerts_device_idx").on(table.deviceId),
    assetIdx: index("alerts_asset_idx").on(table.assetId),
    snoozedUntilIdx: index("alerts_snoozed_until_idx")
      .on(table.snoozedUntil)
      .where(sql`${table.snoozedUntil} is not null`),
  })
)

/**
 * One row per new connection observed on the concentrator. Populated by the
 * worker from nftables log lines; never updated in place.
 */
export const connectionEvents = pgTable(
  "connection_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    siteId: uuid("site_id").references(() => sites.id, {
      onDelete: "set null",
    }),
    deviceId: uuid("device_id").references(() => devices.id, {
      onDelete: "cascade",
    }),
    adminProfileId: uuid("admin_profile_id").references(
      () => adminVpnProfiles.id,
      { onDelete: "cascade" }
    ),
    direction: text("direction").$type<ConnectionDirection>().notNull(),
    verdict: text("verdict").$type<ConnectionVerdict>().notNull(),
    protocol: text("protocol").$type<ConnectionProtocol>().notNull(),
    srcIp: inet("src_ip").notNull(),
    dstIp: inet("dst_ip").notNull(),
    dstPort: integer("dst_port"),
    bytes: bigint("bytes", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    occurredAtIdx: index("connection_events_occurred_at_idx").on(
      table.occurredAt
    ),
    deviceOccurredIdx: index("connection_events_device_occurred_idx").on(
      table.deviceId,
      table.occurredAt
    ),
    organizationOccurredIdx: index(
      "connection_events_organization_occurred_idx"
    ).on(table.organizationId, table.occurredAt),
    adminOccurredIdx: index("connection_events_admin_occurred_idx").on(
      table.adminProfileId,
      table.occurredAt
    ),
    destinationIdx: index("connection_events_destination_idx").on(
      table.dstIp,
      table.dstPort
    ),
  })
)

/**
 * Per-day rollup of connection events by source, destination and verdict.
 * `subject_key` identifies the source peer so the unique key has no nulls.
 */
export const connectionDaily = pgTable(
  "connection_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    day: timestamp("day", { withTimezone: true }).notNull(),
    subjectKey: text("subject_key").notNull(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    siteId: uuid("site_id").references(() => sites.id, {
      onDelete: "set null",
    }),
    deviceId: uuid("device_id").references(() => devices.id, {
      onDelete: "cascade",
    }),
    adminProfileId: uuid("admin_profile_id").references(
      () => adminVpnProfiles.id,
      { onDelete: "cascade" }
    ),
    direction: text("direction").$type<ConnectionDirection>().notNull(),
    verdict: text("verdict").$type<ConnectionVerdict>().notNull(),
    protocol: text("protocol").$type<ConnectionProtocol>().notNull(),
    dstIp: inet("dst_ip").notNull(),
    dstPort: integer("dst_port").notNull().default(0),
    connections: integer("connections").notNull().default(0),
    bytes: bigint("bytes", { mode: "number" }).notNull().default(0),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    uniqueBucket: uniqueIndex("connection_daily_bucket_idx").on(
      table.day,
      table.subjectKey,
      table.direction,
      table.verdict,
      table.protocol,
      table.dstIp,
      table.dstPort
    ),
    deviceDayIdx: index("connection_daily_device_day_idx").on(
      table.deviceId,
      table.day
    ),
    organizationDayIdx: index("connection_daily_organization_day_idx").on(
      table.organizationId,
      table.day
    ),
    dayIdx: index("connection_daily_day_idx").on(table.day),
  })
)

export const notificationChannels = pgTable(
  "notification_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").$type<NotificationChannelType>().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    config: jsonb("config")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    minSeverity: text("min_severity")
      .$type<AuditSeverity>()
      .notNull()
      .default("info"),
    alertKinds: jsonb("alert_kinds")
      .$type<AlertKind[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    siteIds: jsonb("site_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    organizationIdx: index("notification_channels_organization_idx").on(
      table.organizationId
    ),
  })
)

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => notificationChannels.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    alertId: uuid("alert_id").references(() => alerts.id, {
      onDelete: "set null",
    }),
    event: text("event").$type<NotificationDeliveryEvent>().notNull(),
    status: text("status")
      .$type<NotificationDeliveryStatus>()
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastResponse: text("last_response"),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (table) => ({
    dueIdx: index("notification_deliveries_due_idx").on(
      table.status,
      table.nextAttemptAt
    ),
    organizationCreatedIdx: index(
      "notification_deliveries_organization_created_idx"
    ).on(table.organizationId, table.createdAt),
    channelCreatedIdx: index("notification_deliveries_channel_created_idx").on(
      table.channelId,
      table.createdAt
    ),
  })
)

export const alertPolicies = pgTable(
  "alert_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    siteId: uuid("site_id").references(() => sites.id, { onDelete: "cascade" }),
    kind: text("kind").$type<AlertKind>().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    severity: text("severity").$type<AuditSeverity>(),
    escalateAfterMinutes: integer("escalate_after_minutes"),
    thresholds: jsonb("thresholds")
      .$type<{ offlineHours?: number }>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgKindIdx: uniqueIndex("alert_policies_org_kind_idx")
      .on(table.organizationId, table.kind)
      .where(sql`${table.siteId} is null`),
    siteKindIdx: uniqueIndex("alert_policies_site_kind_idx")
      .on(table.organizationId, table.siteId, table.kind)
      .where(sql`${table.siteId} is not null`),
    organizationIdx: index("alert_policies_organization_idx").on(
      table.organizationId
    ),
  })
)

export const maintenanceWindows = pgTable(
  "maintenance_windows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    siteId: uuid("site_id").references(() => sites.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").references(() => devices.id, {
      onDelete: "cascade",
    }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    timeZone: text("time_zone").notNull().default("UTC"),
    recurrence: text("recurrence")
      .$type<MaintenanceWindowRecurrence>()
      .notNull()
      .default("none"),
    reason: text("reason").notNull().default(""),
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
    organizationStartsIdx: index(
      "maintenance_windows_organization_starts_idx"
    ).on(table.organizationId, table.startsAt),
    siteIdx: index("maintenance_windows_site_idx").on(table.siteId),
    deviceIdx: index("maintenance_windows_device_idx").on(table.deviceId),
  })
)

export const deviceUptimeDaily = pgTable(
  "device_uptime_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    day: timestamp("day", { withTimezone: true }).notNull(),
    onlineMs: integer("online_ms").notNull().default(0),
    observedMs: integer("observed_ms").notNull().default(0),
    sampleCount: integer("sample_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    deviceDayIdx: uniqueIndex("device_uptime_daily_device_day_idx").on(
      table.deviceId,
      table.day
    ),
    dayIdx: index("device_uptime_daily_day_idx").on(table.day),
  })
)

export const reportSchedules = pgTable(
  "report_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    siteId: uuid("site_id").references(() => sites.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").$type<ReportType>().notNull(),
    cadence: text("cadence").$type<ReportCadence>().notNull(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => notificationChannels.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
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
    organizationIdx: index("report_schedules_organization_idx").on(
      table.organizationId
    ),
    channelIdx: index("report_schedules_channel_idx").on(table.channelId),
  })
)

export const agentReleases = pgTable(
  "agent_releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    platform: text("platform").$type<AgentReleasePlatform>().notNull(),
    version: text("version").notNull(),
    channel: text("channel").$type<AgentChannel>().notNull(),
    downloadUrl: text("download_url").notNull(),
    sha256: text("sha256").notNull(),
    notes: text("notes"),
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
    channelPlatformVersionIdx: uniqueIndex(
      "agent_releases_channel_platform_version_idx"
    ).on(table.channel, table.platform, table.version),
    channelIdx: index("agent_releases_channel_idx").on(table.channel),
  })
)

export const deviceCommands = pgTable(
  "device_commands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    kind: text("kind").$type<AgentCommandKind>().notNull(),
    status: text("status")
      .$type<DeviceCommandStatus>()
      .notNull()
      .default("pending"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    resultDetail: text("result_detail"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    deviceStatusIdx: index("device_commands_device_status_idx").on(
      table.deviceId,
      table.status
    ),
    createdAtIdx: index("device_commands_created_at_idx").on(table.createdAt),
  })
)

export const playbooks = pgTable(
  "playbooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    siteId: uuid("site_id").references(() => sites.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    alertKind: text("alert_kind").$type<AlertKind>().notNull(),
    action: text("action").$type<PlaybookAction>().notNull(),
    requireApproval: boolean("require_approval").notNull().default(false),
    cooldownMinutes: integer("cooldown_minutes").notNull().default(60),
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
    orgKindIdx: uniqueIndex("playbooks_org_kind_idx")
      .on(table.organizationId, table.alertKind)
      .where(sql`${table.siteId} is null`),
    siteKindIdx: uniqueIndex("playbooks_site_kind_idx")
      .on(table.organizationId, table.siteId, table.alertKind)
      .where(sql`${table.siteId} is not null`),
    organizationIdx: index("playbooks_organization_idx").on(
      table.organizationId
    ),
  })
)

export const playbookRuns = pgTable(
  "playbook_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    playbookId: uuid("playbook_id")
      .notNull()
      .references(() => playbooks.id, { onDelete: "cascade" }),
    alertId: uuid("alert_id")
      .notNull()
      .references(() => alerts.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    siteId: uuid("site_id").references(() => sites.id, {
      onDelete: "set null",
    }),
    deviceId: uuid("device_id").references(() => devices.id, {
      onDelete: "cascade",
    }),
    action: text("action").$type<PlaybookAction>().notNull(),
    status: text("status")
      .$type<PlaybookRunStatus>()
      .notNull()
      .default("pending_approval"),
    skipReason: text("skip_reason").$type<PlaybookSkipReason>(),
    deviceCommandId: uuid("device_command_id").references(
      () => deviceCommands.id,
      { onDelete: "set null" }
    ),
    decidedByUserId: text("decided_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    playbookAlertIdx: uniqueIndex("playbook_runs_playbook_alert_idx").on(
      table.playbookId,
      table.alertId
    ),
    statusIdx: index("playbook_runs_status_idx").on(
      table.status,
      table.createdAt
    ),
    deviceCreatedIdx: index("playbook_runs_device_created_idx").on(
      table.deviceId,
      table.createdAt
    ),
    organizationStatusIdx: index("playbook_runs_organization_status_idx").on(
      table.organizationId,
      table.status
    ),
  })
)

export type Organization = typeof organizations.$inferSelect
export type OrganizationMembership = typeof organizationMemberships.$inferSelect
export type Site = typeof sites.$inferSelect
export type SiteMembership = typeof siteMemberships.$inferSelect
export type Asset = typeof assets.$inferSelect
export type CustomFieldDefinition = typeof customFieldDefinitions.$inferSelect
export type AuthUser = typeof user.$inferSelect
export type AuthSession = typeof session.$inferSelect
export type Passkey = typeof passkey.$inferSelect
export type UserInvitation = typeof userInvitations.$inferSelect
export type Device = typeof devices.$inferSelect
export type RoutePolicy = typeof routePolicies.$inferSelect
export type VpnIdentity = typeof vpnIdentities.$inferSelect
export type AdminVpnProfile = typeof adminVpnProfiles.$inferSelect
export type ManagementService = typeof managementServices.$inferSelect
export type ManagementServiceCredential =
  typeof managementServiceCredentials.$inferSelect
export type SiteSshCredential = typeof siteSshCredentials.$inferSelect
export type OrganizationSshCredential =
  typeof organizationSshCredentials.$inferSelect
export type EnrollmentToken = typeof enrollmentTokens.$inferSelect
export type RemoteSession = typeof remoteSessions.$inferSelect
export type AccessRequest = typeof accessRequests.$inferSelect
export type AuditEvent = typeof auditEvents.$inferSelect
export type VpnPeerSample = typeof vpnPeerSamples.$inferSelect
export type Alert = typeof alerts.$inferSelect
export type AlertPolicy = typeof alertPolicies.$inferSelect
export type MaintenanceWindow = typeof maintenanceWindows.$inferSelect
export type NotificationChannel = typeof notificationChannels.$inferSelect
export type NotificationDelivery = typeof notificationDeliveries.$inferSelect
export type DeviceUptimeDaily = typeof deviceUptimeDaily.$inferSelect
export type ReportSchedule = typeof reportSchedules.$inferSelect
export type AgentRelease = typeof agentReleases.$inferSelect
export type DeviceCommand = typeof deviceCommands.$inferSelect
export type Playbook = typeof playbooks.$inferSelect
export type PlaybookRun = typeof playbookRuns.$inferSelect

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    secretHash: text("secret_hash").notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    permissions: jsonb("permissions")
      .$type<Permission[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    prefixIdx: uniqueIndex("api_keys_prefix_idx").on(table.prefix),
    createdByIdx: index("api_keys_created_by_idx").on(table.createdByUserId),
    organizationIdx: index("api_keys_organization_idx").on(
      table.organizationId
    ),
  })
)

export type ApiKey = typeof apiKeys.$inferSelect
export type ConnectionEvent = typeof connectionEvents.$inferSelect
export type ConnectionDailyRow = typeof connectionDaily.$inferSelect

export const deviceMetricsLatest = pgTable("device_metrics_latest", {
  deviceId: uuid("device_id")
    .primaryKey()
    .references(() => devices.id, { onDelete: "cascade" }),
  collectedAt: timestamp("collected_at", { withTimezone: true }).notNull(),
  uptimeSeconds: bigint("uptime_seconds", { mode: "number" }).notNull(),
  cpuLoad1: doublePrecision("cpu_load1"),
  cpuLoad5: doublePrecision("cpu_load5"),
  cpuLoad15: doublePrecision("cpu_load15"),
  cpuCores: integer("cpu_cores"),
  memoryTotalBytes: bigint("memory_total_bytes", { mode: "number" }),
  memoryAvailableBytes: bigint("memory_available_bytes", { mode: "number" }),
  memoryUsedBytes: bigint("memory_used_bytes", { mode: "number" }),
  disks: jsonb("disks")
    .$type<Array<Record<string, unknown>>>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  network: jsonb("network")
    .$type<Array<Record<string, unknown>>>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  wgHandshakeAgeSeconds: integer("wg_handshake_age_seconds"),
  rebootRequired: boolean("reboot_required").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const deviceMetricsSamples = pgTable(
  "device_metrics_samples",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    sampledAt: timestamp("sampled_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    uptimeSeconds: bigint("uptime_seconds", { mode: "number" }).notNull(),
    cpuLoad1: doublePrecision("cpu_load1"),
    cpuLoad5: doublePrecision("cpu_load5"),
    cpuLoad15: doublePrecision("cpu_load15"),
    cpuCores: integer("cpu_cores"),
    memoryTotalBytes: bigint("memory_total_bytes", { mode: "number" }),
    memoryAvailableBytes: bigint("memory_available_bytes", { mode: "number" }),
    memoryUsedBytes: bigint("memory_used_bytes", { mode: "number" }),
    disks: jsonb("disks")
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    network: jsonb("network")
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    wgHandshakeAgeSeconds: integer("wg_handshake_age_seconds"),
    rebootRequired: boolean("reboot_required").notNull().default(false),
  },
  (table) => ({
    deviceSampledIdx: index("device_metrics_samples_device_sampled_idx").on(
      table.deviceId,
      table.sampledAt
    ),
    sampledAtIdx: index("device_metrics_samples_sampled_at_idx").on(
      table.sampledAt
    ),
  })
)

export const devicePackages = pgTable(
  "device_packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    version: text("version").notNull(),
    source: text("source").notNull().default("unknown"),
    availableVersion: text("available_version"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    deviceNameSourceIdx: uniqueIndex(
      "device_packages_device_name_source_idx"
    ).on(table.deviceId, table.name, table.source),
    deviceIdx: index("device_packages_device_idx").on(table.deviceId),
  })
)

export const organizationSsoSettings = pgTable(
  "organization_sso_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    required: boolean("required").notNull().default(false),
    protocol: text("protocol").$type<SsoProtocol>().notNull().default("oidc"),
    usePlatformIdp: boolean("use_platform_idp").notNull().default(true),
    allowedDomains: jsonb("allowed_domains")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    trustIdpMfa: boolean("trust_idp_mfa").notNull().default(false),
    claimsMap: jsonb("claims_map")
      .$type<SsoClaimsMap>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    defaultOrganizationRole: organizationRoleEnum("default_organization_role")
      .notNull()
      .default("technician"),
    providerId: text("provider_id"),
    issuer: text("issuer"),
    discoveryUrl: text("discovery_url"),
    clientId: text("client_id"),
    clientSecret: jsonb("client_secret").$type<{
      ciphertext: string
      iv: string
      authTag: string
    } | null>(),
    samlEntryPoint: text("saml_entry_point"),
    samlCertificate: text("saml_certificate"),
    samlAudience: text("saml_audience"),
    samlMetadataXml: text("saml_metadata_xml"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    organizationIdx: uniqueIndex(
      "organization_sso_settings_organization_idx"
    ).on(table.organizationId),
    providerIdx: uniqueIndex("organization_sso_settings_provider_idx")
      .on(table.providerId)
      .where(sql`${table.providerId} is not null`),
  })
)

export const ssoProvider = pgTable(
  "sso_provider",
  {
    id: text("id").primaryKey(),
    issuer: text("issuer").notNull(),
    domain: text("domain").notNull(),
    oidcConfig: text("oidc_config"),
    samlConfig: text("saml_config"),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    providerId: text("provider_id").notNull(),
    organizationId: text("organization_id"),
  },
  (table) => ({
    providerIdIdx: uniqueIndex("sso_provider_provider_id_idx").on(
      table.providerId
    ),
    organizationIdx: index("sso_provider_organization_idx").on(
      table.organizationId
    ),
  })
)

export type DeviceMetricsLatest = typeof deviceMetricsLatest.$inferSelect
export type DeviceMetricsSample = typeof deviceMetricsSamples.$inferSelect
export type DevicePackage = typeof devicePackages.$inferSelect
export type OrganizationSsoSettings =
  typeof organizationSsoSettings.$inferSelect
export type SsoProvider = typeof ssoProvider.$inferSelect
