import {
  checkInResponseSchema,
  resolveAgentCommands,
  type AgentCommandResult,
} from "@nms/shared"

import { collectHostIdentity } from "./collect/host"
import { collectMetrics } from "./collect/metrics"
import { collectPackages } from "./collect/packages"
import { collectServices } from "./collect/services"
import { collectTitles } from "./collect/titles"
import { collectVpn } from "./collect/vpn"
import {
  createCommandRuntime,
  executeAgentCommand,
  executeResolvedCommands,
} from "./commands/execute"
import { loadState, saveState, type AgentState } from "./config"
import { postJson } from "./http"
import { buildCheckInPayload } from "./payload"

export async function performCheckIn(state?: AgentState) {
  const current = state ?? (await loadState())
  if (!current) {
    throw new Error("This device is not enrolled yet.")
  }

  const host = await collectHostIdentity()
  const [vpn, services, metrics, packages, titles] = await Promise.all([
    collectVpn(current.tunnelName, current.vpnIpv4),
    collectServices(host.osFamily),
    collectMetrics(current.tunnelName),
    collectPackages(),
    collectTitles(),
  ])

  const payload = buildCheckInPayload({
    deviceId: current.deviceId,
    checkInSecret: current.checkInSecret,
    hostname: current.hostname,
    host,
    vpn,
    services,
    metrics,
    packages,
    titles,
    commandResults: current.pendingCommandResults,
  })

  const { status, data } = await postJson<unknown>(
    `${current.baseUrl}/api/agent/check-in`,
    payload
  )
  if (status >= 400) {
    throw new Error("Check-in was refused.")
  }

  const response = checkInResponseSchema.parse(data)
  const { accepted, refused } = resolveAgentCommands(response.commands)
  const runtime = createCommandRuntime()
  const later = accepted.filter((command) => command.kind === "reboot")
  const now = accepted.filter((command) => command.kind !== "reboot")
  const results: AgentCommandResult[] = [
    ...refused,
    ...(await executeResolvedCommands(now, runtime)),
  ]

  const nextState: AgentState = {
    ...current,
    pendingCommandResults: results,
  }
  await saveState(nextState)

  for (const command of later) {
    results.push(await executeAgentCommand(command, runtime))
  }
  if (later.length > 0) {
    await saveState({ ...nextState, pendingCommandResults: results })
  }

  return { status, accepted: accepted.length, refused: refused.length }
}
