import assert from "node:assert/strict"
import test from "node:test"

import {
  findActiveMaintenanceWindow,
  isMaintenanceWindowActive,
  pickEffectiveAlertPolicy,
  resolveEffectiveAlertPolicy,
  selectAlertsToEscalate,
  shouldAutoResolveConcentratorProbe,
  shouldEscalateAlert,
  fromZonedTime,
  type AlertPolicyFields,
  type EscalationCandidate,
  type MaintenanceWindowMatchInput,
} from "./alert-lifecycle"

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const SITE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const DEVICE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

function window(
  overrides: Partial<MaintenanceWindowMatchInput> &
    Pick<MaintenanceWindowMatchInput, "startsAt" | "endsAt">
): MaintenanceWindowMatchInput {
  return {
    organizationId: ORG,
    siteId: null,
    deviceId: null,
    timeZone: "UTC",
    recurrence: "none",
    ...overrides,
  }
}

function policy(
  overrides: Partial<AlertPolicyFields> & Pick<AlertPolicyFields, "kind">
): AlertPolicyFields {
  return {
    organizationId: ORG,
    siteId: null,
    enabled: true,
    severity: null,
    escalateAfterMinutes: null,
    thresholds: {},
    ...overrides,
  }
}

test("one-shot window matches the half-open start/end interval", () => {
  const w = window({
    startsAt: new Date("2026-09-16T19:00:00Z"),
    endsAt: new Date("2026-09-16T21:00:00Z"),
  })
  assert.equal(
    isMaintenanceWindowActive(w, new Date("2026-09-16T19:00:00Z")),
    true
  )
  assert.equal(
    isMaintenanceWindowActive(w, new Date("2026-09-16T20:30:00Z")),
    true
  )
  assert.equal(
    isMaintenanceWindowActive(w, new Date("2026-09-16T21:00:00Z")),
    false
  )
  assert.equal(
    isMaintenanceWindowActive(w, new Date("2026-09-16T18:59:59Z")),
    false
  )
})

test("weekly recurrence matches the same weekday and local time", () => {
  // First occurrence: Wednesday 14:00–16:00 in America/Chicago (UTC-5 in Sep).
  const w = window({
    startsAt: new Date("2026-09-16T19:00:00Z"),
    endsAt: new Date("2026-09-16T21:00:00Z"),
    timeZone: "America/Chicago",
    recurrence: "weekly",
  })
  assert.equal(
    isMaintenanceWindowActive(w, new Date("2026-09-16T20:00:00Z")),
    true,
    "first occurrence"
  )
  assert.equal(
    isMaintenanceWindowActive(w, new Date("2026-09-23T19:30:00Z")),
    true,
    "the following Wednesday"
  )
  assert.equal(
    isMaintenanceWindowActive(w, new Date("2026-09-23T21:00:00Z")),
    false,
    "end of the next occurrence is exclusive"
  )
  assert.equal(
    isMaintenanceWindowActive(w, new Date("2026-09-17T20:00:00Z")),
    false,
    "Thursday is a different weekday"
  )
  assert.equal(
    isMaintenanceWindowActive(w, new Date("2026-09-09T20:00:00Z")),
    false,
    "the week before the first start stays inactive"
  )
})

test("weekly matching is timezone-aware around a DST spring-forward", () => {
  // Sunday 10:00–12:00 America/Chicago, first occurrence 1 Mar 2026 (CST).
  const w = window({
    startsAt: new Date("2026-03-01T16:00:00Z"),
    endsAt: new Date("2026-03-01T18:00:00Z"),
    timeZone: "America/Chicago",
    recurrence: "weekly",
  })
  // 8 Mar 2026 is CDT (UTC-5). 10:30 local is 15:30 UTC.
  assert.equal(
    isMaintenanceWindowActive(w, new Date("2026-03-08T15:30:00Z")),
    true,
    "10:30 CDT is inside the weekly window"
  )
  assert.equal(
    isMaintenanceWindowActive(w, new Date("2026-03-08T17:00:00Z")),
    false,
    "12:00 CDT is the exclusive end"
  )
  assert.equal(
    isMaintenanceWindowActive(w, new Date("2026-03-08T16:30:00Z")),
    true,
    "11:30 CDT is still before noon"
  )
})

test("fromZonedTime converts a New York wall clock to UTC", () => {
  const instant = fromZonedTime(
    {
      year: 2026,
      month: 9,
      day: 16,
      hour: 9,
      minute: 0,
      second: 0,
    },
    "America/New_York"
  )
  assert.equal(instant.toISOString(), "2026-09-16T13:00:00.000Z")
})

