import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import {
  enrollmentRequestSchema,
  enrollmentResponseSchema,
  serviceDefaults,
} from "@nms/shared"
import { generateWireGuardKeyPair } from "@nms/vpn"

import { saveState, type AgentState } from "./config"
import { collectHostIdentity } from "./collect/host"
import { postJson } from "./http"

export type EnrollOptions = {
  token: string
  baseUrl: string
  tunnelName?: string
}

export async function enrollDevice(options: EnrollOptions) {
  const host = await collectHostIdentity()
  const keyPair = generateWireGuardKeyPair()
  const tunnelName = options.tunnelName ?? "lockhaven"
  const baseUrl = options.baseUrl.replace(/\/+$/, "")

  const services =
    host.osFamily === "windows"
      ? [
          {
            type: "rdp" as const,
            protocol: "tcp",
            port: serviceDefaults.rdp.port,
          },
        ]
      : [
          {
            type: "ssh" as const,
            protocol: "tcp",
            port: serviceDefaults.ssh.port,
          },
          {
            type: "vnc" as const,
            protocol: "tcp",
            port: serviceDefaults.vnc.port,
          },
        ]

  const request = enrollmentRequestSchema.parse({
    token: options.token,
    hostname: host.hostname,
    os_family: host.osFamily,
    os_version: host.osVersion,
    architecture: host.architecture,
    serial_number: host.serialNumber,
    wireguard_public_key: keyPair.publicKey,
    services,
  })

  const { status, data } = await postJson<unknown>(
    `${baseUrl}/api/enroll`,
    request
  )
  if (status >= 400) {
    throw new Error("Enrollment was refused.")
  }

  const enrolled = enrollmentResponseSchema.parse(data)
  const state: AgentState = {
    deviceId: enrolled.device_id,
    checkInSecret: enrolled.check_in_secret,
    baseUrl,
    hostname: host.hostname,
    vpnIpv4: enrolled.vpn_ipv4,
    tunnelName,
  }
  const statePath = await saveState(state)

  if (host.osFamily === "linux") {
    await writeLinuxTunnel(state, keyPair.privateKey, enrolled)
  }

  return { state, statePath }
}

async function writeLinuxTunnel(
  state: AgentState,
  privateKey: string,
  enrolled: ReturnType<typeof enrollmentResponseSchema.parse>
) {
  const configDir = "/etc/wireguard"
  const libDir = "/var/lib/lockhaven"
  await mkdir(configDir, { recursive: true, mode: 0o700 })
  await mkdir(libDir, { recursive: true, mode: 0o700 })

  const config = `[Interface]
Address = ${enrolled.vpn_ipv4}
PrivateKey = ${privateKey}

[Peer]
PublicKey = ${enrolled.wireguard.server_public_key}
Endpoint = ${enrolled.wireguard.endpoint}
AllowedIPs = ${enrolled.wireguard.allowed_ips.join(", ")}
PersistentKeepalive = ${enrolled.wireguard.persistent_keepalive}
`

  await writeFile(join(configDir, `${state.tunnelName}.conf`), config, {
    mode: 0o600,
  })
  await writeFile(
    join(libDir, `${state.tunnelName}.check-in-secret`),
    `${enrolled.check_in_secret}\n`,
    { mode: 0o600 }
  )
}
