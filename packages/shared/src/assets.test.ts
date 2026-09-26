import assert from "node:assert/strict"
import test from "node:test"

import {
  assetLabelQrPayload,
  fillEmptyAssetIdentity,
  initialAssetIdentityFromAgent,
  matchAssetToDevice,
  matchDeviceModel,
  normalizeSerial,
  parseAssetBulkCsv,
  parseCsv,
  parseDeviceBulkCsv,
  parseIsoDate,
  parseMoney,
  parseSiteBulkCsv,
  suggestAssetTrackingTag,
  warrantyState,
} from "./assets"

test("normalizeSerial strips case, spaces, and hyphens", () => {
  assert.equal(normalizeSerial(" sn-abc 12 "), "SNABC12")
  assert.equal(normalizeSerial("  "), null)
  assert.equal(normalizeSerial(null), null)
})

test("suggestAssetTrackingTag is short and stable for the same seed", () => {
  const first = suggestAssetTrackingTag({
    deviceId: "11111111-1111-4111-8111-111111111111",
    hostname: "kiosk-01",
    serialNumber: "SN-LONG-SMBIOS-VALUE",
  })
  const second = suggestAssetTrackingTag({
    deviceId: "11111111-1111-4111-8111-111111111111",
    hostname: "kiosk-01",
    serialNumber: "SN-LONG-SMBIOS-VALUE",
  })
  assert.equal(first, second)
  assert.match(first, /^LH-[0-9A-Z]{6}$/)
  assert.notEqual(first, "SN-LONG-SMBIOS-VALUE")
})

test("assetLabelQrPayload is plain text tag and optional serial", () => {
  assert.equal(assetLabelQrPayload({ tag: "LH-7K2MPQ" }), "LH-7K2MPQ")
  assert.equal(
    assetLabelQrPayload({ tag: "LH-7K2MPQ", serial: "SN-100" }),
    "LH-7K2MPQ\nSN-100"
  )
  assert.equal(assetLabelQrPayload({ tag: "  ", serial: "SN" }), "")
  assert.ok(
    !assetLabelQrPayload({ tag: "LH-1", serial: null }).includes("http")
  )
})

test("matchDeviceModel prefers manufacturer and model together", () => {
  const catalog = [
    { id: "a", manufacturer: "Dell", model: "OptiPlex", name: "Desk" },
    { id: "b", manufacturer: "HP", model: "OptiPlex", name: "Other" },
  ]
  assert.equal(
    matchDeviceModel({ manufacturer: "dell", model: "optiplex" }, catalog),
    "a"
  )
  assert.equal(
    matchDeviceModel({ manufacturer: null, model: "optiplex" }, catalog),
    null
  )
  assert.equal(
    matchDeviceModel({ manufacturer: null, model: "unique" }, [
      { id: "c", manufacturer: null, model: "Unique", name: "Only" },
    ]),
    "c"
  )
})

test("fillEmptyAssetIdentity never clobbers operator values or blanks", () => {
  const patch = fillEmptyAssetIdentity(
    {
      serial: "KEEP",
      hostname: "shop",
      vendor: "Acme",
      model: null,
      deviceModelId: null,
    },
    {
      serialNumber: "NEW",
      hostname: "other",
      manufacturer: "Dell",
      model: "XPS",
    },
    null
  )
  assert.deepEqual(patch, { model: "XPS" })
  assert.ok(!("serial" in patch))
  assert.ok(!("hostname" in patch))
  assert.ok(!("vendor" in patch))
})

test("fillEmptyAssetIdentity links catalog model when empty", () => {
  const patch = fillEmptyAssetIdentity(
    {
      serial: null,
      hostname: null,
      vendor: null,
      model: null,
      deviceModelId: null,
    },
    {
      serialNumber: "SN-1",
      hostname: "pc-1",
      manufacturer: "Dell",
      model: "OptiPlex",
    },
    "model-1",
    { manufacturer: "Dell", model: "OptiPlex 7010" }
  )
  assert.equal(patch.deviceModelId, "model-1")
  assert.equal(patch.vendor, "Dell")
  assert.equal(patch.model, "OptiPlex 7010")
  assert.equal(patch.serial, "SN-1")
})

test("initialAssetIdentityFromAgent creates first-report fields", () => {
  const created = initialAssetIdentityFromAgent(
    {
      serialNumber: "SN-2",
      hostname: "bar",
      manufacturer: "HP",
      model: "Elite",
    },
    null
  )
  assert.equal(created.serial, "SN-2")
  assert.equal(created.hostname, "bar")
  assert.equal(created.vendor, "HP")
  assert.equal(created.model, "Elite")
  assert.equal(created.deviceModelId, null)
})

