/**
 * Hub worker liveness. Heartbeats and queue snapshots live in Redis so the
 * Console health check can fail closed when background jobs stop completing
 * or when the queue is quietly backing up.
 */

export const JOB_STALE_MS = 5 * 60 * 1000

export const WORKER_HEARTBEAT_KEY = "lockhaven:worker:heartbeats"
export const WORKER_QUEUE_KEY = "lockhaven:worker:queue"
export const WORKER_FLOW_LOG_KEY = "lockhaven:worker:flow-log"

/** Jobs the Hub worker is expected to run. Intervals match the worker schedulers. */
export const WORKER_JOB_SCHEDULES = [
  { name: "reconcile-vpn", everyMs: 15_000 },
  { name: "refresh-services", everyMs: 30_000 },
  { name: "refresh-sessions", everyMs: 15_000 },
  { name: "flow-ingest", everyMs: 15_000 },
  { name: "notify", everyMs: 15_000 },
  { name: "escalate-alerts", everyMs: 60_000 },
  { name: "rollup-connections", everyMs: 10 * 60 * 1000 },
  { name: "rollup-uptime", everyMs: 60 * 60 * 1000 },
  { name: "send-report-schedules", everyMs: 60 * 60 * 1000 },
  { name: "evaluate-agent-versions", everyMs: 60_000 },
  { name: "evaluate-warranties", everyMs: 60 * 60 * 1000 },
  { name: "run-playbooks", everyMs: 30_000 },
  { name: "prune-history", everyMs: 60 * 60 * 1000 },
] as const

export type WorkerJobSchedule = (typeof WORKER_JOB_SCHEDULES)[number]

export type JobHeartbeat = {
  name: string
  lastCompletedAt: string | null
  durationMs: number | null
  everyMs: number | null
  /** Set when the worker first advertises the job, before it has completed. */
  seededAt: string | null
}

export type QueueSnapshot = {
  waiting: number
  active: number
  delayed: number
  oldestWaitingAgeMs: number | null
  updatedAt: string | null
}

export type FlowLogSnapshot = {
  path: string | null
  mtime: string | null
  ageMs: number | null
  missing: boolean
  updatedAt: string | null
}

export type EvaluatedJob = JobHeartbeat & {
  ageMs: number | null
  staleThresholdMs: number
  stale: boolean
}

export type HubHealthInput = {
  nowMs: number
  postgresOk: boolean
  redisOk: boolean
  heartbeats: JobHeartbeat[]
  expectedJobs?: ReadonlyArray<{ name: string; everyMs: number }>
  queue: QueueSnapshot
  flowLog: FlowLogSnapshot
}

export type HubHealthReport = {
  ok: boolean
  postgres: "ok" | "degraded"
  redis: "ok" | "degraded"
  queue: {
    depth: number
    waiting: number
    active: number
    delayed: number
    oldestWaitingAgeMs: number | null
    lying: boolean
  }
  jobs: EvaluatedJob[]
  flowLog: FlowLogSnapshot
  staleJobNames: string[]
}

/**
 * Frequent jobs are stale after 5 minutes of silence. Jobs that are meant to
 * run less often than that are stale once they are more than 5 minutes overdue.
 */
export function jobStaleThresholdMs(everyMs: number | null | undefined) {
  if (everyMs == null || everyMs <= JOB_STALE_MS) {
    return JOB_STALE_MS
  }
  return everyMs + JOB_STALE_MS
}

export function heartbeatAgeMs(
  heartbeat: Pick<JobHeartbeat, "lastCompletedAt" | "seededAt">,
  nowMs: number
) {
  const reference = heartbeat.lastCompletedAt ?? heartbeat.seededAt
  if (!reference) return null
  const at = Date.parse(reference)
  if (Number.isNaN(at)) return null
  return Math.max(0, nowMs - at)
}

function isJobStale(heartbeat: JobHeartbeat, nowMs: number) {
  const ageMs = heartbeatAgeMs(heartbeat, nowMs)
  if (ageMs == null) return true
  return ageMs > jobStaleThresholdMs(heartbeat.everyMs)
}

export function parseJobHeartbeat(
  name: string,
  raw: string
): JobHeartbeat | null {
  try {
    const parsed = JSON.parse(raw) as Partial<JobHeartbeat>
    return {
      name: typeof parsed.name === "string" ? parsed.name : name,
      lastCompletedAt:
        typeof parsed.lastCompletedAt === "string"
          ? parsed.lastCompletedAt
          : null,
      durationMs:
        typeof parsed.durationMs === "number" &&
        Number.isFinite(parsed.durationMs)
          ? parsed.durationMs
          : null,
      everyMs:
        typeof parsed.everyMs === "number" && Number.isFinite(parsed.everyMs)
          ? parsed.everyMs
          : null,
      seededAt: typeof parsed.seededAt === "string" ? parsed.seededAt : null,
    }
  } catch {
    return null
  }
}

