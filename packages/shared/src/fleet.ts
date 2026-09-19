import { z } from "zod"

import { agentCommandKinds, type AgentCommandKind } from "./telemetry"

/** Default when an organization has not chosen a channel. */
export const DEFAULT_AGENT_CHANNEL = "stable"

export const agentChannels = ["stable", "beta"] as const
export type AgentChannel = (typeof agentChannels)[number]
export const agentChannelSchema = z.enum(agentChannels)

export const agentReleasePlatforms = [
  "linux-amd64",
  "linux-arm64",
  "windows-amd64",
  "windows-arm64",
  "linux",
  "windows",
  "macos",
  "android",
  "all",
] as const
export type AgentReleasePlatform = (typeof agentReleasePlatforms)[number]
export const agentReleasePlatformSchema = z.enum(agentReleasePlatforms)

export const deviceCommandStatuses = [
  "pending",
  "sent",
  "succeeded",
  "failed",
  "refused",
  "cancelled",
] as const
export type DeviceCommandStatus = (typeof deviceCommandStatuses)[number]
export const deviceCommandStatusSchema = z.enum(deviceCommandStatuses)

export const agentChannelLabels: Record<AgentChannel, string> = {
  stable: "Stable",
  beta: "Beta",
}

export const agentReleasePlatformLabels: Record<AgentReleasePlatform, string> =
  {
    "linux-amd64": "Linux (Intel or AMD)",
    "linux-arm64": "Linux (ARM)",
    "windows-amd64": "Windows (Intel or AMD)",
    "windows-arm64": "Windows (ARM)",
    linux: "Linux",
    windows: "Windows",
    macos: "macOS",
    android: "Android",
    all: "All platforms",
  }

/** Version baked into the Hub image's agent binaries. */
export const SHIPPED_AGENT_VERSION = "0.3.0"

export const shippedAgentBinaries = [
  {
    platform: "linux-amd64",
    fileName: "lockhaven-agent-linux-amd64",
  },
  {
    platform: "linux-arm64",
    fileName: "lockhaven-agent-linux-arm64",
  },
  {
    platform: "windows-amd64",
    fileName: "lockhaven-agent-windows-amd64.exe",
  },
  {
    platform: "windows-arm64",
    fileName: "lockhaven-agent-windows-arm64.exe",
  },
] as const satisfies ReadonlyArray<{
  platform: AgentReleasePlatform
  fileName: string
}>

export function shippedAgentDownloadPath(fileName: string) {
  return `/install/${fileName}`
}

/** Sidecar written next to a shipped binary. Accepts a bare hash or `sha256sum` output. */
export function parseSha256Sidecar(contents: string) {
  const token = contents.trim().split(/\s+/)[0]?.toLowerCase() ?? ""
  return /^[a-f0-9]{64}$/.test(token) ? token : null
}

export const agentCommandKindLabels: Record<AgentCommandKind, string> = {
  reboot: "Restart device",
  restart: "Restart agent",
  update: "Update agent",
  restart_service: "Restart service",
}

export const deviceCommandStatusLabels: Record<DeviceCommandStatus, string> = {
  pending: "Waiting",
  sent: "Sent",
  succeeded: "Done",
  failed: "Failed",
  refused: "Refused",
  cancelled: "Cancelled",
}

export const sha256HexSchema = z
  .string()
  .trim()
  .regex(/^[a-fA-F0-9]{64}$/, "Use a 64-character checksum.")

export const agentVersionSchema = z.string().trim().min(1).max(64)

export type ParsedSemver = {
  major: number
  minor: number
  patch: number
  prerelease: string | null
}

/**
 * Parse a dotted version. Extra build metadata after `+` is ignored.
 * Returns null when the value has no leading numeric core.
 */
export function parseSemver(
  value: string | null | undefined
): ParsedSemver | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const withoutBuild = trimmed.split("+")[0] ?? trimmed
  const [core, ...preParts] = withoutBuild.split("-")
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(core ?? "")
  if (!match) return null
  const prerelease = preParts.length > 0 ? preParts.join("-") : null
  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
    prerelease,
  }
}

function compareIdentifiers(left: string, right: string) {
  const leftNumeric = /^\d+$/.test(left)
  const rightNumeric = /^\d+$/.test(right)
  if (leftNumeric && rightNumeric) {
    return Number(left) - Number(right)
  }
  if (leftNumeric) return -1
  if (rightNumeric) return 1
  return left.localeCompare(right)
}

