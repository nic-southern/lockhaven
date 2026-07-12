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

export interface RemoteAccessProvider {
  createSession(
    request: RemoteAccessSessionRequest
  ): Promise<RemoteAccessSession>
  closeSession(sessionId: string): Promise<void>
}

export const guacamoleConfigSchema = z.object({
  baseUrl: z.string().url(),
  databaseUrl: z.string().min(1),
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

    const userinfo = `:${encodeURIComponent(args.password)}`
    const portSuffix = args.port === 5900 ? "" : `:${args.port}`
    return `vnc://${userinfo}@${host}${portSuffix}`
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

      await client.query("COMMIT")

      return connectionId
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }
}

export class GuacamoleRemoteAccessProvider implements RemoteAccessProvider {
  private readonly store: GuacamoleConnectionStore

  constructor(
    private readonly config: z.infer<typeof guacamoleConfigSchema>,
    pool?: Pool
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
    const connectionId = await this.store.upsertConnection({
      connectionName,
      protocol: request.serviceType,
      hostname: request.hostname,
      port: request.port,
      password: request.password,
      username: request.username,
      privateKey: request.privateKey,
    })

    return {
      sessionId: connectionName,
      url: buildGuacamoleClientUrl(this.config.baseUrl, connectionId),
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    void sessionId
  }
}
