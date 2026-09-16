import { createHmac, timingSafeEqual } from "node:crypto"

export const WEBHOOK_SIGNATURE_HEADER = "X-Lockhaven-Signature"
export const WEBHOOK_TIMESTAMP_HEADER = "X-Lockhaven-Timestamp"

export const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60

export function signWebhookPayload(
  secret: string,
  timestamp: string,
  body: string
) {
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex")
  return `sha256=${digest}`
}

export function webhookHeaders(secret: string, body: string, now = new Date()) {
  const timestamp = String(Math.floor(now.getTime() / 1000))
  return {
    timestamp,
    signature: signWebhookPayload(secret, timestamp, body),
    headers: {
      [WEBHOOK_TIMESTAMP_HEADER]: timestamp,
      [WEBHOOK_SIGNATURE_HEADER]: signWebhookPayload(secret, timestamp, body),
      "Content-Type": "application/json",
    } as Record<string, string>,
  }
}

function equalHex(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length !== b.length) {
    return false
  }
  return timingSafeEqual(a, b)
}

export function parseWebhookSignature(header: string | null | undefined) {
  if (!header) return null
  const match = /^sha256=([0-9a-f]+)$/i.exec(header.trim())
  return match ? match[1].toLowerCase() : null
}

export function verifyWebhookSignature(input: {
  secret: string
  timestamp: string
  body: string
  signature: string
  now?: Date
  toleranceSeconds?: number
}) {
  const expected = signWebhookPayload(input.secret, input.timestamp, input.body)
  const provided = input.signature.trim().startsWith("sha256=")
    ? input.signature.trim()
    : `sha256=${input.signature.trim()}`
  if (!equalHex(expected, provided)) {
    return false
  }

  const timestampSeconds = Number(input.timestamp)
  if (!Number.isFinite(timestampSeconds)) {
    return false
  }
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000)
  const age = Math.abs(nowSeconds - timestampSeconds)
  const tolerance =
    input.toleranceSeconds ?? WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS
  return age <= tolerance
}
