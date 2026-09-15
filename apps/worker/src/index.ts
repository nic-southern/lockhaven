import "dotenv/config"

import { execFile } from "node:child_process"
import { promisify } from "node:util"
import net from "node:net"

import { Queue, Worker } from "bullmq"
import Redis from "ioredis"

import {
  adminVpnProfiles,
  devices,
  eq,
  isNull,
  and,
  managementServices,
  routePolicies,
  sql,
  vpnIdentities,
  vpnPeerSamples,
} from "@nms/db"
import { db } from "@nms/db/client"
import {
  DEVICE_OFFLINE_ALERT_HOURS,
  PEER_FLAP_THRESHOLD,
  PEER_FLAP_WINDOW_MS,
  PEER_SAMPLE_INTERVAL_MS,
  PEER_SAMPLE_RETENTION_DAYS,
} from "@nms/shared"
import {
  buildAddPeerCommand,
  buildRemovePeerCommand,
  buildServerPeerAllowedIps,
  buildSyncFirewallCommand,
  deriveDeviceStatus,
  endpointHost,
  evaluatePeer,
  isFlapping,
  normalizeEndpoint,
  parseWgDump,
  normalizeVpnIpv4,
  sameUserPeerDestinationIps,
  type AdminForwardRule,
  type PeerTransition,
  type WgPeerStats,
} from "@nms/vpn"

import { alertKeys, raiseAlert, resolveAlert } from "./alerts"
import { recordEvent } from "./audit"
import {
  FlowCursorStore,
  ingestFlows,
  pruneConnectionHistory,
  rollupConnections,
} from "./flows"
import { PeerStateStore, type StoredPeerState } from "./peer-state"
import { refreshRemoteSessions } from "./sessions"

const execFileAsync = promisify(execFile)

const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379/0"
const vpnctlPath = process.env.VPNCTL_PATH ?? "/usr/local/sbin/vpnctl"
const vpnServerIp = process.env.VPN_SERVER_IP ?? "10.80.0.1"

const connection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
})

const peerStateStore = new PeerStateStore(connection)
const flowCursorStore = new FlowCursorStore(connection)

type VpnctlResult =
  | { ok: true }
  | { ok: false; unavailable: boolean; message: string }

let warnedVpnctlMissing = false

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

