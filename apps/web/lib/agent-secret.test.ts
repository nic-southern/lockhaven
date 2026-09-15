import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"

import { agentSecretMatches, hashAgentSecret } from "./agent-secret"

test("hashAgentSecret produces a stable hex sha-256 digest", () => {
  const digest = hashAgentSecret("s3cret")
  assert.equal(digest, createHash("sha256").update("s3cret").digest("hex"))
  assert.match(digest, /^[0-9a-f]{64}$/)
  assert.equal(hashAgentSecret("s3cret"), digest)
})

test("agentSecretMatches accepts the original secret only", () => {
  const stored = hashAgentSecret("correct-horse")
  assert.equal(agentSecretMatches("correct-horse", stored), true)
  assert.equal(agentSecretMatches("correct-horsf", stored), false)
  assert.equal(agentSecretMatches("", stored), false)
  assert.equal(agentSecretMatches("correct-horse", stored.toUpperCase()), true)
})

test("agentSecretMatches rejects missing or malformed digests", () => {
  assert.equal(agentSecretMatches("anything", null), false)
  assert.equal(agentSecretMatches("anything", undefined), false)
  assert.equal(agentSecretMatches("anything", ""), false)
  assert.equal(agentSecretMatches("anything", "not-hex"), false)
  assert.equal(agentSecretMatches("anything", "abcd"), false)
  const stored = hashAgentSecret("anything")
  assert.equal(agentSecretMatches("anything", stored.slice(0, 62)), false)
  assert.equal(agentSecretMatches("anything", `${stored}00`), false)
})
