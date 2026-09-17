import assert from "node:assert/strict"
import test from "node:test"

import {
  AFTER_HOURS_UPDATE_SETTLE_MINUTES,
  afterHoursApprovalExpiresAt,
  afterHoursDeviceEligibility,
  afterHoursRunIsSettled,
  afterHoursScheduleInputSchema,
  afterHoursSteps,
  afterHoursWindowKey,
  decideAfterHoursDeviceStep,
  decideAfterHoursSiteStart,
  nextSiteOpenAt,
  siteClosedSince,
  summarizeAfterHoursRun,
  type AfterHoursStepRow,
} from "./after-hours"
import type { SiteBusinessHours } from "./assets"
import { playbookActions } from "./playbooks"

const chicago = "America/Chicago"
const hours: SiteBusinessHours = {
  weekdays: { open: "10:00", close: "22:00" },
  saturday: { open: "10:00", close: "02:00" },
  sunday: null,
  holidays: [{ date: "2026-12-25", name: "Christmas" }],
}
const site = { timezone: chicago, businessHours: hours }

test("after-close steps are update then reboot from the closed whitelist", () => {
  assert.deepEqual([...afterHoursSteps], ["update", "reboot"])
  for (const step of afterHoursSteps) {
    assert.ok((playbookActions as readonly string[]).includes(step))
  }
  assert.equal((afterHoursSteps as readonly string[]).includes("shell"), false)
})

test("closed-since is the minute the floor closed, in the site timezone", () => {
  // Wednesday 2026-09-16 closes 22:00 CDT = 03:00Z on the 17th.
  const now = new Date("2026-09-17T04:30:00Z")
  const closedSince = siteClosedSince(site, now)
  assert.equal(closedSince?.toISOString(), "2026-09-17T03:00:00.000Z")
  assert.equal(afterHoursWindowKey(closedSince!), "2026-09-17T03:00:00.000Z")
  // Thursday opens 10:00 CDT = 15:00Z.
  assert.equal(
    nextSiteOpenAt(site, now)?.toISOString(),
    "2026-09-17T15:00:00.000Z"
  )
})

test("the same closed stretch keeps one key from close until open", () => {
  const early = siteClosedSince(site, new Date("2026-09-17T03:01:00Z"))
  const late = siteClosedSince(site, new Date("2026-09-17T14:59:00Z"))
  assert.equal(early?.toISOString(), late?.toISOString())
})

test("overnight Saturday close spills into Sunday and stays closed until Monday", () => {
  // Saturday 2026-09-19 10:00-02:00 closes Sunday 02:00 CDT = 07:00Z.
  const now = new Date("2026-09-20T12:00:00Z")
  assert.equal(
    siteClosedSince(site, now)?.toISOString(),
    "2026-09-20T07:00:00.000Z"
  )
  // Sunday has no hours, so the next opening is Monday 10:00 CDT.
  assert.equal(
    nextSiteOpenAt(site, now)?.toISOString(),
    "2026-09-21T15:00:00.000Z"
  )
  // Sunday evening is the same closed stretch, not a new one.
  assert.equal(
    siteClosedSince(site, new Date("2026-09-21T02:00:00Z"))?.toISOString(),
    "2026-09-20T07:00:00.000Z"
  )
})

test("a closed holiday does not start a second window", () => {
  // Thursday 2026-12-24 closes 22:00 CST = 04:00Z on the 25th; Friday is a holiday.
  const closedSince = siteClosedSince(site, new Date("2026-12-25T20:00:00Z"))
  assert.equal(closedSince?.toISOString(), "2026-12-25T04:00:00.000Z")
  // Saturday opens 10:00 CST = 16:00Z on the 26th.
  assert.equal(
    nextSiteOpenAt(site, new Date("2026-12-25T20:00:00Z"))?.toISOString(),
    "2026-12-26T16:00:00.000Z"
  )
})

test("open floor, missing hours, or missing timezone give no window", () => {
  assert.equal(siteClosedSince(site, new Date("2026-09-16T16:00:00Z")), null)
  assert.equal(nextSiteOpenAt(site, new Date("2026-09-16T16:00:00Z")), null)
  assert.equal(
    siteClosedSince(
      { timezone: chicago, businessHours: null },
      new Date("2026-09-17T04:30:00Z")
    ),
    null
  )
  assert.equal(
    siteClosedSince(
      { timezone: null, businessHours: hours },
      new Date("2026-09-17T04:30:00Z")
    ),
    null
  )
  assert.equal(siteClosedSince(null, new Date()), null)
})