async function invokeVpnctl(args: string[]): Promise<VpnctlResult> {
  try {
    await execFileAsync(vpnctlPath, args, {
      env: process.env,
    })
    return { ok: true }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    const unavailable = code === "ENOENT" || code === "EACCES"
    if (unavailable) {
      if (!warnedVpnctlMissing) {
        console.warn("vpnctl is not available on this host; skipping", {
          path: vpnctlPath,
        })
        warnedVpnctlMissing = true
      }
    } else {
      console.error("vpnctl failed", { args, error })
    }
    return {
      ok: false,
      unavailable,
      message: error instanceof Error ? error.message : String(error),
    }
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

const transitionEventType = {
  up: "vpn_peer_up",
  down: "vpn_peer_down",
  endpoint_changed: "vpn_endpoint_changed",
} as const

const transitionSampleReason = {
  up: "up",
  down: "down",
  endpoint_changed: "endpoint",
} as const

type TrackedIdentity = {
  id: string
  deviceId: string
  organizationId: string
  siteId: string | null
  displayName: string
  vpnIpv4: string
}

async function writePeerSample(args: {
  deviceId: string
  now: Date
  online: boolean
  endpoint: string | null
  lastHandshakeAt: Date | null
  rxBytes: number
  txBytes: number
  reason: string
}) {
  await db.insert(vpnPeerSamples).values({
    deviceId: args.deviceId,
    sampledAt: args.now,
    online: args.online,
    endpoint: args.endpoint,
    lastHandshakeAt: args.lastHandshakeAt,
    rxBytes: args.rxBytes,
    txBytes: args.txBytes,
    reason: args.reason,
  })
}

async function recordTransition(
  identity: TrackedIdentity,
  transition: PeerTransition,
  now: Date
) {
  await recordEvent({
    eventType: transitionEventType[transition.kind],
    organizationId: identity.organizationId,
    siteId: identity.siteId,
    deviceId: identity.deviceId,
    eventData: {
      vpnIpv4: identity.vpnIpv4,
      endpoint: transition.endpoint,
      endpointHost: endpointHost(transition.endpoint),
      previousEndpoint: transition.previousEndpoint,
      previousEndpointHost: endpointHost(transition.previousEndpoint),
      lastHandshakeAt: transition.lastHandshakeAt?.toISOString() ?? null,
      rxBytes: transition.rxBytes,
      txBytes: transition.txBytes,
    },
  })

  await writePeerSample({
    deviceId: identity.deviceId,
    now,
    online: transition.kind !== "down",
    endpoint: transition.endpoint,
    lastHandshakeAt: transition.lastHandshakeAt,
    rxBytes: transition.rxBytes,
    txBytes: transition.txBytes,
    reason: transitionSampleReason[transition.kind],
  })
}

/**
 * Compares this run's reading with the stored state, emits transition
 * events and samples, and keeps device alerts in step with what we saw.
 */
async function observePeer(args: {
  identity: TrackedIdentity
  peer: WgPeerStats | null
  previous: StoredPeerState | null
  now: Date
}): Promise<StoredPeerState> {
  const { identity, peer, previous, now } = args
  const evaluation = evaluatePeer({
    previous,
    peer,
    now,
    sampleIntervalMs: PEER_SAMPLE_INTERVAL_MS,
  })

  const recentTransitions = (previous?.recentTransitions ?? []).filter(
    (item) => now.getTime() - new Date(item).getTime() < PEER_FLAP_WINDOW_MS
  )

  for (const transition of evaluation.transitions) {
    await recordTransition(identity, transition, now)

    if (transition.kind === "up" || transition.kind === "down") {
      recentTransitions.push(now.toISOString())
    }

    if (transition.kind === "up") {
      await resolveAlert(alertKeys.deviceOffline(identity.deviceId), {
        resolvedReason: "peer_up",
        endpoint: transition.endpoint,
      })
    }

    if (transition.kind === "endpoint_changed") {
      await raiseAlert({
        kind: "new_endpoint",
        dedupeKey: alertKeys.newEndpoint(identity.deviceId),
        organizationId: identity.organizationId,
        siteId: identity.siteId,
        deviceId: identity.deviceId,
        title: `${identity.displayName} is connecting from a new address`,
        detail: {
          device: identity.displayName,
          previousEndpoint: transition.previousEndpoint,
          previousEndpointHost: endpointHost(transition.previousEndpoint),
          endpoint: transition.endpoint,
          endpointHost: endpointHost(transition.endpoint),
        },
      })
    }
  }

  if (evaluation.transitions.length === 0 && evaluation.intervalSampleDue) {
    await writePeerSample({
      deviceId: identity.deviceId,
      now,
      online: evaluation.next.online,
      endpoint: evaluation.next.endpoint,
      lastHandshakeAt: peer?.latestHandshakeAt ?? null,
      rxBytes: evaluation.next.rxBytes,
      txBytes: evaluation.next.txBytes,
      reason: "interval",
    })
  }

  const flapping = isFlapping(
    recentTransitions.map((item) => new Date(item)),
    now,
    PEER_FLAP_THRESHOLD,
    PEER_FLAP_WINDOW_MS
  )
  if (flapping) {
    await raiseAlert({
      kind: "peer_flapping",
      dedupeKey: alertKeys.peerFlapping(identity.deviceId),
      organizationId: identity.organizationId,
      siteId: identity.siteId,
      deviceId: identity.deviceId,
      title: `${identity.displayName} tunnel is flapping`,
      detail: {
        device: identity.displayName,
        transitions: recentTransitions.length,
        windowMinutes: PEER_FLAP_WINDOW_MS / 60_000,
      },
    })
  } else if (
    recentTransitions.length === 0 &&
    previous?.recentTransitions.length
  ) {
    await resolveAlert(alertKeys.peerFlapping(identity.deviceId), {
      resolvedReason: "stable",
    })
  }

  const lastOnlineAt = evaluation.next.lastOnlineAt
    ? new Date(evaluation.next.lastOnlineAt)
    : null
  if (
    !evaluation.next.online &&
    lastOnlineAt &&
    now.getTime() - lastOnlineAt.getTime() >=
      DEVICE_OFFLINE_ALERT_HOURS * 60 * 60 * 1000
  ) {
    await raiseAlert({
      kind: "device_offline",
      dedupeKey: alertKeys.deviceOffline(identity.deviceId),
      organizationId: identity.organizationId,
      siteId: identity.siteId,
      deviceId: identity.deviceId,
      title: `${identity.displayName} has been offline for more than ${DEVICE_OFFLINE_ALERT_HOURS} hours`,
      detail: {
        device: identity.displayName,
        lastOnlineAt: lastOnlineAt.toISOString(),
        lastEndpoint: evaluation.next.endpoint,
      },
    })
  }

  return { ...evaluation.next, recentTransitions }
}

async function syncFirewall(command: string[]) {
  const previous = await peerStateStore.loadFirewall()
  const result = await invokeVpnctl(command)
  const now = new Date()

  if (result.ok) {
    if (previous && !previous.ok) {
      await recordEvent({
        eventType: "firewall_synced",
        eventData: { recoveredAfter: previous.changedAt },
      })
      await resolveAlert(alertKeys.firewallSync(), {
        resolvedReason: "sync_succeeded",
      })
    }
    if (!previous || !previous.ok) {
      await peerStateStore.saveFirewall({
        ok: true,
        lastError: null,
        changedAt: now.toISOString(),
      })
    }
    return
  }

  if (result.unavailable) {
    // Not a VPN host; nothing to enforce here.
    return
  }

  if (!previous || previous.ok) {
    await recordEvent({
      eventType: "firewall_sync_failed",
      eventData: { message: result.message },
    })
    await peerStateStore.saveFirewall({
      ok: false,
      lastError: result.message,
      changedAt: now.toISOString(),
    })
  }

  await raiseAlert({
    kind: "firewall_sync_failed",
    dedupeKey: alertKeys.firewallSync(),
    detail: { message: result.message, lastAttemptAt: now.toISOString() },
  })
}

async function reconcileVpnPeers() {
  const now = new Date()
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
      organizationId: devices.organizationId,
      siteId: devices.siteId,
      displayName: devices.displayName,
      hostname: devices.hostname,
    })
    .from(vpnIdentities)
    .innerJoin(devices, eq(devices.id, vpnIdentities.deviceId))
    .leftJoin(routePolicies, eq(routePolicies.id, vpnIdentities.routePolicyId))

  const adminProfiles = await db.select().from(adminVpnProfiles)

  const peerByPublicKey = new Map(peers.map((peer) => [peer.publicKey, peer]))
  const routeSet = new Set<string>()
  const knownPublicKeys = new Set<string>()

  const previousStates = await peerStateStore.loadAll()
  const nextStates = new Map<string, StoredPeerState>()
  const retiredStateKeys: string[] = []

  for (const identity of identities) {
    knownPublicKeys.add(identity.wireguardPublicKey)
    const peer = peerByPublicKey.get(identity.wireguardPublicKey)
    const previous = previousStates.get(identity.id) ?? null
    const allowedIps = buildServerPeerAllowedIps({
      vpnIp: identity.vpnIpv4,
      routePolicyRoutes: identity.routePolicyRoutes ?? [],
    })
    const tracked: TrackedIdentity = {
      id: identity.id,
      deviceId: identity.deviceId,
      organizationId: identity.organizationId,
      siteId: identity.siteId,
      displayName: identity.displayName || identity.hostname || "Device",
      vpnIpv4: String(identity.vpnIpv4),
    }

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

      if (previous) {
        retiredStateKeys.push(identity.id)
        if (previous.online) {
          await recordTransition(
            tracked,
            {
              kind: "down",
              previousEndpoint: previous.endpoint,
              endpoint: previous.endpoint,
              lastHandshakeAt:
                peer?.latestHandshakeAt ?? identity.lastHandshakeAt,
              rxBytes: peer?.rxBytes ?? previous.rxBytes,
              txBytes: peer?.txBytes ?? previous.txBytes,
            },
            now
          )
        }
        for (const key of [
          alertKeys.deviceOffline(identity.deviceId),
          alertKeys.peerFlapping(identity.deviceId),
          alertKeys.newEndpoint(identity.deviceId),
        ]) {
          await resolveAlert(key, { resolvedReason: "peer_revoked" })
        }
      }
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

    if (!previous) {
      await recordEvent({
        eventType: "vpn_peer_added",
        organizationId: identity.organizationId,
        siteId: identity.siteId,
        deviceId: identity.deviceId,
        eventData: { vpnIpv4: identity.vpnIpv4 },
      })
    }

    nextStates.set(
      identity.id,
      await observePeer({
        identity: tracked,
        peer: peer ?? null,
        previous,
        now,
      })
    )

    if (peer) {
      await db
        .update(vpnIdentities)
        .set({
          lastHandshakeAt: peer.latestHandshakeAt,
          latestEndpoint:
            normalizeEndpoint(peer.endpoint) ?? identity.latestEndpoint,
          rxBytes: peer.rxBytes,
          txBytes: peer.txBytes,
        })
        .where(eq(vpnIdentities.id, identity.id))
    }
  }

  for (const key of previousStates.keys()) {
    if (!nextStates.has(key) && !retiredStateKeys.includes(key)) {
      retiredStateKeys.push(key)
    }
  }

  await peerStateStore.saveAll(nextStates, retiredStateKeys)

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

    const destinations = [
      ...(deviceIpsByOrganization.get(profile.organizationId) ?? []),
      ...sameUserPeerDestinationIps(profile, adminProfiles),
    ]
    if (destinations.length > 0) {
      adminForwards.push({
        sourceIp: String(profile.vpnIpv4),
        destinationIps: destinations,
      })
    }

    if (!peer) {
      if (!previousStates.has(`admin:${profile.id}`)) {
        await recordEvent({
          eventType: "admin_vpn_peer_added",
          actorUserId: profile.userId,
          organizationId: profile.organizationId,
          eventData: { vpnIpv4: profile.vpnIpv4, profileId: profile.id },
        })
      }
      continue
    }

    await db
      .update(adminVpnProfiles)
      .set({
        lastHandshakeAt: peer.latestHandshakeAt,
        latestEndpoint:
          normalizeEndpoint(peer.endpoint) ?? profile.latestEndpoint,
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

  await syncFirewall(
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

async function pruneHistory() {
  const now = new Date()
  const cutoff = new Date(
    now.getTime() - PEER_SAMPLE_RETENTION_DAYS * 24 * 60 * 60 * 1000
  )
  await db
    .delete(vpnPeerSamples)
    .where(sql`${vpnPeerSamples.sampledAt} < ${cutoff}`)
  await pruneConnectionHistory(now)
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
        case "refresh-sessions":
          await refreshRemoteSessions()
          break
        case "flow-ingest":
          await ingestFlows(flowCursorStore)
          break
        case "rollup-connections":
          await rollupConnections()
          break
        case "prune-history":
          await pruneHistory()
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
    { name: "refresh-sessions", data: {} },
    { name: "flow-ingest", data: {} },
    { name: "rollup-connections", data: {} },
    { name: "prune-history", data: {} },
  ])

  setInterval(() => {
    void queue.add("reconcile-vpn", {})
    void queue.add("refresh-services", {})
    void queue.add("refresh-sessions", {})
    void queue.add("flow-ingest", {})
  }, 15_000)

  setInterval(
    () => {
      void queue.add("rollup-connections", {})
    },
    10 * 60 * 1000
  )

  setInterval(
    () => {
      void queue.add("prune-history", {})
    },
    60 * 60 * 1000
  )
}

void main()
