import { readFile } from "node:fs/promises"
import { hostname as osHostname, type, release, arch } from "node:os"

import { sanitizeHardwareSerial } from "@nms/shared"

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

async function platformSerial(): Promise<string> {
  try {
    return (await readFile("/sys/class/dmi/id/product_serial", "utf8")).trim()
  } catch {
    return ""
  }
}

/** Real chassis serial only; empty when missing or a BIOS placeholder. */
export async function hardwareSerial(): Promise<string> {
  const fromEnv = sanitizeHardwareSerial(process.env.LOCKHAVEN_SERIAL_NUMBER)
  if (fromEnv) return fromEnv
  return sanitizeHardwareSerial(await platformSerial()) ?? ""
}

async function serialNumber() {
  const hardware = await hardwareSerial()
  if (hardware) return hardware
  return osHostname()
}

export async function collectHostIdentity(): Promise<HostIdentity> {
  return {
    hostname: osHostname(),
    osFamily: osFamily(),
    osVersion: process.env.LOCKHAVEN_OS_VERSION || `${type()} ${release()}`,
    architecture: arch(),
    serialNumber: await serialNumber(),
  }
}
