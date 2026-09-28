import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

import { and, eq, isNull } from "drizzle-orm"

import {
  SESSION_MAX_AGE_SECONDS,
  recordAuthEvent,
  requestContextFromHeaders,
} from "@nms/auth"
import { fieldAuthHandoffs, session, user } from "@nms/db"
import { db } from "@nms/db/client"

/** Loopback-only redirects for the desktop field app OAuth-style handoff. */
const LOOPBACK_REDIRECT =
  /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):(\d{2,5})\/callback$/i

export const FIELD_HANDOFF_TTL_MS = 2 * 60 * 1000
export const FIELD_USER_AGENT = "lockhaven-field"

export function isAllowedFieldRedirectUri(value: string) {
  const match = LOOPBACK_REDIRECT.exec(value.trim())
  if (!match) return false
  const port = Number(match[2])
  return Number.isInteger(port) && port >= 1024 && port <= 65535
}

export function hashFieldHandoffCode(code: string) {
  return createHash("sha256").update(code).digest("hex")
}

export function generateFieldHandoffCode() {
  return randomBytes(32).toString("base64url")
}

function generateSessionToken() {
  return randomBytes(32).toString("base64url")
}

function generateSessionId() {
  return randomBytes(16).toString("hex")
}

export async function issueFieldHandoff(input: {
  userId: string
  redirectUri: string
  state: string | null
}) {
  if (!isAllowedFieldRedirectUri(input.redirectUri)) {
    throw new Error("redirect_uri_invalid")
  }

  const code = generateFieldHandoffCode()
  const expiresAt = new Date(Date.now() + FIELD_HANDOFF_TTL_MS)

  await db.insert(fieldAuthHandoffs).values({
    codeHash: hashFieldHandoffCode(code),
    userId: input.userId,
    redirectUri: input.redirectUri.trim(),
    state: input.state,
    expiresAt,
  })

  return { code, expiresAt }
}

export async function exchangeFieldHandoff(input: {
  code: string
  headers: Headers
}) {
  const code = input.code.trim()
  if (!code) {
    return { ok: false as const, error: "missing_code" as const }
  }

  const codeHash = hashFieldHandoffCode(code)
  const [handoff] = await db
    .select()
    .from(fieldAuthHandoffs)
    .where(eq(fieldAuthHandoffs.codeHash, codeHash))

  if (!handoff) {
    return { ok: false as const, error: "invalid_code" as const }
  }

  if (handoff.consumedAt) {
    return { ok: false as const, error: "code_used" as const }
  }

  if (handoff.expiresAt.getTime() <= Date.now()) {
    return { ok: false as const, error: "code_expired" as const }
  }

  const expected = Buffer.from(handoff.codeHash, "hex")
  const actual = Buffer.from(codeHash, "hex")
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false as const, error: "invalid_code" as const }
  }

  const [account] = await db
    .select()
    .from(user)
    .where(eq(user.id, handoff.userId))

  if (!account || account.status !== "active" || account.disabledAt) {
    return { ok: false as const, error: "user_inactive" as const }
  }

  const now = new Date()
  const token = generateSessionToken()
  const sessionId = generateSessionId()
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000)
  const request = requestContextFromHeaders(input.headers)

  await db.insert(session).values({
    id: sessionId,
    userId: account.id,
    token,
    expiresAt,
    ipAddress: request.ipAddress,
    userAgent: FIELD_USER_AGENT,
    createdAt: now,
    updatedAt: now,
  })

  await db
    .update(fieldAuthHandoffs)
    .set({ consumedAt: now })
    .where(
      and(
        eq(fieldAuthHandoffs.id, handoff.id),
        isNull(fieldAuthHandoffs.consumedAt)
      )
    )

  await recordAuthEvent({
    eventType: "field_session_issued",
    actorUserId: account.id,
    eventData: {
      sessionId,
      handoffId: handoff.id,
      client: "field",
    },
    request,
  })

  return {
    ok: true as const,
    token,
    expiresAt,
    sessionId,
    user: {
      id: account.id,
      email: account.email,
      name: account.name,
    },
  }
}

export async function revokeFieldSession(input: {
  token: string
  headers: Headers
}) {
  const [row] = await db
    .select()
    .from(session)
    .where(eq(session.token, input.token))

  if (!row) {
    return { ok: false as const, error: "not_found" as const }
  }

  await db.delete(session).where(eq(session.id, row.id))

  await recordAuthEvent({
    eventType: "field_session_revoked",
    actorUserId: row.userId,
    eventData: {
      sessionId: row.id,
      client: "field",
    },
    request: requestContextFromHeaders(input.headers),
  })

  return { ok: true as const }
}

export async function lookupSessionByToken(token: string) {
  const [row] = await db.select().from(session).where(eq(session.token, token))

  if (!row) return null
  if (row.expiresAt.getTime() <= Date.now()) return null
  return row
}
