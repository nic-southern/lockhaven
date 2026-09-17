import type { AlertPolicyThresholds } from "./alert-lifecycle"
import {
  AGENT_STALE_MINUTES_DEFAULT,
  DISK_FULL_FLOOR_MIN_TOTAL_BYTES_DEFAULT,
  DISK_FULL_FREE_BYTES_DEFAULT,
  DISK_FULL_USED_PERCENT_DEFAULT,
} from "./events"

export type DiskFullThresholds = {
  usedPercent: number
  freeBytes: number
  /**
   * Smallest volume the free-bytes floor applies to. Smaller volumes use the
   * percent threshold only. The floor also never applies to a volume smaller
   * than four times the floor itself.
   */
  floorMinTotalBytes: number
}

export type AgentStaleThresholds = {
  staleMinutes: number
}

export type DiskReading = {
  mount: string
  filesystem?: string | null
  /** Volume label when the agent reports one. */
  label?: string | null
  totalBytes: number
  usedBytes: number
  availableBytes: number
}

export type FullDiskReason = "percent" | "free_bytes"

export type FullDisk = DiskReading & {
  usedPercent: number
  /** Which threshold tripped; a disk may trip both. */
  reasons: FullDiskReason[]
}

export type DiskSkipReason = "system_volume" | "floor_not_applicable"

/** A volume that met a threshold but was deliberately not counted as full. */
export type SkippedDisk = DiskReading & {
  usedPercent: number
  skipped: DiskSkipReason
}

export type DiskFullEvaluation = {
  full: FullDisk[]
  skipped: SkippedDisk[]
}

/** Volumes that never hold game data and are not worth paging on. */
const IGNORED_FILESYSTEMS = new Set([
  "tmpfs",
  "devtmpfs",
  "squashfs",
  "iso9660",
  "overlay",
  "proc",
  "sysfs",
  "cgroup",
  "cgroup2",
  "efivarfs",
  "fuse.snapfuse",
])

/**
 * Boot, firmware, and recovery mount points. These are sized to hold exactly
 * what they hold, so a free-space floor can never be met and a high percent
 * is normal.
 */
const SYSTEM_VOLUME_MOUNTS = new Set([
  "/boot",
  "/boot/efi",
  "/boot/firmware",
  "/efi",
  "/recovery",
])

/** FAT-family filesystems only appear on firmware and boot partitions. */
const SYSTEM_VOLUME_FILESYSTEMS = new Set([
  "vfat",
  "fat",
  "fat12",
  "fat16",
  "fat32",
  "msdos",
  "efi",
])

/** Labels Windows and installers give to system partitions. */
const SYSTEM_VOLUME_LABELS = new Set([
  "system reserved",
  "recovery",
  "efi",
  "efi system partition",
  "esp",
  "system",
  "boot",
  "winre",
  "windows re tools",
])

/** Windows volumes without a drive letter are reported by GUID path. */
const WINDOWS_VOLUME_GUID_PATH = /^\\\\[?.]\\volume\{/i

export const MIN_DISK_FULL_PERCENT = 50
export const MAX_DISK_FULL_PERCENT = 100
export const MIN_AGENT_STALE_MINUTES = 5
export const MAX_AGENT_STALE_MINUTES = 7 * 24 * 60

/** Upper bound for the free-space floor: 1 TiB. */
export const MAX_DISK_FULL_FREE_BYTES = 1024 * 1024 * 1024 * 1024

export function diskFullThresholdsFrom(
  thresholds: Pick<
    AlertPolicyThresholds,
    "diskUsedPercent" | "diskFreeBytes"
  > | null
): DiskFullThresholds {
  return {
    usedPercent: thresholds?.diskUsedPercent ?? DISK_FULL_USED_PERCENT_DEFAULT,
    freeBytes: thresholds?.diskFreeBytes ?? DISK_FULL_FREE_BYTES_DEFAULT,
    floorMinTotalBytes: DISK_FULL_FLOOR_MIN_TOTAL_BYTES_DEFAULT,
  }
}

export function agentStaleThresholdsFrom(
  thresholds: Pick<AlertPolicyThresholds, "agentStaleMinutes"> | null
): AgentStaleThresholds {
  return {
    staleMinutes: thresholds?.agentStaleMinutes ?? AGENT_STALE_MINUTES_DEFAULT,
  }
}

function asNonNegativeInteger(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null
  }
  return Math.floor(value)
}

