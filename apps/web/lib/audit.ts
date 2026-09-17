import { formatDate, statusLabel } from "@/lib/dashboard"

const detailKeyLabels: Record<string, string> = {
  organizationId: "Organization",
  deviceId: "Device",
  siteId: "Site",
  previousSiteId: "Previous site",
  routePolicyId: "Route policy",
  previousRoutePolicyId: "Previous route policy",
  tokenId: "Token",
  apiKeyId: "Key",
  prefix: "Prefix",
  serviceId: "Service",
  serviceType: "Service type",
  displayName: "Display name",
  hostname: "Hostname",
  name: "Name",
  port: "Port",
  enabled: "Enabled",
  revoked: "Revoked",
  siteWide: "Site-wide",
  maxUses: "Max uses",
  expiresAt: "Expires",
  vpnIpv4: "VPN address",
  serviceCount: "Services",
  organization: "Organization",
  tags: "Tags",
  previousTags: "Previous tags",
  ipAddress: "IP address",
  userAgent: "Browser",
  method: "Method",
  reason: "Reason",
  archived: "Archived",
  count: "Count",
  ticketNumber: "Ticket",
  sessionId: "Session",
}

export function humanizeDetailKey(key: string) {
  if (detailKeyLabels[key]) {
    return detailKeyLabels[key]
  }

  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase())
}

export function shortId(value: string) {
  return value.length > 10 ? `${value.slice(0, 8)}…` : value
}

function isIsoDateLike(value: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)
}

export type DetailLookups = {
  organizationNameById: Map<string, string>
  deviceNameById: Map<string, string>
  siteNameById: Map<string, string>
  routePolicyNameById: Map<string, string>
}

export const emptyDetailLookups: DetailLookups = {
  organizationNameById: new Map(),
  deviceNameById: new Map(),
  siteNameById: new Map(),
  routePolicyNameById: new Map(),
}

export function formatDetailValue(
  key: string,
  value: unknown,
  lookups: DetailLookups
): string {
  if (value === null || value === undefined || value === "") {
    return "—"
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No"
  }

  if (Array.isArray(value)) {
    return value.length === 0
      ? "—"
      : value.map((entry) => formatDetailValue(key, entry, lookups)).join(", ")
  }

  if (typeof value === "string") {
    if (key === "organizationId") {
      return lookups.organizationNameById.get(value) ?? shortId(value)
    }
    if (key === "deviceId") {
      return lookups.deviceNameById.get(value) ?? shortId(value)
    }
    if (key === "siteId" || key === "previousSiteId") {
      return lookups.siteNameById.get(value) ?? shortId(value)
    }
    if (key === "routePolicyId" || key === "previousRoutePolicyId") {
      return lookups.routePolicyNameById.get(value) ?? shortId(value)
    }
    if (key === "serviceType") {
      return statusLabel(value)
    }
    if (key === "tokenId" || key === "serviceId") {
      return shortId(value)
    }
    if (isIsoDateLike(value)) {
      return formatDate(value)
    }

    return value
  }

  if (typeof value === "object") {
    return JSON.stringify(value)
  }

  return String(value)
}

export const auditTimeRanges = [
  { value: "all", label: "All time" },
  { value: "1h", label: "Last hour" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
] as const

export function auditRangeStart(range: string) {
  const now = Date.now()
  switch (range) {
    case "1h":
      return new Date(now - 60 * 60 * 1000)
    case "24h":
      return new Date(now - 24 * 60 * 60 * 1000)
    case "7d":
      return new Date(now - 7 * 24 * 60 * 60 * 1000)
    case "30d":
      return new Date(now - 30 * 24 * 60 * 60 * 1000)
    default:
      return null
  }
}