export function parseHeartbeats(hash: Record<string, string>): JobHeartbeat[] {
  const heartbeats: JobHeartbeat[] = []
  for (const [name, raw] of Object.entries(hash)) {
    const parsed = parseJobHeartbeat(name, raw)
    if (parsed) heartbeats.push(parsed)
  }
  return heartbeats
}

export function parseQueueSnapshot(raw: string | null): QueueSnapshot {
  if (!raw) {
    return {
      waiting: 0,
      active: 0,
      delayed: 0,
      oldestWaitingAgeMs: null,
      updatedAt: null,
    }
  }
  try {
    const parsed = JSON.parse(raw) as Partial<QueueSnapshot>
    return {
      waiting: Number(parsed.waiting) || 0,
      active: Number(parsed.active) || 0,
      delayed: Number(parsed.delayed) || 0,
      oldestWaitingAgeMs:
        typeof parsed.oldestWaitingAgeMs === "number" &&
        Number.isFinite(parsed.oldestWaitingAgeMs)
          ? parsed.oldestWaitingAgeMs
          : null,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    }
  } catch {
    return {
      waiting: 0,
      active: 0,
      delayed: 0,
      oldestWaitingAgeMs: null,
      updatedAt: null,
    }
  }
}

export function parseFlowLogSnapshot(raw: string | null): FlowLogSnapshot {
  if (!raw) {
    return {
      path: null,
      mtime: null,
      ageMs: null,
      missing: true,
      updatedAt: null,
    }
  }
  try {
    const parsed = JSON.parse(raw) as Partial<FlowLogSnapshot>
    return {
      path: typeof parsed.path === "string" ? parsed.path : null,
      mtime: typeof parsed.mtime === "string" ? parsed.mtime : null,
      ageMs:
        typeof parsed.ageMs === "number" && Number.isFinite(parsed.ageMs)
          ? parsed.ageMs
          : null,
      missing: parsed.missing === true,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    }
  } catch {
    return {
      path: null,
      mtime: null,
      ageMs: null,
      missing: true,
      updatedAt: null,
    }
  }
}

function emptyHeartbeat(name: string, everyMs: number | null): JobHeartbeat {
  return {
    name,
    lastCompletedAt: null,
    durationMs: null,
    everyMs,
    seededAt: null,
  }
}

/**
 * Combines heartbeats, queue depth, and dependency pings. Returns `ok: false`
 * when any expected job is stale beyond 5 minutes, when waiting work is older
 * than 5 minutes, or when the queue depth says jobs are piling up.
 */
export function evaluateHubHealth(input: HubHealthInput): HubHealthReport {
  const expected = input.expectedJobs ?? WORKER_JOB_SCHEDULES
  const byName = new Map(input.heartbeats.map((item) => [item.name, item]))

  const jobs: EvaluatedJob[] = expected.map((schedule) => {
    const heartbeat =
      byName.get(schedule.name) ??
      emptyHeartbeat(schedule.name, schedule.everyMs)
    const everyMs = heartbeat.everyMs ?? schedule.everyMs
    const merged = { ...heartbeat, everyMs }
    const ageMs = heartbeatAgeMs(merged, input.nowMs)
    const staleThresholdMs = jobStaleThresholdMs(everyMs)
    return {
      ...merged,
      ageMs,
      staleThresholdMs,
      stale: isJobStale(merged, input.nowMs),
    }
  })

  for (const heartbeat of input.heartbeats) {
    if (jobs.some((job) => job.name === heartbeat.name)) continue
    const ageMs = heartbeatAgeMs(heartbeat, input.nowMs)
    jobs.push({
      ...heartbeat,
      ageMs,
      staleThresholdMs: jobStaleThresholdMs(heartbeat.everyMs),
      stale: isJobStale(heartbeat, input.nowMs),
    })
  }

  const waiting = input.queue.waiting
  const oldestWaitingAgeMs = input.queue.oldestWaitingAgeMs
  const queueLying =
    (oldestWaitingAgeMs != null && oldestWaitingAgeMs > JOB_STALE_MS) ||
    waiting > expected.length

  const staleJobNames = jobs.filter((job) => job.stale).map((job) => job.name)
  const postgres = input.postgresOk ? "ok" : "degraded"
  const redis = input.redisOk ? "ok" : "degraded"
  const ok =
    input.postgresOk &&
    input.redisOk &&
    staleJobNames.length === 0 &&
    !queueLying

  return {
    ok,
    postgres,
    redis,
    queue: {
      depth: waiting + input.queue.active,
      waiting,
      active: input.queue.active,
      delayed: input.queue.delayed,
      oldestWaitingAgeMs,
      lying: queueLying,
    },
    jobs,
    flowLog: input.flowLog,
    staleJobNames,
  }
}
