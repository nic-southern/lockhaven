import "dotenv/config"

import { execFile } from "node:child_process"
import { promisify } from "node:util"
import net from "node:net"

import { Queue, Worker } from "bullmq"
import Redis from "ioredis"
import { inArray, isNotNull, lte } from "drizzle-orm"

import {
  accessRequests,
  adminVpnProfiles,
  devices,
  eq,
  isNull,
  and,
  managementServices,
  remoteSessions,
  routePolicies,
  sql,
  vpnIdentities,
  vpnPeerSamples,
} from "@nms/db"
import { db } from "@nms/db/client"
import {
  PEER_FLAP_THRESHOLD,
  PEER_FLAP_WINDOW_MS,
  PEER_SAMPLE_INTERVAL_MS,
  PEER_SAMPLE_RETENTION_DAYS,
  sessionRecordingRetentionDays,
} from "@nms/shared"
import {
  pruneSessionRecordingFiles,
  sessionRecordingRoot,
} from "@nms/shared/session-recording"
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
import { runEscalateAlerts } from "./escalate"
import {
  FlowCursorStore,
  flowLogPath,
  ingestFlows,
  pruneConnectionHistory,
  rollupConnections,
} from "./flows"
import { JobHeartbeatStore } from "./heartbeats"
import { offlineAlertHours } from "./lifecycle"
import { processNotificationDeliveries } from "./notify"
import { PeerStateStore, type StoredPeerState } from "./peer-state"
import { sendReportSchedules } from "./report-schedules"
import { refreshRemoteSessions } from "./sessions"
import { pruneUptimeHistory, rollupUptime } from "./uptime"

const execFileAsync = promisify(execFile)

const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379/0"
const vpnctlPath = process.env.VPNCTL_PATH ?? "/usr/local/sbin/vpnctl"
const vpnServerIp = process.env.VPN_SERVER_IP ?? "10.80.0.1"

const connection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
})

const peerStateStore = new PeerStateStore(connection)
const flowCursorStore = new FlowCursorStore(connection)
const heartbeatStore = new JobHeartbeatStore(connection)

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
      mode: "condition",
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
  const offlineHours = await offlineAlertHours(
    identity.organizationId,
    identity.siteId
  )
  if (
    !evaluation.next.online &&
    lastOnlineAt &&
    now.getTime() - lastOnlineAt.getTime() >= offlineHours * 60 * 60 * 1000
  ) {
    await raiseAlert({
      kind: "device_offline",
      mode: "condition",
      dedupeKey: alertKeys.deviceOffline(identity.deviceId),
      organizationId: identity.organizationId,
      siteId: identity.siteId,
      deviceId: identity.deviceId,
      title: `${identity.displayName} has been offline for more than ${offlineHours} hours`,
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
    mode: "condition",
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

/** How many service probes run at once. */
const SERVICE_PROBE_CONCURRENCY = 8

/** A tunnel with no handshake in this window is treated as down. */
const TUNNEL_ONLINE_WINDOW_MS = 3 * 60 * 1000

async function mapConcurrent<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
) {
  let next = 0
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const item = items[next++]
        await fn(item)
      }
    }
  )
  await Promise.all(runners)
}

/**
 * Probes each published service over the tunnel. Devices whose tunnel is
 * down are marked without a probe: every one would otherwise cost a full
 * connect timeout, which is what let this job fall minutes behind.
 */
async function refreshServiceHealth() {
  const now = new Date()
  const rows = await db
    .select({
      serviceId: managementServices.id,
      port: managementServices.port,
      deviceId: devices.id,
      vpnIpv4: vpnIdentities.vpnIpv4,
      lastHandshakeAt: vpnIdentities.lastHandshakeAt,
      revokedAt: vpnIdentities.revokedAt,
    })
    .from(managementServices)
    .innerJoin(devices, eq(devices.id, managementServices.deviceId))
    .innerJoin(vpnIdentities, eq(vpnIdentities.deviceId, devices.id))

  const results = new Map<string, boolean>()

  await mapConcurrent(rows, SERVICE_PROBE_CONCURRENCY, async (row) => {
    const tunnelUp =
      !row.revokedAt &&
      row.lastHandshakeAt !== null &&
      now.getTime() - row.lastHandshakeAt.getTime() < TUNNEL_ONLINE_WINDOW_MS
    const reachable = tunnelUp
      ? await tcpReachable(normalizeVpnIpv4(String(row.vpnIpv4)), row.port)
      : false
    results.set(row.serviceId, reachable)
  })

  const deviceStatus = new Map<
    string,
    { status: ReturnType<typeof deriveDeviceStatus>; online: boolean }
  >()

  for (const row of rows) {
    const reachable = results.get(row.serviceId) ?? false
    const status = deriveDeviceStatus({
      handshakeAt: row.lastHandshakeAt,
      serviceReachable: reachable,
      revoked: Boolean(row.revokedAt),
    })
    // A device with several services is online if any of them answers.
    const current = deviceStatus.get(row.deviceId)
    if (
      !current ||
      (status === "service_online" && current.status !== "service_online")
    ) {
      deviceStatus.set(row.deviceId, {
        status,
        online: status !== "offline" && status !== "revoked",
      })
    }

    await db
      .update(managementServices)
      .set({
        healthStatus: reachable ? "online" : "offline",
        lastCheckedAt: now,
      })
      .where(eq(managementServices.id, row.serviceId))
  }

  for (const [deviceId, entry] of deviceStatus) {
    await db
      .update(devices)
      .set({
        status: entry.status,
        // Only contact over the tunnel counts as having seen the device.
        ...(entry.online ? { lastSeenAt: now } : {}),
      })
      .where(eq(devices.id, deviceId))
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
  await pruneUptimeHistory(now)

  await db
    .update(accessRequests)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        inArray(accessRequests.status, ["pending", "approved"]),
        lte(accessRequests.expiresAt, now)
      )
    )

  const recordingCutoff = new Date(
    now.getTime() - sessionRecordingRetentionDays() * 24 * 60 * 60 * 1000
  )
  await pruneSessionRecordingFiles({
    root: sessionRecordingRoot(),
    cutoff: recordingCutoff,
  })
  await db
    .update(remoteSessions)
    .set({ recordingPath: null })
    .where(
      and(
        isNotNull(remoteSessions.recordingPath),
        lte(remoteSessions.endedAt, recordingCutoff)
      )
    )
}