/**
 * Reads a stored check-in disk entry. Entries missing a mount or sizes are
 * skipped rather than treated as full.
 */
export function diskReadingFromStored(value: unknown): DiskReading | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const mount = typeof row.mount === "string" ? row.mount.trim() : ""
  if (!mount) return null
  const totalBytes = asNonNegativeInteger(row.total_bytes)
  const usedBytes = asNonNegativeInteger(row.used_bytes)
  const availableBytes = asNonNegativeInteger(row.available_bytes)
  if (totalBytes === null || usedBytes === null || availableBytes === null) {
    return null
  }
  const filesystem =
    typeof row.filesystem === "string" && row.filesystem.trim()
      ? row.filesystem.trim()
      : null
  const label =
    typeof row.label === "string" && row.label.trim() ? row.label.trim() : null
  return { mount, filesystem, label, totalBytes, usedBytes, availableBytes }
}

export function diskIsIgnored(disk: Pick<DiskReading, "filesystem">) {
  const filesystem = disk.filesystem?.toLowerCase() ?? ""
  return filesystem !== "" && IGNORED_FILESYSTEMS.has(filesystem)
}

function normalizeMount(mount: string) {
  const lowered = mount.trim().toLowerCase().replace(/\\/g, "/")
  if (lowered.length > 1 && lowered.endsWith("/")) {
    return lowered.replace(/\/+$/, "")
  }
  return lowered
}

/**
 * Boot, firmware, and recovery volumes: matched on mount path, filesystem
 * type, or volume label. Windows volumes with no drive letter (System
 * Reserved, Recovery, EFI) arrive as `\\?\Volume{...}\` paths.
 */
export function diskIsSystemVolume(
  disk: Pick<DiskReading, "mount" | "filesystem" | "label">
) {
  const mount = normalizeMount(disk.mount)
  if (SYSTEM_VOLUME_MOUNTS.has(mount) || mount.startsWith("/boot/")) {
    return true
  }
  if (WINDOWS_VOLUME_GUID_PATH.test(disk.mount.trim())) return true

  const filesystem = disk.filesystem?.trim().toLowerCase() ?? ""
  if (filesystem !== "" && SYSTEM_VOLUME_FILESYSTEMS.has(filesystem)) {
    return true
  }

  const label = disk.label?.trim().toLowerCase().replace(/\s+/g, " ") ?? ""
  return label !== "" && SYSTEM_VOLUME_LABELS.has(label)
}

/**
 * Whether the free-bytes floor is meaningful for a volume. A floor of 2 GB
 * cannot be satisfied by a 500 MB partition, so small volumes are judged by
 * percent only.
 */
export function diskFloorApplies(
  disk: Pick<DiskReading, "totalBytes">,
  thresholds: Pick<DiskFullThresholds, "freeBytes" | "floorMinTotalBytes">
) {
  if (thresholds.freeBytes <= 0) return false
  const minimum = Math.max(
    thresholds.floorMinTotalBytes,
    thresholds.freeBytes * 4
  )
  return disk.totalBytes >= minimum
}

export function diskUsedPercent(
  disk: Pick<DiskReading, "totalBytes" | "usedBytes" | "availableBytes">
) {
  if (disk.totalBytes <= 0) return 0
  // Reserved blocks mean used + available can be less than total; measure
  // what is left for the operator rather than raw used bytes.
  const free = Math.min(disk.availableBytes, disk.totalBytes)
  return Math.round(((disk.totalBytes - free) / disk.totalBytes) * 1000) / 10
}

function byUsedPercentDescending<T extends { usedPercent: number }>(
  left: T,
  right: T
) {
  return right.usedPercent - left.usedPercent
}

