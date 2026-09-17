import { randomBytes } from "node:crypto"

import { and, eq, isNull, or, sql } from "drizzle-orm"

import {
  auditEvents,
  devices,
  enrollmentTokens,
  organizations,
  routePolicies,
  vpnIdentities,
} from "@nms/db"
import { db } from "@nms/db/client"
import {
  matchExistingDevice,
  normalizeHostname,
  normalizeSerial,
  severityForEvent,
  type AttachCandidate,
  type AttachIdentity,
  type AttachMatch,
} from "@nms/shared"
import { buildClientAllowedIps } from "@nms/vpn"

import { hashAgentSecret } from "@/lib/agent-secret"

export type EnrollmentTokenRow = typeof enrollmentTokens.$inferSelect

type TransactionClient = Parameters<typeof db.transaction>[0] extends (
  tx: infer T
) => unknown
  ? T
  : never

export type BoundDevice = {
  device: typeof devices.$inferSelect
  identity: typeof vpnIdentities.$inferSelect | null
  routePolicyRoutes: string[]
}

const env = {
  vpnServerPublicKey: process.env.VPN_SERVER_PUBLIC_KEY,
  vpnPublicHostname: process.env.VPN_PUBLIC_HOSTNAME ?? "vpn.example.com",
  vpnPublicPort: Number(process.env.VPN_PUBLIC_PORT ?? 51820),
  vpnServerIp: process.env.VPN_SERVER_IP ?? "10.80.0.1",
}

export function clientVpnSettings(routePolicyRoutes: string[]) {
  if (!env.vpnServerPublicKey) return null
  return {
    server_public_key: env.vpnServerPublicKey,
    endpoint: `${env.vpnPublicHostname}:${env.vpnPublicPort}`,
    allowed_ips: buildClientAllowedIps({
      serverIp: env.vpnServerIp,
      routePolicyRoutes,
    }),
    persistent_keepalive: 25,
  }
}

export function issueCheckInSecret() {
  const checkInSecret = randomBytes(32).toString("base64url")
  return { checkInSecret, checkInSecretHash: hashAgentSecret(checkInSecret) }
}

export async function loadEnrollmentToken(
  tx: TransactionClient,
  token: string
): Promise<
  | { ok: true; token: EnrollmentTokenRow; organizationName: string }
  | {
      ok: false
      reason: "token_not_found" | "token_exhausted" | "token_expired"
      token?: EnrollmentTokenRow
    }
> {
  const tokenHash = hashAgentSecret(token)
  const [record] = await tx
    .select()
    .from(enrollmentTokens)
    .where(eq(enrollmentTokens.tokenHash, tokenHash))

  if (!record) return { ok: false, reason: "token_not_found" }

  if (!record.siteWide && record.uses >= record.maxUses) {
    return { ok: false, reason: "token_exhausted", token: record }
  }

  if (record.expiresAt !== null && record.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "token_expired", token: record }
  }

  const [organization] = await tx
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, record.organizationId))

  if (!organization)
    return { ok: false, reason: "token_not_found", token: record }

  return { ok: true, token: record, organizationName: organization.name }
}

function candidateWhere(
  organizationId: string,
  identity: AttachIdentity,
  siteId: string | null
) {
  const identityClauses = [
    sql`upper(replace(coalesce(${devices.serialNumber}, ''), '-', '')) = ${normalizeSerial(identity.serialNumber) ?? ""}`,
    sql`regexp_replace(lower(coalesce(${devices.hostname}, '')), '\\.+$', '') = ${normalizeHostname(identity.hostname) ?? ""}`,
  ]
  if (identity.deviceId) {
    identityClauses.push(eq(devices.id, identity.deviceId))
  }
  if (identity.wireguardPublicKey) {
    identityClauses.push(
      eq(vpnIdentities.wireguardPublicKey, identity.wireguardPublicKey)
    )
  }

  const filters = [
    eq(devices.organizationId, organizationId),
    or(...identityClauses),
  ]
  if (siteId) {
    filters.push(or(eq(devices.siteId, siteId), isNull(devices.siteId)))
  }
  return and(...filters)
}

export async function loadAttachCandidates(
  tx: TransactionClient,
  organizationId: string,
  identity: AttachIdentity,
  siteId: string | null
): Promise<Array<AttachCandidate & { vpnIpv4: string | null }>> {
  const rows = await tx
    .select({
      id: devices.id,
      organizationId: devices.organizationId,
      siteId: devices.siteId,
      hostname: devices.hostname,
      serialNumber: devices.serialNumber,
      status: devices.status,
      wireguardPublicKey: vpnIdentities.wireguardPublicKey,
      revokedAt: vpnIdentities.revokedAt,
      vpnIpv4: vpnIdentities.vpnIpv4,
    })
    .from(devices)
    .leftJoin(vpnIdentities, eq(vpnIdentities.deviceId, devices.id))
    .where(candidateWhere(organizationId, identity, siteId))

  return rows
}

export function matchForToken(
  candidates: AttachCandidate[],
  identity: AttachIdentity,
  token: EnrollmentTokenRow
): AttachMatch {
  return matchExistingDevice(candidates, identity, {
    organizationId: token.organizationId,
    siteId: token.siteId,
  })
}

export async function bindAgentToDevice(
  tx: TransactionClient,
  args: {
    deviceId: string
    identity: AttachIdentity
    osFamily: string
    osVersion: string
    architecture: string
    checkInSecretHash: string
  }
): Promise<BoundDevice | null> {
  const [device] = await tx
    .select()
    .from(devices)
    .where(eq(devices.id, args.deviceId))
  if (!device) return null

  const now = new Date()
  await tx
    .update(devices)
    .set({
      checkInSecretHash: args.checkInSecretHash,
      osFamily: args.osFamily,
      osVersion: args.osVersion,
      architecture: args.architecture,
      serialNumber: device.serialNumber ?? args.identity.serialNumber,
      hostname: device.hostname ?? args.identity.hostname,
      updatedAt: now,
    })
    .where(eq(devices.id, args.deviceId))

  const [identity] = await tx
    .select()
    .from(vpnIdentities)
    .where(eq(vpnIdentities.deviceId, args.deviceId))

  const routePolicyRoutes = identity?.routePolicyId
    ? ((
        await tx
          .select({ routes: routePolicies.routes })
          .from(routePolicies)
          .where(eq(routePolicies.id, identity.routePolicyId))
      )[0]?.routes ?? [])
    : []

  const [updated] = await tx
    .select()
    .from(devices)
    .where(eq(devices.id, args.deviceId))

  return {
    device: updated ?? device,
    identity: identity ?? null,
    routePolicyRoutes,
  }
}

export async function recordAgentAttachEvent(
  tx: TransactionClient,
  args: {
    organizationId: string
    siteId: string | null
    deviceId: string
    actorIp: string | null
    userAgent: string | null
    eventData: Record<string, unknown>
  }
) {
  await tx.insert(auditEvents).values({
    organizationId: args.organizationId,
    siteId: args.siteId,
    deviceId: args.deviceId,
    eventType: "device_agent_attached",
    severity: severityForEvent("device_agent_attached"),
    actorIp: args.actorIp,
    userAgent: args.userAgent,
    eventData: args.eventData,
  })
}
