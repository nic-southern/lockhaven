import assert from "node:assert/strict"
import test from "node:test"

import type { Pool } from "pg"

import {
  buildGuacamoleClientUrl,
  buildNativeAppUrl,
  decryptSecret,
  deriveOpenSshPublicKeyFromPrivateKey,
  encryptSecret,
  generateSiteSshKeyPair,
  GuacamoleRemoteAccessProvider,
} from "./index"

test("encrypts and decrypts saved credentials", () => {
  const secret = "test-credential-key-".repeat(2)
  const encrypted = encryptSecret("hunter2", secret)

  assert.equal(decryptSecret(encrypted, secret), "hunter2")
})

test("builds native VNC app urls without embedding passwords", () => {
  assert.equal(
    buildNativeAppUrl({
      serviceType: "vnc",
      hostname: "10.80.30.12/32",
      port: 5900,
      password: "9tt0dWHRjfEt0nM",
    }),
    "vnc://10.80.30.12"
  )

  assert.equal(
    buildNativeAppUrl({
      serviceType: "vnc",
      hostname: "10.80.30.12",
      port: 5901,
      password: "p@ss:word",
    }),
    "vnc://10.80.30.12:1"
  )
})

test("builds native SSH app urls", () => {
  assert.equal(
    buildNativeAppUrl({
      serviceType: "ssh",
      hostname: "10.80.20.11",
      port: 22,
      username: "admin",
    }),
    "ssh://admin@10.80.20.11"
  )
})

test("generates an ed25519 site SSH keypair", () => {
  const pair = generateSiteSshKeyPair("site-test")
  assert.match(pair.privateKey, /BEGIN PRIVATE KEY/)
  assert.match(pair.publicKey, /^ssh-ed25519 /)
  assert.match(pair.publicKey, /site-test$/)
  assert.equal(
    deriveOpenSshPublicKeyFromPrivateKey(pair.privateKey, "site-test"),
    pair.publicKey
  )
})

test("builds the direct Guacamole client url", () => {
  const url = buildGuacamoleClientUrl("https://guac.example.com/guacamole/", 42)

  assert.equal(
    url,
    `https://guac.example.com/guacamole/#/client/${Buffer.from("42\u0000c\u0000postgresql").toString("base64")}`
  )
})

test("provisions a VNC connection without a password when none is saved", async () => {
  const queries: Array<{ text: string; values?: unknown[] }> = []

  const client = {
    query: async (text: string, values?: unknown[]) => {
      queries.push({ text, values })

      if (text.includes("SELECT connection_id")) {
        return { rows: [] }
      }

      if (text.includes("RETURNING connection_id")) {
        return { rows: [{ connection_id: 42 }] }
      }

      return { rows: [] }
    },
    release: () => undefined,
  }

  const pool = {
    connect: async () => client,
  } as unknown as Pool

  const provider = new GuacamoleRemoteAccessProvider(
    {
      baseUrl: "https://guac.example.com/guacamole/",
      databaseUrl:
        "postgresql://guacamole:guacamole@guacamole-db:5432/guacamole_db",
    },
    pool
  )

  const session = await provider.createSession({
    deviceId: "device-1",
    serviceId: "service-1",
    serviceType: "vnc",
    adminUserId: "admin-1",
    connectionMethod: "guacamole",
    hostname: "10.80.0.10",
    port: 5900,
    launchId: "launch-1",
  })

  assert.equal(session.sessionId, "nms-device-1-service-1-launch-1")
  assert.match(
    session.url,
    /^https:\/\/guac\.example\.com\/guacamole\/#\/client\//
  )
  assert.ok(!queries.some((entry) => String(entry.text).includes("'password'")))
  assert.ok(
    queries.some((entry) => String(entry.text).includes("recording-path"))
  )
  assert.ok(
    queries.some(
      (entry) =>
        Array.isArray(entry.values) &&
        entry.values.includes("nms-device-1-service-1-launch-1")
    )
  )
})

