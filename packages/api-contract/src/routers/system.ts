import { count, min, sql } from "drizzle-orm"
import Redis from "ioredis"
import { Pool } from "pg"

import { connectionDaily, connectionEvents, vpnPeerSamples } from "@nms/db"
import {
  FLOW_RETENTION_DAYS_DEFAULT,
  FLOW_ROLLUP_RETENTION_DAYS_DEFAULT,
  PEER_SAMPLE_RETENTION_DAYS,
  WORKER_FLOW_LOG_KEY,
  WORKER_HEARTBEAT_KEY,
  WORKER_QUEUE_KEY,
  evaluateHubHealth,
  parseFlowLogSnapshot,
  parseHeartbeats,
  parseQueueSnapshot,
} from "@nms/shared"

import { assertPlatformAdministrator } from "../access"
import { adminProcedure, createTRPCRouter } from "../trpc"

function redisClient() {
  return new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379/0", {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
  })
}

async function databaseSizeBytes(url: string | undefined) {
  if (!url) return null
  const pool = new Pool({ connectionString: url, max: 1 })
  try {
    const result = await pool.query<{ bytes: string }>(
      "select pg_database_size(current_database())::text as bytes"
    )
    const bytes = Number(result.rows[0]?.bytes)
    return Number.isFinite(bytes) ? bytes : null
  } catch {
    return null
  } finally {
    await pool.end()
  }
}

function retentionDays(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export const systemRouter = createTRPCRouter({
  status: adminProcedure.query(async ({ ctx }) => {
    assertPlatformAdministrator(ctx.actor)

    const redis = redisClient()
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

    let postgresOk = true
    try {
      await ctx.db.execute(sql`select 1`)
    } catch {
      postgresOk = false
    }

    const health = evaluateHubHealth({
      nowMs: Date.now(),
      postgresOk,
      redisOk,
      heartbeats,
      queue,
      flowLog,
    })

    const [peerSamples, connectionHistory, dailySummaries] = await Promise.all([
      ctx.db
        .select({
          total: count(),
          oldest: min(vpnPeerSamples.sampledAt),
        })
        .from(vpnPeerSamples),
      ctx.db
        .select({
          total: count(),
          oldest: min(connectionEvents.occurredAt),
        })
        .from(connectionEvents),
      ctx.db
        .select({
          total: count(),
          oldest: min(connectionDaily.day),
        })
        .from(connectionDaily),
    ])

    const [controlPlaneBytes, sessionGatewayBytes] = await Promise.all([
      databaseSizeBytes(process.env.DATABASE_URL),
      databaseSizeBytes(process.env.GUACAMOLE_DATABASE_URL),
    ])

    return {
      health,
      images: {
        console:
          process.env.LOCKHAVEN_WEB_IMAGE ?? process.env.WEB_IMAGE ?? null,
        worker:
          process.env.LOCKHAVEN_WORKER_IMAGE ??
          process.env.WORKER_IMAGE ??
          null,
      },
      databases: {
        controlPlaneBytes,
        sessionGatewayBytes,
      },
      retention: {
        peerSamples: {
          count: Number(peerSamples[0]?.total ?? 0),
          oldestAt: peerSamples[0]?.oldest ?? null,
          keepDays: PEER_SAMPLE_RETENTION_DAYS,
        },
        connectionHistory: {
          count: Number(connectionHistory[0]?.total ?? 0),
          oldestAt: connectionHistory[0]?.oldest ?? null,
          keepDays: retentionDays(
            process.env.FLOW_RETENTION_DAYS,
            FLOW_RETENTION_DAYS_DEFAULT
          ),
        },
        dailySummaries: {
          count: Number(dailySummaries[0]?.total ?? 0),
          oldestAt: dailySummaries[0]?.oldest ?? null,
          keepDays: retentionDays(
            process.env.FLOW_ROLLUP_RETENTION_DAYS,
            FLOW_ROLLUP_RETENTION_DAYS_DEFAULT
          ),
        },
      },
    }
  }),
})
