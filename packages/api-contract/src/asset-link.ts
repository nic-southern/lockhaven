import { and, eq, inArray, isNull, sql } from "drizzle-orm"

import { assets, auditEvents, deviceModels, devices } from "@nms/db"
import { db } from "@nms/db/client"
import {
  fillEmptyAssetIdentity,
  initialAssetIdentityFromAgent,
  matchAssetToDevice,
  matchDeviceModel,
  severityForEvent,
  suggestAssetTrackingTag,
  type AgentReportedAssetIdentity,
} from "@nms/shared"

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

export type DeviceAssetReport = LinkableDevice & {
  manufacturer?: string | null
  model?: string | null
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

async function loadCatalog(client: AssetLinkDb, organizationId: string) {
  return client
    .select({
      id: deviceModels.id,
      manufacturer: deviceModels.manufacturer,
      model: deviceModels.model,
      name: deviceModels.name,
    })
    .from(deviceModels)
    .where(eq(deviceModels.organizationId, organizationId))
}

async function writeLinkAudit(
  client: AssetLinkDb,
  device: LinkableDevice,
  match: { assetId: string; reason: "serial" | "hostname" | "created" }
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

async function allocateTrackingTag(
  client: AssetLinkDb,
  device: LinkableDevice,
  reported: AgentReportedAssetIdentity
) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const tag = suggestAssetTrackingTag({
      deviceId: device.id,
      hostname: reported.hostname,
      serialNumber: reported.serialNumber,
      attempt,
    })
    const [existing] = await client
      .select({ id: assets.id })
      .from(assets)
      .where(
        and(
          eq(assets.organizationId, device.organizationId),
          eq(assets.tag, tag)
        )
      )
      .limit(1)
    if (!existing) return tag
  }
  return suggestAssetTrackingTag({
    deviceId: device.id,
    hostname: reported.hostname,
    serialNumber: `${Date.now()}`,
    attempt: 99,
  })
}

async function fillLinkedAsset(
  client: AssetLinkDb,
  device: DeviceAssetReport,
  assetId: string,
  reported: AgentReportedAssetIdentity
) {
  const [existing] = await client
    .select({
      id: assets.id,
      serial: assets.serial,
      hostname: assets.hostname,
      vendor: assets.vendor,
      model: assets.model,
      deviceModelId: assets.deviceModelId,
    })
    .from(assets)
    .where(eq(assets.id, assetId))
    .limit(1)
  if (!existing) return null

  const catalog = await loadCatalog(client, device.organizationId)
  const catalogModelId = matchDeviceModel(reported, catalog)
  const catalogEntry = catalogModelId
    ? (catalog.find((entry) => entry.id === catalogModelId) ?? null)
    : null
  const patch = fillEmptyAssetIdentity(
    {
      serial: existing.serial,
      hostname: existing.hostname,
      vendor: existing.vendor,
      model: existing.model,
      deviceModelId: existing.deviceModelId,
    },
    reported,
    catalogModelId,
    catalogEntry
  )
  if (Object.keys(patch).length === 0) return { assetId, created: false }

  await client
    .update(assets)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(assets.id, assetId))
  return { assetId, created: false }
}

async function createAndLinkAsset(
  client: AssetLinkDb,
  device: DeviceAssetReport,
  reported: AgentReportedAssetIdentity
) {
  const catalog = await loadCatalog(client, device.organizationId)
  const catalogModelId = matchDeviceModel(reported, catalog)
  const catalogEntry = catalogModelId
    ? (catalog.find((entry) => entry.id === catalogModelId) ?? null)
    : null
  const identity = initialAssetIdentityFromAgent(
    reported,
    catalogModelId,
    catalogEntry
  )
  const tag = await allocateTrackingTag(client, device, reported)

  let serial = identity.serial
  if (serial) {
    const [serialTaken] = await client
      .select({ id: assets.id })
      .from(assets)
      .where(
        and(
          eq(assets.organizationId, device.organizationId),
          sql`replace(upper(coalesce(${assets.serial}, '')), '-', '') = ${serial.replace(/[\s-]+/g, "").toUpperCase()}`
        )
      )
      .limit(1)
    if (serialTaken) serial = null
  }

  const [created] = await client
    .insert(assets)
    .values({
      organizationId: device.organizationId,
      siteId: device.siteId,
      deviceModelId: identity.deviceModelId,
      tag,
      vendor: identity.vendor,
      model: identity.model,
      serial,
      hostname: identity.hostname,
      status: "in_service",
      customFields: {},
    })
    .returning({ id: assets.id })

  if (!created) return null

  const [updated] = await client
    .update(devices)
    .set({ assetId: created.id, updatedAt: new Date() })
    .where(and(eq(devices.id, device.id), isNull(devices.assetId)))
    .returning({ id: devices.id })

  if (!updated) return { assetId: created.id, created: true }

  await client.insert(auditEvents).values({
    actorUserId: null,
    organizationId: device.organizationId,
    siteId: device.siteId,
    deviceId: device.id,
    eventType: "asset_created",
    severity: severityForEvent("asset_created"),
    eventData: {
      assetId: created.id,
      tag,
      automatic: true,
      source: "agent",
    },
  })
  await writeLinkAudit(client, device, {
    assetId: created.id,
    reason: "created",
  })
  return { assetId: created.id, created: true }
}

function reportedIdentity(
  device: DeviceAssetReport
): AgentReportedAssetIdentity {
  return {
    serialNumber: device.serialNumber,
    hostname: device.hostname,
    manufacturer: device.manufacturer ?? null,
    model: device.model ?? null,
  }
}

/**
 * On attach/check-in: fill an existing linked asset, link a matching unmatched
 * asset (serial preferred), or create a short-tag asset and link it.
 */
export async function upsertAssetFromDeviceReport(
  client: AssetLinkDb,
  device: DeviceAssetReport
) {
  const reported = reportedIdentity(device)

  if (device.assetId) {
    return fillLinkedAsset(client, device, device.assetId, reported)
  }

  const candidates = await unmatchedAssets(client, device.organizationId)
  const match = matchAssetToDevice(device, candidates)
  if (match) {
    const [updated] = await client
      .update(devices)
      .set({ assetId: match.assetId, updatedAt: new Date() })
      .where(and(eq(devices.id, device.id), isNull(devices.assetId)))
      .returning({ id: devices.id })
    if (updated) {
      await writeLinkAudit(client, device, match)
      await fillLinkedAsset(client, device, match.assetId, reported)
      return { assetId: match.assetId, created: false }
    }
  }

  return createAndLinkAsset(client, device, reported)
}

/**
 * When a device has no asset yet, attach the first unmatched asset in the
 * same organization whose serial or hostname matches. Prefer
 * `upsertAssetFromDeviceReport` on agent paths so missing assets are created.
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