function comparePrerelease(left: string | null, right: string | null) {
  if (left === right) return 0
  if (left == null) return 1
  if (right == null) return -1
  const leftParts = left.split(".")
  const rightParts = right.split(".")
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index]
    const rightPart = rightParts[index]
    if (leftPart == null) return -1
    if (rightPart == null) return 1
    const compared = compareIdentifiers(leftPart, rightPart)
    if (compared !== 0) return compared
  }
  return 0
}

/** Negative when `left` is older than `right`. Invalid values sort below valid ones. */
export function compareSemver(
  left: string | null | undefined,
  right: string | null | undefined
) {
  const parsedLeft = parseSemver(left)
  const parsedRight = parseSemver(right)
  if (!parsedLeft && !parsedRight) return 0
  if (!parsedLeft) return -1
  if (!parsedRight) return 1
  if (parsedLeft.major !== parsedRight.major) {
    return parsedLeft.major - parsedRight.major
  }
  if (parsedLeft.minor !== parsedRight.minor) {
    return parsedLeft.minor - parsedRight.minor
  }
  if (parsedLeft.patch !== parsedRight.patch) {
    return parsedLeft.patch - parsedRight.patch
  }
  return comparePrerelease(parsedLeft.prerelease, parsedRight.prerelease)
}

export function isAgentBehind(
  current: string | null | undefined,
  desired: string | null | undefined
) {
  if (!desired) return false
  return compareSemver(current, desired) < 0
}

export function isAgentCommandKind(value: string): value is AgentCommandKind {
  return (agentCommandKinds as readonly string[]).includes(value)
}

/**
 * Site channel wins when set. Otherwise the organization channel, then stable.
 */
export function resolveAgentChannel(
  siteChannel: string | null | undefined,
  organizationChannel: string | null | undefined
): AgentChannel {
  if (siteChannel && agentChannels.includes(siteChannel as AgentChannel)) {
    return siteChannel as AgentChannel
  }
  if (
    organizationChannel &&
    agentChannels.includes(organizationChannel as AgentChannel)
  ) {
    return organizationChannel as AgentChannel
  }
  return DEFAULT_AGENT_CHANNEL
}

export function normalizeCpuArchitecture(
  architecture: string | null | undefined
): "amd64" | "arm64" | null {
  const value = (architecture ?? "").trim().toLowerCase().replaceAll("-", "_")
  if (value === "amd64" || value === "x86_64" || value === "x64") return "amd64"
  if (value === "arm64" || value === "aarch64") return "arm64"
  return null
}

function agentFamilyPlatform(
  osFamily: string | null | undefined
): AgentReleasePlatform {
  const family = (osFamily ?? "").toLowerCase()
  if (family.includes("windows")) return "windows"
  if (family.includes("android")) return "android"
  if (family.includes("mac") || family.includes("darwin")) return "macos"
  if (family.includes("linux")) return "linux"
  return "all"
}

export function normalizeAgentPlatform(
  osFamily: string | null | undefined,
  architecture?: string | null
): AgentReleasePlatform {
  const family = agentFamilyPlatform(osFamily)
  const arch = normalizeCpuArchitecture(architecture)
  if (family === "linux" && arch === "amd64") return "linux-amd64"
  if (family === "linux" && arch === "arm64") return "linux-arm64"
  if (family === "windows" && arch === "amd64") return "windows-amd64"
  if (family === "windows" && arch === "arm64") return "windows-arm64"
  return family
}

const releaseFamily: Partial<
  Record<AgentReleasePlatform, AgentReleasePlatform>
> = {
  "linux-amd64": "linux",
  "linux-arm64": "linux",
  "windows-amd64": "windows",
  "windows-arm64": "windows",
}

function newestRelease<T extends AgentReleasePick>(pool: T[]) {
  return pool.reduce((latest, candidate) =>
    compareSemver(candidate.version, latest.version) > 0 ? candidate : latest
  )
}

const installPathPattern = /^\/install\/[A-Za-z0-9._-]+$/

