export const statusVariant: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  service_online: "default",
  vpn_online: "secondary",
  degraded: "destructive",
  offline: "outline",
  enrolled: "secondary",
  pending: "outline",
  revoked: "destructive",
  ok: "default",
  Down: "destructive",
}

const statusLabels: Record<string, string> = {
  service_online: "Service online",
  vpn_online: "VPN online",
  degraded: "Degraded",
  offline: "Offline",
  enrolled: "Enrolled",
  pending: "Pending",
  revoked: "Revoked",
  ok: "Healthy",
  Down: "Down",
  winrm_https: "WinRM",
  vnc: "VNC",
  rdp: "RDP",
  ssh: "SSH",
}

export function statusLabel(value: string | null | undefined) {
  if (!value) {
    return "—"
  }

  return statusLabels[value] ?? value.replaceAll("_", " ")
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) {
    return "—"
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

export function formatBytes(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "—"
  }

  const units = ["B", "KB", "MB", "GB", "TB"]
  let size = value
  let unit = 0

  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }

  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}
