import assert from "node:assert/strict"
import test from "node:test"

import type { Pool } from "pg"

import {
  buildGuacamoleClientUrl,
  decryptSecret,
  encryptSecret,
  GuacamoleRemoteAccessProvider,
} from "./index"

test("encrypts and decrypts saved credentials", () => {
  const secret = "test-credential-key-".repeat(2)
  const encrypted = encryptSecret("hunter2", secret)

  assert.equal(decryptSecret(encrypted, secret), "hunter2")
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
