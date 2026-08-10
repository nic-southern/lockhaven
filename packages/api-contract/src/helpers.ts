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
 * WireGuard clients name the tunnel after the file, so each profile needs a
 * distinct filename to keep multiple machines apart.
 */
export function adminVpnConfigFilename(
  organizationName: string,
  vpnIpv4: string,
  label: string | null
) {
  const safeName = slugifyForFilename(organizationName) || "org"
  const address = normalizeVpnIpv4(vpnIpv4).replaceAll(".", "-")
  const safeLabel = label ? slugifyForFilename(label) : ""
  return `lockhaven-admin-${safeName}-${safeLabel || address}.conf`
}