/**
 * A disk counts as full when it is at or above the used-percent threshold
 * or has less than the free-bytes floor left (a zero floor disables that
 * check; the floor is skipped for volumes too small to ever hold it).
 * Empty or pseudo filesystems and boot/firmware/recovery volumes never count.
 *
 * `skipped` lists volumes that met a threshold but were excluded, so an
 * alert raised under earlier rules can be resolved with the right reason.
 */
export function evaluateDiskFull(
  disks: DiskReading[],
  thresholds: DiskFullThresholds
): DiskFullEvaluation {
  const full: FullDisk[] = []
  const skipped: SkippedDisk[] = []
  for (const disk of disks) {
    if (disk.totalBytes <= 0 || diskIsIgnored(disk)) continue
    const usedPercent = diskUsedPercent(disk)
    const overPercent = usedPercent >= thresholds.usedPercent
    const underFloor =
      thresholds.freeBytes > 0 && disk.availableBytes < thresholds.freeBytes

    if (diskIsSystemVolume(disk)) {
      if (overPercent || underFloor) {
        skipped.push({ ...disk, usedPercent, skipped: "system_volume" })
      }
      continue
    }

    const reasons: FullDiskReason[] = []
    if (overPercent) reasons.push("percent")
    if (underFloor) {
      if (diskFloorApplies(disk, thresholds)) {
        reasons.push("free_bytes")
      } else if (!overPercent) {
        skipped.push({ ...disk, usedPercent, skipped: "floor_not_applicable" })
      }
    }
    if (reasons.length === 0) continue
    full.push({ ...disk, usedPercent, reasons })
  }
  return {
    full: full.sort(byUsedPercentDescending),
    skipped: skipped.sort(byUsedPercentDescending),
  }
}

export function findFullDisks(
  disks: DiskReading[],
  thresholds: DiskFullThresholds
): FullDisk[] {
  return evaluateDiskFull(disks, thresholds).full
}

export type AgentStaleState = "fresh" | "stale" | "unknown" | "grace"

/**
 * Whether an agent has gone quiet for longer than the threshold.
 * `unknown` when the agent has never checked in.
 * `grace` when the floor opened less than a stale window ago, so a cabinet
 * that powers up at open is given the full window before it is flagged.
 */
export function agentStaleState(args: {
  lastCheckInAt: Date | string | number | null | undefined
  now: Date
  staleMinutes: number
  /** Site open state at the start of the stale window; null when hours are not set. */
  siteOpenAtWindowStart?: boolean | null
}): AgentStaleState {
  if (args.lastCheckInAt == null) return "unknown"
  const last = new Date(args.lastCheckInAt).getTime()
  if (!Number.isFinite(last)) return "unknown"
  const staleMs = Math.max(1, args.staleMinutes) * 60_000
  if (args.now.getTime() - last < staleMs) return "fresh"
  if (args.siteOpenAtWindowStart === false) return "grace"
  return "stale"
}

export function agentStaleWindowStart(now: Date, staleMinutes: number) {
  return new Date(now.getTime() - Math.max(1, staleMinutes) * 60_000)
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const rounded = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded} ${units[unit]}`
}

export function diskFullAlertTitle(displayName: string, disks: FullDisk[]) {
  const name = displayName.trim() || "Device"
  const first = disks[0]
  if (!first) return `${name} is out of disk space`
  if (disks.length === 1) {
    return `${name} is out of disk space on ${first.mount} (${first.usedPercent}% used)`
  }
  return `${name} is out of disk space on ${disks.length} volumes`
}

export function agentStaleAlertTitle(displayName: string, minutes: number) {
  const name = displayName.trim() || "Device"
  return `${name} has not checked in for more than ${minutes} minutes`
}

/** Bytes shown to operators as whole gigabytes. */
export const GIGABYTE = 1024 * 1024 * 1024

export function gigabytesToBytes(value: number) {
  return Math.round(value * GIGABYTE)
}

export function bytesToGigabytes(value: number) {
  return Math.round((value / GIGABYTE) * 100) / 100
}
