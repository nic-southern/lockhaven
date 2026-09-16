import { access } from "node:fs/promises"

import { parseAptUpgradable, parseDpkgQuery, parseRpmQa } from "./parse"
import { runCommand } from "../process"

async function fileExists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function collectLinuxPackages() {
  const dpkg = await runCommand("dpkg-query", [
    "-W",
    "-f",
    "${Package}\\t${Version}\\n",
  ])
  if (dpkg.code === 0 && dpkg.stdout.trim()) {
    const installed = parseDpkgQuery(dpkg.stdout)
    const upgrades = await runCommand("apt", ["list", "--upgradable"])
    return {
      installed,
      available_updates:
        upgrades.code === 0 ? parseAptUpgradable(upgrades.stdout) : [],
    }
  }

  const rpm = await runCommand("rpm", [
    "-qa",
    "--queryformat",
    "%{NAME}\\t%{VERSION}-%{RELEASE}\\n",
  ])
  if (rpm.code === 0 && rpm.stdout.trim()) {
    return {
      installed: parseRpmQa(rpm.stdout),
      available_updates: [],
    }
  }

  return { installed: [], available_updates: [] }
}

async function collectDarwinPackages() {
  const brew = await runCommand("brew", ["list", "--versions"])
  if (brew.code !== 0) {
    return { installed: [], available_updates: [] }
  }
  const installed = brew.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, version] = line.split(/\s+/)
      return {
        name,
        version: version ?? "0",
        source: "brew",
      }
    })
  return { installed, available_updates: [] }
}

async function collectWindowsPackages() {
  const result = await runCommand("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*, HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* | Where-Object DisplayName | Select-Object -First 2000 DisplayName, DisplayVersion | ConvertTo-Csv -NoTypeInformation",
  ])
  if (result.code !== 0) {
    return { installed: [], available_updates: [] }
  }
  const lines = result.stdout.split("\n").slice(1)
  const installed = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^"(.*)","(.*)"$/)
      if (!match) return null
      return {
        name: match[1],
        version: match[2] || "0",
        source: "windows",
      }
    })
    .filter((pkg): pkg is { name: string; version: string; source: string } =>
      Boolean(pkg?.name)
    )
  return { installed, available_updates: [] }
}

export async function collectPackages(platform = process.platform) {
  const inventory =
    platform === "win32"
      ? await collectWindowsPackages()
      : platform === "darwin"
        ? await collectDarwinPackages()
        : await collectLinuxPackages()

  const reboot_required =
    platform === "linux" ? await fileExists("/var/run/reboot-required") : false

  return {
    reboot_required,
    installed: inventory.installed,
    available_updates: inventory.available_updates,
  }
}
