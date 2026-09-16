import { z } from "zod"

/**
 * Route policy entries, CIDR parsing, and validation shared by the API,
 * the worker, and the Console. IPv4 only: the tunnel overlay is IPv4 and
 * WireGuard allowed-ips are compared as IPv4 ranges throughout the product.
 */

export const MAX_ROUTE_POLICY_ENTRIES = 64
export const ROUTE_LABEL_MAX_LENGTH = 40
export const ROUTE_COMMENT_MAX_LENGTH = 200

export const routePolicyColors = [
  "slate",
  "blue",
  "emerald",
  "amber",
  "violet",
  "rose",
  "cyan",
  "orange",
] as const

export type RoutePolicyColor = (typeof routePolicyColors)[number]

export const routePolicyEntrySchema = z.object({
  cidr: z.string().trim().min(1).max(43),
  label: z.string().trim().max(ROUTE_LABEL_MAX_LENGTH).optional().nullable(),
  comment: z
    .string()
    .trim()
    .max(ROUTE_COMMENT_MAX_LENGTH)
    .optional()
    .nullable(),
})

export type RoutePolicyEntry = z.infer<typeof routePolicyEntrySchema>

export const routePolicyEntriesSchema = z
  .array(routePolicyEntrySchema)
  .max(MAX_ROUTE_POLICY_ENTRIES)

export const routePolicyColorSchema = z.enum(routePolicyColors)

export type ParsedCidr = {
  /** Canonical `network/prefix` form (host bits cleared). */
  cidr: string
  /** Original text as written. */
  input: string
  address: string
  prefix: number
  /** First address of the range as a 32-bit unsigned integer. */
  start: number
  /** Last address of the range as a 32-bit unsigned integer. */
  end: number
  /** True when the written address had host bits set (e.g. 10.0.0.5/24). */
  hostBitsSet: boolean
}

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

export function ipv4ToInt(address: string): number | null {
  const match = IPV4_PATTERN.exec(address.trim())
  if (!match) {
    return null
  }
  let value = 0
  for (let index = 1; index <= 4; index += 1) {
    const octet = Number(match[index])
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      return null
    }
    value = value * 256 + octet
  }
  return value
}

export function intToIpv4(value: number): string {
  return [
    Math.floor(value / 16777216) % 256,
    Math.floor(value / 65536) % 256,
    Math.floor(value / 256) % 256,
    value % 256,
  ].join(".")
}

/**
 * Parses an IPv4 address or CIDR. A bare address is treated as a /32.
 * Returns `null` for anything that is not a valid IPv4 range.
 */
export function parseCidr(value: string): ParsedCidr | null {
  const input = value.trim()
  if (!input) {
    return null
  }

  const [addressPart, prefixPart, ...rest] = input.split("/")
  if (rest.length > 0) {
    return null
  }

  const address = ipv4ToInt(addressPart)
  if (address === null) {
    return null
  }

  let prefix = 32
  if (prefixPart !== undefined) {
    if (!/^\d{1,2}$/.test(prefixPart)) {
      return null
    }
    prefix = Number(prefixPart)
    if (prefix < 0 || prefix > 32) {
      return null
    }
  }

  const size = 2 ** (32 - prefix)
  const start = Math.floor(address / size) * size
  const end = start + size - 1

  return {
    cidr: `${intToIpv4(start)}/${prefix}`,
    input,
    address: intToIpv4(address),
    prefix,
    start,
    end,
    hostBitsSet: start !== address,
  }
}

export function isValidCidr(value: string) {
  return parseCidr(value) !== null
}

/** Canonical `network/prefix` form, or the trimmed input when unparseable. */
export function normalizeCidr(value: string) {
  return parseCidr(value)?.cidr ?? value.trim()
}

export function cidrsOverlap(a: ParsedCidr, b: ParsedCidr) {
  return a.start <= b.end && b.start <= a.end
}

/** True when `outer` fully contains `inner`. */
export function cidrContains(outer: ParsedCidr, inner: ParsedCidr) {
  return outer.start <= inner.start && outer.end >= inner.end
}

export function cidrSize(parsed: ParsedCidr) {
  return parsed.end - parsed.start + 1
}

const RFC1918 = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"].map(
  (cidr) => parseCidr(cidr) as ParsedCidr
)

const SPECIAL_RANGES: Array<{ cidr: ParsedCidr; kind: RouteRangeKind }> = [
  { cidr: parseCidr("0.0.0.0/8") as ParsedCidr, kind: "this-network" },
  { cidr: parseCidr("127.0.0.0/8") as ParsedCidr, kind: "loopback" },
  { cidr: parseCidr("169.254.0.0/16") as ParsedCidr, kind: "link-local" },
  { cidr: parseCidr("100.64.0.0/10") as ParsedCidr, kind: "shared-address" },
  { cidr: parseCidr("224.0.0.0/4") as ParsedCidr, kind: "multicast" },
  { cidr: parseCidr("240.0.0.0/4") as ParsedCidr, kind: "reserved" },
]

export type RouteRangeKind =
  | "default"
  | "private"
  | "public"
  | "this-network"
  | "loopback"
  | "link-local"
  | "shared-address"
  | "multicast"
  | "reserved"