/**
 * Periodic jobs and how often each recurs. A job scheduler keeps exactly one
 * pending instance per job, so a slow pass delays the next one instead of
 * piling up a backlog that runs hours late.
 */
const schedules: Array<{ name: string; everyMs: number }> = [
  { name: "reconcile-vpn", everyMs: 15_000 },
  { name: "refresh-services", everyMs: 30_000 },
  { name: "refresh-sessions", everyMs: 15_000 },
  { name: "flow-ingest", everyMs: 15_000 },
  { name: "notify", everyMs: 15_000 },
  { name: "escalate-alerts", everyMs: 60_000 },
  { name: "rollup-connections", everyMs: 10 * 60 * 1000 },
  { name: "rollup-uptime", everyMs: 60 * 60 * 1000 },
  { name: "send-report-schedules", everyMs: 60 * 60 * 1000 },
  { name: "prune-history", everyMs: 60 * 60 * 1000 },
]

const everyMsByName = new Map(
  schedules.map((schedule) => [schedule.name, schedule.everyMs])
)

/**
 * Earlier releases enqueued a fresh job every tick regardless of progress and
 * kept every finished job forever. Clear whatever that left behind so the
 * schedulers start from an empty queue.
 */
async function clearLegacyBacklog(queue: Queue) {
  const waiting = await queue.getJobCountByTypes("wait", "delayed", "paused")
  if (waiting > 0) {
    await queue.drain(true)
    console.info("dropped stale queued jobs", { count: waiting })
  }
  for (const state of ["completed", "failed"] as const) {
    let removed = 0
    for (;;) {
      const ids = await queue.clean(0, 10_000, state)
      removed += ids.length
      if (ids.length < 10_000) break
    }
    if (removed > 0) {
      console.info("removed retained job records", { state, count: removed })
    }
  }
}

async function main() {
  const queue = new Queue("management-maintenance", {
    connection,
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: { count: 200 },
    },
  })

  await clearLegacyBacklog(queue)

  for (const schedule of schedules) {
    await queue.upsertJobScheduler(
      schedule.name,
      { every: schedule.everyMs },
      { name: schedule.name, data: {} }
    )
    await heartbeatStore.seed(schedule.name, schedule.everyMs)
  }

  const worker = new Worker(
    "management-maintenance",
    async (job) => {
      const startedAt = Date.now()
      const everyMs = everyMsByName.get(job.name) ?? null
      try {
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
          case "notify":
            await processNotificationDeliveries()
            break
          case "escalate-alerts":
            await runEscalateAlerts()
            break
          case "rollup-connections":
            await rollupConnections()
            break
          case "rollup-uptime":
            await rollupUptime()
            break
          case "send-report-schedules":
            await sendReportSchedules()
            break
          case "prune-history":
            await pruneHistory()
            break
          default:
            break
        }
        await heartbeatStore.recordCompletion({
          name: job.name,
          durationMs: Date.now() - startedAt,
          everyMs,
        })
      } catch (error) {
        await heartbeatStore.recordFailure({
          name: job.name,
          durationMs: Date.now() - startedAt,
          everyMs,
        })
        throw error
      } finally {
        await heartbeatStore.recordQueue(queue)
        if (job.name === "flow-ingest") {
          await heartbeatStore.recordFlowLog(flowLogPath)
        }
      }
    },
    {
      connection,
      concurrency: 4,
    }
  )

  worker.on("completed", (job) => {
    const durationMs =
      job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : 0
    console.info("completed", job.name, `${durationMs}ms`)
  })

  worker.on("failed", (job, error) => {
    console.error("failed", job?.name, error)
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
