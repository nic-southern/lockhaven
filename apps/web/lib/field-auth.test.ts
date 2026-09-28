import assert from "node:assert/strict"
import test from "node:test"

import { hashFieldHandoffCode, isAllowedFieldRedirectUri } from "./field-auth"

test("allows loopback callback redirect URIs on ephemeral ports", () => {
  assert.equal(
    isAllowedFieldRedirectUri("http://127.0.0.1:53421/callback"),
    true
  )
  assert.equal(
    isAllowedFieldRedirectUri("http://localhost:1024/callback"),
    true
  )
  assert.equal(isAllowedFieldRedirectUri("http://[::1]:45000/callback"), true)
})

test("rejects non-loopback or non-callback redirect URIs", () => {
  assert.equal(
    isAllowedFieldRedirectUri("https://evil.example/callback"),
    false
  )
  assert.equal(isAllowedFieldRedirectUri("http://127.0.0.1:80/callback"), false)
  assert.equal(isAllowedFieldRedirectUri("http://127.0.0.1:53421/other"), false)
  assert.equal(isAllowedFieldRedirectUri("lockhaven-field://auth"), false)
})

test("hashes handoff codes stably", () => {
  const first = hashFieldHandoffCode("abc")
  const second = hashFieldHandoffCode("abc")
  assert.equal(first, second)
  assert.notEqual(first, hashFieldHandoffCode("abd"))
  assert.equal(first.length, 64)
})
