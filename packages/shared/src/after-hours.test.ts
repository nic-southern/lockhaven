import assert from "node:assert/strict"
import test from "node:test"

import {
  AFTER_HOURS_DEFAULT_STEPS,
  afterHoursStepsSchema,
  decideAfterHoursRun,
  inPlannedRebootGrace,
  plannedRebootGraceUntil,
  sanitizeAfterHoursSteps,
  selectAfterHoursDevices,
  type AfterHoursDeviceCandidate,
  type AfterHoursSiteFields,
} from "./after-hours"

// Chicago venue open 10:00–22:00 weekdays; 2026-09-16 is a Wednesday.
const site: AfterHoursSiteFields = {
  timezone: "America/Chicago",
  businessHours: {
    weekdays: { open: "10:00", close: "22:00" },
    holidays: [{ date: "2026-09-17", name: "Closed", closed: true }],
  },
  afterHoursEnabled: true,
  afterHoursSteps: ["update", "reboot"],
}

// 21:59 and 22:00 Chicago (CDT, UTC-5) on 2026-09-16.
const justBeforeClose = new Date("2026-09-17T02:59:00.000Z")
const atClose = new Date("2026-09-17T03:00:00.000Z")
const laterThatNight = new Date("2026-09-17T05:00:00.000Z")
// Midday on the all-day-closed holiday 2026-09-17.
const holidayNoon = new Date("2026-09-17T17:00:00.000Z")

test("fires once on the open→closed transition", () => {
  assert.equal(
    decideAfterHoursRun({
      site,
      previousOpen: true,
      lastRunAt: null,
      now: justBeforeClose,
    }).kind,
    "idle"
  )
  const decision = decideAfterHoursRun({
    site,
    previousOpen: true,
    lastRunAt: null,
    now: atClose,
  })
  assert.equal(decision.kind, "fire")
  if (decision.kind === "fire") {
    assert.deepEqual(decision.steps, ["update", "reboot"])
  }

  // Next tick: already closed, already ran.
  const again = decideAfterHoursRun({
    site,
    previousOpen: false,
    lastRunAt: atClose,
    now: laterThatNight,
  })
  assert.equal(again.kind, "idle")
  if (again.kind === "idle") assert.equal(again.reason, "still_closed")
})

test("does not fire during open hours or on an all-day holiday", () => {
  const open = decideAfterHoursRun({
    site,
    previousOpen: false,
    lastRunAt: null,
    now: new Date("2026-09-16T18:00:00.000Z"),
  })
  assert.equal(open.kind, "idle")
  if (open.kind === "idle") assert.equal(open.reason, "still_open")

  const holiday = decideAfterHoursRun({
    site,
    previousOpen: false,
    lastRunAt: atClose,
    now: holidayNoon,
  })
  assert.equal(holiday.kind, "idle")
  if (holiday.kind === "idle") assert.equal(holiday.reason, "still_closed")
})

test("waits for a previous observation instead of firing on first sight", () => {
  const first = decideAfterHoursRun({
    site,
    previousOpen: null,
    lastRunAt: null,
    now: atClose,
  })
  assert.equal(first.kind, "idle")
  if (first.kind === "idle") assert.equal(first.reason, "no_previous_state")
})

test("treats a second close inside the minimum interval as the same close", () => {
  const decision = decideAfterHoursRun({
    site,
    previousOpen: true,
    lastRunAt: new Date(atClose.getTime() - 30 * 60 * 1000),
    now: atClose,
  })
  assert.equal(decision.kind, "idle")
  if (decision.kind === "idle") assert.equal(decision.reason, "just_ran")
})

test("respects opt-in, configured steps, and configured hours", () => {
  const optedOut = decideAfterHoursRun({
    site: { ...site, afterHoursEnabled: false },
    previousOpen: true,
    lastRunAt: null,
    now: atClose,
  })
  assert.equal(optedOut.kind, "idle")
  if (optedOut.kind === "idle") assert.equal(optedOut.reason, "opted_out")

  const noSteps = decideAfterHoursRun({
    site: { ...site, afterHoursSteps: ["ssh", "shell"] },
    previousOpen: true,
    lastRunAt: null,
    now: atClose,
  })
  assert.equal(noSteps.kind, "idle")
  if (noSteps.kind === "idle") assert.equal(noSteps.reason, "no_steps")

  const noHours = decideAfterHoursRun({
    site: { ...site, businessHours: null },
    previousOpen: true,
    lastRunAt: null,
    now: atClose,
  })
  assert.equal(noHours.kind, "idle")
  if (noHours.kind === "idle") assert.equal(noHours.reason, "hours_not_set")
})

