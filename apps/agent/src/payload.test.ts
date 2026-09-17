import assert from "node:assert/strict"
import test from "node:test"

import { buildCheckInPayload } from "./payload"

const facts = {
  deviceId: "11111111-1111-4111-8111-111111111111",
  checkInSecret: "secret",
  hostname: "kiosk-01",
  host: {
    hostname: "kiosk-01",
    osFamily: "linux" as const,
    osVersion: "Debian GNU/Linux 12",
    architecture: "x64",
    serialNumber: "abc",
  },
  vpn: { interface_up: true, vpn_ipv4: "10.80.30.11" },
  services: [{ type: "ssh" as const, port: 22, listening: true }],
}

test("builds a check-in payload that keeps hostname and secret fields", () => {
  const payload = buildCheckInPayload(facts)
  assert.equal(payload.device_id, facts.deviceId)
  assert.equal(payload.check_in_secret, facts.checkInSecret)
  assert.equal(payload.hostname, "kiosk-01")
  assert.equal(payload.metrics, undefined)
  assert.equal(payload.packages, undefined)
  assert.equal(payload.titles, undefined)
})

test("includes optional metrics, packages, and titles when collected", () => {
  const payload = buildCheckInPayload({
    ...facts,
    metrics: {
      uptime_seconds: 12,
      cpu: { load1: 0, load5: 0, load15: 0, cores: 2 },
      memory: { total_bytes: 1, available_bytes: 1, used_bytes: 0 },
      disks: [],
      network: [],
      wireguard: { handshake_age_seconds: 4 },
    },
    packages: {
      reboot_required: false,
      installed: [{ name: "curl", version: "8.0.0", source: "apt" }],
      available_updates: [],
    },
    titles: {
      items: [
        {
          key: "cabinet-a",
          title: "Cabinet A",
          build: "2026.04.11",
          config_hash: "abc",
          process_running: true,
          process_name: "game-bin",
        },
      ],
    },
  })
  assert.equal(payload.metrics?.uptime_seconds, 12)
  assert.equal(payload.packages?.installed[0]?.name, "curl")
  assert.equal(payload.titles?.items[0]?.title, "Cabinet A")
  assert.equal(payload.titles?.items[0]?.process_running, true)
})

test("rejects a payload that drops the check-in secret", () => {
  assert.throws(() =>
    buildCheckInPayload({
      ...facts,
      checkInSecret: "",
    })
  )
})