test("matchAssetToDevice prefers serial over hostname", () => {
  const assets = [
    { id: "host", serial: null, hostname: "shop-pc", tag: "SHOP-PC" },
    { id: "serial", serial: "SN-99", hostname: "other", tag: "TAG-1" },
  ]
  const match = matchAssetToDevice(
    { serialNumber: "sn99", hostname: "shop-pc" },
    assets
  )
  assert.deepEqual(match, { assetId: "serial", reason: "serial" })
})

test("matchAssetToDevice uses hostname or tag when serial is missing", () => {
  const byHost = matchAssetToDevice(
    { serialNumber: null, hostname: "front-desk.local." },
    [{ id: "a", serial: null, hostname: "front-desk.local", tag: "FD-1" }]
  )
  assert.deepEqual(byHost, { assetId: "a", reason: "hostname" })

  const byTag = matchAssetToDevice(
    { serialNumber: null, hostname: "spare-kit" },
    [{ id: "b", serial: null, hostname: null, tag: "spare-kit" }]
  )
  assert.deepEqual(byTag, { assetId: "b", reason: "hostname" })

  const none = matchAssetToDevice({ serialNumber: null, hostname: "unknown" }, [
    { id: "c", serial: "ZZ", hostname: "other", tag: "TAG" },
  ])
  assert.equal(none, null)
})

test("warrantyState windows expired, expiring, and current dates", () => {
  const now = new Date("2026-06-01T12:00:00.000Z")
  assert.equal(warrantyState(null, now), "none")
  assert.equal(warrantyState("2026-05-31", now), "expired")
  assert.equal(warrantyState("2026-06-01", now), "expiring")
  assert.equal(warrantyState("2026-08-15", now), "expiring")
  assert.equal(warrantyState("2026-08-30", now), "expiring")
  assert.equal(warrantyState("2026-09-01", now), "current")
  assert.equal(warrantyState("2026-07-01", now, 10), "current")
})

test("parseCsv handles quotes, commas, and blank lines", () => {
  const parsed = parseCsv('tag,notes\n"A,1","He said ""ok"""\n\nB,plain\n')
  assert.deepEqual(parsed.headers, ["tag", "notes"])
  assert.equal(parsed.rows.length, 2)
  assert.equal(parsed.rows[0].tag, "A,1")
  assert.equal(parsed.rows[0].notes, 'He said "ok"')
  assert.equal(parsed.rows[1].tag, "B")
})

test("parseDeviceBulkCsv matches by id, serial, or host name", () => {
  const result = parseDeviceBulkCsv(
    [
      "id,serial,hostname,display_name,tags,site,notes,asset_tag",
      "11111111-1111-4111-8111-111111111111,, ,Front desk,alpha|beta,Main,Keep nearby,TAG-1",
      ",SN-2,shop-pc,Shop,,Warehouse,,",
      ",,,missing-key,,,,",
    ].join("\n")
  )
  assert.equal(result.rows.length, 2)
  assert.equal(result.errors.length, 1)
  assert.equal(result.rows[0].displayName, "Front desk")
  assert.deepEqual(result.rows[0].tags, ["alpha", "beta"])
  assert.equal(result.rows[1].hostname, "shop-pc")
  assert.equal(result.errors[0].row, 4)
})

test("parseSiteBulkCsv requires organization and name", () => {
  const result = parseSiteBulkCsv(
    [
      "organization,name,timezone,address,contact_name,contact_email",
      "Acme,Warehouse,America/Chicago,1 Main St,Pat,pat@example.com",
      ",No org,,,,",
    ].join("\n")
  )
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].name, "Warehouse")
  assert.equal(result.rows[0].contact?.name, "Pat")
  assert.equal(result.errors.length, 1)
})

test("parseAssetBulkCsv accepts money and calendar dates", () => {
  const result = parseAssetBulkCsv(
    [
      "tag,vendor,serial,status,purchase_cost,warranty_expires_on,site",
      'PRN-1,Brother,SN-9,stock,"$1,240.50",2027-01-15,Main',
      ",missing tag,,,,,,",
      "SW-1,Cisco,SN-8,bogus,12.00,2027-01-15,Main",
    ].join("\n")
  )
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].purchaseCost, "1240.50")
  assert.equal(result.rows[0].status, "stock")
  assert.equal(result.errors.length, 2)
})

test("parseIsoDate and parseMoney reject garbage", () => {
  assert.equal(parseIsoDate("2026-13-01"), null)
  assert.equal(parseIsoDate("2026-02-30"), null)
  assert.equal(
    parseIsoDate("2026-02-01")?.toISOString().slice(0, 10),
    "2026-02-01"
  )
  assert.equal(parseMoney("n/a"), null)
  assert.equal(parseMoney("(12.5)"), "-12.50")
})