export function isAgentDownloadLocation(value: string) {
  const raw = value.trim()
  if (
    !raw ||
    raw.includes("..") ||
    raw.includes("\\") ||
    raw.includes("\0") ||
    raw.includes("@")
  ) {
    return false
  }
  if (raw.startsWith("/install/")) {
    return installPathPattern.test(raw)
  }
  try {
    const url = new URL(raw)
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.username.length === 0 &&
      url.password.length === 0
    )
  } catch {
    return false
  }
}

export const agentDownloadUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine(isAgentDownloadLocation, "Enter a download link.")

/**
 * Turn a shipped `/install/…` path into an absolute link on this Hub.
 * Absolute links are returned unchanged so the agent can reject other hosts.
 */
export function resolveAgentDownloadUrl(
  origin: string | null | undefined,
  downloadUrl: string | null | undefined
) {
  const raw = downloadUrl?.trim()
  if (!raw || !isAgentDownloadLocation(raw)) return null
  if (raw.startsWith("/install/")) {
    if (!origin) return null
    let base: URL
    try {
      base = new URL(origin)
    } catch {
      return null
    }
    if (base.protocol !== "https:" && base.protocol !== "http:") return null
    return `${base.origin}${raw}`
  }
  return raw
}

export type AgentReleasePick = {
  version: string
  channel: AgentChannel
  platform: AgentReleasePlatform
  downloadUrl: string
  sha256?: string
}

/**
 * Newest release on `channel` for this platform. An architecture build wins,
 * then a family build (`linux`, `windows`), then `all`.
 */
export function pickDesiredRelease<T extends AgentReleasePick>(
  releases: T[],
  channel: AgentChannel,
  platform: AgentReleasePlatform
): T | null {
  const onChannel = releases.filter((release) => release.channel === channel)
  const tiers: AgentReleasePlatform[] = [platform]
  const family = releaseFamily[platform]
  if (family) tiers.push(family)
  if (platform !== "all") tiers.push("all")
  for (const tier of tiers) {
    const pool = onChannel.filter((release) => release.platform === tier)
    if (pool.length > 0) return newestRelease(pool)
  }
  return null
}

export type DeviceCommandRecord = {
  id: string
  kind: string
  status: DeviceCommandStatus
  serviceName?: string | null
}

/** Hub only delivers waiting commands. Sent items wait for the next check-in ack. */
export function commandsForCheckIn(commands: DeviceCommandRecord[]) {
  return commands
    .filter(
      (command) =>
        command.status === "pending" && isAgentCommandKind(command.kind)
    )
    .map((command) => {
      if (command.kind === "restart_service") {
        return {
          id: command.id,
          kind: "restart_service" as const,
          name: command.serviceName ?? "",
        }
      }
      return {
        id: command.id,
        kind: command.kind as AgentCommandKind,
      }
    })
}

export function statusAfterCommandResult(
  resultStatus: "succeeded" | "failed" | "refused"
): Extract<DeviceCommandStatus, "succeeded" | "failed" | "refused"> {
  return resultStatus
}

export type CommandAck = {
  id: string
  status: "succeeded" | "failed" | "refused"
}

/**
 * Apply check-in acknowledgements. Unknown ids are ignored. Terminal
 * statuses are left alone so a late duplicate result cannot reopen them.
 */
export function applyCommandAcks(
  commands: DeviceCommandRecord[],
  results: CommandAck[]
): DeviceCommandRecord[] {
  const byId = new Map(results.map((result) => [result.id, result] as const))
  return commands.map((command) => {
    const result = byId.get(command.id)
    if (!result) return command
    if (
      command.status === "succeeded" ||
      command.status === "failed" ||
      command.status === "refused" ||
      command.status === "cancelled"
    ) {
      return command
    }
    return { ...command, status: statusAfterCommandResult(result.status) }
  })
}

const OPEN_COMMAND_STATUSES: ReadonlySet<DeviceCommandStatus> = new Set([
  "pending",
  "sent",
])

/** True when another open command of the same allowlisted kind is already queued. */
export function hasOpenCommandOfKind(
  commands: DeviceCommandRecord[],
  kind: AgentCommandKind,
  serviceName?: string | null
) {
  return commands.some((command) => {
    if (command.kind !== kind || !OPEN_COMMAND_STATUSES.has(command.status)) {
      return false
    }
    if (kind !== "restart_service" || !serviceName) return true
    return command.serviceName === serviceName
  })
}
