import assert from "node:assert/strict"
import test from "node:test"

import {
  analyzeRoutes,
  cidrContains,
  cidrsOverlap,
  classifyCidr,
  diffRoutePolicies,
  parseCidr,
  parseRouteInput,
  routePolicyEntriesSchema,
} from "@nms/shared"

test("parseCidr canonicalizes ranges and rejects garbage", () => {
  const parsed = parseCidr("10.0.0.5/24")
  assert.ok(parsed)
  assert.equal(parsed.cidr, "10.0.0.0/24")
  assert.equal(parsed.hostBitsSet, true)
  assert.equal(parsed.end - parsed.start + 1, 256)

  assert.equal(parseCidr("192.168.1.10")?.cidr, "192.168.1.10/32")
  assert.equal(parseCidr("10.0.0.0/0")?.prefix, 0)

  for (const bad of [
    "",
    "10.0.0/24",
    "10.0.0.256/24",
    "10.0.0.0/33",
    "10.0.0.0/-1",
    "10.0.0.0/24/8",
    "fe80::1/64",
    "not a cidr",
  ]) {
    assert.equal(parseCidr(bad), null, `should reject ${JSON.stringify(bad)}`)
  }
})

test("overlap and containment use address ranges", () => {
  const a = parseCidr("10.0.0.0/16")!
  const b = parseCidr("10.0.5.0/24")!
  const c = parseCidr("10.1.0.0/16")!
  assert.equal(cidrsOverlap(a, b), true)
  assert.equal(cidrsOverlap(a, c), false)
  assert.equal(cidrContains(a, b), true)
  assert.equal(cidrContains(b, a), false)
})

test("classifyCidr recognises private, public, and special ranges", () => {
  assert.equal(classifyCidr(parseCidr("10.1.2.0/24")!), "private")
  assert.equal(classifyCidr(parseCidr("172.20.0.0/16")!), "private")
  assert.equal(classifyCidr(parseCidr("172.32.0.0/16")!), "public")
  assert.equal(classifyCidr(parseCidr("8.8.8.8/32")!), "public")
  assert.equal(classifyCidr(parseCidr("127.0.0.1/32")!), "loopback")
  assert.equal(classifyCidr(parseCidr("169.254.0.0/16")!), "link-local")
  assert.equal(classifyCidr(parseCidr("224.0.0.1/32")!), "multicast")
  assert.equal(classifyCidr(parseCidr("0.0.0.0/0")!), "default")
})

test("analyzeRoutes flags errors, warnings, and overlaps", () => {
  const analysis = analyzeRoutes(
    [
      { cidr: "10.10.0.0/16" },
      { cidr: "10.10.5.0/24", label: "Printers" },
      { cidr: "10.10.0.0/16" },
      { cidr: "0.0.0.0/0" },
      { cidr: "bogus" },
      { cidr: "1.2.3.0/24" },
      { cidr: "10.80.5.1/24" },
      { cidr: "127.0.0.1" },
    ],
    {
      vpnCidr: "10.80.0.0/16",
      otherPolicies: [
        { id: "p2", name: "Warehouse", routes: ["10.10.5.0/25"] },
      ],
    }
  )

  const codesFor = (index: number) =>
    analysis.routes[index].issues.map((issue) => issue.code).sort()

  assert.deepEqual(codesFor(0), ["overlaps_policy"])
  assert.deepEqual(codesFor(1), ["contained_by_entry", "overlaps_policy"])
  assert.deepEqual(codesFor(2), ["duplicate"])
  assert.deepEqual(codesFor(3), ["default_route"])
  assert.deepEqual(codesFor(4), ["invalid"])
  assert.deepEqual(codesFor(5), ["public_range"])
  assert.deepEqual(codesFor(6), ["host_bits", "overlaps_vpn"])
  assert.deepEqual(codesFor(7), ["special_range"])

  assert.equal(analysis.errorCount, 4)
  assert.deepEqual(analysis.normalizedRoutes, [
    "10.10.0.0/16",
    "10.10.5.0/24",
    "1.2.3.0/24",
    "10.80.5.0/24",
  ])
  // /16 already covers the /24, so the union is 65536 + 256 + 256.
  assert.equal(analysis.addressCount, 65536 + 256 + 256)
})

test("analyzeRoutes accepts a clean policy", () => {
  const analysis = analyzeRoutes(
    [{ cidr: "192.168.10.0/24" }, { cidr: "192.168.20.0/24" }],
    { vpnCidr: "10.80.0.0/16" }
  )
  assert.equal(analysis.errorCount, 0)
  assert.equal(analysis.warningCount, 0)
  assert.equal(analysis.issues.length, 0)
})

test("parseRouteInput splits pasted text into entries with labels", () => {
  assert.deepEqual(
    parseRouteInput(
      "10.0.0.0/24 # Office LAN\n192.168.1.0/24 Printers, 172.16.0.5\n\n10.9.0.0/16 // Lab"
    ),
    [
      { cidr: "10.0.0.0/24", label: "Office LAN" },
      { cidr: "192.168.1.0/24", label: "Printers" },
      { cidr: "172.16.0.5", label: null },
      { cidr: "10.9.0.0/16", label: "Lab" },
    ]
  )
})

test("diffRoutePolicies reports shared, unique, and overlapping routes", () => {
  const diff = diffRoutePolicies(
    ["10.0.0.0/24", "10.1.0.0/16", "192.168.0.0/24"],
    ["10.0.0.0/24", "10.1.5.0/24", "172.16.0.0/12"]
  )
  assert.deepEqual(diff.shared, ["10.0.0.0/24"])
  assert.deepEqual(diff.onlyInA, ["10.1.0.0/16", "192.168.0.0/24"])
  assert.deepEqual(diff.onlyInB, ["10.1.5.0/24", "172.16.0.0/12"])
  assert.deepEqual(diff.overlapping, [{ a: "10.1.0.0/16", b: "10.1.5.0/24" }])
})

test("routePolicyEntriesSchema trims and bounds labels", () => {
  const parsed = routePolicyEntriesSchema.parse([
    { cidr: " 10.0.0.0/24 ", label: " LAN " },
  ])
  assert.deepEqual(parsed, [{ cidr: "10.0.0.0/24", label: "LAN" }])
  assert.equal(
    routePolicyEntriesSchema.safeParse([
      { cidr: "10.0.0.0/24", label: "x".repeat(41) },
    ]).success,
    false
  )
})