test("provisions an SSH connection with username and private key", async () => {
  const queries: Array<{ text: string; values?: unknown[] }> = []

  const client = {
    query: async (text: string, values?: unknown[]) => {
      queries.push({ text, values })

      if (text.includes("SELECT connection_id")) {
        return { rows: [] }
      }

      if (text.includes("RETURNING connection_id")) {
        return { rows: [{ connection_id: 43 }] }
      }

      return { rows: [] }
    },
    release: () => undefined,
  }

  const pool = {
    connect: async () => client,
  } as unknown as Pool

  const provider = new GuacamoleRemoteAccessProvider(
    {
      baseUrl: "https://guac.example.com/guacamole/",
      databaseUrl:
        "postgresql://guacamole:guacamole@guacamole-db:5432/guacamole_db",
    },
    pool
  )
  const privateKeyLabel = "OPENSSH PRIVATE KEY"
  const fakePrivateKey = [
    `-----BEGIN ${privateKeyLabel}-----`,
    "key",
    `-----END ${privateKeyLabel}-----`,
  ].join("\n")

  const session = await provider.createSession({
    deviceId: "device-1",
    serviceId: "service-2",
    serviceType: "ssh",
    adminUserId: "admin-1",
    connectionMethod: "guacamole",
    hostname: "10.80.0.20",
    port: 22,
    username: "ubuntu",
    privateKey: fakePrivateKey,
    launchId: "launch-2",
  })

  assert.equal(session.sessionId, "nms-device-1-service-2-launch-2")
  assert.match(
    session.url,
    /^https:\/\/guac\.example\.com\/guacamole\/#\/client\//
  )
  assert.ok(queries.some((entry) => entry.values?.includes("ssh")))
  assert.ok(queries.some((entry) => entry.values?.includes("ubuntu")))
  assert.ok(queries.some((entry) => entry.values?.includes(fakePrivateKey)))
  assert.ok(
    queries.some((entry) =>
      String(entry.text).includes("'server-alive-interval', '60'")
    )
  )
  assert.ok(
    queries.some((entry) =>
      String(entry.text).includes("'enable-sftp', 'true'")
    )
  )
})

test("provisions an RDP connection through Guacamole", async () => {
  const queries: Array<{ text: string; values?: unknown[] }> = []

  const client = {
    query: async (text: string, values?: unknown[]) => {
      queries.push({ text, values })

      if (text.includes("SELECT connection_id")) {
        return { rows: [] }
      }

      if (text.includes("RETURNING connection_id")) {
        return { rows: [{ connection_id: 44 }] }
      }

      return { rows: [] }
    },
    release: () => undefined,
  }

  const pool = {
    connect: async () => client,
  } as unknown as Pool

  const provider = new GuacamoleRemoteAccessProvider(
    {
      baseUrl: "https://guac.example.com/guacamole/",
      databaseUrl:
        "postgresql://guacamole:guacamole@guacamole-db:5432/guacamole_db",
    },
    pool
  )

  const session = await provider.createSession({
    deviceId: "device-1",
    serviceId: "service-3",
    serviceType: "rdp",
    adminUserId: "admin-1",
    connectionMethod: "guacamole",
    hostname: "10.80.0.30",
    port: 3389,
    launchId: "launch-3",
  })

  assert.equal(session.sessionId, "nms-device-1-service-3-launch-3")
  assert.match(
    session.url,
    /^https:\/\/guac\.example\.com\/guacamole\/#\/client\//
  )
  assert.ok(queries.some((entry) => entry.values?.includes("rdp")))
  assert.ok(
    queries.some((entry) =>
      String(entry.text).includes("'enable-drive', 'true'")
    )
  )
  assert.ok(
    queries.some((entry) =>
      String(entry.text).includes("'create-drive-path', 'true'")
    )
  )
  assert.ok(
    queries.some((entry) =>
      entry.values?.includes("/drive/nms-device-1-service-3-launch-3")
    )
  )
})

