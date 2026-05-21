import assert from "node:assert/strict"
import test from "node:test"

import {
  allocateVpnIpv4,
  buildClientAllowedIps,
  buildServerPeerAllowedIps,
  normalizeVpnIpv4,
} from "./index"

test("normalizes inet values without breaking /32 allocation", () => {
  assert.equal(normalizeVpnIpv4("10.80.20.11/32"), "10.80.20.11")
  assert.equal(normalizeVpnIpv4("10.80.20.11"), "10.80.20.11")
})

test("skips addresses already returned by inet columns", () => {
  assert.equal(allocateVpnIpv4(["10.80.20.11"], "windows"), "10.80.20.12/32")
  assert.equal(allocateVpnIpv4(["10.80.20.11/32"], "windows"), "10.80.20.12/32")
})

test("adds route policy ranges to client allowed ips", () => {
  assert.deepEqual(
    buildClientAllowedIps({
      serverIp: "10.80.0.1",
      routePolicyRoutes: ["10.1.0.0/24", "10.1.0.0/24"],
    }),
    ["10.80.0.1/32", "10.1.0.0/24"]
  )
})

test("adds route policy ranges to server peers", () => {
  assert.deepEqual(
    buildServerPeerAllowedIps({
      vpnIp: "10.80.20.11/32",
      routePolicyRoutes: ["10.1.0.0/24"],
    }),
    ["10.80.20.11/32", "10.1.0.0/24"]
  )
})
