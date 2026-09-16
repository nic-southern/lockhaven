import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export type AgentState = {
  deviceId: string
  checkInSecret: string
  baseUrl: string
  hostname: string
  vpnIpv4: string
  tunnelName: string
  pendingCommandResults?: Array<{
    id: string
    status: "succeeded" | "failed" | "refused"
    detail?: string
  }>
}

export function defaultStateDir(platform = process.platform) {
  if (platform === "win32") {
    return join(process.env.PROGRAMDATA ?? "C:\\ProgramData", "Lockhaven")
  }
  if (platform === "darwin") {
    return "/Library/Application Support/Lockhaven"
  }
  return "/var/lib/lockhaven"
}

export function stateFilePath(dir = defaultStateDir()) {
  return join(dir, "agent.json")
}

function fallbackStateDir() {
  return join(homedir(), ".lockhaven")
}

export async function loadState(): Promise<AgentState | null> {
  const candidates = [stateFilePath(), stateFilePath(fallbackStateDir())]
  for (const path of candidates) {
    try {
      const raw = await readFile(path, "utf8")
      const parsed = JSON.parse(raw) as Partial<AgentState>
      if (
        parsed.deviceId &&
        parsed.checkInSecret &&
        parsed.baseUrl &&
        parsed.hostname &&
        parsed.vpnIpv4
      ) {
        return {
          deviceId: parsed.deviceId,
          checkInSecret: parsed.checkInSecret,
          baseUrl: parsed.baseUrl.replace(/\/+$/, ""),
          hostname: parsed.hostname,
          vpnIpv4: parsed.vpnIpv4,
          tunnelName: parsed.tunnelName ?? "lockhaven",
          pendingCommandResults: parsed.pendingCommandResults,
        }
      }
    } catch {
      // try the next location
    }
  }
  return null
}

export async function saveState(state: AgentState) {
  const privileged = stateFilePath()
  const fallback = stateFilePath(fallbackStateDir())
  const payload = `${JSON.stringify(state, null, 2)}\n`

  try {
    await mkdir(dirname(privileged), { recursive: true, mode: 0o700 })
    await writeFile(privileged, payload, { mode: 0o600 })
    return privileged
  } catch {
    await mkdir(dirname(fallback), { recursive: true, mode: 0o700 })
    await writeFile(fallback, payload, { mode: 0o600 })
    return fallback
  }
}
