import type { DeviceConnectivity } from "@nms/shared"

import type { StatusTone } from "@/lib/dashboard"

export const connectivityLabel: Record<DeviceConnectivity, string> = {
  online: "Online",
  offline: "Offline",
  never: "Never connected",
  revoked: "Revoked",
}

export const connectivityToneMap: Record<DeviceConnectivity, StatusTone> = {
  online: "online",
  offline: "offline",
  never: "neutral",
  revoked: "danger",
}

export const osFamilyLabel = (value: string | null | undefined) => {
  switch ((value ?? "").toLowerCase()) {
    case "windows":
      return "Windows"
    case "linux":
      return "Linux"
    case "darwin":
    case "macos":
      return "macOS"
    case "android":
      return "Android"
    case "":
      return "Unknown"
    default:
      return value as string
  }
}

export const serviceTypeLabel: Record<string, string> = {
  vnc: "VNC",
  rdp: "RDP",
  ssh: "SSH",
  winrm_https: "WinRM",
}

/** Escapes a single CSV cell per RFC 4180. */
export function csvCell(value: unknown) {
  if (value === null || value === undefined) return ""
  const text =
    value instanceof Date
      ? value.toISOString()
      : Array.isArray(value)
        ? value.join(" ")
        : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv<T>(
  rows: T[],
  columns: Array<{ header: string; value: (row: T) => unknown }>
) {
  const lines = [columns.map((column) => csvCell(column.header)).join(",")]
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(column.value(row))).join(","))
  }
  return `${lines.join("\r\n")}\r\n`
}

export function downloadTextFile(
  filename: string,
  contents: string,
  type = "text/csv;charset=utf-8"
) {
  const blob = new Blob([contents], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