test("closes an active Guacamole session through the admin API", async () => {
  const calls: Array<{
    url: string
    method: string
    authenticatedUser: string | null
  }> = []

  const pool = {
    query: async (text: string) => {
      if (String(text).includes("SELECT connection_id")) {
        return { rows: [{ connection_id: 42 }] }
      }
      return { rows: [] }
    },
    connect: async () => {
      throw new Error("connect should not be used")
    },
  } as unknown as Pool

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input)
    const method = (init?.method ?? "GET").toUpperCase()
    const headers = new Headers(init?.headers)
    calls.push({
      url,
      method,
      authenticatedUser: headers.get("X-Authenticated-User"),
    })

    if (url.includes("/api/tokens") && method === "POST") {
      return new Response(
        JSON.stringify({ authToken: "token-1", dataSource: "postgresql" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    }
    if (url.includes("/activeConnections") && method === "GET") {
      return new Response(
        JSON.stringify({
          "hist-9": { identifier: "hist-9", connectionIdentifier: "42" },
          "hist-8": { identifier: "hist-8", connectionIdentifier: "7" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    }
    return new Response(null, { status: 204 })
  }

  const provider = new GuacamoleRemoteAccessProvider(
    {
      baseUrl: "https://guac.example.com/guacamole/",
      databaseUrl:
        "postgresql://guacamole:replace_me@guacamole-db:5432/guacamole_db",
      apiUrl: "http://guacamole.internal/guacamole/",
      adminUser: "guacadmin",
    },
    pool,
    fetchImpl
  )

  await provider.closeSession("nms-device-1-service-1-launch-1")

  assert.equal(
    calls.some(
      (call) =>
        call.method === "DELETE" &&
        call.url.includes("activeConnections/hist-9")
    ),
    true
  )
  assert.equal(
    calls.some(
      (call) =>
        call.method === "DELETE" &&
        call.url.includes("activeConnections/hist-8")
    ),
    false
  )
  assert.equal(
    calls.some(
      (call) => call.method === "DELETE" && call.url.includes("/api/tokens/")
    ),
    true
  )
  assert.equal(
    calls.some(
      (call) => call.url.includes("token-1") && call.url.includes("hist-9")
    ),
    true
  )
  assert.equal(
    calls.find((call) => call.method === "POST")?.authenticatedUser,
    "guacadmin"
  )
})

test("looks up session history by connection name", async () => {
  // pragma: allowlist secret
  const pool = {
    query: async (text: string, values?: unknown[]) => {
      assert.match(String(text), /connection_history/)
      assert.deepEqual(values, ["nms-device-1-service-1-launch-1"])
      return {
        rows: [
          {
            history_id: 99,
            start_date: new Date("2026-09-16T12:00:00.000Z"),
            end_date: new Date("2026-09-16T12:08:00.000Z"),
          },
        ],
      }
    },
    connect: async () => {
      throw new Error("connect should not be used")
    },
  } as unknown as Pool

  const provider = new GuacamoleRemoteAccessProvider( // pragma: allowlist secret
    {
      baseUrl: "https://guac.example.com/[REDACTED]/",
      databaseUrl:
        "postgresql://[REDACTED]:replace_me@[REDACTED]-db:5432/[REDACTED]_db",
    },
    pool
  )

  const history = await provider.getSessionHistory(
    "nms-device-1-service-1-launch-1"
  )
  assert.deepEqual(history, {
    historyId: "99",
    startedAt: new Date("2026-09-16T12:00:00.000Z"),
    endedAt: new Date("2026-09-16T12:08:00.000Z"),
  })
})

test("omits recording parameters when SESSION_RECORDING_ROOT is empty", async () => {
  const previous = process.env.SESSION_RECORDING_ROOT
  process.env.SESSION_RECORDING_ROOT = ""
  const queries: Array<{ text: string }> = []
  const client = {
    query: async (text: string) => {
      queries.push({ text })
      if (text.includes("SELECT connection_id")) return { rows: [] }
      if (text.includes("RETURNING connection_id")) {
        return { rows: [{ connection_id: 45 }] }
      }
      return { rows: [] }
    },
    release: () => undefined,
  }
  const pool = { connect: async () => client } as unknown as Pool
  const provider = new GuacamoleRemoteAccessProvider( // pragma: allowlist secret
    {
      baseUrl: "https://guac.example.com/[REDACTED]/",
      databaseUrl:
        "postgresql://[REDACTED]:replace_me@[REDACTED]-db:5432/[REDACTED]_db",
    },
    pool
  )

  try {
    await provider.createSession({
      deviceId: "device-1",
      serviceId: "service-1",
      serviceType: "vnc",
      adminUserId: "admin-1",
      connectionMethod: "guacamole", // pragma: allowlist secret
      hostname: "10.80.0.40",
      port: 5900,
      launchId: "launch-off",
    })
    assert.equal(
      queries.some((entry) => String(entry.text).includes("recording-path")),
      false
    )
  } finally {
    if (previous === undefined) delete process.env.SESSION_RECORDING_ROOT
    else process.env.SESSION_RECORDING_ROOT = previous
  }
})

test("closeSession is a no-op when the gateway has no matching connection", async () => {
  const calls: Array<{ url: string }> = []
  const pool = {
    query: async () => ({ rows: [] }),
    connect: async () => {
      throw new Error("connect should not be used")
    },
  } as unknown as Pool

  const provider = new GuacamoleRemoteAccessProvider( // pragma: allowlist secret
    {
      baseUrl: "https://guac.example.com/guacamole/",
      databaseUrl:
        "postgresql://guacamole:replace_me@guacamole-db:5432/guacamole_db",
    },
    pool,
    async (input) => {
      calls.push({ url: String(input) })
      return new Response(null, { status: 500 })
    }
  )

  await provider.closeSession("missing-session")
  assert.equal(calls.length, 0)
})
