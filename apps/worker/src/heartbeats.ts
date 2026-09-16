import { stat } from "node:fs/promises"

import type { Queue } from "bullmq"
import type Redis from "ioredis"

import {
  WORKER_FLOW_LOG_KEY,
  WORKER_HEARTBEAT_KEY,
  WORKER_QUEUE_KEY,
  parseJobHeartbeat,
  type JobHeartbeat,
} from "@nms/shared"

export class JobHeartbeatStore {
  constructor(private readonly redis: Redis) {}

  async seed(name: string, everyMs: number) {
    const existing = await this.redis.hget(WORKER_HEARTBEAT_KEY, name)
    if (existing) {
      const parsed = parseJobHeartbeat(name, existing)
      if (parsed) return
    }

    const now = new Date().toISOString()
    const heartbeat: JobHeartbeat = {
      name,
      lastCompletedAt: null,
      durationMs: null,
      everyMs,
      seededAt: now,
    }
    await this.redis.hset(WORKER_HEARTBEAT_KEY, name, JSON.stringify(heartbeat))
  }

  async recordCompletion(args: {
    name: string
    durationMs: number
    everyMs: number | null
  }) {
    await this.write(args.name, {
      lastCompletedAt: new Date().toISOString(),
      durationMs: args.durationMs,
      everyMs: args.everyMs,
    })
  }

  async recordFailure(args: {
    name: string
    durationMs: number
    everyMs: number | null
  }) {
    await this.write(args.name, {
      durationMs: args.durationMs,
      everyMs: args.everyMs,
    })
  }

  async recordQueue(queue: Queue) {
    const counts = await queue.getJobCounts(
      "wait",
      "paused",
      "active",
      "delayed"
    )
    const waitingJobs = await queue.getJobs(["wait", "paused"], 0, 200)
    const activeJobs = await queue.getJobs(["active"], 0, 200)
    const now = Date.now()
    let oldestWaitingAgeMs: number | null = null

    for (const job of [...waitingJobs, ...activeJobs]) {
      const marked = job.processedOn ?? job.timestamp
      if (!marked) continue
      const ageMs = now - marked
      if (oldestWaitingAgeMs == null || ageMs > oldestWaitingAgeMs) {
        oldestWaitingAgeMs = ageMs
      }
    }

    await this.redis.set(
      WORKER_QUEUE_KEY,
      JSON.stringify({
        waiting: (counts.wait ?? 0) + (counts.paused ?? 0),
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        oldestWaitingAgeMs,
        updatedAt: new Date().toISOString(),
      })
    )
  }

  async recordFlowLog(path: string) {
    const updatedAt = new Date().toISOString()
    try {
      const info = await stat(path)
      await this.redis.set(
        WORKER_FLOW_LOG_KEY,
        JSON.stringify({
          path,
          mtime: info.mtime.toISOString(),
          ageMs: Date.now() - info.mtimeMs,
          missing: false,
          updatedAt,
        })
      )
    } catch {
      await this.redis.set(
        WORKER_FLOW_LOG_KEY,
        JSON.stringify({
          path,
          mtime: null,
          ageMs: null,
          missing: true,
          updatedAt,
        })
      )
    }
  }

  private async write(name: string, patch: Partial<JobHeartbeat>) {
    const existingRaw = await this.redis.hget(WORKER_HEARTBEAT_KEY, name)
    const existing = existingRaw ? parseJobHeartbeat(name, existingRaw) : null
    const heartbeat: JobHeartbeat = {
      name,
      lastCompletedAt: existing?.lastCompletedAt ?? null,
      durationMs: existing?.durationMs ?? null,
      everyMs: existing?.everyMs ?? null,
      seededAt: existing?.seededAt ?? new Date().toISOString(),
      ...patch,
    }
    await this.redis.hset(WORKER_HEARTBEAT_KEY, name, JSON.stringify(heartbeat))
  }
}