export function classifyCidr(parsed: ParsedCidr): RouteRangeKind {
  if (parsed.prefix === 0) {
    return "default"
  }
  for (const special of SPECIAL_RANGES) {
    if (cidrsOverlap(special.cidr, parsed)) {
      return special.kind
    }
  }
  if (RFC1918.some((range) => cidrContains(range, parsed))) {
    return "private"
  }
  return "public"
}

export function isRfc1918(parsed: ParsedCidr) {
  return classifyCidr(parsed) === "private"
}

export type RouteIssueSeverity = "error" | "warning" | "info"

export type RouteIssueCode =
  | "invalid"
  | "duplicate"
  | "default_route"
  | "special_range"
  | "public_range"
  | "host_bits"
  | "very_broad"
  | "overlaps_vpn"
  | "contains_entry"
  | "contained_by_entry"
  | "overlaps_policy"
  | "too_many_entries"

export type RouteIssue = {
  /** Index into the analyzed entries; `null` for policy-level issues. */
  index: number | null
  severity: RouteIssueSeverity
  code: RouteIssueCode
  message: string
  /** Related entry index or external policy for overlap issues. */
  related?: { index?: number; policyId?: string; policyName?: string }
}

export type AnalyzedRoute = {
  entry: RoutePolicyEntry
  parsed: ParsedCidr | null
  kind: RouteRangeKind | null
  issues: RouteIssue[]
}

export type RouteAnalysis = {
  routes: AnalyzedRoute[]
  issues: RouteIssue[]
  errorCount: number
  warningCount: number
  /** Canonical, deduplicated CIDRs for the valid entries in input order. */
  normalizedRoutes: string[]
  /** Total addresses covered by the union of valid entries. */
  addressCount: number
}

export type ExternalPolicyRoutes = {
  id: string
  name: string
  routes: string[]
}

export type AnalyzeRoutesOptions = {
  /** Overlay network used by the tunnel itself (`VPN_CIDR`). */
  vpnCidr?: string | null
  /** Other policies in the same organization, for overlap information. */
  otherPolicies?: ExternalPolicyRoutes[]
}

const BROAD_PREFIX_THRESHOLD = 8

/**
 * Validates a list of route entries and explains anything a network admin
 * would want to know before publishing them to devices.
 */
export function analyzeRoutes(
  entries: RoutePolicyEntry[],
  options: AnalyzeRoutesOptions = {}
): RouteAnalysis {
  const vpn = options.vpnCidr ? parseCidr(options.vpnCidr) : null
  const routes: AnalyzedRoute[] = entries.map((entry) => {
    const parsed = parseCidr(entry.cidr)
    return {
      entry,
      parsed,
      kind: parsed ? classifyCidr(parsed) : null,
      issues: [],
    }
  })
  const policyIssues: RouteIssue[] = []

  const push = (index: number, issue: Omit<RouteIssue, "index">) => {
    routes[index].issues.push({ index, ...issue })
  }

  if (entries.length > MAX_ROUTE_POLICY_ENTRIES) {
    policyIssues.push({
      index: null,
      severity: "error",
      code: "too_many_entries",
      message: `A policy can hold at most ${MAX_ROUTE_POLICY_ENTRIES} routes.`,
    })
  }

  const seen = new Map<string, number>()

  routes.forEach((route, index) => {
    const { parsed, kind } = route
    if (!parsed || !kind) {
      push(index, {
        severity: "error",
        code: "invalid",
        message: `"${route.entry.cidr.trim() || "(empty)"}" isn't a valid IPv4 address or range.`,
      })
      return
    }

    const firstIndex = seen.get(parsed.cidr)
    if (firstIndex !== undefined) {
      push(index, {
        severity: "error",
        code: "duplicate",
        message: `${parsed.cidr} is already listed.`,
        related: { index: firstIndex },
      })
      return
    }
    seen.set(parsed.cidr, index)

    if (kind === "default") {
      push(index, {
        severity: "error",
        code: "default_route",
        message:
          "0.0.0.0/0 would send all device traffic through the tunnel. Use specific networks instead.",
      })
      return
    }

    if (kind !== "private" && kind !== "public") {
      push(index, {
        severity: "error",
        code: "special_range",
        message: `${parsed.cidr} is a ${specialRangeLabel(kind)} range and can't be routed.`,
      })
      return
    }

    if (parsed.hostBitsSet) {
      push(index, {
        severity: "warning",
        code: "host_bits",
        message: `${parsed.input} will be saved as ${parsed.cidr}.`,
      })
    }

    if (kind === "public") {
      push(index, {
        severity: "warning",
        code: "public_range",
        message: `${parsed.cidr} is a public address range. Devices will send that internet traffic through the tunnel.`,
      })
    }

    if (parsed.prefix < BROAD_PREFIX_THRESHOLD) {
      push(index, {
        severity: "warning",
        code: "very_broad",
        message: `${parsed.cidr} covers ${cidrSize(parsed).toLocaleString()} addresses.`,
      })
    }

    if (vpn && cidrsOverlap(vpn, parsed)) {
      push(index, {
        severity: "warning",
        code: "overlaps_vpn",
        message: `${parsed.cidr} overlaps the tunnel network ${vpn.cidr}. Devices already reach the tunnel; this may shadow tunnel addresses.`,
      })
    }
  })

  const valid = routes
    .map((route, index) => ({ route, index }))
    .filter(
      ({ route }) =>
        route.parsed &&
        !route.issues.some((issue) => issue.severity === "error")
    ) as Array<{ route: AnalyzedRoute & { parsed: ParsedCidr }; index: number }>

  for (const a of valid) {
    for (const b of valid) {
      if (a.index === b.index) continue
      if (cidrContains(a.route.parsed, b.route.parsed)) {
        push(b.index, {
          severity: "info",
          code: "contained_by_entry",
          message: `${b.route.parsed.cidr} is already covered by ${a.route.parsed.cidr}.`,
          related: { index: a.index },
        })
      }
    }
  }

  for (const policy of options.otherPolicies ?? []) {
    const parsedOther = policy.routes
      .map((route) => parseCidr(route))
      .filter((route): route is ParsedCidr => route !== null)
    for (const { route, index } of valid) {
      const overlap = parsedOther.find((other) =>
        cidrsOverlap(other, route.parsed)
      )
      if (overlap) {
        push(index, {
          severity: "info",
          code: "overlaps_policy",
          message: `${route.parsed.cidr} overlaps ${overlap.cidr} in "${policy.name}".`,
          related: { policyId: policy.id, policyName: policy.name },
        })
      }
    }
  }

  const issues = [...policyIssues, ...routes.flatMap((route) => route.issues)]

  return {
    routes,
    issues,
    errorCount: issues.filter((issue) => issue.severity === "error").length,
    warningCount: issues.filter((issue) => issue.severity === "warning").length,
    normalizedRoutes: valid.map(({ route }) => route.parsed.cidr),
    addressCount: unionAddressCount(valid.map(({ route }) => route.parsed)),
  }
}

