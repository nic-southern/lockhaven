import Redis from "ioredis"

import { sql } from "@nms/db"
import { db } from "@nms/db/client"

export async function GET() {
  const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379/0", {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
  })

  const result = {
    ok: true,
    postgres: "ok" as "ok" | "degraded",
    redis: "ok" as "ok" | "degraded",
  }

  try {
    await db.execute(sql`select 1`)
  } catch {
    result.ok = false
    result.postgres = "degraded"
  }

  try {
    await redis.connect()
    await redis.ping()
  } catch {
    result.ok = false
    result.redis = "degraded"
  } finally {
    redis.disconnect()
  }

  return Response.json(result, { status: result.ok ? 200 : 503 })
}
