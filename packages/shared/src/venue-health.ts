import type { AlertPolicyThresholds } from "./alert-lifecycle"
import {
  AGENT_STALE_MINUTES_DEFAULT,
  DISK_FULL_FREE_BYTES_DEFAULT,
  DISK_FULL_USED_PERCENT_DEFAULT,
} from "./events"

export type DiskFullThresholds = {
  usedPercent: number
  freeBytes: number
}

export type AgentStaleThresholds = {
  staleMinutes: number
}

export type DiskReading = {
  mount: string
  filesystem?: string | null
  totalBytes: number
  usedBytes: number
  availableBytes: number
}

export type FullDisk = DiskReading & {
  usedPercent: number
  /** Which threshold tripped; a disk may trip both. */
  reasons: Array<"percent" | "free_bytes">
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
  return { mount, filesystem, totalBytes, usedBytes, availableBytes }
}

export function diskIsIgnored(disk: Pick<DiskReading, "filesystem">) {
  const filesystem = disk.filesystem?.toLowerCase() ?? ""
  return filesystem !== "" && IGNORED_FILESYSTEMS.has(filesystem)
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

/**
 * A disk counts as full when it is at or above the used-percent threshold
 * or has less than the free-bytes floor left (a zero floor disables that
 * check). Empty or pseudo filesystems never count.
 */
export function findFullDisks(
  disks: DiskReading[],
  thresholds: DiskFullThresholds
): FullDisk[] {
  const full: FullDisk[] = []
  for (const disk of disks) {
    if (disk.totalBytes <= 0 || diskIsIgnored(disk)) continue
    const usedPercent = diskUsedPercent(disk)
    const reasons: FullDisk["reasons"] = []
    if (usedPercent >= thresholds.usedPercent) reasons.push("percent")
    if (
      thresholds.freeBytes > 0 &&
      disk.availableBytes < thresholds.freeBytes
    ) {
      reasons.push("free_bytes")
    }
    if (reasons.length === 0) continue
    full.push({ ...disk, usedPercent, reasons })
  }
  return full.sort((left, right) => right.usedPercent - left.usedPercent)
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
