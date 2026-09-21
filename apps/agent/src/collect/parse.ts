export function parseDfKp(output: string) {
  const disks: Array<{
    mount: string
    filesystem: string
    total_bytes: number
    used_bytes: number
    available_bytes: number
  }> = []

  for (const line of output.split("\n").slice(1)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parts = trimmed.split(/\s+/)
    if (parts.length < 6) continue
    const filesystem = parts[0]
    const totalKb = Number(parts[1])
    const usedKb = Number(parts[2])
    const availableKb = Number(parts[3])
    const mount = parts.slice(5).join(" ")
    if (!filesystem || filesystem.startsWith("tmpfs") || !mount) continue
    if (
      ![totalKb, usedKb, availableKb].every((value) => Number.isFinite(value))
    ) {
      continue
    }
    disks.push({
      mount,
      filesystem,
      total_bytes: totalKb * 1024,
      used_bytes: usedKb * 1024,
      available_bytes: availableKb * 1024,
    })
  }

  return disks
}

export function parseProcNetDev(output: string) {
  const interfaces: Array<{
    name: string
    rx_bytes: number
    tx_bytes: number
    rx_packets: number
    tx_packets: number
  }> = []

  for (const line of output.split("\n").slice(2)) {
    const match = line.match(
      /^\s*([^:]+):\s*(\d+)\s+(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)\s+(\d+)/
    )
    if (!match) continue
    const name = match[1].trim()
    if (!name || name === "lo") continue
    interfaces.push({
      name,
      rx_bytes: Number(match[2]),
      rx_packets: Number(match[3]),
      tx_bytes: Number(match[4]),
      tx_packets: Number(match[5]),
    })
  }

  return interfaces
}

export function parseProcMeminfo(output: string) {
  const values = new Map<string, number>()
  for (const line of output.split("\n")) {
    const match = line.match(/^(\w+):\s+(\d+) kB/)
    if (!match) continue
    values.set(match[1], Number(match[2]) * 1024)
  }
  const total = values.get("MemTotal") ?? 0
  const available = values.get("MemAvailable") ?? values.get("MemFree") ?? 0
  return {
    total_bytes: total,
    available_bytes: available,
    used_bytes: Math.max(0, total - available),
  }
}

const RPM_ARCH_SUFFIXES = [
  ".x86_64",
  ".aarch64",
  ".noarch",
  ".i686",
  ".i386",
  ".ppc64le",
  ".s390x",
  ".armv7hl",
] as const

/** Apt pocket names like `jammy-security` or `stable-security`. */
export function aptPocketIsSecurity(suite: string) {
  return suite
    .split(",")
    .some((part) => part.trim().toLowerCase().split("-").includes("security"))
}

export function parseDpkgQuery(output: string, source = "apt") {
  const packages: Array<{ name: string; version: string; source: string }> = []
  for (const line of output.split("\n")) {
    const [name, version] = line.split("\t")
    if (!name || !version) continue
    packages.push({ name: name.trim(), version: version.trim(), source })
  }
  return packages
}

export function parseRpmQa(output: string, source = "rpm") {
  const packages: Array<{ name: string; version: string; source: string }> = []
  for (const line of output.split("\n")) {
    const [name, version] = line.split("\t")
    if (!name || !version) continue
    packages.push({ name: name.trim(), version: version.trim(), source })
  }
  return packages
}

export function parseAptUpgradable(output: string) {
  const updates: Array<{
    name: string
    current_version?: string
    available_version: string
    source: string
    severity?: "security"
  }> = []

  for (const line of output.split("\n")) {
    const match = line.match(
      /^(\S+)\/(\S+)\s+(\S+)\s+\S+\s+\[upgradable from: ([^\]]+)\]/
    )
    if (!match) continue
    const suite = match[2] ?? ""
    updates.push({
      name: match[1] ?? "",
      available_version: match[3] ?? "",
      current_version: match[4],
      source: "apt",
      ...(aptPocketIsSecurity(suite) ? { severity: "security" as const } : {}),
    })
  }
  return updates
}

function looksLikeRpmVersion(value: string) {
  return /^(?:\d+:)?\d/.test(value)
}

function rpmNameFromArch(field: string) {
  for (const suffix of RPM_ARCH_SUFFIXES) {
    if (field.endsWith(suffix) && field.length > suffix.length) {
      return field.slice(0, -suffix.length)
    }
  }
  return null
}

