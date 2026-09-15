import type { OrganizationRole, PlatformRole, SiteRole } from "@nms/shared"

export const platformRoleLabels: Record<PlatformRole, string> = {
  owner: "Platform owner",
  admin: "Platform admin",
  member: "Member",
}

export const organizationRoleLabels: Record<OrganizationRole, string> = {
  owner: "Owner",
  admin: "Admin",
  operator: "Operator",
  technician: "Technician",
  viewer: "Viewer",
}

export const organizationRoleDescriptions: Record<OrganizationRole, string> = {
  owner: "Full control, including admin VPN profiles and user management.",
  admin: "Manage devices, sites, tokens, policies, and users.",
  operator: "Connect to devices, manage services, and revoke access.",
  technician:
    "Connect to devices and update basic details. No enrollment, revoking, or credential access.",
  viewer: "Read-only access to inventory and activity.",
}

export const siteRoleLabels: Record<SiteRole, string> = {
  operator: "Operator",
  technician: "Technician",
  viewer: "Viewer",
}

export const siteRoleDescriptions: Record<SiteRole, string> = {
  operator: "Connect, manage services, and revoke devices at this site.",
  technician: "Connect to devices and update details at this site.",
  viewer: "View devices at this site.",
}

export function labelForPlatformRole(role: string) {
  return platformRoleLabels[role as PlatformRole] ?? role
}

export function labelForOrganizationRole(role: string) {
  return organizationRoleLabels[role as OrganizationRole] ?? role
}

export function labelForSiteRole(role: string) {
  return siteRoleLabels[role as SiteRole] ?? role
}
