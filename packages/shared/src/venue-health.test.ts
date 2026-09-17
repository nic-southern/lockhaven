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
  diskFloorApplies,
  diskFullAlertTitle,
  diskFullThresholdsFrom,
  diskIsSystemVolume,
  diskReadingFromStored,
  diskUsedPercent,
  evaluateDiskFull,
  findFullDisks,
  formatBytes,
  gigabytesToBytes,
  type DiskReading,
} from "./venue-health"

const MiB = 1024 * 1024
const GiB = 1024 * MiB

const defaultThresholds = diskFullThresholdsFrom(null)

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
    floorMinTotalBytes: 16 * GiB,
  })
  assert.deepEqual(agentStaleThresholdsFrom({}), { staleMinutes: 15 })
  assert.deepEqual(
    diskFullThresholdsFrom({ diskUsedPercent: 90, diskFreeBytes: 0 }),
    { usedPercent: 90, freeBytes: 0, floorMinTotalBytes: 16 * GiB }
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
  const thresholds = defaultThresholds
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
    [disk({ mount: "/", totalBytes: 100 * GiB, availableBytes: 1 * GiB })],
    { ...defaultThresholds, usedPercent: 100, freeBytes: 0 }
  )
  assert.equal(full.length, 0)
})

test("boot, firmware, and recovery volumes are never full", () => {
  const efi = disk({
    mount: "/boot/efi",
    filesystem: "vfat",
    totalBytes: 511 * MiB,
    availableBytes: 506 * MiB,
  })
  const boot = disk({
    mount: "/boot",
    filesystem: "ext4",
    totalBytes: 1 * GiB,
    availableBytes: 40 * MiB,
  })
  const firmware = disk({
    mount: "/boot/firmware/",
    filesystem: "vfat",
    totalBytes: 256 * MiB,
    availableBytes: 200 * MiB,
  })
  const recovery = disk({
    mount: "/recovery",
    filesystem: "ext4",
    totalBytes: 4 * GiB,
    availableBytes: 100 * MiB,
  })
  const root = disk({
    mount: "/",
    totalBytes: 240 * GiB,
    availableBytes: 1 * GiB,
  })

  for (const volume of [efi, boot, firmware, recovery]) {
    assert.equal(diskIsSystemVolume(volume), true, volume.mount)
  }
  assert.equal(diskIsSystemVolume(root), false)

  const { full, skipped } = evaluateDiskFull(
    [efi, boot, firmware, recovery, root],
    defaultThresholds
  )
  assert.deepEqual(
    full.map((entry) => [entry.mount, entry.reasons]),
    [["/", ["percent", "free_bytes"]]]
  )
  assert.deepEqual(
    skipped.map((entry) => [entry.mount, entry.skipped]),
    [
      ["/recovery", "system_volume"],
      ["/boot", "system_volume"],
      ["/boot/firmware/", "system_volume"],
      ["/boot/efi", "system_volume"],
    ]
  )
})

test("FAT-family filesystems and system labels mark a volume as system", () => {
  assert.equal(
    diskIsSystemVolume({ mount: "/mnt/esp", filesystem: "vfat" }),
    true
  )
  assert.equal(
    diskIsSystemVolume({ mount: "/mnt/esp", filesystem: "FAT32" }),
    true
  )
  assert.equal(
    diskIsSystemVolume({ mount: "/mnt/x", filesystem: "msdos" }),
    true
  )
  assert.equal(
    diskIsSystemVolume({
      mount: "E:\\",
      filesystem: "ntfs",
      label: "System Reserved",
    }),
    true
  )
  assert.equal(
    diskIsSystemVolume({
      mount: "E:\\",
      filesystem: "ntfs",
      label: "Recovery",
    }),
    true
  )
  assert.equal(
    diskIsSystemVolume({ mount: "E:\\", filesystem: "ntfs", label: "Games" }),
    false
  )
  assert.equal(
    diskIsSystemVolume({ mount: "/games", filesystem: "exfat" }),
    false
  )
})