function specialRangeLabel(kind: RouteRangeKind) {
  switch (kind) {
    case "loopback":
      return "loopback"
    case "link-local":
      return "link-local"
    case "multicast":
      return "multicast"
    case "shared-address":
      return "carrier-grade NAT"
    case "this-network":
      return "reserved"
    default:
      return "reserved"
  }
}

function unionAddressCount(ranges: ParsedCidr[]) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  let total = 0
  let currentStart: number | null = null
  let currentEnd = -1
  for (const range of sorted) {
    if (currentStart === null || range.start > currentEnd + 1) {
      if (currentStart !== null) {
        total += currentEnd - currentStart + 1
      }
      currentStart = range.start
      currentEnd = range.end
    } else {
      currentEnd = Math.max(currentEnd, range.end)
    }
  }
  if (currentStart !== null) {
    total += currentEnd - currentStart + 1
  }
  return total
}

/**
 * Splits free text (pasted lists, comma or newline separated) into entries.
 * Anything after `#` or `//` on a line becomes the entry's comment.
 */
export function parseRouteInput(text: string): RoutePolicyEntry[] {
  return text
    .split(/[\n,;]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const commentMatch = /^(\S+)\s*(?:#|\/\/)\s*(.*)$/.exec(line)
      if (commentMatch) {
        return {
          cidr: commentMatch[1],
          label: commentMatch[2].slice(0, ROUTE_LABEL_MAX_LENGTH) || null,
        }
      }
      const [cidr, ...labelParts] = line.split(/\s+/)
      const label = labelParts.join(" ").trim()
      return {
        cidr,
        label: label ? label.slice(0, ROUTE_LABEL_MAX_LENGTH) : null,
      }
    })
}

/** Legacy `text[]` routes lifted into entry objects. */
export function entriesFromRoutes(routes: string[]): RoutePolicyEntry[] {
  return routes.map((cidr) => ({ cidr, label: null, comment: null }))
}

export type RoutePolicyDiff = {
  onlyInA: string[]
  onlyInB: string[]
  shared: string[]
  /** Pairs that overlap without being identical. */
  overlapping: Array<{ a: string; b: string }>
}

export function diffRoutePolicies(
  routesA: string[],
  routesB: string[]
): RoutePolicyDiff {
  const a = [...new Set(routesA.map(normalizeCidr))]
  const b = [...new Set(routesB.map(normalizeCidr))]
  const setA = new Set(a)
  const setB = new Set(b)
  const overlapping: Array<{ a: string; b: string }> = []

  for (const routeA of a) {
    const parsedA = parseCidr(routeA)
    if (!parsedA || setB.has(routeA)) continue
    for (const routeB of b) {
      const parsedB = parseCidr(routeB)
      if (!parsedB || setA.has(routeB)) continue
      if (cidrsOverlap(parsedA, parsedB)) {
        overlapping.push({ a: routeA, b: routeB })
      }
    }
  }

  return {
    onlyInA: a.filter((route) => !setB.has(route)),
    onlyInB: b.filter((route) => !setA.has(route)),
    shared: a.filter((route) => setB.has(route)),
    overlapping,
  }
}
