import assert from "node:assert/strict"
import { test } from "node:test"

import { hashPassword, verifyPassword } from "./password"

test("verifies a password created by hashPassword", async () => {
  const passwordHash = await hashPassword("correct horse battery staple")

  assert.equal(
    await verifyPassword("correct horse battery staple", passwordHash),
    true
  )
})

test("rejects the wrong password", async () => {
  const passwordHash = await hashPassword("correct horse battery staple")

  assert.equal(await verifyPassword("wrong password", passwordHash), false)
})

test("rejects malformed password hashes", async () => {
  assert.equal(await verifyPassword("anything", "not-a-valid-hash"), false)
})
