import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  type KeyObject,
} from "node:crypto"

import { Pool } from "pg"
import { z } from "zod"

import type { ServiceType } from "@nms/shared"

export type RemoteAccessSessionRequest = {
  deviceId: string
  serviceId: string
  serviceType: ServiceType
  adminUserId: string
  connectionMethod: "guacamole" | "custom-novnc" | "native"
  hostname: string
  port: number
  password?: string | null
  username?: string | null
  privateKey?: string | null
  launchId?: string
}

export type RemoteAccessSession = {
  sessionId: string
  url: string
}

export type RemoteAccessSessionActivity = {
  sessionId: string
  /** First time a client connected, if ever. */
  connectedAt: Date | null
  /** Last disconnect; `null` while a client is still attached. */
  disconnectedAt: Date | null
  /** True when the gateway still shows an open connection. */
  active: boolean
}

export interface RemoteAccessProvider {
  createSession(
    request: RemoteAccessSessionRequest
  ): Promise<RemoteAccessSession>
  closeSession(sessionId: string): Promise<void>
  /**
   * Looks up connection history for the given session ids so the control
   * plane can close its own session records once the client disconnects.
   */
  getSessionActivity(
    sessionIds: string[]
  ): Promise<Map<string, RemoteAccessSessionActivity>>
}

export const guacamoleConfigSchema = z.object({
  baseUrl: z.string().url(),
  databaseUrl: z.string().min(1),
  apiUrl: z.string().url().optional(),
  adminUser: z.string().min(1).optional(),
})

export type EncryptedSecret = {
  ciphertext: string
  iv: string
  authTag: string
}

const AES_256_GCM_AUTH_TAG_LENGTH = 16
const GUACAMOLE_DRIVE_ROOT = "/drive"
const GUACAMOLE_DRIVE_NAME = "Lockhaven"

export function deriveSecretKey(secret: string) {
  return createHash("sha256").update(secret).digest()
}

export function encryptSecret(
  plaintext: string,
  secret: string
): EncryptedSecret {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", deriveSecretKey(secret), iv)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ])

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  }
}

export function decryptSecret(payload: EncryptedSecret, secret: string) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveSecretKey(secret),
    Buffer.from(payload.iv, "base64"),
    { authTagLength: AES_256_GCM_AUTH_TAG_LENGTH }
  )

  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"))

  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8")
}

function writeSshString(value: Buffer | string) {
  const payload = typeof value === "string" ? Buffer.from(value) : value
  const length = Buffer.alloc(4)
  length.writeUInt32BE(payload.length)
  return Buffer.concat([length, payload])
}

export function exportOpenSshEd25519PublicKey(
  publicKey: KeyObject,
  comment = "lockhaven"
) {
  const der = publicKey.export({ type: "spki", format: "der" })
  const keyBytes = der.subarray(der.length - 32)
  const body = Buffer.concat([
    writeSshString("ssh-ed25519"),
    writeSshString(keyBytes),
  ])

  return `ssh-ed25519 ${body.toString("base64")} ${comment}`
}

export function deriveOpenSshPublicKeyFromPrivateKey(
  privateKeyPem: string,
  comment = "lockhaven"
) {
  const privateKey = createPrivateKey(privateKeyPem)
  const publicKey = createPublicKey(privateKey)

  if (publicKey.asymmetricKeyType !== "ed25519") {
    // Fall back to SPKI PEM for non-ed25519 keys so Guacamole hosts can still
    // be documented; OpenSSH one-liner is preferred for ed25519.
    return publicKey.export({ type: "spki", format: "pem" }).toString()
  }

  return exportOpenSshEd25519PublicKey(publicKey, comment)
}

export function generateSiteSshKeyPair(comment = "lockhaven") {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")

  return {
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey: exportOpenSshEd25519PublicKey(publicKey, comment),
  }
}

export function encodeGuacamoleConnectionReference(connectionId: number) {
  return Buffer.from(`${connectionId}\0c\0postgresql`, "utf8").toString(
    "base64"
  )
}

