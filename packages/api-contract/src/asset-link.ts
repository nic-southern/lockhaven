import { and, eq, inArray, isNull } from "drizzle-orm"

import { assets, auditEvents, devices } from "@nms/db"
import { db } from "@nms/db/client"
import { matchAssetToDevice, severityForEvent } from "@nms/shared"

type TransactionClient = Parameters<typeof db.transaction>[0] extends (
  tx: infer T
) => unknown
  ? T
  : never

export type AssetLinkDb =
  | Pick<typeof db, "select" | "update" | "insert">
  | TransactionClient

export type LinkableDevice = {
  id: string
  organizationId: string
  siteId: string | null
  assetId: string | null
  serialNumber: string | null
  hostname: string | null
}

async function unmatchedAssets(client: AssetLinkDb, organizationId: string) {
  return client
    .select({
      id: assets.id,
      serial: assets.serial,
      hostname: assets.hostname,
      tag: assets.tag,
    })
    .from(assets)
    .leftJoin(devices, eq(devices.assetId, assets.id))
    .where(and(eq(assets.organizationId, organizationId), isNull(devices.id)))
}

async function writeLinkAudit(
  client: AssetLinkDb,
  device: LinkableDevice,
  match: { assetId: string; reason: "serial" | "hostname" }
) {
  await client.insert(auditEvents).values({
    actorUserId: null,
    organizationId: device.organizationId,
    siteId: device.siteId,
    deviceId: device.id,
    eventType: "asset_linked",
    severity: severityForEvent("asset_linked"),
    eventData: {
      assetId: match.assetId,
      reason: match.reason,
      automatic: true,
    },
  })
}

/**
 * When a device has no asset yet, attach the first unmatched asset in the
 * same organization whose serial or hostname matches.
 */
export async function tryLinkDeviceToAsset(
  client: AssetLinkDb,
  device: LinkableDevice
) {
  if (device.assetId) return null
  const candidates = await unmatchedAssets(client, device.organizationId)
  const match = matchAssetToDevice(device, candidates)
  if (!match) return null

  const [updated] = await client
    .update(devices)
    .set({ assetId: match.assetId, updatedAt: new Date() })
    .where(and(eq(devices.id, device.id), isNull(devices.assetId)))
    .returning({ id: devices.id })

  if (!updated) return null
  await writeLinkAudit(client, device, match)
  return match
}

export async function tryLinkDevicesToAssets(
  client: AssetLinkDb,
  rows: LinkableDevice[]
) {
  const pending = rows.filter((row) => !row.assetId)
  if (pending.length === 0) return []

  const organizationIds = [...new Set(pending.map((row) => row.organizationId))]
  const unmatched = await client
    .select({
      id: assets.id,
      organizationId: assets.organizationId,
      serial: assets.serial,
      hostname: assets.hostname,
      tag: assets.tag,
    })
    .from(assets)
    .leftJoin(devices, eq(devices.assetId, assets.id))
    .where(
      and(inArray(assets.organizationId, organizationIds), isNull(devices.id))
    )

  const remaining = new Map<string, typeof unmatched>()
  for (const asset of unmatched) {
    const list = remaining.get(asset.organizationId) ?? []
    list.push(asset)
    remaining.set(asset.organizationId, list)
  }

  const linked: Array<{
    deviceId: string
    assetId: string
    reason: "serial" | "hostname"
  }> = []

  for (const device of pending) {
    const candidates = remaining.get(device.organizationId) ?? []
    const match = matchAssetToDevice(device, candidates)
    if (!match) continue

    const [updated] = await client
      .update(devices)
      .set({ assetId: match.assetId, updatedAt: new Date() })
      .where(and(eq(devices.id, device.id), isNull(devices.assetId)))
      .returning({ id: devices.id })
    if (!updated) continue

    remaining.set(
      device.organizationId,
      candidates.filter((asset) => asset.id !== match.assetId)
    )
    await writeLinkAudit(client, device, match)
    linked.push({ deviceId: device.id, ...match })
  }

  return linked
}
