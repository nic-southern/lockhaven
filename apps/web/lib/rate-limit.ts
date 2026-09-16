export type TokenBucketOptions = {
  /** Maximum burst size. */
  capacity: number
  /** Sustained rate at which tokens are restored. */
  refillPerSecond: number
}

export type TokenBucketState = {
  tokens: number
  updatedAt: number
}

export type RateLimitDecision = {
  allowed: boolean
  remaining: number
  /** Milliseconds until one token is available again; 0 when allowed. */
  retryAfterMs: number
  limit: number
}

/**
 * Pure token bucket step: refills based on elapsed time, then spends `cost`
 * tokens if enough are available. The Redis script below runs the identical
 * arithmetic server-side so behaviour matches between tests and production.
 */
export function takeToken(
  state: TokenBucketState | null,
  now: number,
  options: TokenBucketOptions,
  cost = 1
): { decision: RateLimitDecision; state: TokenBucketState } {
  const capacity = Math.max(1, options.capacity)
  const refillPerMs = Math.max(0, options.refillPerSecond) / 1000
  const previousTokens = state ? state.tokens : capacity
  const elapsed = state ? Math.max(0, now - state.updatedAt) : 0
  const tokens = Math.min(capacity, previousTokens + elapsed * refillPerMs)

  if (tokens >= cost) {
    const nextTokens = tokens - cost
    return {
      decision: {
        allowed: true,
        remaining: Math.floor(nextTokens),
        retryAfterMs: 0,
        limit: capacity,
      },
      state: { tokens: nextTokens, updatedAt: now },
    }
  }

  const deficit = cost - tokens
  const retryAfterMs =
    refillPerMs > 0
      ? Math.ceil(deficit / refillPerMs)
      : Number.POSITIVE_INFINITY
  return {
    decision: {
      allowed: false,
      remaining: 0,
      retryAfterMs,
      limit: capacity,
    },
    state: { tokens, updatedAt: now },
  }
}

/**
 * Standard rate-limit response headers for a decision. `Retry-After` is in
 * whole seconds, rounded up so a client that waits exactly that long succeeds.
 */
export function rateLimitHeaders(decision: RateLimitDecision) {
  const headers: Record<string, string> = {
    "RateLimit-Limit": String(decision.limit),
    "RateLimit-Remaining": String(Math.max(0, decision.remaining)),
  }
  if (!decision.allowed && Number.isFinite(decision.retryAfterMs)) {
    headers["Retry-After"] = String(
      Math.max(1, Math.ceil(decision.retryAfterMs / 1000))
    )
  }
  return headers
}

/**
 * Atomic Redis implementation of `takeToken`. Keys hold `tokens` and `ts`
 * fields and expire once a full refill has elapsed so idle keys disappear.
 *
 * KEYS[1] bucket key
 * ARGV[1] capacity, ARGV[2] refill per second, ARGV[3] now ms, ARGV[4] cost
 * Returns { allowed(0|1), remaining, retryAfterMs }
 */
export const TOKEN_BUCKET_SCRIPT = `
local capacity = tonumber(ARGV[1])
local refillPerMs = tonumber(ARGV[2]) / 1000
local now = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local tokens = capacity
local updatedAt = now
local stored = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
if stored[1] then
  tokens = tonumber(stored[1])
  updatedAt = tonumber(stored[2])
  local elapsed = now - updatedAt
  if elapsed < 0 then elapsed = 0 end
  tokens = math.min(capacity, tokens + elapsed * refillPerMs)
end

local allowed = 0
local retryAfterMs = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  if refillPerMs > 0 then
    retryAfterMs = math.ceil((cost - tokens) / refillPerMs)
  else
    retryAfterMs = -1
  end
end

redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
local ttl = 1000
if refillPerMs > 0 then
  ttl = math.ceil(capacity / refillPerMs) + 1000
end
redis.call('PEXPIRE', KEYS[1], ttl)

return { allowed, math.floor(tokens), retryAfterMs }
`

type ScriptRunner = {
  eval(
    script: string,
    numKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown>
}

export type RateLimiter = {
  take(
    key: string,
    options: TokenBucketOptions,
    cost?: number
  ): Promise<RateLimitDecision>
}

/**
 * Wraps a Redis client. When the store is unreachable the limiter fails open
 * and logs once per minute: refusing every agent check-in because a cache
 * blipped would be a worse outcome than briefly losing the throttle.
 */
export function createRedisRateLimiter(
  client: ScriptRunner,
  options: {
    prefix?: string
    now?: () => number
    onError?: (error: unknown) => void
  } = {}
): RateLimiter {
  const prefix = options.prefix ?? "rl"
  const now = options.now ?? Date.now
  let lastErrorAt = 0

  return {
    async take(key, bucket, cost = 1) {
      try {
        const result = (await client.eval(
          TOKEN_BUCKET_SCRIPT,
          1,
          `${prefix}:${key}`,
          bucket.capacity,
          bucket.refillPerSecond,
          now(),
          cost
        )) as [number, number, number]
        const [allowed, remaining, retryAfterMs] = result
        return {
          allowed: Number(allowed) === 1,
          remaining: Number(remaining),
          retryAfterMs:
            Number(retryAfterMs) < 0
              ? Number.POSITIVE_INFINITY
              : Number(retryAfterMs),
          limit: bucket.capacity,
        }
      } catch (error) {
        const at = now()
        if (at - lastErrorAt > 60_000) {
          lastErrorAt = at
          options.onError?.(error)
        }
        return {
          allowed: true,
          remaining: bucket.capacity,
          retryAfterMs: 0,
          limit: bucket.capacity,
        }
      }
    },
  }
}

/** Limiter that never refuses, for environments without a shared store. */
export const passthroughRateLimiter: RateLimiter = {
  async take(_key, options) {
    return {
      allowed: true,
      remaining: options.capacity,
      retryAfterMs: 0,
      limit: options.capacity,
    }
  },
}
