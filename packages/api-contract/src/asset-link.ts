import { and, eq, inArray, isNull, sql } from "drizzle-orm"

import { assets, auditEvents, deviceModels, devices } from "@nms/db"
import { db } from "@nms/db/client"
import {
  fillEmptyAssetIdentity,
  matchAssetToDevice,
  matchDeviceModel,
  severityForEvent,
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
 * Org-unique serial check used by fill. Shared SMBIOS placeholders must not
 * abort a check-in: if another asset already owns the serial, drop it from the
 * patch or the whole check-in transaction rolls back and the agent looks stale
 * while the tunnel stays up.
 */
async function serialTakenInOrganization(
  client: AssetLinkDb,
  organizationId: string,
  serial: string,
  excludeAssetId?: string
) {
  const normalized = serial.replace(/[\s-]+/g, "").toUpperCase()
  const conditions = [
    eq(assets.organizationId, organizationId),
    sql`replace(upper(coalesce(${assets.serial}, '')), '-', '') = ${normalized}`,
  ]
  if (excludeAssetId) {
    conditions.push(sql`${assets.id} <> ${excludeAssetId}`)
  }
  const [row] = await client
    .select({ id: assets.id })
    .from(assets)
    .where(and(...conditions))
    .limit(1)
  return Boolean(row)
}

/** Drop `serial` from a fill patch when another asset already owns it. */
export function omitTakenSerialFromPatch<T extends { serial?: string | null }>(
  patch: T,
  taken: boolean
): T {
  if (!taken || patch.serial == null) return patch
  const rest = { ...patch }
  delete rest.serial
  return rest
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
  let patch = fillEmptyAssetIdentity(
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
  if (patch.serial) {
    const taken = await serialTakenInOrganization(
      client,
      device.organizationId,
      patch.serial,
      assetId
    )
    patch = omitTakenSerialFromPatch(patch, taken)
  }
  if (Object.keys(patch).length === 0) {
    return { assetId, created: false as const }
  }

  await client
    .update(assets)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(assets.id, assetId))
  return { assetId, created: false as const }
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
 * Pure decision for operator-driven device site moves: copy the device site
 * onto the linked asset when they differ (including clearing to null).
 * Agent check-in/fill paths must not call this — operators own asset site.
 */
export function linkedAssetSitePatch(
  assetSiteId: string | null,
  deviceSiteId: string | null
): { siteId: string | null } | null {
  if (assetSiteId === deviceSiteId) return null
  return { siteId: deviceSiteId }
}

/**
 * Keep a linked asset on the same site as its device after an operator moves
 * (or clears) the device site. When the linked asset is a folder, children
 * inherit the same site. No-op when there is no linked asset or the asset is
 * already on that site.
 */
export async function syncLinkedAssetSite(
  client: AssetLinkDb,
  device: { assetId: string | null; siteId: string | null }
) {
  if (!device.assetId) return null

  const [existing] = await client
    .select({
      id: assets.id,
      siteId: assets.siteId,
      isContainer: assets.isContainer,
    })
    .from(assets)
    .where(eq(assets.id, device.assetId))
    .limit(1)
  if (!existing) return null

  const patch = linkedAssetSitePatch(existing.siteId, device.siteId)
  if (!patch) {
    return { assetId: existing.id, siteId: existing.siteId, changed: false }
  }

  await client
    .update(assets)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(assets.id, existing.id))

  if (existing.isContainer) {
    await client
      .update(assets)
      .set({ siteId: patch.siteId, updatedAt: new Date() })
      .where(eq(assets.parentAssetId, existing.id))
  }

  return { assetId: existing.id, siteId: patch.siteId, changed: true }
}

/**
 * Bulk variant for assign-site: move every linked asset onto `siteId`.
 * Skips devices with no linked asset. Already-matching rows are left alone.
 * Folder children inherit the same site.
 */
export async function syncLinkedAssetSites(
  client: AssetLinkDb,
  rows: Array<{ assetId: string | null }>,
  siteId: string | null
) {
  const assetIds = [
    ...new Set(
      rows
        .map((row) => row.assetId)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ]
  if (assetIds.length === 0) return { updated: 0 }

  const matched = await client
    .select({
      id: assets.id,
      siteId: assets.siteId,
      isContainer: assets.isContainer,
    })
    .from(assets)
    .where(inArray(assets.id, assetIds))
  const toUpdate = matched
    .filter((row) => linkedAssetSitePatch(row.siteId, siteId) !== null)
    .map((row) => row.id)
  if (toUpdate.length === 0) return { updated: 0 }

  await client
    .update(assets)
    .set({ siteId, updatedAt: new Date() })
    .where(inArray(assets.id, toUpdate))

  const folderIds = matched
    .filter((row) => toUpdate.includes(row.id) && row.isContainer)
    .map((row) => row.id)
  if (folderIds.length > 0) {
    await client
      .update(assets)
      .set({ siteId, updatedAt: new Date() })
      .where(inArray(assets.parentAssetId, folderIds))
  }

  return { updated: toUpdate.length }
}

/**
 * On attach / enroll / check-in: fill an already-linked asset, or link a
 * matching unmatched asset (serial preferred, then hostname). Never inserts a
 * new assets row — operators create assets from the Console when needed.
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
  if (!match) return null

  const [updated] = await client
    .update(devices)
    .set({ assetId: match.assetId, updatedAt: new Date() })
    .where(and(eq(devices.id, device.id), isNull(devices.assetId)))
    .returning({ id: devices.id })
  if (!updated) return null

  await writeLinkAudit(client, device, match)
  await fillLinkedAsset(client, device, match.assetId, reported)
  return { assetId: match.assetId, created: false as const }
}

/**
 * When a device has no asset yet, attach the first unmatched asset in the
 * same organization whose serial or hostname matches. Agent paths prefer
 * `upsertAssetFromDeviceReport`, which also fills empty identity fields.
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
