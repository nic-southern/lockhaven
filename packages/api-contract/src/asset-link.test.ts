import assert from "node:assert/strict"
import test from "node:test"

import { fillEmptyAssetIdentity } from "@nms/shared"

import { omitTakenSerialFromPatch } from "./asset-link"

test("omitTakenSerialFromPatch drops serial when another asset owns it", () => {
  const patch = omitTakenSerialFromPatch(
    { serial: "03000200-0400-0500-0006-000700080009", hostname: "cab-1" },
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

test("shared placeholder serial fill would conflict without omitTakenSerialFromPatch", () => {
  // Reproduce the Demo/VFW TRT failure mode: create skipped the shared
  // placeholder serial, then fillEmpty tried to write it on the next check-in.
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
  assert.equal(patch.serial, "03000200-0400-0500-0006-000700080009")
  const safe = omitTakenSerialFromPatch(patch, true)
  assert.ok(!("serial" in safe))
  assert.equal(Object.keys(safe).length, 0)
})
