import { eq } from "drizzle-orm"

import { assets, devices } from "@nms/db"
import { db } from "@nms/db/client"
import { warrantyState } from "@nms/shared"

import { alertKeys, raiseAlert, resolveAlert } from "./alerts"

/**
 * Raise or clear condition alerts when an asset's warranty is within the
 * notice window or already past due.
 */
export async function evaluateWarranties() {
  const rows = await db
    .select({
      id: assets.id,
      tag: assets.tag,
      serial: assets.serial,
      organizationId: assets.organizationId,
      siteId: assets.siteId,
      status: assets.status,
      warrantyExpiresOn: assets.warrantyExpiresOn,
      deviceId: devices.id,
    })
    .from(assets)
    .leftJoin(devices, eq(devices.assetId, assets.id))

  const now = new Date()

  for (const asset of rows) {
    const key = alertKeys.warrantyExpiring(asset.id)
    if (asset.status === "retired" || asset.status === "disposed") {
      await resolveAlert(key, { reason: "retired" })
      continue
    }

    const state = warrantyState(asset.warrantyExpiresOn, now)
    if (state !== "expiring" && state !== "expired") {
      await resolveAlert(key, { reason: state })
      continue
    }

    await raiseAlert({
      kind: "warranty_expiring",
      dedupeKey: key,
      organizationId: asset.organizationId,
      siteId: asset.siteId,
      deviceId: asset.deviceId,
      assetId: asset.id,
      mode: "condition",
      title: state === "expired" ? "Warranty expired" : "Warranty expiring",
      detail: {
        assetTag: asset.tag,
        serial: asset.serial,
        expiresOn: asset.warrantyExpiresOn,
        state,
      },
    })
  }
}