export function buildGuacamoleClientUrl(baseUrl: string, connectionId: number) {
  return new URL(
    `#/client/${encodeGuacamoleConnectionReference(connectionId)}`,
    baseUrl
  ).toString()
}

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`
}

function normalizeHost(hostname: string) {
  return hostname.trim().split("/")[0]
}

/** Build a native app deep link for direct overlay access (e.g. macOS Screen Sharing). */
export function buildNativeAppUrl(args: {
  serviceType: ServiceType
  hostname: string
  port: number
  password?: string | null
  username?: string | null
}) {
  const host = normalizeHost(args.hostname)

  if (args.serviceType === "vnc") {
    if (!args.password) {
      throw new Error("VNC password is required for native launch")
    }

    // macOS Screen Sharing treats host:N as display N (TCP 5900+N), not a raw
    // TCP port. It also does not reliably accept VNC passwords in the URL — the
    // caller should copy the password and let Screen Sharing prompt.
    if (args.port === 5900) {
      return `vnc://${host}`
    }

    if (args.port > 5900 && args.port < 6000) {
      return `vnc://${host}:${args.port - 5900}`
    }

    return `vnc://${host}:${args.port}`
  }

  if (args.serviceType === "ssh") {
    const user = args.username?.trim()
    if (!user) {
      throw new Error("SSH username is required for native launch")
    }

    const portSuffix = args.port === 22 ? "" : `:${args.port}`
    return `ssh://${encodeURIComponent(user)}@${host}${portSuffix}`
  }

  throw new Error(`Native launch is not supported for ${args.serviceType}`)
}

function buildGuacamoleDrivePath(connectionName: string) {
  return `${GUACAMOLE_DRIVE_ROOT}/${connectionName}`
}

type UpsertConnectionInput = {
  connectionName: string
  protocol: ServiceType
  hostname: string
  port: number
  password?: string | null
  username?: string | null
  privateKey?: string | null
  recordingRoot?: string | null
  recordingName?: string | null
}

class GuacamoleConnectionStore {
  constructor(private readonly pool: Pool) {}

