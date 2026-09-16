import { and, gte, inArray, lt, sql } from "drizzle-orm"

import { deviceUptimeDaily, devices, vpnPeerSamples } from "@nms/db"
import { db } from "@nms/db/client"
import {
  UPTIME_ROLLUP_RETENTION_DAYS,
  computeDeviceUptimeForDay,
  utcDayEnd,
  utcDayStart,
} from "@nms/shared"

const UPSERT_CHUNK = 200

function priorOnlineAt(
  samples: Array<{ sampledAt: Date; online: boolean }>,
  dayStart: Date
) {
  let prior: boolean | null = null
  const startMs = dayStart.getTime()
  for (const sample of samples) {
    if (sample.sampledAt.getTime() >= startMs) break
    prior = sample.online
  }
  return prior
}

/**
 * Rebuilds daily uptime for recent UTC days from peer samples. Recomputing
 * whole days keeps the job idempotent after a crash.
 */
export async function rollupUptime(now = new Date(), days = 2) {
  const lastDayStart = utcDayStart(now)
  const firstDayStart = new Date(
    lastDayStart.getTime() - (days - 1) * 24 * 60 * 60 * 1000
  )
  const lookback = new Date(firstDayStart.getTime() - 7 * 24 * 60 * 60 * 1000)

  const samples = await db
    .select({
      deviceId: vpnPeerSamples.deviceId,
      sampledAt: vpnPeerSamples.sampledAt,
      online: vpnPeerSamples.online,
    })
    .from(vpnPeerSamples)
    .where(
      and(
        gte(vpnPeerSamples.sampledAt, lookback),
        lt(vpnPeerSamples.sampledAt, now)
      )
    )
    .orderBy(vpnPeerSamples.deviceId, vpnPeerSamples.sampledAt)

  const byDevice = new Map<
    string,
    Array<{ sampledAt: Date; online: boolean }>
  >()
  for (const sample of samples) {
    const list = byDevice.get(sample.deviceId) ?? []
    list.push({ sampledAt: sample.sampledAt, online: sample.online })
    byDevice.set(sample.deviceId, list)
  }

  const deviceIds = [...byDevice.keys()]
  const deviceRows =
    deviceIds.length === 0
      ? []
      : await db
          .select({ id: devices.id })
          .from(devices)
          .where(inArray(devices.id, deviceIds))
  const knownDevices = new Set(deviceRows.map((row) => row.id))

  const dayStarts: Date[] = []
  for (let i = 0; i < days; i += 1) {
    dayStarts.push(new Date(firstDayStart.getTime() + i * 24 * 60 * 60 * 1000))
  }

  const rows: Array<{
    deviceId: string
    day: Date
    onlineMs: number
    observedMs: number
    sampleCount: number
    updatedAt: Date
  }> = []

  for (const deviceId of deviceIds) {
    if (!knownDevices.has(deviceId)) continue
    const deviceSamples = byDevice.get(deviceId) ?? []
    for (const dayStart of dayStarts) {
      const dayEnd = utcDayEnd(dayStart)
      const asOf = dayEnd.getTime() > now.getTime() ? now : undefined
      const computed = computeDeviceUptimeForDay({
        samples: deviceSamples,
        dayStart,
        dayEnd,
        priorOnline: priorOnlineAt(deviceSamples, dayStart),
        asOf,
      })
      if (computed.observedMs === 0 && computed.sampleCount === 0) continue
      rows.push({
        deviceId,
        day: dayStart,
        onlineMs: computed.onlineMs,
        observedMs: computed.observedMs,
        sampleCount: computed.sampleCount,
        updatedAt: now,
      })
    }
  }

  for (let offset = 0; offset < rows.length; offset += UPSERT_CHUNK) {
    const chunk = rows.slice(offset, offset + UPSERT_CHUNK)
    await db
      .insert(deviceUptimeDaily)
      .values(chunk)
      .onConflictDoUpdate({
        target: [deviceUptimeDaily.deviceId, deviceUptimeDaily.day],
        set: {
          onlineMs: sql`excluded.online_ms`,
          observedMs: sql`excluded.observed_ms`,
          sampleCount: sql`excluded.sample_count`,
          updatedAt: sql`excluded.updated_at`,
        },
      })
  }

  return { devices: knownDevices.size, rows: rows.length }
}

export async function pruneUptimeHistory(now = new Date()) {
  const cutoff = new Date(
    now.getTime() - UPTIME_ROLLUP_RETENTION_DAYS * 24 * 60 * 60 * 1000
  )
  await db
    .delete(deviceUptimeDaily)
    .where(sql`${deviceUptimeDaily.day} < ${cutoff}`)
}
