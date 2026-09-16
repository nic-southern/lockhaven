import assert from "node:assert/strict"
import test from "node:test"

import {
  JOB_STALE_MS,
  WORKER_JOB_SCHEDULES,
  evaluateHubHealth,
  jobStaleThresholdMs,
  parseHeartbeats,
  parseQueueSnapshot,
  type FlowLogSnapshot,
  type JobHeartbeat,
  type QueueSnapshot,
} from "./health"

const nowMs = Date.parse("2026-09-16T12:00:00.000Z")

const freshFlow: FlowLogSnapshot = {
  path: "/var/log/lockhaven/flows.jsonl",
  mtime: "2026-09-16T11:59:50.000Z",
  ageMs: 10_000,
  missing: false,
  updatedAt: "2026-09-16T12:00:00.000Z",
}

const quietQueue: QueueSnapshot = {
  waiting: 0,
  active: 1,
  delayed: WORKER_JOB_SCHEDULES.length,
  oldestWaitingAgeMs: null,
  updatedAt: "2026-09-16T12:00:00.000Z",
}

function isoAgo(ms: number) {
  return new Date(nowMs - ms).toISOString()
}

function heartbeat(name: string, agoMs: number, everyMs: number): JobHeartbeat {
  return {
    name,
    lastCompletedAt: isoAgo(agoMs),
    durationMs: 40,
    everyMs,
    seededAt: isoAgo(agoMs + 60_000),
  }
}

function allFresh() {
  return WORKER_JOB_SCHEDULES.map((schedule) =>
    heartbeat(schedule.name, 20_000, schedule.everyMs)
  )
}

test("frequent jobs use a 5 minute stale threshold", () => {
  assert.equal(jobStaleThresholdMs(15_000), JOB_STALE_MS)
  assert.equal(jobStaleThresholdMs(30_000), JOB_STALE_MS)
  assert.equal(
    jobStaleThresholdMs(10 * 60 * 1000),
    10 * 60 * 1000 + JOB_STALE_MS
  )
})

test("healthy heartbeats and an empty wait list report ok", () => {
  const report = evaluateHubHealth({
    nowMs,
    postgresOk: true,
    redisOk: true,
    heartbeats: allFresh(),
    queue: quietQueue,
    flowLog: freshFlow,
  })

  assert.equal(report.ok, true)
  assert.equal(report.postgres, "ok")
  assert.equal(report.redis, "ok")
  assert.equal(report.queue.lying, false)
  assert.deepEqual(report.staleJobNames, [])
  assert.equal(
    report.jobs.every((job) => !job.stale),
    true
  )
})

test("a frequent job at exactly 5 minutes is not stale", () => {
  const heartbeats = allFresh().map((item) =>
    item.name === "reconcile-vpn"
      ? heartbeat("reconcile-vpn", JOB_STALE_MS, 15_000)
      : item
  )

  const report = evaluateHubHealth({
    nowMs,
    postgresOk: true,
    redisOk: true,
    heartbeats,
    queue: quietQueue,
    flowLog: freshFlow,
  })

  assert.equal(report.ok, true)
  assert.equal(
    report.jobs.find((item) => item.name === "reconcile-vpn")?.stale,
    false
  )
})

test("a frequent job silent for more than 5 minutes is stale", () => {
  const heartbeats = allFresh().map((item) =>
    item.name === "reconcile-vpn"
      ? heartbeat("reconcile-vpn", 5 * 60 * 1000 + 1, 15_000)
      : item
  )

  const report = evaluateHubHealth({
    nowMs,
    postgresOk: true,
    redisOk: true,
    heartbeats,
    queue: quietQueue,
    flowLog: freshFlow,
  })

  assert.equal(report.ok, false)
  assert.deepEqual(report.staleJobNames, ["reconcile-vpn"])
  const job = report.jobs.find((item) => item.name === "reconcile-vpn")
  assert.equal(job?.stale, true)
})

test("an hourly job is not stale 6 minutes after it last completed", () => {
  const heartbeats = allFresh().map((item) =>
    item.name === "prune-history"
      ? heartbeat("prune-history", 6 * 60 * 1000, 60 * 60 * 1000)
      : item
  )

  const report = evaluateHubHealth({
    nowMs,
    postgresOk: true,
    redisOk: true,
    heartbeats,
    queue: quietQueue,
    flowLog: freshFlow,
  })

  assert.equal(report.ok, true)
  assert.equal(
    report.jobs.find((item) => item.name === "prune-history")?.stale,
    false
  )
})