  async upsertConnection(input: UpsertConnectionInput) {
    const client = await this.pool.connect()

    try {
      await client.query("BEGIN")

      const existing = await client.query<{ connection_id: number }>(
        `
          SELECT connection_id
          FROM guacamole_connection
          WHERE connection_name = $1 AND parent_id IS NULL
          LIMIT 1
        `,
        [input.connectionName]
      )

      let connectionId = existing.rows[0]?.connection_id

      if (!connectionId) {
        const inserted = await client.query<{ connection_id: number }>(
          `
            INSERT INTO guacamole_connection (connection_name, protocol, parent_id)
            VALUES ($1, $2, NULL)
            RETURNING connection_id
          `,
          [input.connectionName, input.protocol]
        )

        connectionId = inserted.rows[0]?.connection_id
      } else {
        await client.query(
          `
            UPDATE guacamole_connection
            SET protocol = $2
            WHERE connection_id = $1
          `,
          [connectionId, input.protocol]
        )
      }

      if (!connectionId) {
        throw new Error("Failed to create Guacamole connection")
      }

      await client.query(
        "DELETE FROM guacamole_connection_parameter WHERE connection_id = $1",
        [connectionId]
      )

      await client.query(
        `
          INSERT INTO guacamole_connection_parameter (connection_id, parameter_name, parameter_value)
          VALUES
            ($1, 'hostname', $2),
            ($1, 'port', $3)
        `,
        [connectionId, input.hostname, String(input.port)]
      )

      if (input.protocol === "vnc") {
        await client.query(
          `
            INSERT INTO guacamole_connection_parameter (connection_id, parameter_name, parameter_value)
            VALUES
            ($1, 'color-depth', '24'),
            ($1, 'disable-display-resize', 'true'),
            ($1, 'cursor', 'remote'),
            ($1, 'encodings', 'tight zrle hextile raw')
          `,
          [connectionId]
        )
      }

      if (input.password && input.password.length > 0) {
        await client.query(
          `
            INSERT INTO guacamole_connection_parameter (connection_id, parameter_name, parameter_value)
            VALUES ($1, 'password', $2)
          `,
          [connectionId, input.password]
        )
      }

      if (
        input.protocol === "ssh" &&
        input.username &&
        input.username.length > 0
      ) {
        await client.query(
          `
            INSERT INTO guacamole_connection_parameter (connection_id, parameter_name, parameter_value)
            VALUES ($1, 'username', $2)
          `,
          [connectionId, input.username]
        )
      }

      if (
        input.protocol === "ssh" &&
        input.privateKey &&
        input.privateKey.length > 0
      ) {
        await client.query(
          `
            INSERT INTO guacamole_connection_parameter (connection_id, parameter_name, parameter_value)
            VALUES ($1, 'private-key', $2)
          `,
          [connectionId, input.privateKey]
        )
      }

      if (input.protocol === "ssh") {
        await client.query(
          `
            INSERT INTO guacamole_connection_parameter (connection_id, parameter_name, parameter_value)
            VALUES
              ($1, 'server-alive-interval', '60'),
              ($1, 'enable-sftp', 'true')
          `,
          [connectionId]
        )
      }

      if (input.protocol === "rdp") {
        await client.query(
          `
            INSERT INTO guacamole_connection_parameter (connection_id, parameter_name, parameter_value)
            VALUES
              ($1, 'enable-drive', 'true'),
              ($1, 'drive-name', $2),
              ($1, 'drive-path', $3),
              ($1, 'create-drive-path', 'true')
          `,
          [
            connectionId,
            GUACAMOLE_DRIVE_NAME,
            buildGuacamoleDrivePath(input.connectionName),
          ]
        )
      }

      const recordingRoot = input.recordingRoot?.trim()
      if (recordingRoot) {
        const recordingName =
          input.recordingName?.trim() || input.connectionName
        await client.query(
          // pragma: allowlist secret
          `
            INSERT INTO guacamole_connection_parameter (connection_id, parameter_name, parameter_value) -- pragma: allowlist secret
            VALUES
              ($1, 'recording-path', $2),
              ($1, 'recording-name', $3),
              ($1, 'create-recording-path', 'true')
          `,
          [connectionId, recordingRoot, recordingName]
        )
      }

      await client.query("COMMIT")

      return connectionId
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }

  async connectionActivity(connectionNames: string[]) {
    const activity = new Map<string, RemoteAccessSessionActivity>()
    if (connectionNames.length === 0) {
      return activity
    }

    const result = await this.pool.query<{
      connection_name: string
      first_start: Date | null
      last_end: Date | null
      open_count: string
    }>(
      `
        SELECT
          c.connection_name,
          MIN(h.start_date) AS first_start,
          MAX(h.end_date) AS last_end,
          COUNT(*) FILTER (WHERE h.end_date IS NULL) AS open_count
        FROM [REDACTED]_connection c
        LEFT JOIN [REDACTED]_connection_history h ON h.connection_id = c.connection_id
        WHERE c.connection_name = ANY($1::text[])
        GROUP BY c.connection_name
      `,
      [connectionNames]
    )

    for (const row of result.rows) {
      const active = Number(row.open_count) > 0
      activity.set(row.connection_name, {
        sessionId: row.connection_name,
        connectedAt: row.first_start,
        disconnectedAt: active ? null : row.last_end,
        active,
      })
    }

    return activity
  }

  async connectionIdByName(connectionName: string) {
    const result = await this.pool.query<{ connection_id: number }>(
      `
        SELECT connection_id
        FROM guacamole_connection
        WHERE connection_name = $1
        LIMIT 1
      `,
      [connectionName]
    )
    return result.rows[0]?.connection_id ?? null
  }

  async connectionHistory(connectionName: string) {
    const result = await this.pool.query<{
      history_id: number
      start_date: Date | null
      end_date: Date | null
    }>(
      `
        SELECT
          h.history_id,
          h.start_date,
          h.end_date
        FROM guacamole_connection_history h -- pragma: allowlist secret
        JOIN guacamole_connection c ON c.connection_id = h.connection_id -- pragma: allowlist secret
        WHERE c.connection_name = $1
        ORDER BY h.start_date DESC
        LIMIT 1
      `,
      [connectionName]
    )
    const row = result.rows[0]
    if (!row) return null
    return {
      historyId: String(row.history_id),
      startedAt: row.start_date,
      endedAt: row.end_date,
    }
  }
}

export class GuacamoleRemoteAccessProvider implements RemoteAccessProvider {
  private readonly store: GuacamoleConnectionStore

