import "dotenv/config"

import { execFile } from "node:child_process"
import { promisify } from "node:util"
import net from "node:net"

import { Queue, Worker } from "bullmq"
import Redis from "ioredis"

import {
  adminVpnProfiles,
  auditEvents,
  devices,
  eq,
  isNull,
  and,
  managementServices,
  routePolicies,
  vpnIdentities,
} from "@nms/db"
import { db } from "@nms/db/client"
import {
  buildAddPeerCommand,
  buildRemovePeerCommand,
  buildServerPeerAllowedIps,
  buildSyncFirewallCommand,
  deriveDeviceStatus,
  parseWgDump,
  normalizeVpnIpv4,
  type AdminForwardRule,
} from "@nms/vpn"

const execFileAsync = promisify(execFile)

const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379/0"
const vpnctlPath = process.env.VPNCTL_PATH ?? "/usr/local/sbin/vpnctl"
const vpnServerIp = process.env.VPN_SERVER_IP ?? "10.80.0.1"

const connection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
})

async function readWireGuardDump() {
  try {
    const { stdout } = await execFileAsync(vpnctlPath, ["show-status"], {
      env: process.env,
    })
    return parseWgDump(stdout)
  } catch {
    return []
  }
}

async function invokeVpnctl(args: string[]) {
  try {
    await execFileAsync(vpnctlPath, args, {
      env: process.env,
    })
  } catch (error) {
    console.error("vpnctl failed", { args, error })
  }
}

async function tcpReachable(host: string, port: number) {
  return await new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host, port })
    socket.once("connect", () => {
      socket.end()
      resolve(true)
    })
    socket.once("error", () => resolve(false))
    socket.setTimeout(2000, () => {
      socket.destroy()
      resolve(false)
    })
  })
}

async function reconcileVpnPeers() {
  const peers = await readWireGuardDump()
  const identities = await db
    .select({
      id: vpnIdentities.id,
      deviceId: vpnIdentities.deviceId,
      wireguardPublicKey: vpnIdentities.wireguardPublicKey,
      vpnIpv4: vpnIdentities.vpnIpv4,
      serverPeerEnabled: vpnIdentities.serverPeerEnabled,
      revokedAt: vpnIdentities.revokedAt,
      lastHandshakeAt: vpnIdentities.lastHandshakeAt,
      latestEndpoint: vpnIdentities.latestEndpoint,
      rxBytes: vpnIdentities.rxBytes,
      txBytes: vpnIdentities.txBytes,
      routePolicyRoutes: routePolicies.routes,
    })
    .from(vpnIdentities)
    .leftJoin(routePolicies, eq(routePolicies.id, vpnIdentities.routePolicyId))

  const adminProfiles = await db.select().from(adminVpnProfiles)

  const peerByPublicKey = new Map(peers.map((peer) => [peer.publicKey, peer]))
  const routeSet = new Set<string>()
  const knownPublicKeys = new Set<string>()

  for (const identity of identities) {
    knownPublicKeys.add(identity.wireguardPublicKey)
    const peer = peerByPublicKey.get(identity.wireguardPublicKey)
    const allowedIps = buildServerPeerAllowedIps({
      vpnIp: identity.vpnIpv4,
      routePolicyRoutes: identity.routePolicyRoutes ?? [],
    })

    if (!identity.serverPeerEnabled || identity.revokedAt) {
      await invokeVpnctl(
        buildRemovePeerCommand({ publicKey: identity.wireguardPublicKey })
      )
      await db
        .update(vpnIdentities)
        .set({
          lastHandshakeAt: peer?.latestHandshakeAt ?? identity.lastHandshakeAt,
          rxBytes: peer?.rxBytes ?? identity.rxBytes,
          txBytes: peer?.txBytes ?? identity.txBytes,
        })
        .where(eq(vpnIdentities.id, identity.id))
      continue
    }

    for (const route of identity.routePolicyRoutes ?? []) {
      routeSet.add(route)
    }

    await invokeVpnctl(
      buildAddPeerCommand({
        publicKey: identity.wireguardPublicKey,
        allowedIps,
      })
    )

    if (!peer) {
      await db.insert(auditEvents).values({
        deviceId: identity.deviceId,
        eventType: "vpn_peer_added",
        eventData: { vpnIpv4: identity.vpnIpv4 },
      })
      continue
    }

    await db
      .update(vpnIdentities)
      .set({
        lastHandshakeAt: peer.latestHandshakeAt,
        latestEndpoint: peer.endpoint,
        rxBytes: peer.rxBytes,
        txBytes: peer.txBytes,
      })
      .where(eq(vpnIdentities.id, identity.id))
  }

  const deviceIpsByOrganization = new Map<string, string[]>()
  const deviceRows = await db
    .select({
      organizationId: devices.organizationId,
      vpnIpv4: vpnIdentities.vpnIpv4,
      revokedAt: vpnIdentities.revokedAt,
      serverPeerEnabled: vpnIdentities.serverPeerEnabled,
    })
    .from(devices)
    .innerJoin(vpnIdentities, eq(vpnIdentities.deviceId, devices.id))
    .where(
      and(
        eq(vpnIdentities.serverPeerEnabled, true),
        isNull(vpnIdentities.revokedAt)
      )
    )

  for (const row of deviceRows) {
    const list = deviceIpsByOrganization.get(row.organizationId) ?? []
    list.push(ensureHostRoute(String(row.vpnIpv4)))
    deviceIpsByOrganization.set(row.organizationId, list)
  }

  const adminForwards: AdminForwardRule[] = []

  for (const profile of adminProfiles) {
    knownPublicKeys.add(profile.wireguardPublicKey)
    const peer = peerByPublicKey.get(profile.wireguardPublicKey)
    const allowedIps = buildServerPeerAllowedIps({
      vpnIp: profile.vpnIpv4,
    })

    if (!profile.serverPeerEnabled || profile.revokedAt) {
      await invokeVpnctl(
        buildRemovePeerCommand({ publicKey: profile.wireguardPublicKey })
      )
      await db
        .update(adminVpnProfiles)
        .set({
          lastHandshakeAt: peer?.latestHandshakeAt ?? profile.lastHandshakeAt,
          rxBytes: peer?.rxBytes ?? profile.rxBytes,
          txBytes: peer?.txBytes ?? profile.txBytes,
          updatedAt: new Date(),
        })
        .where(eq(adminVpnProfiles.id, profile.id))
      continue
    }

    await invokeVpnctl(
      buildAddPeerCommand({
        publicKey: profile.wireguardPublicKey,
        allowedIps,
      })
    )

    const destinations =
      deviceIpsByOrganization.get(profile.organizationId) ?? []
    if (destinations.length > 0) {
      adminForwards.push({
        sourceIp: String(profile.vpnIpv4),
        destinationIps: destinations,
      })
    }

    if (!peer) {
      await db.insert(auditEvents).values({
        actorUserId: profile.userId,
        organizationId: profile.organizationId,
        eventType: "admin_vpn_peer_added",
        eventData: { vpnIpv4: profile.vpnIpv4, profileId: profile.id },
      })
      continue
    }

    await db
      .update(adminVpnProfiles)
      .set({
        lastHandshakeAt: peer.latestHandshakeAt,
        latestEndpoint: peer.endpoint,
        rxBytes: peer.rxBytes,
        txBytes: peer.txBytes,
        updatedAt: new Date(),
      })
      .where(eq(adminVpnProfiles.id, profile.id))
  }

  for (const peer of peers) {
    if (knownPublicKeys.has(peer.publicKey)) {
      continue
    }

    await invokeVpnctl(buildRemovePeerCommand({ publicKey: peer.publicKey }))
  }

  await invokeVpnctl(
    buildSyncFirewallCommand({
      allowedRoutes: [...routeSet],
      adminForwards,
      snatTo: vpnServerIp,
    })
  )
}