test("Windows system volumes without a drive letter are excluded", () => {
  const systemReserved = disk({
    mount: "\\\\?\\Volume{3a1b2c3d-0000-0000-0000-000000000001}\\",
    filesystem: "ntfs",
    totalBytes: 549 * MiB,
    availableBytes: 20 * MiB,
  })
  const recovery = disk({
    mount: "\\\\?\\Volume{3a1b2c3d-0000-0000-0000-000000000002}\\",
    filesystem: "ntfs",
    label: "Recovery",
    totalBytes: 1 * GiB,
    availableBytes: 90 * MiB,
  })
  const efi = disk({
    mount: "\\\\?\\Volume{3a1b2c3d-0000-0000-0000-000000000003}\\",
    filesystem: "fat32",
    totalBytes: 100 * MiB,
    availableBytes: 70 * MiB,
  })
  const games = disk({
    mount: "D:\\",
    filesystem: "ntfs",
    label: "Games",
    totalBytes: 2000 * GiB,
    availableBytes: 500 * GiB,
  })
  const system = disk({
    mount: "C:\\",
    filesystem: "ntfs",
    totalBytes: 240 * GiB,
    availableBytes: 3 * GiB,
  })

  const { full, skipped } = evaluateDiskFull(
    [systemReserved, recovery, efi, games, system],
    defaultThresholds
  )
  assert.deepEqual(
    full.map((entry) => [entry.mount, entry.reasons]),
    [["C:\\", ["percent"]]]
  )
  assert.deepEqual(
    skipped.map((entry) => entry.skipped),
    ["system_volume", "system_volume", "system_volume"]
  )
})

test("the free floor only applies to volumes large enough to hold it", () => {
  assert.equal(
    diskFloorApplies({ totalBytes: 8 * GiB }, defaultThresholds),
    false
  )
  assert.equal(
    diskFloorApplies({ totalBytes: 16 * GiB }, defaultThresholds),
    true
  )
  // A 10 GB floor is meaningless on a 20 GB volume: the floor needs at least
  // four times its size.
  assert.equal(
    diskFloorApplies(
      { totalBytes: 20 * GiB },
      { ...defaultThresholds, freeBytes: 10 * GiB }
    ),
    false
  )
  assert.equal(
    diskFloorApplies(
      { totalBytes: 40 * GiB },
      { ...defaultThresholds, freeBytes: 10 * GiB }
    ),
    true
  )
  assert.equal(
    diskFloorApplies(
      { totalBytes: 1 * GiB },
      { ...defaultThresholds, freeBytes: 0 }
    ),
    false
  )
})

test("small volumes are judged by percent only", () => {
  // 8 GB scratch volume with 1.5 GB free: under the 2 GB floor, but only
  // 81% used. Not full.
  const roomy = disk({
    mount: "/scratch",
    totalBytes: 8 * GiB,
    availableBytes: 1.5 * GiB,
  })
  // Same volume with 200 MB free: 97.6% used. Full by percent.
  const packed = disk({
    mount: "/var/cache",
    totalBytes: 8 * GiB,
    availableBytes: 200 * MiB,
  })
  const { full, skipped } = evaluateDiskFull([roomy, packed], defaultThresholds)
  assert.deepEqual(
    full.map((entry) => [entry.mount, entry.reasons]),
    [["/var/cache", ["percent"]]]
  )
  assert.deepEqual(
    skipped.map((entry) => [entry.mount, entry.skipped]),
    [["/scratch", "floor_not_applicable"]]
  )
})

test("the free floor still trips on large volumes", () => {
  const { full, skipped } = evaluateDiskFull(
    [
      disk({
        mount: "/games",
        totalBytes: 2000 * GiB,
        availableBytes: 1 * GiB,
      }),
      disk({ mount: "/", totalBytes: 16 * GiB, availableBytes: 1.9 * GiB }),
      disk({ mount: "/home", totalBytes: 100 * GiB, availableBytes: 10 * GiB }),
    ],
    defaultThresholds
  )
  assert.deepEqual(
    full.map((entry) => [entry.mount, entry.reasons]),
    [
      ["/games", ["percent", "free_bytes"]],
      ["/", ["free_bytes"]],
    ]
  )
  assert.equal(skipped.length, 0)
})

test("nothing is skipped when no excluded volume met a threshold", () => {
  const { full, skipped } = evaluateDiskFull(
    [
      disk({
        mount: "/boot/efi",
        filesystem: "vfat",
        totalBytes: 4 * GiB,
        availableBytes: 3 * GiB,
      }),
      disk({ mount: "/", totalBytes: 100 * GiB, availableBytes: 50 * GiB }),
    ],
    defaultThresholds
  )
  assert.equal(full.length, 0)
  assert.equal(skipped.length, 0)
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
    defaultThresholds
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
      label: null,
      totalBytes: 1000,
      usedBytes: 900,
      availableBytes: 100,
    }
  )
  assert.equal(
    diskReadingFromStored({
      mount: "E:\\",
      label: " System Reserved ",
      total_bytes: 1000,
      used_bytes: 900,
      available_bytes: 100,
    })?.label,
    "System Reserved"
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
    defaultThresholds
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
