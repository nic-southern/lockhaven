import { toNextJsHandler } from "better-auth/next-js"

import { auth } from "@/auth"
import {
  addressKey,
  enforceRateLimit,
  rateLimitPolicies,
} from "@/lib/rate-limit-server"

const handlers = toNextJsHandler(auth)

/**
 * Credential-guessing surfaces get an address-keyed bucket in the shared
 * store before the framework's own per-route limiter (which counts in the
 * database) sees the request.
 */
const guardedPaths: Array<{
  suffix: string
  policy: (typeof rateLimitPolicies)[keyof typeof rateLimitPolicies]
  bucket: string
}> = [
  {
    suffix: "/sign-in/email",
    policy: rateLimitPolicies.signInPerAddress,
    bucket: "sign-in",
  },
  {
    suffix: "/sign-in/passkey",
    policy: rateLimitPolicies.signInPerAddress,
    bucket: "sign-in",
  },
  {
    suffix: "/two-factor/verify-totp",
    policy: rateLimitPolicies.twoFactorPerAddress,
    bucket: "two-factor",
  },
  {
    suffix: "/two-factor/verify-backup-code",
    policy: rateLimitPolicies.twoFactorPerAddress,
    bucket: "two-factor",
  },
]

export const GET = handlers.GET

export async function POST(request: Request) {
  const pathname = new URL(request.url).pathname
  const guard = guardedPaths.find((entry) => pathname.endsWith(entry.suffix))
  if (guard) {
    const limited = await enforceRateLimit(
      `auth:${guard.bucket}:ip:${addressKey(request.headers)}`,
      guard.policy,
      "Too many attempts. Wait a minute before trying again."
    )
    if (limited) return limited
  }
  return handlers.POST(request)
}
