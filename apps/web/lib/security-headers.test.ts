import assert from "node:assert/strict"
import test from "node:test"

import {
  buildContentSecurityPolicy,
  nonceFromPolicy,
  staticSecurityHeaders,
} from "./security-headers"

function directives(policy: string) {
  return new Map(
    policy.split(";").map((entry) => {
      const [name, ...values] = entry.trim().split(/\s+/)
      return [name, values] as const
    })
  )
}

test("production policy gates scripts by nonce and blocks framing", () => {
  const policy = buildContentSecurityPolicy({ nonce: "abc123" })
  const map = directives(policy)

  assert.deepEqual(map.get("script-src"), [
    "'self'",
    "'nonce-abc123'",
    "'strict-dynamic'",
  ])
  assert.deepEqual(map.get("frame-ancestors"), ["'none'"])
  assert.deepEqual(map.get("frame-src"), ["'none'"])
  assert.deepEqual(map.get("object-src"), ["'none'"])
  assert.deepEqual(map.get("base-uri"), ["'self'"])
  assert.deepEqual(map.get("form-action"), ["'self'"])
  assert.deepEqual(map.get("connect-src"), ["'self'"])
  assert.equal(map.has("upgrade-insecure-requests"), true)
  assert.equal(policy.includes("unsafe-eval"), false)
})

test("development policy allows the bundler's eval and websocket refresh", () => {
  const policy = buildContentSecurityPolicy({ nonce: "n", dev: true })
  const map = directives(policy)
  assert.equal(map.get("script-src")?.includes("'unsafe-eval'"), true)
  assert.deepEqual(map.get("connect-src"), ["'self'", "ws:", "wss:"])
  assert.equal(map.has("upgrade-insecure-requests"), false)
})

test("nonce round-trips through the policy string", () => {
  const nonce = Buffer.from("7f3a-nonce").toString("base64")
  assert.equal(nonceFromPolicy(buildContentSecurityPolicy({ nonce })), nonce)
  assert.equal(nonceFromPolicy("default-src 'self'"), null)
})

test("static headers always include hardening basics and HSTS only over TLS", () => {
  const plain = staticSecurityHeaders({ https: false })
  const keys = plain.map((header) => header.key)
  assert.deepEqual(keys, [
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Referrer-Policy",
    "Permissions-Policy",
    "Cross-Origin-Opener-Policy",
    "X-DNS-Prefetch-Control",
  ])
  assert.equal(
    plain.find((header) => header.key === "X-Frame-Options")?.value,
    "DENY"
  )

  const secure = staticSecurityHeaders({ https: true })
  const hsts = secure.find(
    (header) => header.key === "Strict-Transport-Security"
  )
  assert.match(hsts?.value ?? "", /max-age=\d+; includeSubDomains/)
})
