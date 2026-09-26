import assert from "node:assert/strict"
import test from "node:test"

import {
  buildMorningOpsTiles,
  countInstallNowDevices,
  morningOpsAllClear,
  morningOpsLinks,
  summarizeMorningAlertCounts,
} from "./morning-ops"

test("countInstallNowDevices counts distinct devices", () => {
  assert.equal(countInstallNowDevices([]), 0)
  assert.equal(
    countInstallNowDevices([
      { deviceId: "d1" },
      { deviceId: "d1" },
      { deviceId: "d2" },
    ]),
    2
  )
})

test("summarizeMorningAlertCounts clamps negatives and fills notice/info", () => {
  assert.deepEqual(
    summarizeMorningAlertCounts({
      open: 3,
      acknowledged: 1,
      critical: 2,
      warning: 1,
      agentStale: 4,
    }),
    {
      open: 3,
      acknowledged: 1,
      critical: 2,
      warning: 1,
      notice: 0,
      info: 0,
      agentStale: 4,
    }
  )
  assert.equal(
    summarizeMorningAlertCounts({
      open: -1,
      acknowledged: 0,
      critical: 0,
      warning: 0,
      agentStale: -2,
    }).open,
    0
  )
})

test("buildMorningOpsTiles uses calm empty-state hints when clear", () => {
  const tiles = buildMorningOpsTiles({
    alerts: {
      open: 0,
      acknowledged: 0,
      critical: 0,
      warning: 0,
      notice: 0,
      info: 0,
      agentStale: 0,
    },
    devices: {
      total: 10,
      online: 10,
      offline: 0,
      never: 0,
      needsAttention: 0,
    },
    patches: { deviceCount: 0, packageCount: 0 },
    sessions: { last24h: 0, active: 0 },
    liveInfrastructureGrants: 0,
  })

  assert.equal(tiles.length, 6)
  assert.ok(morningOpsAllClear(tiles))
  assert.equal(
    tiles.some((tile) => tile.id === "expected_loss"),
    false
  )
  const byId = Object.fromEntries(tiles.map((tile) => [tile.id, tile]))
  assert.equal(byId.alerts?.hint, "Nothing waiting on you")
  assert.equal(byId.patches?.hint, "No security updates waiting")
  assert.equal(byId.offline?.hint, "Every enrolled device has connected")
  assert.equal(byId.agent_stale?.hint, "Agents are checking in")
  assert.equal(byId.sessions?.hint, "No remote sessions in the last day")
  assert.equal(byId.live_grants?.hint, "No live infrastructure access")
  assert.equal(byId.alerts?.href, morningOpsLinks.alerts)
})

test("buildMorningOpsTiles deep-links critical alerts and warns on patches", () => {
  const tiles = buildMorningOpsTiles({
    alerts: {
      open: 5,
      acknowledged: 1,
      critical: 2,
      warning: 3,
      notice: 0,
      info: 0,
      agentStale: 1,
    },
    devices: {
      total: 20,
      online: 15,
      offline: 4,
      never: 1,
      needsAttention: 5,
    },
    patches: { deviceCount: 3, packageCount: 7 },
    sessions: { last24h: 12, active: 2 },
    liveInfrastructureGrants: 1,
  })

  const byId = Object.fromEntries(tiles.map((tile) => [tile.id, tile]))
  assert.equal(byId.alerts?.href, morningOpsLinks.alertsCritical)
  assert.equal(byId.alerts?.tone, "danger")
  assert.equal(byId.alerts?.empty, false)
  assert.equal(byId.patches?.value, "3")
  assert.equal(byId.patches?.tone, "warning")
  assert.match(byId.patches?.hint ?? "", /7 updates/)
  assert.equal(byId.offline?.value, "5")
  assert.match(byId.offline?.hint ?? "", /never connected/)
  assert.equal(byId.agent_stale?.href, morningOpsLinks.alertsAgentStale)
  assert.equal(byId.sessions?.hint, "2 still open")
  assert.equal(byId.live_grants?.tone, "online")
  assert.equal(morningOpsAllClear(tiles), false)
})
