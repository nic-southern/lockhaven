import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { agentReleases } from "@nms/db"
import { db } from "@nms/db/client"
import {
  parseSha256Sidecar,
  shippedAgentBinaries,
  shippedAgentDownloadPath,
  SHIPPED_AGENT_VERSION,
  type AgentReleasePlatform,
} from "@nms/shared"

export type ShippedReleaseRow = {
  platform: AgentReleasePlatform
  version: string
  channel: "stable"
  downloadUrl: string
  sha256: string
}

/** Read checksum sidecars next to the binaries this process can serve. */
export function collectShippedReleaseFiles(
  installDir: string
): ShippedReleaseRow[] {
  const rows: ShippedReleaseRow[] = []
  for (const binary of shippedAgentBinaries) {
    const binaryPath = path.join(installDir, binary.fileName)
    const sidecarPath = path.join(installDir, `${binary.fileName}.sha256`)
    if (!existsSync(binaryPath) || !existsSync(sidecarPath)) continue
    const sha256 = parseSha256Sidecar(readFileSync(sidecarPath, "utf8"))
    if (!sha256) continue
    rows.push({
      platform: binary.platform,
      version: SHIPPED_AGENT_VERSION,
      channel: "stable",
      downloadUrl: shippedAgentDownloadPath(binary.fileName),
      sha256,
    })
  }
  return rows
}

export function findShippedInstallDir(cwd = process.cwd()) {
  const candidates = [
    path.join(cwd, "apps/web/public/install"),
    path.join(cwd, "public/install"),
  ]
  for (const dir of candidates) {
    if (collectShippedReleaseFiles(dir).length > 0) return dir
  }
  return null
}

/**
 * Upsert the releases this image ships. Missing files are skipped so a dev
 * process without built binaries does not invent rows.
 */
export async function seedShippedAgentReleases(options?: {
  installDir?: string | null
}) {
  const installDir =
    options && "installDir" in options
      ? options.installDir
      : findShippedInstallDir()
  if (!installDir) return { seeded: 0 }
  const rows = collectShippedReleaseFiles(installDir)
  if (rows.length === 0) return { seeded: 0 }

  const now = new Date()
  for (const row of rows) {
    await db
      .insert(agentReleases)
      .values({
        platform: row.platform,
        version: row.version,
        channel: row.channel,
        downloadUrl: row.downloadUrl,
        sha256: row.sha256,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          agentReleases.channel,
          agentReleases.platform,
          agentReleases.version,
        ],
        set: {
          downloadUrl: row.downloadUrl,
          sha256: row.sha256,
          updatedAt: now,
        },
      })
  }

  return { seeded: rows.length }
}
