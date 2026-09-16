import { mkdir, unlink, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

import { runCommand } from "./process"

function selfCommand() {
  const self = fileURLToPath(import.meta.url)
  return { exec: process.execPath, script: self }
}

export function systemdUnit() {
  const { exec, script } = selfCommand()
  return `[Unit]
Description=Lockhaven endpoint agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${exec} ${script} run
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
`
}

export function launchdPlist() {
  const { exec, script } = selfCommand()
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.lockhaven.agent</string>
    <key>ProgramArguments</key>
    <array>
      <string>${exec}</string>
      <string>${script}</string>
      <string>run</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
  </dict>
</plist>
`
}

export async function installService(platform = process.platform) {
  if (platform === "linux") {
    const path = "/etc/systemd/system/lockhaven-agent.service"
    await writeFile(path, systemdUnit(), { mode: 0o644 })
    await runCommand("systemctl", ["daemon-reload"])
    await runCommand("systemctl", [
      "enable",
      "--now",
      "lockhaven-agent.service",
    ])
    return path
  }

  if (platform === "darwin") {
    const path = "/Library/LaunchDaemons/com.lockhaven.agent.plist"
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, launchdPlist(), { mode: 0o644 })
    await runCommand("launchctl", ["load", "-w", path])
    return path
  }

  if (platform === "win32") {
    const { exec, script } = selfCommand()
    const result = await runCommand("schtasks.exe", [
      "/Create",
      "/TN",
      "LockhavenAgent",
      "/SC",
      "ONSTART",
      "/RU",
      "SYSTEM",
      "/F",
      "/TR",
      `${exec} ${script} run`,
    ])
    if (result.code !== 0) {
      throw new Error("Could not install the background task.")
    }
    return "LockhavenAgent"
  }

  throw new Error("This platform is not supported yet.")
}

export async function uninstallService(platform = process.platform) {
  if (platform === "linux") {
    await runCommand("systemctl", [
      "disable",
      "--now",
      "lockhaven-agent.service",
    ])
    await unlink("/etc/systemd/system/lockhaven-agent.service").catch(() => {})
    await runCommand("systemctl", ["daemon-reload"])
    return
  }

  if (platform === "darwin") {
    const path = "/Library/LaunchDaemons/com.lockhaven.agent.plist"
    await runCommand("launchctl", ["unload", "-w", path])
    await unlink(path).catch(() => {})
    return
  }

  if (platform === "win32") {
    await runCommand("schtasks.exe", ["/Delete", "/TN", "LockhavenAgent", "/F"])
    return
  }
}
