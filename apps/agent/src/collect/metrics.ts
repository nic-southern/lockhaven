import { readFile } from "node:fs/promises"
import {
  cpus,
  loadavg,
  totalmem,
  freemem,
  uptime,
  networkInterfaces,
} from "node:os"

import { parseWgDump } from "@nms/vpn"

import { runCommand } from "../process"
import { parseDfKp, parseProcMeminfo, parseProcNetDev } from "./parse"

export type CollectedMetrics = {
  uptime_seconds: number
  cpu: {
    load1: number
    load5: number
    load15: number
    cores: number
  }
  memory: {
    total_bytes: number
    available_bytes: number
    used_bytes: number
  }
  disks: Array<{
    mount: string
    filesystem: string
    total_bytes: number
    used_bytes: number
    available_bytes: number
  }>
  network: Array<{
    name: string
    rx_bytes: number
    tx_bytes: number
    rx_packets?: number
    tx_packets?: number
  }>
  wireguard: {
    handshake_age_seconds: number | null
  }
}

async function memoryFromProc() {
  try {
    return parseProcMeminfo(await readFile("/proc/meminfo", "utf8"))
  } catch {
    const total = totalmem()
    const available = freemem()
    return {
      total_bytes: total,
      available_bytes: available,
      used_bytes: Math.max(0, total - available),
    }
  }
}

async function disksFromDf() {
  const result = await runCommand("df", ["-kP"])
  if (result.code !== 0) return []
  return parseDfKp(result.stdout)
}

async function networkFromProc() {
  try {
    return parseProcNetDev(await readFile("/proc/net/dev", "utf8"))
  } catch {
    return Object.entries(networkInterfaces())
      .filter(([name]) => name !== "lo")
      .map(([name]) => ({
        name,
        rx_bytes: 0,
        tx_bytes: 0,
      }))
  }
}

async function handshakeAgeSeconds(tunnelName: string) {
  const result = await runCommand("wg", ["show", tunnelName, "dump"])
  if (result.code !== 0) return null
  const peers = parseWgDump(result.stdout)
  const handshake = peers[0]?.latestHandshakeAt
  if (!handshake) return null
  return Math.max(0, Math.floor((Date.now() - handshake.getTime()) / 1000))
}

export async function collectMetrics(
  tunnelName: string
): Promise<CollectedMetrics> {
  const [load1, load5, load15] = loadavg()
  const [memory, disks, network, handshake] = await Promise.all([
    memoryFromProc(),
    disksFromDf(),
    networkFromProc(),
    handshakeAgeSeconds(tunnelName),
  ])

  return {
    uptime_seconds: Math.floor(uptime()),
    cpu: {
      load1: load1 ?? 0,
      load5: load5 ?? 0,
      load15: load15 ?? 0,
      cores: cpus().length || 1,
    },
    memory,
    disks,
    network,
    wireguard: { handshake_age_seconds: handshake },
  }
}
