import { readFile } from "node:fs/promises"
import { hostname as osHostname, type, release, arch } from "node:os"

export type HostIdentity = {
  hostname: string
  osFamily: "linux" | "windows" | "macos"
  osVersion: string
  architecture: string
  serialNumber: string
}

function osFamily(platform = process.platform): HostIdentity["osFamily"] {
  if (platform === "win32") return "windows"
  if (platform === "darwin") return "macos"
  return "linux"
}

async function serialNumber() {
  const candidates = ["/sys/class/dmi/id/product_uuid", "/etc/machine-id"]
  for (const path of candidates) {
    try {
      const value = (await readFile(path, "utf8")).trim()
      if (value) return value
    } catch {
      // try the next source
    }
  }
  return osHostname()
}

export async function collectHostIdentity(): Promise<HostIdentity> {
  return {
    hostname: osHostname(),
    osFamily: osFamily(),
    osVersion: process.env.LOCKHAVEN_OS_VERSION || `${type()} ${release()}`,
    architecture: arch(),
    serialNumber: process.env.LOCKHAVEN_SERIAL_NUMBER || (await serialNumber()),
  }
}
