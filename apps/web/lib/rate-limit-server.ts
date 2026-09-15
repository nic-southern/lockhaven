import Redis from "ioredis"

import { requestInfoFromHeaders } from "@nms/api-contract"

import {
  createRedisRateLimiter,
  passthroughRateLimiter,
  rateLimitHeaders,
  type RateLimiter,
  type TokenBucketOptions,
} from "./rate-limit"

/**
 * Bucket sizes per caller. Agents check in roughly twice a minute, so the
 * per-device bucket tolerates a restart burst while stopping a runaway loop.
 * Enrollment and sign-in are keyed by address to blunt token or password
 * guessing without affecting other sites behind a different NAT.
 */
export const rateLimitPolicies = {
  enrollPerAddress: { capacity: 10, refillPerSecond: 10 / 60 },
  checkInPerDevice: { capacity: 12, refillPerSecond: 6 / 60 },
  checkInPerAddress: { capacity: 240, refillPerSecond: 120 / 60 },
  signInPerAddress: { capacity: 10, refillPerSecond: 5 / 60 },
  twoFactorPerAddress: { capacity: 8, refillPerSecond: 4 / 60 },
} satisfies Record<string, TokenBucketOptions>

let limiter: RateLimiter | null = null

export function getRateLimiter(): RateLimiter {
  if (limiter) return limiter
  const url = process.env.REDIS_URL
  if (!url || process.env.RATE_LIMIT_DISABLED === "1") {
    limiter = passthroughRateLimiter
    return limiter
  }
  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
  })
  client.on("error", () => {
    // Surfaced through the limiter's own throttled logger instead.
  })
  limiter = createRedisRateLimiter(client, {
    prefix: "lockhaven:rl",
    onError: (error) => {
      console.warn("[rate-limit] store unavailable, allowing request", error)
    },
  })
  return limiter
}

/** Address key for a request, falling back to a shared bucket when unknown. */
export function addressKey(headers: Headers) {
  return requestInfoFromHeaders(headers).ipAddress ?? "unknown"
}

/**
 * Applies a bucket and returns a ready 429 response when exhausted, or null
 * when the request may proceed.
 */
export async function enforceRateLimit(
  key: string,
  options: TokenBucketOptions,
  message = "Too many requests. Try again shortly."
) {
  const decision = await getRateLimiter().take(key, options)
  if (decision.allowed) return null
  return Response.json(
    { error: message },
    { status: 429, headers: rateLimitHeaders(decision) }
  )
}
