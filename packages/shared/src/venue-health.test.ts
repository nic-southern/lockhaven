import assert from "node:assert/strict"
import test from "node:test"

import { resolveEffectiveAlertPolicy } from "./alert-lifecycle"
import { shouldSkipQuietAlert } from "./device-archive"
import {
  isClosedHoursQuietKind,
  shouldSkipRaisingAlertForClosedHours,
} from "./site-hours"
import {
  agentStaleAlertTitle,
  agentStaleState,
  agentStaleThresholdsFrom,
  agentStaleWindowStart,
  bytesToGigabytes,
  diskFullAlertTitle,
  diskFullThresholdsFrom,
  diskReadingFromStored,
  diskUsedPercent,
  findFullDisks,
  formatBytes,
  gigabytesToBytes,
  type DiskReading,
} from "./venue-health"

const GiB = 1024 * 1024 * 1024

function disk(
  overrides: Partial<DiskReading> & { mount: string }
): DiskReading {
  const totalBytes = overrides.totalBytes ?? 100 * GiB
  const availableBytes = overrides.availableBytes ?? 50 * GiB
  return {
    filesystem: "ext4",
    usedBytes: totalBytes - availableBytes,
    ...overrides,
    mount: overrides.mount,
    totalBytes,
    availableBytes,
  }
}

test("default thresholds match the product defaults", () => {
  assert.deepEqual(diskFullThresholdsFrom(null), {
    usedPercent: 95,
    freeBytes: 2 * GiB,
  })
  assert.deepEqual(agentStaleThresholdsFrom({}), { staleMinutes: 15 })
  assert.deepEqual(
    diskFullThresholdsFrom({ diskUsedPercent: 90, diskFreeBytes: 0 }),
    { usedPercent: 90, freeBytes: 0 }
  )
})

test("effective policy carries the new thresholds with site over org", () => {
  const defaults = resolveEffectiveAlertPolicy("disk_full", {})
  assert.equal(defaults.severity, "critical")
  assert.equal(defaults.diskUsedPercent, 95)
  assert.equal(defaults.diskFreeBytes, 2 * GiB)
  assert.equal(defaults.agentStaleMinutes, 15)

  const base = {
    organizationId: "org",
    siteId: null,
    enabled: true,
    severity: null,
    escalateAfterMinutes: null,
  }
  const fromSite = resolveEffectiveAlertPolicy("agent_stale", {
    orgPolicy: {
      ...base,
      kind: "agent_stale",
      thresholds: { agentStaleMinutes: 30 },
    },
    sitePolicy: {
      ...base,
      kind: "agent_stale",
      siteId: "site",
      thresholds: { agentStaleMinutes: 10 },
    },
  })
  assert.equal(fromSite.agentStaleMinutes, 10)
  assert.equal(fromSite.severity, "warning")
})

test("a disk is full at the percent threshold or below the free floor", () => {
  const thresholds = { usedPercent: 95, freeBytes: 2 * GiB }
  const full = findFullDisks(
    [
      disk({ mount: "/", totalBytes: 100 * GiB, availableBytes: 4 * GiB }),
      disk({ mount: "/data", totalBytes: 2000 * GiB, availableBytes: 1 * GiB }),
      disk({
        mount: "/games",
        totalBytes: 500 * GiB,
        availableBytes: 100 * GiB,
      }),
    ],
    thresholds
  )
  assert.deepEqual(
    full.map((entry) => [entry.mount, entry.reasons]),
    [
      ["/data", ["percent", "free_bytes"]],
      ["/", ["percent"]],
    ]
  )
})

test("a zero free floor disables the free-bytes check", () => {
  const full = findFullDisks(
    [disk({ mount: "/", totalBytes: 10 * GiB, availableBytes: 1 * GiB })],
    { usedPercent: 95, freeBytes: 0 }
  )
  assert.equal(full.length, 0)
})

test("pseudo and empty filesystems never count as full", () => {
  const full = findFullDisks(
    [
      disk({
        mount: "/run",
        filesystem: "tmpfs",
        totalBytes: 1 * GiB,
        availableBytes: 0,
      }),
      disk({
        mount: "/snap/core",
        filesystem: "squashfs",
        totalBytes: 100 * 1024 * 1024,
        availableBytes: 0,
      }),
      disk({ mount: "/mnt/empty", totalBytes: 0, availableBytes: 0 }),
    ],
    { usedPercent: 95, freeBytes: 2 * GiB }
  )
  assert.equal(full.length, 0)
})

test("used percent is measured from what is left, not raw used bytes", () => {
  // Reserved blocks: used + available < total.
  assert.equal(
    diskUsedPercent({
      totalBytes: 100 * GiB,
      usedBytes: 90 * GiB,
      availableBytes: 5 * GiB,
    }),
    95
  )
  assert.equal(
    diskUsedPercent({ totalBytes: 0, usedBytes: 0, availableBytes: 0 }),
    0
  )
})

