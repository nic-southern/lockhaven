import { stat } from "node:fs/promises"

import Redis from "ioredis"

import { sql } from "@nms/db"
import { db } from "@nms/db/client"
import {
  WORKER_FLOW_LOG_KEY,
  WORKER_HEARTBEAT_KEY,
  WORKER_QUEUE_KEY,
  evaluateHubHealth,
  parseFlowLogSnapshot,
  parseHeartbeats,
  parseQueueSnapshot,
} from "@nms/shared"

async function pingPostgres() {
  try {
    await db.execute(sql`select 1`)
    return true
  } catch {
    return false
  }
}

export async function collectHubHealth(nowMs = Date.now()) {
  const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379/0", {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
  })

  let redisOk = false
  let heartbeats = parseHeartbeats({})
  let queue = parseQueueSnapshot(null)
  let flowLog = parseFlowLogSnapshot(null)

  try {
    await redis.connect()
    await redis.ping()
    redisOk = true
    const [hash, queueRaw, flowRaw] = await Promise.all([
      redis.hgetall(WORKER_HEARTBEAT_KEY),
      redis.get(WORKER_QUEUE_KEY),
      redis.get(WORKER_FLOW_LOG_KEY),
    ])
    heartbeats = parseHeartbeats(hash)
    queue = parseQueueSnapshot(queueRaw)
    flowLog = parseFlowLogSnapshot(flowRaw)
  } catch {
    redisOk = false
  } finally {
    redis.disconnect()
  }

  if (flowLog.mtime) {
    const mtimeMs = Date.parse(flowLog.mtime)
    if (!Number.isNaN(mtimeMs)) {
      flowLog = { ...flowLog, ageMs: Math.max(0, nowMs - mtimeMs) }
    }
  } else if (flowLog.path && !flowLog.missing) {
    try {
      const info = await stat(flowLog.path)
      flowLog = {
        ...flowLog,
        mtime: info.mtime.toISOString(),
        ageMs: Math.max(0, nowMs - info.mtimeMs),
        missing: false,
      }
    } catch {
      flowLog = { ...flowLog, missing: true }
    }
  }

  const postgresOk = await pingPostgres()
  return evaluateHubHealth({
    nowMs,
    postgresOk,
    redisOk,
    heartbeats,
    queue,
    flowLog,
  })
}
