import { collectHubHealth } from "@/lib/hub-health"

export async function GET() {
  const report = await collectHubHealth()
  return Response.json(
    {
      ok: report.ok,
      postgres: report.postgres,
      redis: report.redis,
      queue: {
        depth: report.queue.depth,
        waiting: report.queue.waiting,
        active: report.queue.active,
        delayed: report.queue.delayed,
        oldestWaitingAgeMs: report.queue.oldestWaitingAgeMs,
        lying: report.queue.lying,
      },
      jobs: report.jobs.map((job) => ({
        name: job.name,
        lastCompletedAt: job.lastCompletedAt,
        durationMs: job.durationMs,
        ageMs: job.ageMs,
        stale: job.stale,
      })),
      flowLog: {
        ageMs: report.flowLog.ageMs,
        missing: report.flowLog.missing,
      },
    },
    { status: report.ok ? 200 : 503 }
  )
}