test("stored disk rows are read defensively", () => {
  assert.deepEqual(
    diskReadingFromStored({
      mount: " C:\\ ",
      filesystem: "ntfs",
      total_bytes: 1000,
      used_bytes: 900,
      available_bytes: 100,
    }),
    {
      mount: "C:\\",
      filesystem: "ntfs",
      totalBytes: 1000,
      usedBytes: 900,
      availableBytes: 100,
    }
  )
  assert.equal(diskReadingFromStored({ mount: "/" }), null)
  assert.equal(diskReadingFromStored({ total_bytes: 1 }), null)
  assert.equal(diskReadingFromStored(null), null)
  assert.equal(diskReadingFromStored("x"), null)
  assert.equal(
    diskReadingFromStored({
      mount: "/",
      total_bytes: -1,
      used_bytes: 0,
      available_bytes: 0,
    }),
    null
  )
})

test("agent stale needs a check-in older than the window", () => {
  const now = new Date("2026-09-17T18:00:00Z")
  assert.equal(
    agentStaleState({ lastCheckInAt: null, now, staleMinutes: 15 }),
    "unknown"
  )
  assert.equal(
    agentStaleState({
      lastCheckInAt: new Date("2026-09-17T17:50:00Z"),
      now,
      staleMinutes: 15,
    }),
    "fresh"
  )
  assert.equal(
    agentStaleState({
      lastCheckInAt: new Date("2026-09-17T17:44:00Z"),
      now,
      staleMinutes: 15,
    }),
    "stale"
  )
  assert.equal(
    agentStaleState({
      lastCheckInAt: "2026-09-17T17:44:00Z",
      now,
      staleMinutes: 15,
      siteOpenAtWindowStart: null,
    }),
    "stale"
  )
  assert.equal(
    agentStaleState({ lastCheckInAt: "not a date", now, staleMinutes: 15 }),
    "unknown"
  )
})

test("a cabinet that powers up at open gets a full window before it is stale", () => {
  const now = new Date("2026-09-17T18:10:00Z")
  const lastCheckInAt = new Date("2026-09-17T04:00:00Z")
  assert.equal(
    agentStaleState({
      lastCheckInAt,
      now,
      staleMinutes: 15,
      siteOpenAtWindowStart: false,
    }),
    "grace"
  )
  assert.equal(
    agentStaleState({
      lastCheckInAt,
      now,
      staleMinutes: 15,
      siteOpenAtWindowStart: true,
    }),
    "stale"
  )
  assert.equal(
    agentStaleWindowStart(now, 15).toISOString(),
    "2026-09-17T17:55:00.000Z"
  )
})

test("agent stale is quiet while closed; disk full is not", () => {
  assert.equal(isClosedHoursQuietKind("agent_stale"), true)
  assert.equal(isClosedHoursQuietKind("disk_full"), false)
  assert.equal(shouldSkipRaisingAlertForClosedHours("agent_stale", false), true)
  assert.equal(shouldSkipRaisingAlertForClosedHours("agent_stale", true), false)
  assert.equal(shouldSkipRaisingAlertForClosedHours("agent_stale", null), false)
  assert.equal(shouldSkipRaisingAlertForClosedHours("disk_full", false), false)
})

test("archived devices stay quiet for agent stale", () => {
  assert.equal(
    shouldSkipQuietAlert({ archivedAt: new Date(), kind: "agent_stale" }),
    true
  )
  assert.equal(
    shouldSkipQuietAlert({ archivedAt: null, kind: "agent_stale" }),
    false
  )
})

test("titles and byte formatting read as product copy", () => {
  const full = findFullDisks(
    [disk({ mount: "C:\\", totalBytes: 100 * GiB, availableBytes: 1 * GiB })],
    { usedPercent: 95, freeBytes: 2 * GiB }
  )
  assert.equal(
    diskFullAlertTitle("Cabinet 12", full),
    "Cabinet 12 is out of disk space on C:\\ (99% used)"
  )
  assert.equal(
    diskFullAlertTitle("  ", [...full, ...full]),
    "Device is out of disk space on 2 volumes"
  )
  assert.equal(
    diskFullAlertTitle("Cabinet 12", []),
    "Cabinet 12 is out of disk space"
  )
  assert.equal(
    agentStaleAlertTitle("Cabinet 12", 15),
    "Cabinet 12 has not checked in for more than 15 minutes"
  )
  assert.equal(formatBytes(0), "0 B")
  assert.equal(formatBytes(1536), "1.5 KB")
  assert.equal(formatBytes(2 * GiB), "2 GB")
  assert.equal(formatBytes(-5), "0 B")
  assert.equal(gigabytesToBytes(2), 2 * GiB)
  assert.equal(bytesToGigabytes(2 * GiB), 2)
  assert.equal(bytesToGigabytes(1.5 * GiB), 1.5)
})
