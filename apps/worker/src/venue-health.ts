import { and, eq, inArray, sql } from "drizzle-orm"

import { alerts, deviceMetricsLatest, devices } from "@nms/db"
import { db } from "@nms/db/client"
import {
  agentStaleAlertTitle,
  agentStaleState,
  agentStaleWindowStart,
  diskFullAlertTitle,
  diskFullThresholdsFrom,
  diskReadingFromStored,
  evaluateDiskFull as evaluateDisks,
  formatBytes,
  type DiskReading,
  type SkippedDisk,
} from "@nms/shared"

import { alertKeys, raiseAlert, resolveAlert } from "./alerts"
import {
  effectivePolicyFor,
  loadAlertLifecycleState,
  siteOpenFor,
} from "./lifecycle"

type LifecycleState = Awaited<ReturnType<typeof loadAlertLifecycleState>>

type VenueDeviceRow = {
  id: string
  organizationId: string
  siteId: string | null
  displayName: string
  hostname: string | null
  status: string
  archivedAt: Date | null
  agentLastCheckInAt: Date | null
  disks: Array<Record<string, unknown>> | null
  metricsCollectedAt: Date | null
}

async function loadOpenVenueAlertKeys() {
  const rows = await db
    .select({ dedupeKey: alerts.dedupeKey })
    .from(alerts)
    .where(
      and(
        inArray(alerts.kind, ["disk_full", "agent_stale"]),
        sql`${alerts.status} <> 'resolved'`
      )
    )
  return new Set(rows.map((row) => row.dedupeKey))
}

async function resolveIfOpen(
  openKeys: Set<string>,
  key: string,
  detail: Record<string, unknown>
) {
  if (!openKeys.has(key)) return
  await resolveAlert(key, detail)
  openKeys.delete(key)
}

function skippedDiskDetail(disk: SkippedDisk) {
  return {
    mount: disk.mount,
    filesystem: disk.filesystem ?? null,
    label: disk.label ?? null,
    usedPercent: disk.usedPercent,
    available: formatBytes(disk.availableBytes),
    total: formatBytes(disk.totalBytes),
    skipped: disk.skipped,
  }
}

async function evaluateDiskFull(
  state: LifecycleState,
  openKeys: Set<string>,
  device: VenueDeviceRow,
  displayName: string
) {
  const key = alertKeys.diskFull(device.id)
  if (!Array.isArray(device.disks)) return

  const readings = device.disks
    .map(diskReadingFromStored)
    .filter((disk): disk is DiskReading => disk !== null)
  if (readings.length === 0) return

  const policy = effectivePolicyFor(
    state,
    "disk_full",
    device.organizationId,
    device.siteId
  )
  const thresholds = diskFullThresholdsFrom(policy)
  const { full, skipped } = evaluateDisks(readings, thresholds)

  if (full.length === 0) {
    // An alert that only ever pointed at excluded volumes (boot, firmware,
    // recovery, or one too small for the floor) was never a real outage.
    await resolveIfOpen(openKeys, key, {
      resolvedReason:
        skipped.length > 0 ? "volume_excluded" : "space_recovered",
      ...(skipped.length > 0
        ? { excludedDisks: skipped.map(skippedDiskDetail) }
        : {}),
    })
    return
  }

  await raiseAlert({
    kind: "disk_full",
    mode: "condition",
    dedupeKey: key,
    organizationId: device.organizationId,
    siteId: device.siteId,
    deviceId: device.id,
    title: diskFullAlertTitle(displayName, full),
    detail: {
      device: displayName,
      collectedAt: device.metricsCollectedAt?.toISOString() ?? null,
      usedPercentThreshold: thresholds.usedPercent,
      freeBytesThreshold: thresholds.freeBytes,
      floorMinTotalBytes: thresholds.floorMinTotalBytes,
      disks: full.map((disk) => ({
        mount: disk.mount,
        filesystem: disk.filesystem ?? null,
        label: disk.label ?? null,
        usedPercent: disk.usedPercent,
        availableBytes: disk.availableBytes,
        totalBytes: disk.totalBytes,
        available: formatBytes(disk.availableBytes),
        total: formatBytes(disk.totalBytes),
        reasons: disk.reasons,
      })),
    },
  })
}

async function evaluateAgentStale(
  state: LifecycleState,
  openKeys: Set<string>,
  device: VenueDeviceRow,
  displayName: string,
  now: Date
) {
  const key = alertKeys.agentStale(device.id)
  const policy = effectivePolicyFor(
    state,
    "agent_stale",
    device.organizationId,
    device.siteId
  )
  const windowStart = agentStaleWindowStart(now, policy.agentStaleMinutes)
  const staleness = agentStaleState({
    lastCheckInAt: device.agentLastCheckInAt,
    now,
    staleMinutes: policy.agentStaleMinutes,
    siteOpenAtWindowStart: siteOpenFor(state, device.siteId, windowStart),
  })

  if (staleness === "fresh") {
    await resolveIfOpen(openKeys, key, {
      resolvedReason: "checked_in",
      lastCheckInAt: device.agentLastCheckInAt?.toISOString() ?? null,
    })
    return
  }
  if (staleness !== "stale") return

  await raiseAlert({
    kind: "agent_stale",
    mode: "condition",
    dedupeKey: key,
    organizationId: device.organizationId,
    siteId: device.siteId,
    deviceId: device.id,
    title: agentStaleAlertTitle(displayName, policy.agentStaleMinutes),
    detail: {
      device: displayName,
      lastCheckInAt: device.agentLastCheckInAt?.toISOString() ?? null,
      staleMinutes: policy.agentStaleMinutes,
    },
  })
}

/**
 * Raise or clear disk-full and agent-stale for every enrolled device.
 * Disk-full pages regardless of venue hours; agent-stale is a quiet kind and
 * `raiseAlert` skips it while the floor is closed. Archived devices resolve
 * both and never raise either.
 */
export async function evaluateVenueHealth(now = new Date()) {
  const [state, openKeys, rows] = await Promise.all([
    loadAlertLifecycleState(),
    loadOpenVenueAlertKeys(),
    db
      .select({
        id: devices.id,
        organizationId: devices.organizationId,
        siteId: devices.siteId,
        displayName: devices.displayName,
        hostname: devices.hostname,
        status: devices.status,
        archivedAt: devices.archivedAt,
        agentLastCheckInAt: devices.agentLastCheckInAt,
        disks: deviceMetricsLatest.disks,
        metricsCollectedAt: deviceMetricsLatest.collectedAt,
      })
      .from(devices)
      .leftJoin(
        deviceMetricsLatest,
        eq(deviceMetricsLatest.deviceId, devices.id)
      ),
  ])

  for (const device of rows) {
    const displayName = device.displayName || device.hostname || "Device"

    if (
      device.archivedAt ||
      device.status === "revoked" ||
      device.status === "pending"
    ) {
      const reason = device.archivedAt ? "archived" : "not_enrolled"
      await resolveIfOpen(openKeys, alertKeys.diskFull(device.id), {
        resolvedReason: reason,
      })
      await resolveIfOpen(openKeys, alertKeys.agentStale(device.id), {
        resolvedReason: reason,
      })
      continue
    }

    await evaluateDiskFull(state, openKeys, device, displayName)
    await evaluateAgentStale(state, openKeys, device, displayName, now)
  }
}