test("site run starts only after the delay and with time left before open", () => {
  const closedSince = new Date("2026-09-17T03:00:00Z")
  const nextOpenAt = new Date("2026-09-17T15:00:00Z")
  const base = {
    enabled: true,
    siteOpen: false as boolean | null,
    closedSince,
    nextOpenAt,
    startAfterMinutes: 30,
  }
  assert.deepEqual(
    decideAfterHoursSiteStart({
      ...base,
      enabled: false,
      now: new Date("2026-09-17T04:00:00Z"),
    }),
    { kind: "disabled" }
  )
  assert.deepEqual(
    decideAfterHoursSiteStart({
      ...base,
      siteOpen: null,
      now: new Date("2026-09-17T04:00:00Z"),
    }),
    { kind: "no_schedule" }
  )
  assert.deepEqual(
    decideAfterHoursSiteStart({
      ...base,
      siteOpen: true,
      now: new Date("2026-09-17T04:00:00Z"),
    }),
    { kind: "open" }
  )
  assert.equal(
    decideAfterHoursSiteStart({
      ...base,
      now: new Date("2026-09-17T03:10:00Z"),
    }).kind,
    "not_yet"
  )
  assert.equal(
    decideAfterHoursSiteStart({
      ...base,
      now: new Date("2026-09-17T14:30:00Z"),
    }).kind,
    "too_close_to_open"
  )
  const start = decideAfterHoursSiteStart({
    ...base,
    now: new Date("2026-09-17T03:30:00Z"),
  })
  assert.equal(start.kind, "start")
  if (start.kind === "start") {
    assert.equal(start.windowKey, "2026-09-17T03:00:00.000Z")
  }
  assert.equal(
    decideAfterHoursSiteStart({
      ...base,
      startAfterMinutes: 0,
      now: closedSince,
    }).kind,
    "start"
  )
})

test("approval requests expire at the next opening when that comes first", () => {
  const defaultExpiry = new Date("2026-09-18T03:30:00Z")
  const opensAt = new Date("2026-09-17T15:00:00Z")
  assert.equal(afterHoursApprovalExpiresAt(defaultExpiry, opensAt), opensAt)
  assert.equal(
    afterHoursApprovalExpiresAt(defaultExpiry, new Date("2026-09-19T00:00Z")),
    defaultExpiry
  )
  assert.equal(afterHoursApprovalExpiresAt(defaultExpiry, null), defaultExpiry)
})

test("archived and unreachable devices are skipped for the night", () => {
  const now = new Date("2026-09-17T04:00:00Z")
  assert.deepEqual(
    afterHoursDeviceEligibility({
      archivedAt: new Date("2026-01-01T00:00:00Z"),
      status: "service_online",
      lastSeenAt: now,
      now,
    }),
    { eligible: false, reason: "device_archived" }
  )
  assert.deepEqual(
    afterHoursDeviceEligibility({
      archivedAt: null,
      status: "offline",
      lastSeenAt: new Date("2026-09-17T01:00:00Z"),
      now,
    }),
    { eligible: false, reason: "device_offline" }
  )
  assert.deepEqual(
    afterHoursDeviceEligibility({
      archivedAt: null,
      status: "revoked",
      lastSeenAt: now,
      now,
    }),
    { eligible: false, reason: "device_offline" }
  )
  assert.deepEqual(
    afterHoursDeviceEligibility({
      archivedAt: null,
      status: "enrolled",
      lastSeenAt: null,
      now,
    }),
    { eligible: false, reason: "device_offline" }
  )
  assert.deepEqual(
    afterHoursDeviceEligibility({
      archivedAt: null,
      status: "service_online",
      lastSeenAt: new Date(now.getTime() - 2 * 60 * 1000),
      now,
    }),
    { eligible: true }
  )
})

