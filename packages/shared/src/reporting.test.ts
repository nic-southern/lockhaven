import assert from "node:assert/strict"
import test from "node:test"

import {
  aggregateMttaMttr,
  computeDeviceUptimeForDay,
  isReportScheduleDue,
  previousCadenceRange,
  reportRangeLabel,
  toCsv,
  utcDayEnd,
  utcDayStart,
} from "./reporting"

const dayStart = utcDayStart(new Date("2026-09-10T15:00:00.000Z"))
const dayEnd = utcDayEnd(dayStart)

function sample(at: string, online: boolean) {
  return { sampledAt: new Date(at), online }
}

test("uptime is 100% when a device stays online all day", () => {
  const result = computeDeviceUptimeForDay({
    samples: [],
    dayStart,
    dayEnd,
    priorOnline: true,
  })
  assert.equal(result.onlineMs, 24 * 60 * 60 * 1000)
  assert.equal(result.observedMs, 24 * 60 * 60 * 1000)
  assert.equal(result.sampleCount, 0)
  assert.equal(result.uptimeRatio, 1)
})

test("uptime is 0% when a device stays offline all day", () => {
  const result = computeDeviceUptimeForDay({
    samples: [],
    dayStart,
    dayEnd,
    priorOnline: false,
  })
  assert.equal(result.onlineMs, 0)
  assert.equal(result.observedMs, 24 * 60 * 60 * 1000)
  assert.equal(result.uptimeRatio, 0)
})

test("uptime ignores time before the first sample when prior state is unknown", () => {
  const result = computeDeviceUptimeForDay({
    samples: [sample("2026-09-10T12:00:00.000Z", true)],
    dayStart,
    dayEnd,
    priorOnline: null,
  })
  assert.equal(result.sampleCount, 1)
  assert.equal(result.onlineMs, 12 * 60 * 60 * 1000)
  assert.equal(result.observedMs, 12 * 60 * 60 * 1000)
  assert.equal(result.uptimeRatio, 1)
})

test("uptime carries the last state across a mid-day gap", () => {
  const result = computeDeviceUptimeForDay({
    samples: [
      sample("2026-09-10T00:00:00.000Z", true),
      sample("2026-09-10T06:00:00.000Z", false),
      sample("2026-09-10T18:00:00.000Z", true),
    ],
    dayStart,
    dayEnd,
  })
  // 00–06 online, 06–18 offline, 18–24 online
  assert.equal(result.onlineMs, 12 * 60 * 60 * 1000)
  assert.equal(result.observedMs, 24 * 60 * 60 * 1000)
  assert.equal(result.sampleCount, 3)
  assert.equal(result.uptimeRatio, 0.5)
})

test("uptime clips a partial current day at asOf", () => {
  const result = computeDeviceUptimeForDay({
    samples: [sample("2026-09-10T00:00:00.000Z", true)],
    dayStart,
    dayEnd,
    asOf: new Date("2026-09-10T06:00:00.000Z"),
  })
  assert.equal(result.onlineMs, 6 * 60 * 60 * 1000)
  assert.equal(result.observedMs, 6 * 60 * 60 * 1000)
  assert.equal(result.uptimeRatio, 1)
})

test("uptime uses prior state until the first in-day sample", () => {
  const result = computeDeviceUptimeForDay({
    samples: [sample("2026-09-10T08:00:00.000Z", false)],
    dayStart,
    dayEnd,
    priorOnline: true,
  })
  // 00–08 online, 08–24 offline
  assert.equal(result.onlineMs, 8 * 60 * 60 * 1000)
  assert.equal(result.observedMs, 24 * 60 * 60 * 1000)
  assert.equal(result.uptimeRatio, 8 / 24)
})

test("uptime with no samples and no prior state is unobserved", () => {
  const result = computeDeviceUptimeForDay({
    samples: [],
    dayStart,
    dayEnd,
  })
  assert.deepEqual(result, {
    onlineMs: 0,
    observedMs: 0,
    sampleCount: 0,
    uptimeRatio: 0,
  })
})

