import { access } from "node:fs/promises"

import { normalizeVpnIpv4 } from "@nms/vpn"

import { runCommand } from "../process"

async function interfaceExists(name: string) {
  try {
    await access(`/sys/class/net/${name}`)
    return true
  } catch {
    return false
  }
}

export async function collectVpn(tunnelName: string, expectedIpv4: string) {
  const dump = await runCommand("wg", ["show", tunnelName, "dump"])
  const interfaceUp = dump.code === 0 || (await interfaceExists(tunnelName))

  return {
    interface_up: interfaceUp,
    vpn_ipv4: normalizeVpnIpv4(expectedIpv4),
  }
}
