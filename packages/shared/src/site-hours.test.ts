import assert from "node:assert/strict"
import test from "node:test"

import type { SiteBusinessHours } from "./assets"
import {
  hasConfiguredSiteHours,
  isClosedHoursQuietKind,
  shouldHoldAlertForClosedHours,
  shouldSkipRaisingAlertForClosedHours,
  shouldSuppressNewAlert,
  shouldWaitForSiteClose,
  siteOpenLabel,
  siteOpenState,
} from "./site-hours"

const chicago = "America/Chicago"
const hours: SiteBusinessHours = {
  weekdays: { open: "10:00", close: "22:00" },
  saturday: { open: "10:00", close: "02:00" },
  sunday: null,
  holidays: [{ date: "2026-12-25", name: "Christmas" }],
}

test("unconfigured hours do not hold alerts or delay playbooks", () => {
  assert.equal(hasConfiguredSiteHours(null), false)
  assert.equal(hasConfiguredSiteHours({}), false)
  assert.equal(
    siteOpenState({ timezone: chicago, businessHours: null }, new Date()),
    null
  )
  assert.equal(shouldWaitForSiteClose("reboot", null), false)
  assert.equal(shouldHoldAlertForClosedHours("device_offline", null), false)
  assert.equal(siteOpenLabel(null), "Hours not set")
})

test("missing timezone does not invent a closed or open state", () => {
  assert.equal(
    siteOpenState({ timezone: null, businessHours: hours }, new Date()),
    null
  )
  assert.equal(
    siteOpenState(
      { timezone: "Not/AZone", businessHours: hours },
      new Date("2026-09-16T16:00:00Z")
    ),
    null
  )
})

test("weekday hours are open during the window and closed after close", () => {
  assert.equal(
    siteOpenState(
      { timezone: chicago, businessHours: hours },
      new Date("2026-09-16T16:00:00Z")
    ),
    true
  )
  assert.equal(
    siteOpenState(
      { timezone: chicago, businessHours: hours },
      new Date("2026-09-17T03:30:00Z")
    ),
    false
  )
  assert.equal(siteOpenLabel(true), "Open")
  assert.equal(siteOpenLabel(false), "Closed")
})

test("overnight Saturday hours stay open past midnight into Sunday", () => {
  assert.equal(
    siteOpenState(
      { timezone: chicago, businessHours: hours },
      new Date("2026-09-20T04:00:00Z")
    ),
    true
  )
  assert.equal(
    siteOpenState(
      { timezone: chicago, businessHours: hours },
      new Date("2026-09-20T06:30:00Z")
    ),
    true
  )
  assert.equal(
    siteOpenState(
      { timezone: chicago, businessHours: hours },
      new Date("2026-09-20T07:30:00Z")
    ),
    false
  )
})

test("a closed holiday wins from midnight over leftover overnight", () => {
  const christmasHours: SiteBusinessHours = {
    weekdays: { open: "10:00", close: "02:00" },
    holidays: [{ date: "2026-12-25", name: "Christmas", closed: true }],
  }
  assert.equal(
    siteOpenState(
      { timezone: chicago, businessHours: christmasHours },
      new Date("2026-12-25T07:30:00Z")
    ),
    false
  )
  assert.equal(
    siteOpenState(
      { timezone: chicago, businessHours: christmasHours },
      new Date("2026-12-25T20:00:00Z")
    ),
    false
  )
})

test("holiday special hours replace the weekly window for that date", () => {
  const special: SiteBusinessHours = {
    weekdays: { open: "10:00", close: "22:00" },
    holidays: [
      {
        date: "2026-12-24",
        name: "Christmas Eve",
        open: "10:00",
        close: "16:00",
      },
    ],
  }
  assert.equal(
    siteOpenState(
      { timezone: chicago, businessHours: special },
      new Date("2026-12-24T20:00:00Z")
    ),
    true
  )
  assert.equal(
    siteOpenState(
      { timezone: chicago, businessHours: special },
      new Date("2026-12-24T23:00:00Z")
    ),
    false
  )
})

test("holidays-only leaves other days open", () => {
  const holidaysOnly: SiteBusinessHours = {
    holidays: [{ date: "2026-12-25", closed: true }],
  }
  assert.equal(hasConfiguredSiteHours(holidaysOnly), true)
  assert.equal(
    siteOpenState(
      { timezone: chicago, businessHours: holidaysOnly },
      new Date("2026-09-16T16:00:00Z")
    ),
    true
  )
  assert.equal(
    siteOpenState(
      { timezone: chicago, businessHours: holidaysOnly },
      new Date("2026-12-25T20:00:00Z")
    ),
    false
  )
})

test("closed-hours quiet kinds match archive's offline/down list", () => {
  assert.equal(isClosedHoursQuietKind("device_offline"), true)
  assert.equal(isClosedHoursQuietKind("peer_flapping"), true)
  assert.equal(isClosedHoursQuietKind("archived_device_online"), false)
  assert.equal(isClosedHoursQuietKind("new_endpoint"), false)
})

test("closed hours skip opening offline alerts instead of suppressing them", () => {
  assert.equal(
    shouldSkipRaisingAlertForClosedHours("device_offline", false),
    true
  )
  assert.equal(
    shouldSkipRaisingAlertForClosedHours("archived_device_online", false),
    false
  )
  assert.equal(
    shouldSuppressNewAlert({
      kind: "device_offline",
      inMaintenanceWindow: false,
      siteOpen: false,
    }),
    false
  )
  assert.equal(
    shouldSuppressNewAlert({
      kind: "agent_outdated",
      inMaintenanceWindow: true,
      siteOpen: true,
    }),
    true
  )
})

test("reboot and update wait while open; restart does not", () => {
  assert.equal(shouldWaitForSiteClose("reboot", true), true)
  assert.equal(shouldWaitForSiteClose("update", true), true)
  assert.equal(shouldWaitForSiteClose("restart", true), false)
  assert.equal(shouldWaitForSiteClose("reboot", false), false)
  assert.equal(shouldWaitForSiteClose("reboot", null), false)
})
