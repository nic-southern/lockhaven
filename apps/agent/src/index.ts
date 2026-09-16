#!/usr/bin/env node

import { performCheckIn } from "./checkin"
import { loadState } from "./config"
import { enrollDevice } from "./enroll"
import { installService, uninstallService } from "./service"
import { AGENT_VERSION } from "./version"

const DEFAULT_INTERVAL_MS = 60_000

function argValue(args: string[], name: string) {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  return args[index + 1]
}

function printUsage() {
  process.stdout.write(`Lockhaven agent ${AGENT_VERSION}

Usage:
  lockhaven-agent enroll --token <token> --base-url <url>
  lockhaven-agent check-in
  lockhaven-agent run
  lockhaven-agent install-service
  lockhaven-agent uninstall-service
  lockhaven-agent version
`)
}

async function main() {
  const [, , command, ...args] = process.argv

  if (!command || command === "help" || command === "--help") {
    printUsage()
    return
  }

  if (command === "version" || command === "--version") {
    process.stdout.write(`${AGENT_VERSION}\n`)
    return
  }

  if (command === "enroll") {
    const token = argValue(args, "--token") || process.env.LOCKHAVEN_TOKEN || ""
    const baseUrl =
      argValue(args, "--base-url") || process.env.LOCKHAVEN_BASE_URL || ""
    const tunnelName =
      argValue(args, "--tunnel-name") ||
      process.env.LOCKHAVEN_TUNNEL_NAME ||
      "lockhaven"
    if (!token || !baseUrl) {
      throw new Error("enroll requires --token and --base-url.")
    }
    const enrolled = await enrollDevice({ token, baseUrl, tunnelName })
    process.stdout.write(`Enrolled device ${enrolled.state.deviceId}\n`)
    process.stdout.write(`State: ${enrolled.statePath}\n`)
    return
  }

  if (command === "check-in") {
    const result = await performCheckIn()
    process.stdout.write(
      `Check-in complete (${result.accepted} commands, ${result.refused} refused).\n`
    )
    return
  }

  if (command === "run") {
    const interval = Number(
      process.env.LOCKHAVEN_CHECK_IN_INTERVAL_MS ?? DEFAULT_INTERVAL_MS
    )
    if (!(await loadState())) {
      throw new Error("This device is not enrolled yet.")
    }
    const tick = async () => {
      try {
        await performCheckIn()
      } catch (error) {
        process.stderr.write(
          `${error instanceof Error ? error.message : "Check-in failed."}\n`
        )
      }
    }
    await tick()
    setInterval(
      () => {
        void tick()
      },
      Number.isFinite(interval) && interval >= 5_000
        ? interval
        : DEFAULT_INTERVAL_MS
    )
    return
  }

  if (command === "install-service") {
    const path = await installService()
    process.stdout.write(`Service installed (${path}).\n`)
    return
  }

  if (command === "uninstall-service") {
    await uninstallService()
    process.stdout.write("Service removed.\n")
    return
  }

  printUsage()
  process.exitCode = 1
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "The agent failed."}\n`
  )
  process.exit(1)
})
