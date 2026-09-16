import assert from "node:assert/strict"
import test from "node:test"

import { channelMatchesAlert, channelMatchesSite } from "./filters"

test("matches when filters are empty", () => {
  assert.equal(
    channelMatchesAlert(
      { minSeverity: "info", alertKinds: [], siteIds: [] },
      { kind: "device_offline", severity: "warning", siteId: "site-1" }
    ),
    true
  )
})

test("rejects alerts below the minimum severity", () => {
  assert.equal(
    channelMatchesAlert(
      { minSeverity: "warning", alertKinds: [], siteIds: [] },
      { kind: "new_endpoint", severity: "notice", siteId: null }
    ),
    false
  )
  assert.equal(
    channelMatchesAlert(
      { minSeverity: "warning", alertKinds: [], siteIds: [] },
      { kind: "device_offline", severity: "warning", siteId: null }
    ),
    true
  )
  assert.equal(
    channelMatchesAlert(
      { minSeverity: "warning", alertKinds: [], siteIds: [] },
      { kind: "firewall_sync_failed", severity: "critical", siteId: null }
    ),
    true
  )
})

test("restricts to selected alert kinds", () => {
  assert.equal(
    channelMatchesAlert(
      {
        minSeverity: "info",
        alertKinds: ["device_offline", "peer_flapping"],
        siteIds: [],
      },
      { kind: "new_endpoint", severity: "notice", siteId: "site-1" }
    ),
    false
  )
  assert.equal(
    channelMatchesAlert(
      {
        minSeverity: "info",
        alertKinds: ["device_offline", "peer_flapping"],
        siteIds: [],
      },
      { kind: "device_offline", severity: "warning", siteId: "site-1" }
    ),
    true
  )
})

test("restricts to selected sites and ignores siteless alerts", () => {
  assert.equal(
    channelMatchesAlert(
      { minSeverity: "info", alertKinds: [], siteIds: ["site-a"] },
      { kind: "device_offline", severity: "warning", siteId: "site-a" }
    ),
    true
  )
  assert.equal(
    channelMatchesAlert(
      { minSeverity: "info", alertKinds: [], siteIds: ["site-a"] },
      { kind: "device_offline", severity: "warning", siteId: "site-b" }
    ),
    false
  )
  assert.equal(
    channelMatchesAlert(
      { minSeverity: "info", alertKinds: [], siteIds: ["site-a"] },
      { kind: "firewall_sync_failed", severity: "critical", siteId: null }
    ),
    false
  )
})

test("matches access-request sites without alert filters", () => {
  assert.equal(channelMatchesSite({ siteIds: [] }, "site-a"), true)
  assert.equal(channelMatchesSite({ siteIds: ["site-a"] }, "site-a"), true)
  assert.equal(channelMatchesSite({ siteIds: ["site-a"] }, "site-b"), false)
  assert.equal(channelMatchesSite({ siteIds: ["site-a"] }, null), false)
})
