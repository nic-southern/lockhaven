import { createHash } from "node:crypto"
import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"

import type { CheckInTitle, CheckInTitles } from "@nms/shared"

export const DEFAULT_TITLES_PATHS = [
  "/etc/lockhaven/titles.json",
  "/var/lib/lockhaven/titles.json",
]

export const MAX_TITLE_CONFIG_FILES = 256
export const MAX_TITLE_CONFIG_FILE_BYTES = 1024 * 1024

export type TitleWatch = {
  key?: string
  title: string
  process?: string
  build?: string
  build_file?: string
  config_path?: string
}

export type ProcEntry = {
  comm: string
  cmdline: string
}

export function parseTitlesWatchList(raw: string): TitleWatch[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }

  const rows = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { titles?: unknown }).titles)
      ? (parsed as { titles: unknown[] }).titles
      : []

  const watches: TitleWatch[] = []
  for (const row of rows) {
    if (!row || typeof row !== "object") continue
    const item = row as Record<string, unknown>
    const title = typeof item.title === "string" ? item.title.trim() : ""
    if (!title) continue
    const watch: TitleWatch = { title }
    if (typeof item.key === "string" && item.key.trim()) {
      watch.key = item.key.trim()
    }
    if (typeof item.process === "string" && item.process.trim()) {
      watch.process = item.process.trim()
    }
    if (typeof item.build === "string" && item.build.trim()) {
      watch.build = item.build.trim()
    }
    if (typeof item.build_file === "string" && item.build_file.trim()) {
      watch.build_file = item.build_file.trim()
    }
    if (typeof item.config_path === "string" && item.config_path.trim()) {
      watch.config_path = item.config_path.trim()
    }
    watches.push(watch)
  }
  return watches
}

export function firstCommandArg(cmdline: string) {
  const first = cmdline.split("\0")[0] ?? cmdline.split(/\s+/)[0] ?? ""
  return path.basename(first.trim())
}

export function processNameMatches(
  processName: string,
  entries: ProcEntry[]
): boolean {
  const wanted = processName.trim().toLowerCase()
  if (!wanted) return false
  const wantedBase = path.basename(wanted)
  for (const entry of entries) {
    const comm = entry.comm.trim().toLowerCase()
    const arg = firstCommandArg(entry.cmdline).toLowerCase()
    if (comm === wanted || comm === wantedBase) return true
    if (arg === wanted || arg === wantedBase) return true
  }
  return false
}

export function hashConfigBytes(
  parts: Array<{ path: string; content: Buffer }>
) {
  const hash = createHash("sha256")
  const sorted = [...parts].sort((left, right) =>
    left.path.localeCompare(right.path)
  )
  for (const part of sorted) {
    hash.update(part.path)
    hash.update("\0")
    hash.update(part.content.subarray(0, MAX_TITLE_CONFIG_FILE_BYTES))
    hash.update("\0")
  }
  return hash.digest("hex")
}

export function titlesFileCandidates(env = process.env) {
  const override = env.LOCKHAVEN_TITLES_FILE?.trim()
  if (override) return [override]
  return [...DEFAULT_TITLES_PATHS]
}

async function readIfExists(filePath: string) {
  try {
    return await readFile(filePath, "utf8")
  } catch {
    return null
  }
}

async function collectConfigParts(configPath: string) {
  try {
    const info = await stat(configPath)
    if (info.isFile()) {
      const content = await readFile(configPath)
      return [{ path: path.basename(configPath), content }]
    }
    if (!info.isDirectory()) {
      return []
    }
  } catch {
    return []
  }

  const parts: Array<{ path: string; content: Buffer }> = []
  const pending = [configPath]
  while (pending.length > 0 && parts.length < MAX_TITLE_CONFIG_FILES) {
    const current = pending.pop()
    if (!current) continue
    let entries: string[]
    try {
      entries = await readdir(current)
    } catch {
      continue
    }
    entries.sort()
    for (const name of entries) {
      if (name.startsWith(".")) continue
      const child = path.join(current, name)
      try {
        const info = await stat(child)
        if (info.isDirectory()) {
          pending.push(child)
          continue
        }
        if (!info.isFile()) continue
        const content = await readFile(child)
        parts.push({
          path: path.relative(configPath, child).split(path.sep).join("/"),
          content,
        })
      } catch {
        continue
      }
      if (parts.length >= MAX_TITLE_CONFIG_FILES) break
    }
  }
  return parts
}

async function collectProcEntries(): Promise<ProcEntry[]> {
  let dirents: Array<{ name: string; isDirectory(): boolean }>
  try {
    dirents = await readdir("/proc", { withFileTypes: true })
  } catch {
    return []
  }

  const entries: ProcEntry[] = []
  for (const dirent of dirents) {
    if (!dirent.isDirectory() || !/^\d+$/.test(dirent.name)) continue
    const base = path.join("/proc", dirent.name)
    const comm = (await readIfExists(path.join(base, "comm")))?.trim() ?? ""
    const cmdlineRaw = await readIfExists(path.join(base, "cmdline"))
    entries.push({ comm, cmdline: cmdlineRaw ?? "" })
  }
  return entries
}

export async function titlesFromWatches(
  watches: TitleWatch[],
  args: {
    readText: (filePath: string) => Promise<string | null>
    configParts: (
      configPath: string
    ) => Promise<Array<{ path: string; content: Buffer }>>
    processes: ProcEntry[]
  }
): Promise<CheckInTitles> {
  const items: CheckInTitle[] = []
  for (const watch of watches) {
    const buildFromFile = watch.build_file
      ? ((await args.readText(watch.build_file))?.trim() ?? "")
      : ""
    const build = buildFromFile || watch.build || ""
    const item: CheckInTitle = {
      title: watch.title,
      build,
    }
    if (watch.key) item.key = watch.key
    if (watch.process) {
      item.process_name = watch.process
      item.process_running = processNameMatches(watch.process, args.processes)
    }
    if (watch.config_path) {
      const parts = await args.configParts(watch.config_path)
      if (parts.length > 0) {
        item.config_hash = hashConfigBytes(parts)
      }
    }
    items.push(item)
  }
  return { items }
}

export async function collectTitles(
  env = process.env
): Promise<CheckInTitles | undefined> {
  let raw: string | null = null
  for (const candidate of titlesFileCandidates(env)) {
    raw = await readIfExists(candidate)
    if (raw != null) break
  }
  if (raw == null) return undefined

  const watches = parseTitlesWatchList(raw)
  return titlesFromWatches(watches, {
    readText: readIfExists,
    configParts: collectConfigParts,
    processes: await collectProcEntries(),
  })
}
