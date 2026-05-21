import type { Permission } from "@nms/shared"

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

export function normalizeRouteValues(routes: string[]) {
  return [...new Set(routes.map((route) => route.trim()).filter(Boolean))]
}

export function siteBelongsToOrganization(
  siteOrganizationId: string,
  deviceOrganizationId: string
) {
  return siteOrganizationId === deviceOrganizationId
}
