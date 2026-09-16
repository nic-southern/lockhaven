import { drizzleAdapter } from "@better-auth/drizzle-adapter"
import { passkey } from "@better-auth/passkey"
import { betterAuth } from "better-auth"
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api"
import { haveIBeenPwned, twoFactor } from "better-auth/plugins"
import { eq } from "drizzle-orm"
// Referenced so declaration emit can name passkey option types.
import type {} from "@simplewebauthn/server"

import { MIN_PASSWORD_LENGTH } from "@nms/shared"
import { db } from "@nms/db/client"
import * as schema from "@nms/db/schema"
import {
  getProductName as mailProductName,
  renderPasswordResetEmail,
  sendTransactionalMail,
} from "@nms/notifications"

import { recordAuthEvent, requestContextFromHeaders } from "./audit"
import { hashPassword, verifyPassword } from "./password"
export * from "./access"
export * from "./audit"
export { hashPassword, verifyPassword } from "./password"

export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60
export const SESSION_REFRESH_AGE_SECONDS = 60 * 60

/** Auth endpoints that can complete a sign-in and issue a session. */
const LOGIN_COMPLETION_PATHS = new Set([
  "/sign-in/email",
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
  "/passkey/verify-authentication",
])

const LOGIN_METHOD_BY_PATH: Record<string, string> = {
  "/sign-in/email": "password",
  "/two-factor/verify-totp": "password+totp",
  "/two-factor/verify-backup-code": "password+backup_code",
  "/passkey/verify-authentication": "passkey",
}

type AuthHookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]

/** True when the request carried the two-factor challenge cookie. */
function hasTwoFactorChallenge(ctx: AuthHookContext) {
  const cookie = ctx.context.createAuthCookie("two_factor")
  return Boolean(ctx.getCookie(cookie.name))
}

function isLocalhostHost(hostname: string) {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  )
}

function getAuthBaseUrl() {
  return (
    process.env.BETTER_AUTH_URL ??
    process.env.NEXTAUTH_URL ??
    process.env.APP_BASE_URL ??
    "http://localhost:3000"
  )
}

function getAuthBaseHostname() {
  try {
    return new URL(getAuthBaseUrl()).hostname
  } catch {
    return "localhost"
  }
}

function getAuthBaseOrigin() {
  try {
    return new URL(getAuthBaseUrl()).origin
  } catch {
    return "http://localhost:3000"
  }
}

function getCrossSubdomainCookieDomain() {
  const overrideDomain = process.env.AUTH_COOKIE_DOMAIN

  if (overrideDomain) {
    return isLocalhostHost(overrideDomain) ? undefined : overrideDomain
  }

  const rootDomain = process.env.ROOT_DOMAIN

  if (!rootDomain || isLocalhostHost(getAuthBaseHostname())) {
    return undefined
  }

  return rootDomain
}

function getPasskeyOrigins() {
  const extra = (process.env.PASSKEY_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)

  return [getAuthBaseOrigin(), ...extra]
}

const productName =
  process.env.PRODUCT_NAME ?? process.env.APP_NAME ?? "Lockhaven"

function isProduction() {
  return process.env.NODE_ENV === "production"
}

function bodyEmail(body: unknown): string | null {
  if (body && typeof body === "object" && "email" in body) {
    const value = (body as { email?: unknown }).email
    return typeof value === "string" ? value.toLowerCase() : null
  }
  return null
}