test("MTTA and MTTR average acknowledged and resolved intervals", () => {
  const stats = aggregateMttaMttr([
    {
      firstSeenAt: new Date("2026-09-10T00:00:00.000Z"),
      acknowledgedAt: new Date("2026-09-10T00:10:00.000Z"),
      resolvedAt: new Date("2026-09-10T01:00:00.000Z"),
    },
    {
      firstSeenAt: new Date("2026-09-10T02:00:00.000Z"),
      acknowledgedAt: new Date("2026-09-10T02:20:00.000Z"),
      resolvedAt: new Date("2026-09-10T03:00:00.000Z"),
    },
    {
      firstSeenAt: new Date("2026-09-10T04:00:00.000Z"),
      acknowledgedAt: null,
      resolvedAt: null,
    },
  ])
  assert.equal(stats.count, 3)
  assert.equal(stats.acknowledgedCount, 2)
  assert.equal(stats.resolvedCount, 2)
  assert.equal(stats.mttaMs, 15 * 60 * 1000)
  assert.equal(stats.mttrMs, 60 * 60 * 1000)
})

test("MTTA and MTTR skip missing and negative intervals", () => {
  const stats = aggregateMttaMttr([
    {
      firstSeenAt: new Date("2026-09-10T01:00:00.000Z"),
      acknowledgedAt: new Date("2026-09-10T00:50:00.000Z"),
      resolvedAt: null,
    },
    {
      firstSeenAt: new Date("2026-09-10T01:00:00.000Z"),
      acknowledgedAt: null,
      resolvedAt: new Date("2026-09-10T01:30:00.000Z"),
    },
  ])
  assert.equal(stats.acknowledgedCount, 1)
  assert.equal(stats.resolvedCount, 1)
  assert.equal(stats.mttaMs, null)
  assert.equal(stats.mttrMs, 30 * 60 * 1000)
})

test("weekly cadence uses the previous Monday window", () => {
  const now = new Date("2026-09-16T12:00:00.000Z")
  const range = previousCadenceRange("weekly", now)
  assert.equal(range.from.toISOString(), "2026-09-07T00:00:00.000Z")
  assert.equal(range.to.toISOString(), "2026-09-14T00:00:00.000Z")
})

test("monthly cadence uses the previous calendar month", () => {
  const now = new Date("2026-09-16T12:00:00.000Z")
  const range = previousCadenceRange("monthly", now)
  assert.equal(range.from.toISOString(), "2026-08-01T00:00:00.000Z")
  assert.equal(range.to.toISOString(), "2026-09-01T00:00:00.000Z")
})

test("schedules wait until the next complete window after creation", () => {
  const now = new Date("2026-09-16T12:00:00.000Z")
  assert.equal(
    isReportScheduleDue({
      cadence: "weekly",
      enabled: true,
      createdAt: new Date("2026-09-15T00:00:00.000Z"),
      lastSentAt: null,
      now,
    }),
    false
  )
  assert.equal(
    isReportScheduleDue({
      cadence: "weekly",
      enabled: true,
      createdAt: new Date("2026-09-10T00:00:00.000Z"),
      lastSentAt: null,
      now,
    }),
    true
  )
  assert.equal(
    isReportScheduleDue({
      cadence: "weekly",
      enabled: true,
      createdAt: new Date("2026-09-10T00:00:00.000Z"),
      lastSentAt: new Date("2026-09-14T08:00:00.000Z"),
      now,
    }),
    false
  )
})

test("csv helper quotes commas and reports a range label", () => {
  const csv = toCsv(
    [{ name: "North, Site", value: 2 }],
    [
      { header: "Name", value: (row) => row.name },
      { header: "Value", value: (row) => row.value },
    ]
  )
  assert.equal(csv, 'Name,Value\r\n"North, Site",2\r\n')
  assert.equal(
    reportRangeLabel(
      new Date("2026-09-07T00:00:00.000Z"),
      new Date("2026-09-14T00:00:00.000Z")
    ),
    "2026-09-07 to 2026-09-13"
  )
})