test("steps are the closed whitelist only, in order, without repeats", () => {
  assert.deepEqual([...AFTER_HOURS_DEFAULT_STEPS], ["update", "reboot"])
  assert.deepEqual(
    sanitizeAfterHoursSteps(["reboot", "update", "reboot", "ssh", "rm -rf /"]),
    ["reboot", "update"]
  )
  assert.deepEqual(sanitizeAfterHoursSteps(["shell", "script"]), [])
  assert.deepEqual(sanitizeAfterHoursSteps(null), [])
  assert.deepEqual(sanitizeAfterHoursSteps([1, null, "update"]), ["update"])

  assert.deepEqual(afterHoursStepsSchema.parse(["update", "reboot"]), [
    "update",
    "reboot",
  ])
  assert.equal(afterHoursStepsSchema.safeParse(["ssh"]).success, false)
  assert.equal(
    afterHoursStepsSchema.safeParse(["update", "reboot", "restart", "update"])
      .success,
    false
  )
})

function device(
  overrides: Partial<AfterHoursDeviceCandidate>
): AfterHoursDeviceCandidate {
  return {
    id: overrides.id ?? "device",
    displayName: "Lane 1",
    hostname: "lane-1",
    status: "vpn_online",
    archivedAt: null,
    lastSeenAt: atClose,
    lastHandshakeAt: null,
    revokedAt: null,
    ...overrides,
  }
}

test("skips archived, offline, revoked, and unenrolled devices", () => {
  const stale = new Date(atClose.getTime() - 60 * 60 * 1000)
  const selection = selectAfterHoursDevices(
    [
      device({ id: "online" }),
      device({
        id: "handshake-only",
        lastSeenAt: null,
        lastHandshakeAt: new Date(atClose.getTime() - 60_000),
      }),
      device({ id: "archived", archivedAt: stale }),
      device({ id: "offline", lastSeenAt: stale, status: "offline" }),
      device({ id: "never", lastSeenAt: null, status: "enrolled" }),
      device({ id: "revoked", revokedAt: stale }),
      device({ id: "pending", status: "pending" }),
    ],
    atClose
  )
  assert.deepEqual(
    selection.eligible.map((entry) => entry.id),
    ["online", "handshake-only"]
  )
  assert.deepEqual(
    selection.skipped.map((entry) => [entry.device.id, entry.outcome]),
    [
      ["archived", "archived"],
      ["offline", "offline"],
      ["never", "offline"],
      ["revoked", "revoked"],
      ["pending", "not_enrolled"],
    ]
  )
})

test("planned restart opens a short grace window for offline and flap", () => {
  const sentAt = new Date("2026-09-17T03:01:00.000Z")
  const commands = [
    { kind: "reboot", status: "sent", sentAt, completedAt: null },
    { kind: "update", status: "sent", sentAt, completedAt: null },
  ]
  assert.equal(
    inPlannedRebootGrace(commands, new Date(sentAt.getTime() + 5 * 60_000)),
    true
  )
  assert.equal(
    plannedRebootGraceUntil(commands, sentAt)?.toISOString(),
    "2026-09-17T03:21:00.000Z"
  )
  assert.equal(
    inPlannedRebootGrace(commands, new Date(sentAt.getTime() + 25 * 60_000)),
    false
  )
  // Waiting, failed, and refused restarts never happened.
  assert.equal(
    inPlannedRebootGrace(
      [
        { kind: "reboot", status: "pending", sentAt: null, completedAt: null },
        { kind: "reboot", status: "failed", sentAt, completedAt: sentAt },
        { kind: "reboot", status: "refused", sentAt, completedAt: sentAt },
        { kind: "restart", status: "sent", sentAt, completedAt: null },
      ],
      sentAt
    ),
    false
  )
})
