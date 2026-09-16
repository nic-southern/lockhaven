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
  }> = []

  for (const line of output.split("\n")) {
    const match = line.match(
      /^(\S+)\/\S+\s+(\S+)\s+\S+\s+\[upgradable from: ([^\]]+)\]/
    )
    if (!match) continue
    updates.push({
      name: match[1],
      available_version: match[2],
      current_version: match[3],
      source: "apt",
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