test("window matching uses the target timezone, not UTC clock hour", () => {
  const w = window({
    startsAt: fromZonedTime(
      { year: 2026, month: 9, day: 16, hour: 9, minute: 0, second: 0 },
      "America/New_York"
    ),
    endsAt: fromZonedTime(
      { year: 2026, month: 9, day: 16, hour: 10, minute: 0, second: 0 },
      "America/New_York"
    ),
    timeZone: "America/New_York",
  })
  assert.equal(
    isMaintenanceWindowActive(w, new Date("2026-09-16T13:30:00Z")),
    true,
    "13:30 UTC is 09:30 in New York"
  )
  assert.equal(
    isMaintenanceWindowActive(w, new Date("2026-09-16T14:00:00Z")),
    false,
    "14:00 UTC is 10:00 in New York, the exclusive end"
  )
})

test("device windows beat site windows, which beat org windows", () => {
  const now = new Date("2026-09-16T20:00:00Z")
  const orgWindow = window({
    startsAt: new Date("2026-09-16T19:00:00Z"),
    endsAt: new Date("2026-09-16T21:00:00Z"),
  })
  const siteWindow = window({
    siteId: SITE,
    startsAt: new Date("2026-09-16T19:00:00Z"),
    endsAt: new Date("2026-09-16T21:00:00Z"),
  })
  const deviceWindow = window({
    siteId: SITE,
    deviceId: DEVICE,
    startsAt: new Date("2026-09-16T19:00:00Z"),
    endsAt: new Date("2026-09-16T21:00:00Z"),
  })
  const otherOrg = window({
    organizationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    startsAt: new Date("2026-09-16T19:00:00Z"),
    endsAt: new Date("2026-09-16T21:00:00Z"),
  })

  const picked = findActiveMaintenanceWindow(
    [orgWindow, siteWindow, deviceWindow, otherOrg],
    { organizationId: ORG, siteId: SITE, deviceId: DEVICE },
    now
  )
  assert.equal(picked, deviceWindow)

  const siteOnly = findActiveMaintenanceWindow(
    [orgWindow, siteWindow],
    { organizationId: ORG, siteId: SITE, deviceId: DEVICE },
    now
  )
  assert.equal(siteOnly, siteWindow)

  const orgWide = findActiveMaintenanceWindow(
    [orgWindow],
    { organizationId: ORG, siteId: SITE, deviceId: DEVICE },
    now
  )
  assert.equal(orgWide, orgWindow)

  const miss = findActiveMaintenanceWindow(
    [siteWindow],
    {
      organizationId: ORG,
      siteId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      deviceId: null,
    },
    now
  )
  assert.equal(miss, null)
})

test("policy precedence is site over org over defaults", () => {
  const defaults = resolveEffectiveAlertPolicy("device_offline", {})
  assert.equal(defaults.enabled, true)
  assert.equal(defaults.severity, "warning")
  assert.equal(defaults.escalateAfterMinutes, null)
  assert.equal(defaults.offlineHours, 24)
  assert.equal(defaults.source, "default")

  const org = policy({
    kind: "device_offline",
    enabled: true,
    severity: "critical",
    escalateAfterMinutes: 60,
    thresholds: { offlineHours: 8 },
  })
  const fromOrg = resolveEffectiveAlertPolicy("device_offline", {
    orgPolicy: org,
  })
  assert.equal(fromOrg.source, "org")
  assert.equal(fromOrg.severity, "critical")
  assert.equal(fromOrg.escalateAfterMinutes, 60)
  assert.equal(fromOrg.offlineHours, 8)

  const site = policy({
    kind: "device_offline",
    siteId: SITE,
    enabled: false,
    severity: "notice",
    escalateAfterMinutes: 15,
    thresholds: { offlineHours: 4 },
  })
  const fromSite = resolveEffectiveAlertPolicy("device_offline", {
    orgPolicy: org,
    sitePolicy: site,
  })
  assert.equal(fromSite.source, "site")
  assert.equal(fromSite.enabled, false)
  assert.equal(fromSite.severity, "notice")
  assert.equal(fromSite.escalateAfterMinutes, 15)
  assert.equal(fromSite.offlineHours, 4)
})

