import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import { SHIPPED_AGENT_VERSION } from "@nms/shared"

import { collectShippedReleaseFiles } from "./shipped-agent-releases"

test("shipped release rows come from sidecar checksums, not hand-edited hashes", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lockhaven-install-"))
  const hash = "ab".repeat(32)
  writeFileSync(path.join(dir, "lockhaven-agent-linux-amd64"), "binary")
  writeFileSync(
    path.join(dir, "lockhaven-agent-linux-amd64.sha256"),
    `${hash}  lockhaven-agent-linux-amd64\n`
  )
  writeFileSync(path.join(dir, "lockhaven-agent-linux-arm64.sha256"), hash)

  const rows = collectShippedReleaseFiles(dir)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.platform, "linux-amd64")
  assert.equal(rows[0]?.version, SHIPPED_AGENT_VERSION)
  assert.equal(rows[0]?.channel, "stable")
  assert.equal(rows[0]?.downloadUrl, "/install/lockhaven-agent-linux-amd64")
  assert.equal(rows[0]?.sha256, hash)
})

test("a sidecar without a binary is ignored", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lockhaven-install-"))
  writeFileSync(
    path.join(dir, "lockhaven-agent-windows-amd64.exe.sha256"),
    "cd".repeat(32)
  )
  assert.deepEqual(collectShippedReleaseFiles(dir), [])
})
