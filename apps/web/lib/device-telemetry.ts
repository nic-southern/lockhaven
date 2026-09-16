import { and, eq, lt } from "drizzle-orm"

import {
  deviceMetricsLatest,
  deviceMetricsSamples,
  devicePackages,
} from "@nms/db"
import { db } from "@nms/db/client"
import {
  DEVICE_METRICS_SAMPLE_RETENTION_DAYS,
  diffPackages,
  inventoryFromCheckIn,
  type CheckInMetrics,
  type CheckInPackages,
  type PackageRecord,
} from "@nms/shared"

type TransactionClient = Parameters<typeof db.transaction>[0] extends (
  tx: infer T
) => unknown
  ? T
  : never

function metricsRow(
  deviceId: string,
  now: Date,
  metrics: CheckInMetrics,
  rebootRequired: boolean
) {
  const collectedAt = metrics.collected_at ?? now
  return {
    deviceId,
    collectedAt,
    uptimeSeconds: metrics.uptime_seconds,
    cpuLoad1: metrics.cpu.load1,
    cpuLoad5: metrics.cpu.load5,
    cpuLoad15: metrics.cpu.load15,
    cpuCores: metrics.cpu.cores ?? null,
    memoryTotalBytes: metrics.memory.total_bytes,
    memoryAvailableBytes: metrics.memory.available_bytes,
    memoryUsedBytes: metrics.memory.used_bytes,
    disks: metrics.disks,
    network: metrics.network,
    wgHandshakeAgeSeconds: metrics.wireguard?.handshake_age_seconds ?? null,
    rebootRequired,
    updatedAt: now,
  }
}

async function applyPackageDiff(
  tx: TransactionClient,
  deviceId: string,
  now: Date,
  previous: PackageRecord[],
  next: PackageRecord[]
) {
  const diff = diffPackages(previous, next)

  for (const pkg of diff.removed) {
    await tx
      .delete(devicePackages)
      .where(
        and(
          eq(devicePackages.deviceId, deviceId),
          eq(devicePackages.name, pkg.name),
          eq(devicePackages.source, pkg.source)
        )
      )
  }

  for (const pkg of diff.added) {
    await tx.insert(devicePackages).values({
      deviceId,
      name: pkg.name,
      version: pkg.version,
      source: pkg.source,
      availableVersion: pkg.availableVersion,
      lastSeenAt: now,
    })
  }

  for (const { next: pkg } of diff.updated) {
    await tx
      .update(devicePackages)
      .set({
        version: pkg.version,
        availableVersion: pkg.availableVersion,
        lastSeenAt: now,
      })
      .where(
        and(
          eq(devicePackages.deviceId, deviceId),
          eq(devicePackages.name, pkg.name),
          eq(devicePackages.source, pkg.source)
        )
      )
  }

  for (const pkg of diff.unchanged) {
    await tx
      .update(devicePackages)
      .set({ lastSeenAt: now })
      .where(
        and(
          eq(devicePackages.deviceId, deviceId),
          eq(devicePackages.name, pkg.name),
          eq(devicePackages.source, pkg.source)
        )
      )
  }

  return diff
}

export async function ingestDeviceTelemetry(
  tx: TransactionClient,
  args: {
    deviceId: string
    now: Date
    metrics?: CheckInMetrics
    packages?: CheckInPackages
  }
) {
  const hasPackages = args.packages !== undefined
  const rebootRequired = args.packages?.reboot_required ?? false

  if (args.metrics) {
    const row = metricsRow(
      args.deviceId,
      args.now,
      args.metrics,
      rebootRequired
    )
    await tx
      .insert(deviceMetricsLatest)
      .values(row)
      .onConflictDoUpdate({
        target: deviceMetricsLatest.deviceId,
        set: {
          collectedAt: row.collectedAt,
          uptimeSeconds: row.uptimeSeconds,
          cpuLoad1: row.cpuLoad1,
          cpuLoad5: row.cpuLoad5,
          cpuLoad15: row.cpuLoad15,
          cpuCores: row.cpuCores,
          memoryTotalBytes: row.memoryTotalBytes,
          memoryAvailableBytes: row.memoryAvailableBytes,
          memoryUsedBytes: row.memoryUsedBytes,
          disks: row.disks,
          network: row.network,
          wgHandshakeAgeSeconds: row.wgHandshakeAgeSeconds,
          ...(hasPackages ? { rebootRequired: row.rebootRequired } : {}),
          updatedAt: row.updatedAt,
        },
      })

    await tx.insert(deviceMetricsSamples).values({
      deviceId: row.deviceId,
      sampledAt: row.collectedAt,
      uptimeSeconds: row.uptimeSeconds,
      cpuLoad1: row.cpuLoad1,
      cpuLoad5: row.cpuLoad5,
      cpuLoad15: row.cpuLoad15,
      cpuCores: row.cpuCores,
      memoryTotalBytes: row.memoryTotalBytes,
      memoryAvailableBytes: row.memoryAvailableBytes,
      memoryUsedBytes: row.memoryUsedBytes,
      disks: row.disks,
      network: row.network,
      wgHandshakeAgeSeconds: row.wgHandshakeAgeSeconds,
      rebootRequired: row.rebootRequired,
    })

    const cutoff = new Date(
      args.now.getTime() -
        DEVICE_METRICS_SAMPLE_RETENTION_DAYS * 24 * 60 * 60 * 1000
    )
    await tx
      .delete(deviceMetricsSamples)
      .where(
        and(
          eq(deviceMetricsSamples.deviceId, args.deviceId),
          lt(deviceMetricsSamples.sampledAt, cutoff)
        )
      )
  } else if (args.packages) {
    await tx
      .update(deviceMetricsLatest)
      .set({ rebootRequired, updatedAt: args.now })
      .where(eq(deviceMetricsLatest.deviceId, args.deviceId))
  }

  if (!args.packages) {
    return
  }

  const existing = await tx
    .select()
    .from(devicePackages)
    .where(eq(devicePackages.deviceId, args.deviceId))

  const previous: PackageRecord[] = existing.map((row) => ({
    name: row.name,
    version: row.version,
    source: row.source,
    availableVersion: row.availableVersion,
  }))
  const next = inventoryFromCheckIn(args.packages)
  await applyPackageDiff(tx, args.deviceId, args.now, previous, next)
}