test("null site policy fields inherit from the org then defaults", () => {
  const org = policy({
    kind: "peer_flapping",
    severity: "critical",
    escalateAfterMinutes: 90,
  })
  const site = policy({
    kind: "peer_flapping",
    siteId: SITE,
    enabled: true,
    severity: null,
    escalateAfterMinutes: null,
    thresholds: {},
  })
  const effective = resolveEffectiveAlertPolicy("peer_flapping", {
    orgPolicy: org,
    sitePolicy: site,
  })
  assert.equal(effective.source, "site")
  assert.equal(effective.severity, "critical")
  assert.equal(effective.escalateAfterMinutes, 90)
  assert.equal(effective.enabled, true)
})

test("pickEffectiveAlertPolicy selects the matching org and site rows", () => {
  const rows = [
    policy({
      kind: "device_offline",
      severity: "notice",
      thresholds: { offlineHours: 12 },
    }),
    policy({
      kind: "device_offline",
      siteId: SITE,
      severity: "critical",
      thresholds: { offlineHours: 2 },
    }),
    policy({ kind: "peer_flapping", severity: "critical" }),
  ]
  const site = pickEffectiveAlertPolicy(rows, "device_offline", ORG, SITE)
  assert.equal(site.source, "site")
  assert.equal(site.offlineHours, 2)
  assert.equal(site.severity, "critical")

  const otherSite = pickEffectiveAlertPolicy(
    rows,
    "device_offline",
    ORG,
    "ffffffff-ffff-4fff-8fff-ffffffffffff"
  )
  assert.equal(otherSite.source, "org")
  assert.equal(otherSite.offlineHours, 12)

  const noOrg = pickEffectiveAlertPolicy(rows, "device_offline", null, SITE)
  assert.equal(noOrg.source, "default")
  assert.equal(noOrg.offlineHours, 24)
})

function candidate(
  overrides: Partial<EscalationCandidate> = {}
): EscalationCandidate {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    kind: "device_offline",
    status: "open",
    organizationId: ORG,
    siteId: SITE,
    firstSeenAt: new Date("2026-09-16T12:00:00Z"),
    snoozedUntil: null,
    escalatedAt: null,
    ...overrides,
  }
}

test("escalation selection only includes open, unsnoozed, due alerts", () => {
  const now = new Date("2026-09-16T13:10:00Z")
  const policyFor = () =>
    resolveEffectiveAlertPolicy("device_offline", {
      orgPolicy: policy({
        kind: "device_offline",
        escalateAfterMinutes: 60,
      }),
    })

  const due = candidate()
  const snoozed = candidate({
    id: "22222222-2222-4222-8211-222222222222",
    snoozedUntil: new Date("2026-09-16T18:00:00Z"),
  })
  const acknowledged = candidate({
    id: "33333333-3333-4333-8311-333333333333",
    status: "acknowledged",
  })
  const suppressed = candidate({
    id: "44444444-4444-4444-8411-444444444444",
    status: "suppressed",
  })
  const already = candidate({
    id: "55555555-5555-4555-8511-555555555555",
    escalatedAt: new Date("2026-09-16T13:00:00Z"),
  })
  const tooNew = candidate({
    id: "66666666-6666-4666-8611-666666666666",
    firstSeenAt: new Date("2026-09-16T12:30:00Z"),
  })

  const selected = selectAlertsToEscalate(
    [due, snoozed, acknowledged, suppressed, already, tooNew],
    policyFor,
    now
  )
  assert.deepEqual(
    selected.map((row) => row.id),
    [due.id]
  )
})

test("alerts without an escalate-after policy are not selected", () => {
  const now = new Date("2026-09-16T18:00:00Z")
  assert.equal(
    shouldEscalateAlert(
      candidate(),
      resolveEffectiveAlertPolicy("device_offline", {}),
      now
    ),
    false
  )
})

test("concentrator probes auto-resolve after 24 hours quiet", () => {
  const now = new Date("2026-09-17T12:00:00Z")
  assert.equal(
    shouldAutoResolveConcentratorProbe(
      {
        kind: "concentrator_probe",
        status: "open",
        lastSeenAt: new Date("2026-09-16T12:00:00Z"),
      },
      now
    ),
    true
  )
  assert.equal(
    shouldAutoResolveConcentratorProbe(
      {
        kind: "concentrator_probe",
        status: "open",
        lastSeenAt: new Date("2026-09-16T12:00:01Z"),
      },
      now
    ),
    false
  )
  assert.equal(
    shouldAutoResolveConcentratorProbe(
      {
        kind: "device_offline",
        status: "open",
        lastSeenAt: new Date("2026-09-15T12:00:00Z"),
      },
      now
    ),
    false
  )
})
