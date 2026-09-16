import assert from "node:assert/strict"
import test from "node:test"

import {
  createRedisRateLimiter,
  rateLimitHeaders,
  takeToken,
  TOKEN_BUCKET_SCRIPT,
  type TokenBucketState,
} from "./rate-limit"

const bucket = { capacity: 3, refillPerSecond: 1 }

test("a fresh bucket allows a burst up to capacity, then refuses", () => {
  let state: TokenBucketState | null = null
  const now = 1_000_000
  const results = []
  for (let index = 0; index < 4; index += 1) {
    const step = takeToken(state, now, bucket)
    state = step.state
    results.push(step.decision)
  }
  assert.deepEqual(
    results.map((decision) => [decision.allowed, decision.remaining]),
    [
      [true, 2],
      [true, 1],
      [true, 0],
      [false, 0],
    ]
  )
  assert.equal(results[3]?.retryAfterMs, 1000)
  assert.equal(results[3]?.limit, 3)
})

test("tokens refill with elapsed time and never exceed capacity", () => {
  const drained: TokenBucketState = { tokens: 0, updatedAt: 10_000 }
  const afterHalf = takeToken(drained, 10_500, bucket)
  assert.equal(afterHalf.decision.allowed, false)
  assert.equal(afterHalf.decision.retryAfterMs, 500)

  const afterOne = takeToken(drained, 11_000, bucket)
  assert.equal(afterOne.decision.allowed, true)
  assert.equal(afterOne.decision.remaining, 0)

  const afterLong = takeToken(drained, 99_000, bucket)
  assert.equal(afterLong.decision.remaining, 2)
  assert.equal(afterLong.state.tokens, 2)
})

test("clock going backwards does not mint tokens", () => {
  const state: TokenBucketState = { tokens: 0, updatedAt: 50_000 }
  const step = takeToken(state, 40_000, bucket)
  assert.equal(step.decision.allowed, false)
  assert.equal(step.state.tokens, 0)
})

test("zero refill buckets report an unbounded wait", () => {
  const step = takeToken({ tokens: 0, updatedAt: 0 }, 1, {
    capacity: 1,
    refillPerSecond: 0,
  })
  assert.equal(step.decision.allowed, false)
  assert.equal(step.decision.retryAfterMs, Number.POSITIVE_INFINITY)
  assert.equal("Retry-After" in rateLimitHeaders(step.decision), false)
})

test("headers round Retry-After up to whole seconds", () => {
  const refused = rateLimitHeaders({
    allowed: false,
    remaining: 0,
    retryAfterMs: 1_200,
    limit: 10,
  })
  assert.deepEqual(refused, {
    "RateLimit-Limit": "10",
    "RateLimit-Remaining": "0",
    "Retry-After": "2",
  })
  const allowed = rateLimitHeaders({
    allowed: true,
    remaining: 4,
    retryAfterMs: 0,
    limit: 10,
  })
  assert.equal("Retry-After" in allowed, false)
  assert.equal(allowed["RateLimit-Remaining"], "4")
})

test("redis limiter maps script results and fails open on store errors", async () => {
  const calls: unknown[][] = []
  const limiter = createRedisRateLimiter(
    {
      async eval(script, numKeys, ...args) {
        calls.push([script === TOKEN_BUCKET_SCRIPT, numKeys, ...args])
        return [0, 0, 2_500]
      },
    },
    { prefix: "t", now: () => 42 }
  )
  const decision = await limiter.take("enroll:ip:1.2.3.4", bucket)
  assert.deepEqual(decision, {
    allowed: false,
    remaining: 0,
    retryAfterMs: 2_500,
    limit: 3,
  })
  assert.deepEqual(calls, [[true, 1, "t:enroll:ip:1.2.3.4", 3, 1, 42, 1]])

  const errors: unknown[] = []
  const broken = createRedisRateLimiter(
    {
      async eval() {
        throw new Error("connection refused")
      },
    },
    { onError: (error) => errors.push(error) }
  )
  const open = await broken.take("k", bucket)
  assert.equal(open.allowed, true)
  assert.equal(errors.length, 1)
  await broken.take("k", bucket)
  assert.equal(
    errors.length,
    1,
    "store errors are logged at most once a minute"
  )
})
