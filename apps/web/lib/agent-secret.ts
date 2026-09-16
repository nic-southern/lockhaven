import { createHash, timingSafeEqual } from "node:crypto"

/** Digest stored for agent check-in secrets and enrollment tokens. */
export function hashAgentSecret(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest("hex")
}

/**
 * Compares a presented secret against a stored digest without leaking where
 * the two first differ. Malformed digests never match.
 */
export function agentSecretMatches(
  provided: string,
  expectedHash: string | null | undefined
) {
  if (!expectedHash) return false
  const providedDigest = Buffer.from(hashAgentSecret(provided), "hex")
  let expected: Buffer
  try {
    expected = Buffer.from(expectedHash, "hex")
  } catch {
    return false
  }
  if (expected.length !== providedDigest.length) return false
  return timingSafeEqual(providedDigest, expected)
}
