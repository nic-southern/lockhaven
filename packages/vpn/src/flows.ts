import type {
  ConnectionDirection,
  ConnectionProtocol,
  ConnectionVerdict,
} from "@nms/shared"

/**
 * nftables log prefixes written by `vpnctl sync-firewall`. The chain and
 * verdict are encoded in the prefix so the ingest never has to infer them.
 */
export const FLOW_LOG_PREFIX = "lockhaven-flow"

export const FLOW_NFLOG_GROUP = 1

export function flowLogPrefix(
  direction: ConnectionDirection,
  verdict: ConnectionVerdict
) {
  return `${FLOW_LOG_PREFIX}-${direction === "hub" ? "in" : "fwd"}-${verdict} `
}

export type FlowRecord = {
  occurredAt: Date
  direction: ConnectionDirection
  verdict: ConnectionVerdict
  srcIp: string
  dstIp: string
  dstPort: number | null
  protocol: ConnectionProtocol
  bytes: number
  inInterface: string | null
  outInterface: string | null
}

const PREFIX_PATTERN = new RegExp(
  `^${FLOW_LOG_PREFIX}-(in|fwd)-(accept|drop)\\b`
)

const IPV4_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/
const IPV6_PATTERN = /^[0-9a-fA-F:]+$/

function isIp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (IPV4_PATTERN.test(value) ||
      (value.includes(":") && IPV6_PATTERN.test(value)))
  )
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function protocolFromNumber(value: number | null): ConnectionProtocol {
  switch (value) {
    case 6:
      return "tcp"
    case 17:
      return "udp"
    case 1:
    case 58:
      return "icmp"
    default:
      return "other"
  }
}

function pick(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (value !== undefined && value !== null && value !== "") return value
  }
  return undefined
}

function parseTimestamp(record: Record<string, unknown>): Date | null {
  const seconds = asNumber(pick(record, ["oob.time.sec"]))
  if (seconds !== null) {
    const micros = asNumber(pick(record, ["oob.time.usec"])) ?? 0
    return new Date(seconds * 1000 + Math.floor(micros / 1000))
  }
  const raw = pick(record, ["timestamp", "@timestamp", "time"])
  if (typeof raw === "string") {
    const parsed = new Date(raw)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return null
}

/**
 * Parses one JSON line emitted by ulogd2's JSON output plugin for the
 * Lockhaven NFLOG group. Returns `null` for lines that are not flow records
 * (other prefixes, truncated writes, missing addresses) so the ingest can
 * skip them without failing the batch.
 */
export function parseFlowLine(line: string): FlowRecord | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith("{")) return null

  let record: Record<string, unknown>
  try {
    record = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    return null
  }
  if (!record || typeof record !== "object") return null

  const prefix = pick(record, ["oob.prefix", "prefix"])
  if (typeof prefix !== "string") return null
  const match = PREFIX_PATTERN.exec(prefix.trim())
  if (!match) return null

  const srcIp = pick(record, ["src_ip", "ip.saddr.str", "ip.saddr"])
  const dstIp = pick(record, ["dest_ip", "ip.daddr.str", "ip.daddr"])
  if (!isIp(srcIp) || !isIp(dstIp)) return null

  const occurredAt = parseTimestamp(record)
  if (!occurredAt) return null

  const protocol = protocolFromNumber(
    asNumber(pick(record, ["ip.protocol", "ip6.nexthdr", "proto"]))
  )
  const dstPort =
    protocol === "tcp" || protocol === "udp"
      ? asNumber(
          pick(record, [
            protocol === "tcp" ? "tcp.dport" : "udp.dport",
            "dest_port",
            "dport",
          ])
        )
      : null

  return {
    occurredAt,
    direction: match[1] === "in" ? "hub" : "forward",
    verdict: match[2] as ConnectionVerdict,
    srcIp,
    dstIp,
    dstPort:
      dstPort !== null && dstPort >= 0 && dstPort <= 65535
        ? Math.trunc(dstPort)
        : null,
    protocol,
    bytes: Math.max(0, asNumber(pick(record, ["raw.pktlen", "bytes"])) ?? 0),
    inInterface: stringOrNull(pick(record, ["oob.in"])),
    outInterface: stringOrNull(pick(record, ["oob.out"])),
  }
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value !== "" ? value : null
}

/** Splits a chunk of file content into complete lines, returning any tail. */
export function splitCompleteLines(buffer: string) {
  const lastNewline = buffer.lastIndexOf("\n")
  if (lastNewline === -1) return { lines: [] as string[], rest: buffer }
  return {
    lines: buffer.slice(0, lastNewline).split("\n"),
    rest: buffer.slice(lastNewline + 1),
  }
}