export const auth = betterAuth({
  appName: productName,
  baseURL: getAuthBaseUrl(),
  secret: process.env.BETTER_AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  advanced: {
    ...(getCrossSubdomainCookieDomain()
      ? {
          crossSubDomainCookies: {
            enabled: true,
            domain: getCrossSubdomainCookieDomain() ?? "",
          },
        }
      : {}),
    useSecureCookies: getAuthBaseUrl().startsWith("https://"),
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    modelName: "rateLimit",
    window: 60,
    max: 60,
    customRules: {
      "/sign-in/email": { window: 60, max: 8 },
      "/sign-in/passkey": { window: 60, max: 15 },
      "/two-factor/verify-totp": { window: 60, max: 8 },
      "/two-factor/verify-backup-code": { window: 300, max: 5 },
      "/change-password": { window: 300, max: 5 },
      "/passkey/generate-authenticate-options": { window: 60, max: 20 },
    },
  },
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
    maxPasswordLength: 256,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    sendResetPassword: async ({ user, url }) => {
      const mail = renderPasswordResetEmail({
        resetUrl: url,
        productName: mailProductName(),
      })
      const sent = await sendTransactionalMail({
        to: user.email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      })
      if (!sent) {
        console.warn("password reset mail was not delivered", {
          userId: user.id,
        })
      }
    },
    password: {
      hash: hashPassword,
      verify: ({ password, hash }) => verifyPassword(password, hash),
    },
  },
  session: {
    expiresIn: SESSION_MAX_AGE_SECONDS,
    updateAge: SESSION_REFRESH_AGE_SECONDS,
    cookieCache: {
      enabled: false,
    },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "member",
        input: false,
      },
      status: {
        type: "string",
        required: false,
        defaultValue: "active",
        input: false,
      },
      mustChangePassword: {
        type: "boolean",
        required: false,
        defaultValue: false,
        input: false,
      },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-out") {
        const session = await getSessionFromCtx(ctx).catch(() => null)
        if (session?.user) {
          await recordAuthEvent({
            eventType: "admin_logout",
            actorUserId: session.user.id,
            eventData: { sessionId: session.session.id },
            request: requestContextFromHeaders(ctx.headers),
          })
        }
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      const request = requestContextFromHeaders(ctx.headers)
      const returned = ctx.context.returned
      const failed = returned instanceof APIError

      if (LOGIN_COMPLETION_PATHS.has(ctx.path) && failed) {
        await recordAuthEvent({
          eventType: "admin_login_failed",
          eventData: {
            email: bodyEmail(ctx.body),
            method: LOGIN_METHOD_BY_PATH[ctx.path] ?? "password",
            reason: returned.body?.code ?? returned.status,
          },
          request,
        })
        return
      }

      if (failed) {
        return
      }

      if (LOGIN_COMPLETION_PATHS.has(ctx.path)) {
        const newSession = ctx.context.newSession
        // For password sign-in, the two-factor plugin discards the session
        // created here and issues a challenge cookie instead (its hook runs
        // after ours), so the login is only complete for users without 2FA.
        // For the TOTP/backup-code endpoints, a session is also re-issued
        // during enrollment while already signed in; only count it as a login
        // when the request was answering a challenge.
        const completed =
          newSession &&
          (ctx.path === "/sign-in/email"
            ? !newSession.user.twoFactorEnabled
            : ctx.path.startsWith("/two-factor/")
              ? hasTwoFactorChallenge(ctx)
              : true)
        if (completed) {
          const now = new Date()
          await db
            .update(schema.user)
            .set({ lastLoginAt: now, updatedAt: now })
            .where(eq(schema.user.id, newSession.user.id))
          await recordAuthEvent({
            eventType: "admin_login",
            actorUserId: newSession.user.id,
            eventData: {
              sessionId: newSession.session.id,
              method: LOGIN_METHOD_BY_PATH[ctx.path] ?? "password",
            },
            request,
          })
        }
        if (ctx.path !== "/two-factor/verify-totp") {
          return
        }
      }

      if (
        ctx.path === "/two-factor/verify-totp" ||
        ctx.path === "/two-factor/enable"
      ) {
        // Enrollment completes on the first successful TOTP verification.
        const session =
          ctx.context.newSession ??
          (await getSessionFromCtx(ctx).catch(() => null))
        const userId = session?.user?.id
        if (userId && ctx.path === "/two-factor/verify-totp") {
          const [row] = await db
            .select({ twoFactorEnforcedAt: schema.user.twoFactorEnforcedAt })
            .from(schema.user)
            .where(eq(schema.user.id, userId))
          if (row && !row.twoFactorEnforcedAt) {
            await db
              .update(schema.user)
              .set({ twoFactorEnforcedAt: new Date(), updatedAt: new Date() })
              .where(eq(schema.user.id, userId))
            await recordAuthEvent({
              eventType: "two_factor_enrolled",
              actorUserId: userId,
              request,
            })
          }
        }
        return
      }

      if (ctx.path === "/passkey/verify-registration") {
        const session = await getSessionFromCtx(ctx).catch(() => null)
        if (session?.user) {
          await recordAuthEvent({
            eventType: "passkey_added",
            actorUserId: session.user.id,
            eventData: {
              passkeyId:
                returned && typeof returned === "object" && "id" in returned
                  ? (returned as { id?: string }).id
                  : undefined,
            },
            request,
          })
        }
        return
      }

      if (ctx.path === "/passkey/delete-passkey") {
        const session = await getSessionFromCtx(ctx).catch(() => null)
        if (session?.user) {
          await recordAuthEvent({
            eventType: "passkey_removed",
            actorUserId: session.user.id,
            eventData: {
              passkeyId:
                ctx.body && typeof ctx.body === "object" && "id" in ctx.body
                  ? (ctx.body as { id?: string }).id
                  : undefined,
            },
            request,
          })
        }
        return
      }

      if (ctx.path === "/change-password") {
        const session = await getSessionFromCtx(ctx).catch(() => null)
        if (session?.user) {
          await db
            .update(schema.user)
            .set({ mustChangePassword: false, updatedAt: new Date() })
            .where(eq(schema.user.id, session.user.id))
          await recordAuthEvent({
            eventType: "password_changed",
            actorUserId: session.user.id,
            request,
          })
        }
        return
      }

      if (
        ctx.path === "/revoke-session" ||
        ctx.path === "/revoke-other-sessions"
      ) {
        const session = await getSessionFromCtx(ctx).catch(() => null)
        if (session?.user) {
          await recordAuthEvent({
            eventType: "session_revoked",
            actorUserId: session.user.id,
            eventData: {
              scope: ctx.path === "/revoke-session" ? "one" : "others",
            },
            request,
          })
        }
      }
    }),
  },
  plugins: [
    twoFactor({
      issuer: productName,
      skipVerificationOnEnable: false,
      totpOptions: {
        digits: 6,
        period: 30,
      },
      backupCodeOptions: {
        amount: 10,
        length: 10,
      },
    }),
    passkey({
      rpID: getAuthBaseHostname(),
      rpName: productName,
      origin: getPasskeyOrigins(),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
    }),
    ...(isProduction() && process.env.DISABLE_PWNED_PASSWORD_CHECK !== "true"
      ? [haveIBeenPwned()]
      : []),
  ],
})

export type Auth = typeof auth