function parseNevra(field: string) {
  const nameWithVersion = rpmNameFromArch(field)
  if (!nameWithVersion) return null
  const releaseAt = nameWithVersion.lastIndexOf("-")
  if (releaseAt <= 0) return null
  const versionAt = nameWithVersion.lastIndexOf("-", releaseAt - 1)
  if (versionAt <= 0) return null
  const name = nameWithVersion.slice(0, versionAt)
  const version = nameWithVersion.slice(versionAt + 1)
  const upstream = version.split("-")[0] ?? ""
  if (!name || !looksLikeRpmVersion(upstream)) return null
  return { name, version }
}

/** Type column from `dnf updateinfo list security`. Unknown labels are ignored. */
export function dnfAdvisorySeverity(typeToken: string) {
  const token = typeToken.trim().toLowerCase().replace(/\.+$/, "")
  switch (token) {
    case "security":
      return "security" as const
    case "critical/sec":
    case "critical/security":
      return "critical" as const
    case "important/sec":
    case "important/security":
    case "moderate/sec":
    case "moderate/security":
    case "low/sec":
    case "low/security":
      return "security" as const
    default:
      return null
  }
}

export function parseDnfSecurityUpdates(output: string) {
  const updates: Array<{
    name: string
    available_version: string
    source: string
    severity: "security" | "critical"
  }> = []
  const seen = new Map<string, number>()

  for (const line of output.split("\n")) {
    const fields = line.trim().split(/\s+/).filter(Boolean)
    let severity: "security" | "critical" | null = null
    let parsed: { name: string; version: string } | null = null
    for (const field of fields) {
      const nextSeverity = dnfAdvisorySeverity(field)
      if (
        nextSeverity &&
        (!severity || (severity !== "critical" && nextSeverity === "critical"))
      ) {
        severity = nextSeverity
      }
      const nevra = parseNevra(field)
      if (nevra) parsed = nevra
    }
    if (!severity || !parsed) continue
    const key = parsed.name.toLowerCase()
    const update = {
      name: parsed.name,
      available_version: parsed.version,
      source: "rpm",
      severity,
    }
    const existing = seen.get(key)
    if (existing !== undefined) {
      if (
        updates[existing]?.severity !== "critical" &&
        severity === "critical"
      ) {
        updates[existing] = update
      }
      continue
    }
    seen.set(key, updates.length)
    updates.push(update)
  }

  return updates
}

/** `dnf check-update --security` rows. Every parsed row is a security update. */
export function parseDnfCheckUpdate(output: string) {
  const updates: Array<{
    name: string
    available_version: string
    source: string
    severity: "security"
  }> = []
  let skipping = false

  for (const line of output.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.toLowerCase().startsWith("obsoleting")) {
      skipping = true
      continue
    }
    if (skipping) continue
    const fields = trimmed.split(/\s+/).filter(Boolean)
    if (fields.length < 2) continue
    const name = rpmNameFromArch(fields[0] ?? "")
    const version = fields[1] ?? ""
    if (!name || !looksLikeRpmVersion(version)) continue
    updates.push({
      name,
      available_version: version,
      source: "rpm",
      severity: "security",
    })
  }

  return updates
}

/**
 * Windows Update category names. Only the official Security Updates and
 * Critical Updates categories qualify. Other names, including ones that
 * merely contain those words, do not.
 */
export function classifyWindowsUpdateCategories(categories: string) {
  let security = false
  let critical = false
  for (const part of categories.split("|")) {
    switch (part.trim().toLowerCase()) {
      case "security updates":
        security = true
        break
      case "critical updates":
        critical = true
        break
      default:
        break
    }
  }
  if (security) return "security" as const
  if (critical) return "critical" as const
  return undefined
}

export function parseWindowsUpdateList(output: string) {
  const updates: Array<{
    name: string
    available_version: string
    source: string
    severity?: "security" | "critical"
  }> = []

  for (const line of output.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const [titleRaw = "", kbRaw = "", categoriesRaw = ""] = trimmed.split("\t")
    const name = titleRaw.trim().slice(0, 256)
    if (!name) continue
    const kb = kbRaw.trim()
    const available = kb
      ? kb.toUpperCase().startsWith("KB")
        ? kb
        : `KB${kb}`
      : "pending"
    const severity = classifyWindowsUpdateCategories(categoriesRaw)
    updates.push({
      name,
      available_version: available.slice(0, 128),
      source: "windows-update",
      ...(severity ? { severity } : {}),
    })
  }

  return updates
}

export function parseListeningPorts(ssOutput: string) {
  const ports = new Set<number>()
  for (const line of ssOutput.split("\n")) {
    const match = line.match(/:(\d+)\s/)
    if (!match) continue
    ports.add(Number(match[1]))
  }
  return ports
}
