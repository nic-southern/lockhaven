import { access } from "node:fs/promises"

import {
  parseAptUpgradable,
  parseDnfCheckUpdate,
  parseDnfSecurityUpdates,
  parseDpkgQuery,
  parseRpmQa,
  parseWindowsUpdateList,
} from "./parse"
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
      available_updates: await collectRpmSecurityUpdates(),
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

function commandRan(code: number) {
  return code === 0 || code === 100
}

async function collectRpmSecurityUpdates() {
  for (const bin of ["dnf", "yum"]) {
    const result = await runCommand(bin, [
      "-q",
      "updateinfo",
      "list",
      "security",
    ])
    if (commandRan(result.code)) {
      return parseDnfSecurityUpdates(result.stdout)
    }
  }
  for (const bin of ["dnf", "yum"]) {
    const result = await runCommand(bin, ["-q", "check-update", "--security"])
    if (commandRan(result.code)) {
      return parseDnfCheckUpdate(result.stdout)
    }
  }
  return []
}

const WINDOWS_UPDATE_SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
  $session = New-Object -ComObject Microsoft.Update.Session
  $searcher = $session.CreateUpdateSearcher()
  $result = $searcher.Search("IsInstalled=0 and IsHidden=0 and Type='Software'")
} catch {
  exit 1
}
$count = 0
foreach ($update in @($result.Updates)) {
  if ($count -ge 200) { break }
  $names = New-Object System.Collections.Generic.List[string]
  if ($update.Categories) {
    foreach ($cat in @($update.Categories)) { [void]$names.Add([string]$cat.Name) }
  }
  $kb = ''
  if ($update.KBArticleIDs) {
    foreach ($article in @($update.KBArticleIDs)) { if (-not $kb) { $kb = [string]$article } }
  }
  $title = [string]$update.Title
  $joined = $names -join '|'
  foreach ($ch in @([char]9, [char]10, [char]13)) {
    $title = $title.Replace([string]$ch, ' ')
    $joined = $joined.Replace([string]$ch, ' ')
  }
  Write-Output ($title + [char]9 + $kb + [char]9 + $joined)
  $count++
}
`

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
  const updates = await runCommand(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_UPDATE_SCRIPT],
    20_000
  )
  return {
    installed,
    available_updates:
      updates.code === 0 ? parseWindowsUpdateList(updates.stdout) : [],
  }
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
