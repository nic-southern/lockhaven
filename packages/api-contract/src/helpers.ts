import { serviceDefaults, type Permission } from "@nms/shared"
import { normalizeVpnIpv4 } from "@nms/vpn"

export type RemoteServiceType = "vnc" | "rdp" | "ssh" | "winrm_https"

export function permissionForServiceType(
  serviceType: RemoteServiceType
): Permission {
  switch (serviceType) {
    case "rdp":
      return "device:start_rdp"
    case "ssh":
      return "device:start_ssh"
    default:
      return "device:start_vnc"
  }
}

export function serviceConnectionDefaults(serviceType: RemoteServiceType) {
  return serviceDefaults[serviceType]
}

export function normalizeRouteValues(routes: string[]) {
  return [...new Set(routes.map((route) => route.trim()).filter(Boolean))]
}

export function siteBelongsToOrganization(
  siteOrganizationId: string,
  deviceOrganizationId: string
) {
  return siteOrganizationId === deviceOrganizationId
}

function slugifyForFilename(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

/**
 * Android WireGuard derives the tunnel name from the file name and rejects
 * anything outside this set. Desktop allows the same characters up to 32.
 * Names stay inside the stricter 15-character limit so one download imports
 * on both.
 */
export const WIREGUARD_TUNNEL_NAME_PATTERN = /^[A-Za-z0-9_=+.-]{1,15}$/

const ANDROID_TUNNEL_NAME_MAX = 15

function ipv4TunnelSuffix(vpnIpv4: string) {
  const parts = normalizeVpnIpv4(vpnIpv4).split(".")
  if (parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part))) {
    return `${parts[2]}-${parts[3]}`
  }

  const fallback = normalizeVpnIpv4(vpnIpv4)
    .replace(/[^0-9a-zA-Z]+/g, "-")
    .replace(/^-|-$/g, "")
  return fallback.slice(-ANDROID_TUNNEL_NAME_MAX) || "vpn"
}

function fitWireGuardTunnelName(head: string, suffix: string) {
  const tail = suffix.slice(-(ANDROID_TUNNEL_NAME_MAX - 3))
  const room = ANDROID_TUNNEL_NAME_MAX - (tail.length + 1)
  const trimmed =
    head.slice(0, Math.max(room, 1)).replace(/[.=+-]+$/g, "") || "lh"
  const stem = `${trimmed}-${tail}`.slice(0, ANDROID_TUNNEL_NAME_MAX)
  if (WIREGUARD_TUNNEL_NAME_PATTERN.test(stem)) {
    return stem
  }
  const fallback = `lh-${tail}`.slice(0, ANDROID_TUNNEL_NAME_MAX)
  return WIREGUARD_TUNNEL_NAME_PATTERN.test(fallback) ? fallback : "lh-vpn"
}

/**
 * WireGuard clients name the tunnel after the file. The name has to be
 * distinct per profile and short enough for the phone app to import.
 */
export function adminVpnConfigFilename(
  organizationName: string,
  vpnIpv4: string,
  label: string | null
) {
  const safeLabel = label ? slugifyForFilename(label) : ""
  const safeOrg = slugifyForFilename(organizationName)
  const head = safeLabel || safeOrg || "lh"
  return `${fitWireGuardTunnelName(head, ipv4TunnelSuffix(vpnIpv4))}.conf`
}
