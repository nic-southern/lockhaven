import { z } from "zod"

import { agentCommandKinds, type AgentCommandKind } from "./telemetry"

/** Default when an organization has not chosen a channel. */
export const DEFAULT_AGENT_CHANNEL = "stable"

export const agentChannels = ["stable", "beta"] as const
export type AgentChannel = (typeof agentChannels)[number]
export const agentChannelSchema = z.enum(agentChannels)

export const agentReleasePlatforms = [
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
    linux: "Linux",
    windows: "Windows",
    macos: "macOS",
    android: "Android",
    all: "All platforms",
  }

export const agentCommandKindLabels: Record<AgentCommandKind, string> = {
  reboot: "Restart device",
  restart: "Restart agent",
  update: "Update agent",
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

export function normalizeAgentPlatform(
  osFamily: string | null | undefined
): AgentReleasePlatform {
  const family = (osFamily ?? "").toLowerCase()
  if (family.includes("windows")) return "windows"
  if (family.includes("android")) return "android"
  if (family.includes("mac") || family.includes("darwin")) return "macos"
  if (family.includes("linux")) return "linux"
  return "all"
}

export type AgentReleasePick = {
  version: string
  channel: AgentChannel
  platform: AgentReleasePlatform
  downloadUrl: string
  sha256?: string
}

/**
 * Latest release on `channel` for `platform`, falling back to an `all`
 * platform build on the same channel.
 */
export function pickDesiredRelease<T extends AgentReleasePick>(
  releases: T[],
  channel: AgentChannel,
  platform: AgentReleasePlatform
): T | null {
  const onChannel = releases.filter((release) => release.channel === channel)
  const exact = onChannel.filter((release) => release.platform === platform)
  const any = onChannel.filter((release) => release.platform === "all")
  const pool = exact.length > 0 ? exact : any
  if (pool.length === 0) return null
  return pool.reduce((latest, candidate) =>
    compareSemver(candidate.version, latest.version) > 0 ? candidate : latest
  )
}

export type DeviceCommandRecord = {
  id: string
  kind: string
  status: DeviceCommandStatus
}

/** Hub only delivers waiting commands. Sent items wait for the next check-in ack. */
export function commandsForCheckIn(commands: DeviceCommandRecord[]) {
  return commands
    .filter(
      (command) =>
        command.status === "pending" && isAgentCommandKind(command.kind)
    )
    .map((command) => ({
      id: command.id,
      kind: command.kind as AgentCommandKind,
    }))
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
  kind: AgentCommandKind
) {
  return commands.some(
    (command) =>
      command.kind === kind && OPEN_COMMAND_STATUSES.has(command.status)
  )
}
