import assert from "node:assert/strict"
import test from "node:test"

import { fillEmptyAssetIdentity } from "@nms/shared"

import { linkedAssetSitePatch, omitTakenSerialFromPatch } from "./asset-link"

test("omitTakenSerialFromPatch drops serial when another asset owns it", () => {
  const patch = omitTakenSerialFromPatch(
    { serial: "PF1A2B3C", hostname: "cab-1" },
    true
  )
  assert.deepEqual(patch, { hostname: "cab-1" })
  assert.ok(!("serial" in patch))
})

test("omitTakenSerialFromPatch keeps serial when available", () => {
  const patch = omitTakenSerialFromPatch(
    { serial: "UNIQUE-SN", hostname: "cab-1" },
    false
  )
  assert.deepEqual(patch, { serial: "UNIQUE-SN", hostname: "cab-1" })
})

test("shared chassis serial fill would conflict without omitTakenSerialFromPatch", () => {
  // Create may skip a taken serial; fill must still omit it or check-in rolls back.
  const patch = fillEmptyAssetIdentity(
    {
      serial: null,
      hostname: "8cc58c0bc3a3",
      vendor: null,
      model: null,
      deviceModelId: null,
    },
    {
      serialNumber: "PF1A2B3C",
      hostname: "8cc58c0bc3a3",
      manufacturer: null,
      model: null,
    },
    null
  )
  assert.equal(patch.serial, "PF1A2B3C")
  const safe = omitTakenSerialFromPatch(patch, true)
  assert.ok(!("serial" in safe))
  assert.equal(Object.keys(safe).length, 0)
})

test("fillEmptyAssetIdentity does not write synthetic UUID serials onto assets", () => {
  const patch = fillEmptyAssetIdentity(
    {
      serial: null,
      hostname: "8cc58c0bc3a3",
      vendor: null,
      model: null,
      deviceModelId: null,
    },
    {
      serialNumber: "03000200-0400-0500-0006-000700080009",
      hostname: "8cc58c0bc3a3",
      manufacturer: null,
      model: null,
    },
    null
  )
  assert.ok(!("serial" in patch))
})

test("linkedAssetSitePatch moves asset when device site changes", () => {
  assert.deepEqual(linkedAssetSitePatch("site-a", "site-b"), {
    siteId: "site-b",
  })
  assert.deepEqual(linkedAssetSitePatch(null, "site-b"), { siteId: "site-b" })
  assert.deepEqual(linkedAssetSitePatch("site-a", null), { siteId: null })
})

test("linkedAssetSitePatch is a no-op when sites already match", () => {
  assert.equal(linkedAssetSitePatch("site-a", "site-a"), null)
  assert.equal(linkedAssetSitePatch(null, null), null)
})
