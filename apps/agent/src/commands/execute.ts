import { spawn } from "node:child_process"

import type { AgentCommand, AgentCommandResult } from "@nms/shared"

/**
 * Platform actions used by allowlisted commands. Callers pass argv arrays
 * only — never a Hub-supplied string, and never `shell: true`.
 */
export type CommandRuntime = {
  spawnDetached: (file: string, args: readonly string[]) => Promise<void>
  platform: NodeJS.Platform
}

export function createCommandRuntime(
  platform: NodeJS.Platform = process.platform
): CommandRuntime {
  return {
    platform,
    spawnDetached(file, args) {
      return new Promise((resolve, reject) => {
        const child = spawn(file, [...args], {
          detached: true,
          stdio: "ignore",
          shell: false,
          windowsHide: true,
        })
        child.once("error", reject)
        child.once("spawn", () => {
          child.unref()
          resolve()
        })
      })
    },
  }
}

const LINUX_REBOOT = { file: "/sbin/shutdown", args: ["-r", "now"] } as const
const DARWIN_REBOOT = { file: "/sbin/shutdown", args: ["-r", "now"] } as const
const WINDOWS_REBOOT = {
  file: "shutdown.exe",
  args: ["/r", "/t", "0"],
} as const

const LINUX_RESTART = {
  file: "/bin/systemctl",
  args: ["restart", "lockhaven-agent.service"],
} as const
const DARWIN_RESTART = {
  file: "/bin/launchctl",
  args: ["kickstart", "-k", "system/com.lockhaven.agent"],
} as const
const WINDOWS_RESTART = {
  file: "sc.exe",
  args: ["stop", "LockhavenAgent"],
} as const

function rebootSpec(platform: NodeJS.Platform) {
  if (platform === "win32") return WINDOWS_REBOOT
  if (platform === "darwin") return DARWIN_REBOOT
  return LINUX_REBOOT
}

function restartSpec(platform: NodeJS.Platform) {
  if (platform === "win32") return WINDOWS_RESTART
  if (platform === "darwin") return DARWIN_RESTART
  return LINUX_RESTART
}

/**
 * Runs one allowlisted command. `command.kind` is the only input that
 * selects behavior; nothing from Hub is passed to a process.
 */
export async function executeAgentCommand(
  command: AgentCommand,
  runtime: CommandRuntime
): Promise<AgentCommandResult> {
  try {
    if (command.kind === "reboot") {
      const spec = rebootSpec(runtime.platform)
      await runtime.spawnDetached(spec.file, spec.args)
      return { id: command.id, status: "succeeded" }
    }

    if (command.kind === "restart") {
      const spec = restartSpec(runtime.platform)
      await runtime.spawnDetached(spec.file, spec.args)
      return { id: command.id, status: "succeeded" }
    }

    if (command.kind === "update") {
      return {
        id: command.id,
        status: "failed",
        detail: "No signed update is available.",
      }
    }

    return {
      id: command.id,
      status: "refused",
      detail: "This command is not allowed.",
    }
  } catch (error) {
    return {
      id: command.id,
      status: "failed",
      detail:
        error instanceof Error
          ? error.message.slice(0, 500)
          : "Command failed.",
    }
  }
}

export async function executeResolvedCommands(
  commands: AgentCommand[],
  runtime: CommandRuntime
) {
  const results: AgentCommandResult[] = []
  for (const command of commands) {
    results.push(await executeAgentCommand(command, runtime))
  }
  return results
}