function ensureHostRoute(value: string) {
  const ip = normalizeVpnIpv4(value)
  return value.includes("/") ? value.trim() : `${ip}/32`
}

async function refreshServiceHealth() {
  const services = await db.select().from(managementServices)

  for (const service of services) {
    const [device] = await db
      .select()
      .from(devices)
      .where(eq(devices.id, service.deviceId))
    if (!device) {
      continue
    }

    const identity = await db
      .select()
      .from(vpnIdentities)
      .where(eq(vpnIdentities.deviceId, device.id))
      .then((rows) => rows[0] ?? null)

    if (!identity) {
      continue
    }

    const host = normalizeVpnIpv4(String(identity.vpnIpv4))
    const reachable = await tcpReachable(host, service.port)
    const status = deriveDeviceStatus({
      handshakeAt: identity.lastHandshakeAt,
      serviceReachable: reachable,
      revoked: Boolean(identity.revokedAt),
    })

    await db
      .update(devices)
      .set({
        status,
        lastSeenAt: new Date(),
      })
      .where(eq(devices.id, device.id))

    await db
      .update(managementServices)
      .set({
        healthStatus: reachable ? "online" : "offline",
        lastCheckedAt: new Date(),
      })
      .where(eq(managementServices.id, service.id))
  }
}

async function main() {
  const queue = new Queue("management-maintenance", {
    connection,
  })

  const worker = new Worker(
    "management-maintenance",
    async (job) => {
      switch (job.name) {
        case "reconcile-vpn":
          await reconcileVpnPeers()
          break
        case "refresh-services":
          await refreshServiceHealth()
          break
        default:
          break
      }
    },
    {
      connection,
      concurrency: 2,
    }
  )

  worker.on("completed", (job) => {
    console.info("completed", job.name)
  })

  worker.on("failed", (job, error) => {
    console.error("failed", job?.name, error)
  })

  await queue.addBulk([
    { name: "reconcile-vpn", data: {} },
    { name: "refresh-services", data: {} },
  ])

  setInterval(() => {
    void queue.add("reconcile-vpn", {})
    void queue.add("refresh-services", {})
  }, 60_000)
}

void main()
