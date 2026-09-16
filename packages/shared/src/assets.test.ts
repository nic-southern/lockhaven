import assert from "node:assert/strict"
import test from "node:test"

import {
  matchAssetToDevice,
  normalizeSerial,
  parseAssetBulkCsv,
  parseCsv,
  parseDeviceBulkCsv,
  parseIsoDate,
  parseMoney,
  parseSiteBulkCsv,
  warrantyState,
} from "./assets"

test("normalizeSerial strips case, spaces, and hyphens", () => {
  assert.equal(normalizeSerial(" sn-abc 12 "), "SNABC12")
  assert.equal(normalizeSerial("  "), null)
  assert.equal(normalizeSerial(null), null)
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
