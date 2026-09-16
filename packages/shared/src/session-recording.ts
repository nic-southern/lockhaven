import { join, resolve, sep } from "node:path"
import { readdir, rm, stat } from "node:fs/promises"

import { sessionRecordingRoot } from "./session-accountability"

/** Node path and prune helpers. Import from `@nms/shared/session-recording`, not the barrel. */

export { sessionRecordingRoot } from "./session-accountability"

export function recordingFileName(connectionName: string) {
  return connectionName.replaceAll(/[^A-Za-z0-9._-]/g, "-")
}

export function recordingPathForConnection(
  connectionName: string,
  root = sessionRecordingRoot()
) {
  return join(root, recordingFileName(connectionName))
}

/**
 * Resolves a stored recording path against the recordings root. Rejects
 * paths that escape the root.
 */
export function resolveRecordingFilePath(
  root: string,
  recordingPath: string | null | undefined
): string | null {
  if (!recordingPath) return null
  const resolvedRoot = resolve(root)
  const candidate = recordingPath.includes(sep)
    ? resolve(recordingPath)
    : resolve(resolvedRoot, recordingPath)
  const rootPrefix = resolvedRoot.endsWith(sep)
    ? resolvedRoot
    : `${resolvedRoot}${sep}`
  if (candidate !== resolvedRoot && !candidate.startsWith(rootPrefix)) {
    return null
  }
  if (candidate === resolvedRoot) return null
  return candidate
}

export async function pruneSessionRecordingFiles(input: {
  root: string
  cutoff: Date
  now?: Date
}): Promise<{ deleted: number; scanned: number }> {
  let scanned = 0
  let deleted = 0
  let entries: string[]
  try {
    entries = await readdir(input.root)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT") return { deleted: 0, scanned: 0 }
    throw error
  }

  const cutoffMs = input.cutoff.getTime()
  for (const name of entries) {
    if (name.startsWith(".")) continue
    const filePath = join(input.root, name)
    scanned += 1
    let info: Awaited<ReturnType<typeof stat>>
    try {
      info = await stat(filePath)
    } catch {
      continue
    }
    if (!info.isFile() && !info.isSymbolicLink()) continue
    const mtimeMs = info.mtimeMs
    if (mtimeMs > cutoffMs) continue
    try {
      await rm(filePath, { force: true })
      deleted += 1
    } catch {
      // Leave the file; the next pass retries.
    }
  }

  return { deleted, scanned }
}
