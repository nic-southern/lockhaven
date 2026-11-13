import { createHash } from "node:crypto"

import { hostnamesMatch } from "@nms/shared"
import {
  buildClientAllowedIps,
  buildClientConfig,
  generateWireGuardKeyPair,
  normalizeVpnIpv4,
} from "@nms/vpn"

import { adminVpnConfigFilename } from "./helpers"

/** Console-created tunnel devices use the same permission as enrollment. */
export const TUNNEL_DEVICE_PERMISSION = "device:enroll" as const

/**
 * Appliances that cannot run the agent (gateways and similar). Unknown families
 * allocate from the general VPN pool, not the admin overlay.
 */
export const TUNNEL_DEVICE_OS_FAMILY = "network"

/**
 * UniFi VPN Client refuses a .conf with no Interface DNS, or with a hostname.
 * Split-tunnel traffic still uses the gateway's WAN for this resolver.
 */
export const TUNNEL_DEVICE_INTERFACE_DNS = "1.1.1.1"

export const tunnelDeviceNameConflictMessage =
  "A device with this name already exists in the organization. Open that listing and reissue its WireGuard config, or pick a different name."

export const tunnelDeviceAgentBoundMessage =
  "This device was enrolled with an agent. Re-enroll from the device to rotate its tunnel key."

export type TunnelDeviceNameRow = {
  id: string
  hostname: string | null
  displayName: string
}

export function fingerprintWireGuardPublicKey(publicKey: string) {
  return createHash("sha256")
    .update(publicKey, "utf8")
    .digest("hex")
    .slice(0, 16)
}

/**
 * Hostname collisions follow the enroll matcher: case-insensitive, trailing
 * dots ignored. Console create refuses instead of silently duplicating or
 * rotating keys; reissue is the rotate path.
 */
export function findTunnelDeviceNameConflict(
  existing: readonly TunnelDeviceNameRow[],
  name: string
) {
  const hits = existing.filter(
    (row) =>
      hostnamesMatch(row.hostname, name) ||
      hostnamesMatch(row.displayName, name)
  )
  if (hits.length === 0) {
    return null
  }
  return {
    reason: hits.length > 1 ? ("ambiguous" as const) : ("exists" as const),
    deviceIds: hits.map((row) => row.id),
  }
}

export function tunnelDeviceNameConflictCopy(
  reason: "exists" | "ambiguous"
): string {
  if (reason === "ambiguous") {
    return "More than one listed device uses this name. Rename one, or open the listing you mean and reissue its WireGuard config."
  }
  return tunnelDeviceNameConflictMessage
}

export function isTunnelOnlyDevice(device: {
  hasCheckInSecret?: boolean | null
  agentVersion?: string | null
}) {
  return !device.hasCheckInSecret && !device.agentVersion
}

export function tunnelIdentityReissuePatch(input: {
  vpnIpv4: string
  nextPublicKey: string
}) {
  return {
    vpnIpv4: input.vpnIpv4,
    wireguardPublicKey: input.nextPublicKey,
    lastHandshakeAt: null,
    latestEndpoint: null,
    serverPeerEnabled: true,
    revokedAt: null,
  }
}

/**
 * One-time client config plus the rows Hub persists. The private key is only
 * in `config`; `persist` never includes it.
 */
export function buildIssuedTunnelDevice(args: {
  privateKey: string
  publicKey: string
  vpnIp: string
  serverPublicKey: string
  serverIp: string
  endpoint: string
  routePolicyRoutes?: string[]
  organizationName: string
  deviceName: string
}) {
  const persist = {
    wireguardPublicKey: args.publicKey,
    vpnIpv4: args.vpnIp,
  }
  const allowedIps = buildClientAllowedIps({
    serverIp: args.serverIp,
    routePolicyRoutes: args.routePolicyRoutes,
  })
  const config = buildClientConfig({
    privateKey: args.privateKey,
    vpnIp: args.vpnIp,
    serverIp: args.serverIp,
    serverPublicKey: args.serverPublicKey,
    endpoint: args.endpoint,
    allowedIps,
    dns: TUNNEL_DEVICE_INTERFACE_DNS,
  })

  return {
    persist,
    config,
    filename: adminVpnConfigFilename(
      args.organizationName,
      args.vpnIp,
      args.deviceName
    ),
    allowedIps,
  }
}

export function issueTunnelDeviceKeyPair() {
  return generateWireGuardKeyPair()
}

export function persistOmitsPrivateKey(
  persist: { wireguardPublicKey: string; vpnIpv4: string },
  privateKey: string
) {
  const serialized = JSON.stringify(persist)
  return !("privateKey" in persist) && !serialized.includes(privateKey)
}

export function tunnelDeviceCreatedAuditData(input: {
  vpnIpv4: string
  publicKey: string
  routePolicyId: string | null
  sshPort: number | null
  organization: string
}) {
  return {
    vpnIpv4: normalizeVpnIpv4(input.vpnIpv4),
    wireguardFingerprint: fingerprintWireGuardPublicKey(input.publicKey),
    routePolicyId: input.routePolicyId,
    sshPort: input.sshPort,
    organization: input.organization,
    enrollment: "console_tunnel",
  }
}

export function tunnelDeviceReissuedAuditData(input: {
  vpnIpv4: string
  oldPublicKey: string
  newPublicKey: string
  organization: string
}) {
  return {
    vpnIpv4: normalizeVpnIpv4(input.vpnIpv4),
    oldWireguardFingerprint: fingerprintWireGuardPublicKey(input.oldPublicKey),
    newWireguardFingerprint: fingerprintWireGuardPublicKey(input.newPublicKey),
    organization: input.organization,
    enrollment: "console_tunnel",
  }
}
