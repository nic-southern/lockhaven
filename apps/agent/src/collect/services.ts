import { serviceDefaults, type ServiceType } from "@nms/shared"

import { parseListeningPorts } from "./parse"
import { runCommand } from "../process"

const watched: ServiceType[] = ["ssh", "vnc", "rdp", "winrm_https"]

export async function collectServices(osFamily: string) {
  const ss = await runCommand("ss", ["-ltn"])
  const netstat = ss.code === 0 ? ss : await runCommand("netstat", ["-lnt"])
  const ports =
    netstat.code === 0 ? parseListeningPorts(netstat.stdout) : new Set<number>()

  const types =
    osFamily === "windows"
      ? (["rdp", "winrm_https"] as const)
      : (["ssh", "vnc"] as const)

  return types
    .filter((type) => watched.includes(type))
    .map((type) => ({
      type,
      port: serviceDefaults[type].port,
      listening: ports.has(serviceDefaults[type].port),
    }))
}
