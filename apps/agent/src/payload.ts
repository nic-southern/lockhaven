import {
  checkInSchema,
  type CheckInMetrics,
  type CheckInPackages,
} from "@nms/shared"

import { AGENT_VERSION } from "./version"
import type { HostIdentity } from "./collect/host"

export type CheckInFacts = {
  deviceId: string
  checkInSecret: string
  hostname: string
  host: HostIdentity
  vpn: { interface_up: boolean; vpn_ipv4: string }
  services: Array<{
    type: "vnc" | "rdp" | "ssh" | "winrm_https"
    port: number
    listening: boolean
  }>
  metrics?: CheckInMetrics
  packages?: CheckInPackages
  commandResults?: Array<{
    id: string
    status: "succeeded" | "failed" | "refused"
    detail?: string
  }>
}

export function buildCheckInPayload(facts: CheckInFacts) {
  return checkInSchema.parse({
    device_id: facts.deviceId,
    check_in_secret: facts.checkInSecret,
    agent_version: AGENT_VERSION,
    hostname: facts.hostname,
    os_family: facts.host.osFamily,
    os_version: facts.host.osVersion,
    vpn: facts.vpn,
    services: facts.services,
    metrics: facts.metrics,
    packages: facts.packages,
    command_results: facts.commandResults,
  })
}