test("device steps run update first, then reboot once the update settles", () => {
  const now = new Date("2026-09-17T04:00:00Z")
  const eligible = { eligible: true as const }
  const offline = {
    eligible: false as const,
    reason: "device_offline" as const,
  }

  assert.deepEqual(
    decideAfterHoursDeviceStep({
      updateRun: null,
      rebootRun: null,
      eligibility: eligible,
      now,
    }),
    { kind: "enqueue", action: "update" }
  )
  assert.deepEqual(
    decideAfterHoursDeviceStep({
      updateRun: null,
      rebootRun: null,
      eligibility: offline,
      now,
    }),
    { kind: "skip", action: "update", reason: "device_offline" }
  )

  const pendingUpdate: AfterHoursStepRow = {
    status: "queued",
    skipReason: null,
    commandStatus: "pending",
    commandSentAt: null,
  }
  assert.deepEqual(
    decideAfterHoursDeviceStep({
      updateRun: pendingUpdate,
      rebootRun: null,
      eligibility: eligible,
      now,
    }),
    { kind: "wait" }
  )

  const sentRecently: AfterHoursStepRow = {
    ...pendingUpdate,
    commandStatus: "sent",
    commandSentAt: new Date(now.getTime() - 5 * 60 * 1000),
  }
  assert.deepEqual(
    decideAfterHoursDeviceStep({
      updateRun: sentRecently,
      rebootRun: null,
      eligibility: eligible,
      now,
    }),
    { kind: "wait" }
  )

  const sentLongAgo: AfterHoursStepRow = {
    ...pendingUpdate,
    commandStatus: "sent",
    commandSentAt: new Date(
      now.getTime() - (AFTER_HOURS_UPDATE_SETTLE_MINUTES + 1) * 60 * 1000
    ),
  }
  assert.deepEqual(
    decideAfterHoursDeviceStep({
      updateRun: sentLongAgo,
      rebootRun: null,
      eligibility: eligible,
      now,
    }),
    { kind: "enqueue", action: "reboot" }
  )

  const finishedUpdate: AfterHoursStepRow = {
    ...pendingUpdate,
    commandStatus: "succeeded",
  }
  assert.deepEqual(
    decideAfterHoursDeviceStep({
      updateRun: finishedUpdate,
      rebootRun: null,
      eligibility: eligible,
      now,
    }),
    { kind: "enqueue", action: "reboot" }
  )
  assert.deepEqual(
    decideAfterHoursDeviceStep({
      updateRun: { ...pendingUpdate, commandStatus: "failed" },
      rebootRun: null,
      eligibility: eligible,
      now,
    }),
    { kind: "enqueue", action: "reboot" }
  )
  assert.deepEqual(
    decideAfterHoursDeviceStep({
      updateRun: finishedUpdate,
      rebootRun: null,
      eligibility: offline,
      now,
    }),
    { kind: "wait" }
  )
  assert.deepEqual(
    decideAfterHoursDeviceStep({
      updateRun: finishedUpdate,
      rebootRun: { ...pendingUpdate, commandStatus: "pending" },
      eligibility: eligible,
      now,
    }),
    { kind: "done" }
  )
  assert.deepEqual(
    decideAfterHoursDeviceStep({
      updateRun: {
        status: "skipped",
        skipReason: "device_offline",
        commandStatus: null,
        commandSentAt: null,
      },
      rebootRun: null,
      eligibility: eligible,
      now,
    }),
    { kind: "done" }
  )
})

test("run summary and settlement reflect device outcomes", () => {
  const rows = [
    {
      deviceId: "a",
      action: "update",
      status: "queued" as const,
      skipReason: null,
      commandStatus: "succeeded" as const,
    },
    {
      deviceId: "a",
      action: "reboot",
      status: "queued" as const,
      skipReason: null,
      commandStatus: "succeeded" as const,
    },
    {
      deviceId: "b",
      action: "update",
      status: "skipped" as const,
      skipReason: "device_offline" as const,
      commandStatus: null,
    },
    {
      deviceId: "c",
      action: "update",
      status: "queued" as const,
      skipReason: null,
      commandStatus: "sent" as const,
    },
  ]
  assert.equal(afterHoursRunIsSettled(rows), false)
  assert.deepEqual(summarizeAfterHoursRun(rows, 1), {
    devices: 4,
    updated: 1,
    restarted: 1,
    skippedOffline: 1,
    skippedArchived: 1,
    cancelled: 0,
    notReached: 1,
  })

  const cancelled = rows.map((row) =>
    row.deviceId === "c" ? { ...row, status: "cancelled" as const } : row
  )
  assert.equal(afterHoursRunIsSettled(cancelled), true)
  assert.equal(summarizeAfterHoursRun(cancelled, 0).cancelled, 1)
  assert.equal(summarizeAfterHoursRun(cancelled, 0).notReached, 0)
  assert.equal(afterHoursRunIsSettled([]), true)
})

test("schedule input caps the delay and requires a site", () => {
  assert.equal(
    afterHoursScheduleInputSchema.safeParse({
      siteId: "8d6a7d0e-6a1c-4c7c-a5f2-3d5b8d0fd8c1",
      enabled: true,
      startAfterMinutes: 45,
    }).success,
    true
  )
  assert.equal(
    afterHoursScheduleInputSchema.safeParse({
      siteId: "8d6a7d0e-6a1c-4c7c-a5f2-3d5b8d0fd8c1",
      enabled: true,
      startAfterMinutes: 5000,
    }).success,
    false
  )
  assert.equal(
    afterHoursScheduleInputSchema.safeParse({ enabled: true }).success,
    false
  )
})