test("an hourly job is stale once it is more than 5 minutes overdue", () => {
  const heartbeats = allFresh().map((item) =>
    item.name === "prune-history"
      ? heartbeat("prune-history", 65 * 60 * 1000 + 1, 60 * 60 * 1000)
      : item
  )

  const report = evaluateHubHealth({
    nowMs,
    postgresOk: true,
    redisOk: true,
    heartbeats,
    queue: quietQueue,
    flowLog: freshFlow,
  })

  assert.equal(report.ok, false)
  assert.ok(report.staleJobNames.includes("prune-history"))
})

test("returns 503 when waiting work is older than 5 minutes even if heartbeats look fresh", () => {
  const report = evaluateHubHealth({
    nowMs,
    postgresOk: true,
    redisOk: true,
    heartbeats: allFresh(),
    queue: {
      waiting: 1,
      active: 1,
      delayed: WORKER_JOB_SCHEDULES.length,
      oldestWaitingAgeMs: JOB_STALE_MS + 1,
      updatedAt: isoAgo(1_000),
    },
    flowLog: freshFlow,
  })

  assert.equal(report.ok, false)
  assert.equal(report.queue.lying, true)
  assert.deepEqual(report.staleJobNames, [])
})

test("a waiting depth larger than the scheduled job set means the queue is lying", () => {
  const report = evaluateHubHealth({
    nowMs,
    postgresOk: true,
    redisOk: true,
    heartbeats: allFresh(),
    queue: {
      waiting: WORKER_JOB_SCHEDULES.length + 1,
      active: 0,
      delayed: 0,
      oldestWaitingAgeMs: 1_000,
      updatedAt: isoAgo(1_000),
    },
    flowLog: freshFlow,
  })

  assert.equal(report.ok, false)
  assert.equal(report.queue.lying, true)
  assert.equal(report.queue.depth, WORKER_JOB_SCHEDULES.length + 1)
})

test("a missing expected job is stale", () => {
  const heartbeats = allFresh().filter((item) => item.name !== "notify")
  const report = evaluateHubHealth({
    nowMs,
    postgresOk: true,
    redisOk: true,
    heartbeats,
    queue: quietQueue,
    flowLog: freshFlow,
  })

  assert.equal(report.ok, false)
  assert.ok(report.staleJobNames.includes("notify"))
})

test("a newly seeded job is healthy until the 5 minute window elapses", () => {
  const heartbeats = allFresh().map((item) =>
    item.name === "notify"
      ? {
          name: "notify",
          lastCompletedAt: null,
          durationMs: null,
          everyMs: 15_000,
          seededAt: isoAgo(30_000),
        }
      : item
  )

  const report = evaluateHubHealth({
    nowMs,
    postgresOk: true,
    redisOk: true,
    heartbeats,
    queue: quietQueue,
    flowLog: freshFlow,
  })

  assert.equal(report.ok, true)
  assert.equal(report.jobs.find((item) => item.name === "notify")?.stale, false)
})

test("dependency failure is unhealthy even with fresh jobs", () => {
  const report = evaluateHubHealth({
    nowMs,
    postgresOk: false,
    redisOk: true,
    heartbeats: allFresh(),
    queue: quietQueue,
    flowLog: freshFlow,
  })

  assert.equal(report.ok, false)
  assert.equal(report.postgres, "degraded")
})

test("parses heartbeat hashes and ignores corrupt entries", () => {
  const parsed = parseHeartbeats({
    "reconcile-vpn": JSON.stringify({
      name: "reconcile-vpn",
      lastCompletedAt: "2026-09-16T11:59:00.000Z",
      durationMs: 12,
      everyMs: 15_000,
      seededAt: "2026-09-16T11:00:00.000Z",
    }),
    broken: "{not-json",
  })

  assert.equal(parsed.length, 1)
  assert.equal(parsed[0]?.name, "reconcile-vpn")
  assert.equal(parseQueueSnapshot("nope").waiting, 0)
  assert.equal(parseQueueSnapshot(null).oldestWaitingAgeMs, null)
})
