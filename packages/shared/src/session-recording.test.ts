import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, utimes, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { SESSION_RECORDING_ROOT_DEFAULT } from "./session-accountability"
import {
  pruneSessionRecordingFiles,
  recordingPathForConnection,
  resolveRecordingFilePath,
} from "./session-recording"

test("recording paths stay under the recordings root", () => {
  const root = SESSION_RECORDING_ROOT_DEFAULT
  assert.equal(
    recordingPathForConnection("nms-device-1-service-1-launch-1", root),
    `${root}/nms-device-1-service-1-launch-1`
  )
  assert.equal(
    resolveRecordingFilePath(root, `${root}/nms-device-1-service-1-launch-1`),
    `${root}/nms-device-1-service-1-launch-1`
  )
  assert.equal(
    resolveRecordingFilePath(root, "nms-device-1-service-1-launch-1"),
    `${root}/nms-device-1-service-1-launch-1`
  )
  assert.equal(resolveRecordingFilePath(root, "../secret"), null)
  assert.equal(resolveRecordingFilePath(root, "/etc/passwd"), null)
  assert.equal(resolveRecordingFilePath(root, null), null)
})

test("prunes recording files older than the cutoff", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lockhaven-recordings-"))
  await mkdir(dir, { recursive: true })
  const keep = join(dir, "keep-session")
  const drop = join(dir, "old-session")
  await writeFile(keep, "keep")
  await writeFile(drop, "drop")
  const old = new Date("2026-01-01T00:00:00.000Z")
  const recent = new Date("2026-09-16T12:00:00.000Z")
  await utimes(drop, old, old)
  await utimes(keep, recent, recent)

  const result = await pruneSessionRecordingFiles({
    root: dir,
    cutoff: new Date("2026-08-01T00:00:00.000Z"),
  })
  assert.equal(result.deleted, 1)
  assert.deepEqual(await readdir(dir), ["keep-session"])
})
