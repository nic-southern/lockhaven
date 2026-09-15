import assert from "node:assert/strict"
import test from "node:test"

import { requestOrigin, verifyRequestOrigin } from "./request-origin"

function headers(entries: Record<string, string>) {
  return new Headers(entries)
}

test("requestOrigin prefers proxy headers and infers the scheme", () => {
  assert.equal(
    requestOrigin(
      headers({
        host: "web:3000",
        "x-forwarded-host": "console.example.com",
        "x-forwarded-proto": "https",
      })
    ),
    "https://console.example.com"
  )
  assert.equal(
    requestOrigin(headers({ host: "localhost:3000" })),
    "http://localhost:3000"
  )
  assert.equal(
    requestOrigin(headers({ host: "console.example.com" })),
    "https://console.example.com"
  )
  assert.equal(requestOrigin(headers({})), null)
})

test("safe methods are never blocked", () => {
  for (const method of ["GET", "head", "OPTIONS"]) {
    assert.deepEqual(
      verifyRequestOrigin({
        method,
        headers: headers({
          host: "console.example.com",
          origin: "https://evil.example",
          cookie: "session=abc",
        }),
      }),
      { ok: true }
    )
  }
})

test("same-origin browser POSTs pass, including behind the proxy", () => {
  assert.deepEqual(
    verifyRequestOrigin({
      method: "POST",
      headers: headers({
        host: "web:3000",
        "x-forwarded-host": "console.example.com",
        "x-forwarded-proto": "https",
        origin: "https://console.example.com",
        "sec-fetch-site": "same-origin",
        cookie: "session=abc",
      }),
    }),
    { ok: true }
  )
  assert.deepEqual(
    verifyRequestOrigin({
      method: "POST",
      headers: headers({
        host: "localhost:3000",
        origin: "http://LOCALHOST:3000",
      }),
    }),
    { ok: true }
  )
})

test("foreign origins and explicit cross-site fetches are refused", () => {
  assert.deepEqual(
    verifyRequestOrigin({
      method: "POST",
      headers: headers({
        host: "console.example.com",
        origin: "https://attacker.example",
        cookie: "session=abc",
      }),
    }),
    { ok: false, reason: "origin_mismatch" }
  )
  assert.deepEqual(
    verifyRequestOrigin({
      method: "POST",
      headers: headers({
        host: "console.example.com",
        origin: "https://console.example.com",
        "sec-fetch-site": "cross-site",
      }),
    }),
    { ok: false, reason: "cross_site_fetch" }
  )
  assert.deepEqual(
    verifyRequestOrigin({
      method: "POST",
      headers: headers({
        host: "console.example.com",
        referer: "https://attacker.example/page",
        cookie: "session=abc",
      }),
    }),
    { ok: false, reason: "referer_mismatch" }
  )
})

test("configured trusted origins are accepted alongside the request host", () => {
  assert.deepEqual(
    verifyRequestOrigin({
      method: "POST",
      headers: headers({
        host: "10.0.0.5:3000",
        origin: "https://console.example.com",
      }),
      trustedOrigins: ["https://console.example.com/"],
    }),
    { ok: true }
  )
})

test("requests without origin details pass only when they carry no cookies", () => {
  assert.deepEqual(
    verifyRequestOrigin({
      method: "POST",
      headers: headers({ host: "console.example.com" }),
    }),
    { ok: true }
  )
  assert.deepEqual(
    verifyRequestOrigin({
      method: "POST",
      headers: headers({
        host: "console.example.com",
        cookie: "session=abc",
      }),
    }),
    { ok: false, reason: "missing_origin" }
  )
})
