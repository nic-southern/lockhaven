import { z } from "zod"

import type { DeviceStatus, ServiceType } from "@nms/shared"

export const vpnConfigSchema = z.object({
  serverPublicKey: z.string().min(1),
  endpoint: z.string().min(1),
  allowedIps: z.array(z.string().min(1)),
  persistentKeepalive: z.number().int().positive().default(25),
})

export function normalizeDeviceFamily(osFamily: string) {
  const family = osFamily.toLowerCase()

  if (family.includes("windows")) {
    return "windows"
  }

  if (family.includes("mac")) {
    return "macos"
  }

  if (family.includes("linux")) {
    return "linux"
  }

  return "general"
}

const allocationPools = {
  general: { subnet: "10.80.10", start: 11, end: 254 },
  windows: { subnet: "10.80.20", start: 11, end: 254 },
  linux: { subnet: "10.80.30", start: 11, end: 254 },
  macos: { subnet: "10.80.40", start: 11, end: 254 },
  lab: { subnet: "10.80.50", start: 11, end: 254 },
  admin: { subnet: "10.80.100", start: 11, end: 254 },
  updates: { subnet: "10.80.200", start: 11, end: 254 },
} as const

export type AllocationPool = keyof typeof allocationPools

export function pickVpnAllocationPool(osFamily: string): AllocationPool {
  const family = normalizeDeviceFamily(osFamily)
  if (family in allocationPools) {
    return family as AllocationPool
  }
  return "general"
}

export function normalizeVpnIpv4(value: string) {
  return value.trim().split("/")[0]
}

function normalizeIpList(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

export function allocateVpnIpv4(existingIps: string[], osFamily: string) {
  const pool = allocationPools[pickVpnAllocationPool(osFamily)]
  const occupiedIps = new Set(existingIps.map(normalizeVpnIpv4))

  for (let lastOctet = pool.start; lastOctet <= pool.end; lastOctet += 1) {
    const candidate = `${pool.subnet}.${lastOctet}/32`
    if (!occupiedIps.has(normalizeVpnIpv4(candidate))) {
      return candidate
    }
  }

  throw new Error(`No available VPN IPs in pool ${pool.subnet}`)
}

export function buildClientAllowedIps(args: {
  serverIp: string
  routePolicyRoutes?: string[]
  includeUpdates?: boolean
}) {
  const allowedIps = [
    `${normalizeVpnIpv4(args.serverIp)}/32`,
    ...(args.routePolicyRoutes ?? []),
  ]

  if (args.includeUpdates) {
    allowedIps.push("10.80.200.0/24")
  }

  return normalizeIpList(allowedIps)
}

export function buildServerPeerAllowedIps(args: {
  vpnIp: string
  routePolicyRoutes?: string[]
}) {
  return normalizeIpList([args.vpnIp, ...(args.routePolicyRoutes ?? [])])
}

export function buildClientConfig({
  privateKey,
  vpnIp,
  serverIp,
  serverPublicKey,
  endpoint,
  includeUpdates = false,
}: {
  privateKey: string
  vpnIp: string
  serverIp: string
  serverPublicKey: string
  endpoint: string
  includeUpdates?: boolean
}) {
  return [
    "[Interface]",
    `Address = ${vpnIp}`,
    `PrivateKey = ${privateKey}`,
    "",
    "[Peer]",
    `PublicKey = ${serverPublicKey}`,
    `Endpoint = ${endpoint}`,
    `AllowedIPs = ${buildClientAllowedIps({
      serverIp,
      includeUpdates,
    }).join(", ")}`,
    "PersistentKeepalive = 25",
  ].join("\n")
}

export function buildAddPeerCommand(args: {
  publicKey: string
  allowedIps: string[]
}) {
  return [
    "add-peer",
    "--public-key",
    args.publicKey,
    "--allowed-ips",
    args.allowedIps.join(", "),
  ]
}

export function buildRemovePeerCommand(args: { publicKey: string }) {
  return ["remove-peer", "--public-key", args.publicKey]
}

export function buildSyncFirewallCommand(args: { allowedRoutes: string[] }) {
  return ["sync-firewall", "--allowed-routes", args.allowedRoutes.join(", ")]
}

export type WgPeerStats = {
  publicKey: string
  presharedKey: string
  endpoint: string
  allowedIps: string[]
  latestHandshakeAt: Date | null
  rxBytes: number
  txBytes: number
  persistentKeepalive: number
}

export function parseWgDump(dump: string) {
  const lines = dump.trim().split("\n").filter(Boolean)
  const peers: WgPeerStats[] = []

  for (const line of lines.slice(1)) {
    const [
      publicKey,
      presharedKey,
      endpoint,
      allowedIps,
      latestHandshake,
      rxBytes,
      txBytes,
      persistentKeepalive,
    ] = line.split("\t")

    peers.push({
      publicKey,
      presharedKey,
      endpoint,
      allowedIps: allowedIps ? allowedIps.split(",") : [],
      latestHandshakeAt:
        latestHandshake && latestHandshake !== "0"
          ? new Date(Number(latestHandshake) * 1000)
          : null,
      rxBytes: Number(rxBytes ?? 0),
      txBytes: Number(txBytes ?? 0),
      persistentKeepalive: Number(persistentKeepalive ?? 0),
    })
  }

  return peers
}

export function deriveDeviceStatus(args: {
  handshakeAt: Date | null
  serviceReachable: boolean
  revoked: boolean
}): DeviceStatus {
  if (args.revoked) {
    return "revoked"
  }

  if (!args.handshakeAt) {
    return "offline"
  }

  const recentEnough = Date.now() - args.handshakeAt.getTime() < 3 * 60 * 1000
  if (!recentEnough) {
    return "offline"
  }

  return args.serviceReachable ? "service_online" : "vpn_online"
}

export function serviceTypeToPort(serviceType: ServiceType) {
  switch (serviceType) {
    case "vnc":
      return 5900
    case "rdp":
      return 3389
    case "ssh":
      return 22
    case "winrm_https":
      return 5986
    default:
      return 5900
  }
}