  constructor(
    private readonly config: z.infer<typeof guacamoleConfigSchema>,
    pool?: Pool,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)
  ) {
    this.store = new GuacamoleConnectionStore(
      pool ?? new Pool({ connectionString: config.databaseUrl })
    )
  }

  async createSession(
    request: RemoteAccessSessionRequest
  ): Promise<RemoteAccessSession> {
    if (request.connectionMethod !== "guacamole") {
      throw new Error("Unsupported remote access provider")
    }

    if (
      request.serviceType !== "vnc" &&
      request.serviceType !== "rdp" &&
      request.serviceType !== "ssh"
    ) {
      throw new Error(
        "Guacamole launch is only supported for VNC, RDP, and SSH services"
      )
    }

    const launchId = request.launchId ?? randomUUID()
    const connectionName = `nms-${request.deviceId}-${request.serviceId}-${launchId}`
    const recordingRoot = sessionRecordingRootFromEnv() // pragma: allowlist secret
    const connectionId = await this.store.upsertConnection({
      connectionName,
      protocol: request.serviceType,
      hostname: request.hostname,
      port: request.port,
      password: request.password,
      username: request.username,
      privateKey: request.privateKey,
      recordingRoot,
      recordingName: connectionName,
    })

    return {
      sessionId: connectionName,
      url: buildGuacamoleClientUrl(this.config.baseUrl, connectionId),
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const connectionId = await this.store.connectionIdByName(sessionId)
    if (connectionId == null) {
      return
    }

    const apiBase = this.config.apiUrl ?? this.config.baseUrl
    const adminUser = this.config.adminUser ?? "guacadmin"
    const tokensUrl = new URL("api/tokens", ensureTrailingSlash(apiBase))

    const tokenResponse = await this.fetchImpl(tokensUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Authenticated-User": adminUser,
      },
      body: new URLSearchParams({ username: adminUser }),
    })

    if (!tokenResponse.ok) {
      throw new Error("Could not open a session-gateway admin session")
    }

    const tokenPayload = (await tokenResponse.json()) as {
      authToken?: string
      dataSource?: string
    }
    const authToken = tokenPayload.authToken
    const dataSource = tokenPayload.dataSource ?? "postgresql"

    if (!authToken) {
      throw new Error("Session gateway did not return an admin token")
    }

    const activeUrl = new URL(
      `api/session/data/${encodeURIComponent(dataSource)}/activeConnections`,
      ensureTrailingSlash(apiBase)
    )
    activeUrl.searchParams.set("token", authToken)

    try {
      const activeResponse = await this.fetchImpl(activeUrl)
      if (!activeResponse.ok) {
        throw new Error("Could not list active remote sessions")
      }

      const active = (await activeResponse.json()) as Record<
        string,
        { identifier?: string; connectionIdentifier?: string }
      >

      for (const [identifier, entry] of Object.entries(active ?? {})) {
        if (String(entry.connectionIdentifier) !== String(connectionId)) {
          continue
        }
        const killUrl = new URL(
          `api/session/data/${encodeURIComponent(dataSource)}/activeConnections/${encodeURIComponent(identifier)}`,
          ensureTrailingSlash(apiBase)
        )
        killUrl.searchParams.set("token", authToken)
        const killed = await this.fetchImpl(killUrl, { method: "DELETE" })
        if (!killed.ok && killed.status !== 404) {
          throw new Error("Could not end the remote session")
        }
      }
    } finally {
      const logoutUrl = new URL(
        `api/tokens/${encodeURIComponent(authToken)}`,
        ensureTrailingSlash(apiBase)
      )
      await this.fetchImpl(logoutUrl, { method: "DELETE" }).catch(
        () => undefined
      )
    }
  }

  async getSessionActivity(sessionIds: string[]) {
    return this.store.connectionActivity(sessionIds)
  }

  async getSessionHistory(connectionName: string) {
    return this.store.connectionHistory(connectionName)
  }
}

function sessionRecordingRootFromEnv() {
  // pragma: allowlist secret
  const value = process.env.SESSION_RECORDING_ROOT?.trim()
  if (value === "") return null
  return value ?? "/var/lib/guacamole/recordings" // pragma: allowlist secret
}
