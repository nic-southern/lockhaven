export type StatusTone = "online" | "warning" | "offline" | "neutral" | "danger"

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

export const statusTone: Record<string, StatusTone> = {
  service_online: "online",
  vpn_online: "online",
  enrolled: "online",
  ok: "online",
  degraded: "warning",
  pending: "warning",
  offline: "offline",
  revoked: "danger",
  Down: "danger",
}

const statusLabels: Record<string, string> = {
  service_online: "Service online",
  vpn_online: "VPN online",
  degraded: "Degraded",
  offline: "Offline",
  enrolled: "Enrolled",
  pending: "Pending",
  revoked: "Revoked",
  device_deleted: "Device removed",
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

export function formatRelativeTime(value: string | Date | null | undefined) {
  if (!value) {
    return "Never"
  }

  const date = new Date(value)
  const deltaSeconds = Math.round((date.getTime() - Date.now()) / 1000)

  const divisions: Array<{
    amount: number
    unit: Intl.RelativeTimeFormatUnit
  }> = [
    { amount: 60, unit: "second" },
    { amount: 60, unit: "minute" },
    { amount: 24, unit: "hour" },
    { amount: 7, unit: "day" },
    { amount: 4.34524, unit: "week" },
    { amount: 12, unit: "month" },
    { amount: Number.POSITIVE_INFINITY, unit: "year" },
  ]

  let duration = deltaSeconds
  for (const division of divisions) {
    if (Math.abs(duration) < division.amount) {
      return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
        Math.round(duration),
        division.unit
      )
    }
    duration /= division.amount
  }

  return formatDate(date)
}

export function connectivityTone(value: {
  revokedAt?: string | Date | null
  lastHandshakeAt?: string | Date | null
  lastSeenAt?: string | Date | null
}): StatusTone {
  if (value.revokedAt) {
    return "danger"
  }

  if (value.lastHandshakeAt) {
    return "online"
  }

  if (value.lastSeenAt) {
    return "warning"
  }

  return "offline"
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
