import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

export const API_KEY_TOKEN_PREFIX = "lhv_"
export const API_KEY_LOOKUP_PREFIX_LENGTH = 12

export type ApiKeyAccessState = "ok" | "expired" | "revoked"

export function generateApiKeySecret() {
  return `${API_KEY_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`
}

export function apiKeyLookupPrefix(secret: string) {
  return secret.slice(0, API_KEY_LOOKUP_PREFIX_LENGTH)
}

export function isApiKeySecretFormat(secret: string) {
  return (
    secret.startsWith(API_KEY_TOKEN_PREFIX) &&
    secret.length > API_KEY_LOOKUP_PREFIX_LENGTH
  )
}

export function hashApiKeySecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex")
}

export function verifyApiKeySecret(secret: string, secretHash: string) {
  const actual = Buffer.from(hashApiKeySecret(secret), "hex")
  const expected = Buffer.from(secretHash, "hex")
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function parseBearerToken(header: string | null | undefined) {
  if (!header) {
    return null
  }
  const match = header.match(/^Bearer\s+(\S+)$/i)
  return match?.[1] ?? null
}

export function apiKeyAccessState(
  record: { revokedAt: Date | null; expiresAt: Date | null },
  now = new Date()
): ApiKeyAccessState {
  if (record.revokedAt) {
    return "revoked"
  }
  if (record.expiresAt && record.expiresAt.getTime() <= now.getTime()) {
    return "expired"
  }
  return "ok"
}
