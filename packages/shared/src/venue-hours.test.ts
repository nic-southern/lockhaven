import assert from "node:assert/strict"
import test from "node:test"

import {
  isSiteFloorOpen,
  isVenueHeldPlaybookAction,
  shouldHoldPlaybookForVenueHours,
  shouldSkipClosedHoursAlert,
  siteHasVenueHours,
  venueFloorLabel,
} from "./venue-hours"

const chicago = "America/Chicago"
const weekdayHours = {
  weekdays: { open: "10:00", close: "22:00" },
}

// Wednesday 16 Sep 2026 15:00 CDT = 20:00 UTC
const wednesdayAfternoon = new Date("2026-09-16T20:00:00.000Z")
// Wednesday 16 Sep 2026 23:00 CDT = 2026-09-17T04:00:00Z
const wednesdayNight = new Date("2026-09-17T04:00:00.000Z")
// Saturday 12 Sep 2026 15:00 CDT
const saturdayAfternoon = new Date("2026-09-12T20:00:00.000Z")
// Friday 18 Sep 2026 23:30 CDT (overnight into Saturday)
const fridayLate = new Date("2026-09-19T04:30:00.000Z")
// Saturday 19 Sep 2026 01:30 CDT (Friday overnight spill)
const saturdayEarly = new Date("2026-09-19T06:30:00.000Z")

test("missing hours or timezone do not follow a venue schedule", () => {
  assert.equal(siteHasVenueHours(null, chicago), false)
  assert.equal(siteHasVenueHours(weekdayHours, null), false)
  assert.equal(siteHasVenueHours(weekdayHours, "Not/AZone"), false)
  assert.equal(siteHasVenueHours({}, chicago), false)
  assert.equal(
    isSiteFloorOpen({
      hours: weekdayHours,
      timeZone: null,
      now: wednesdayAfternoon,
    }),
    true
  )
  assert.equal(venueFloorLabel({ hours: weekdayHours, timeZone: null }), "none")
})

test("weekdays are open during listed hours and closed after close", () => {
  assert.equal(
    isSiteFloorOpen({
      hours: weekdayHours,
      timeZone: chicago,
      now: wednesdayAfternoon,
    }),
    true
  )
  assert.equal(
    isSiteFloorOpen({
      hours: weekdayHours,
      timeZone: chicago,
      now: wednesdayNight,
    }),
    false
  )
  assert.equal(
    venueFloorLabel({
      hours: weekdayHours,
      timeZone: chicago,
      now: wednesdayAfternoon,
    }),
    "open"
  )
  assert.equal(
    venueFloorLabel({
      hours: weekdayHours,
      timeZone: chicago,
      now: wednesdayNight,
    }),
    "closed"
  )
})

test("a day with no window is closed when weekly hours exist", () => {
  assert.equal(
    isSiteFloorOpen({
      hours: weekdayHours,
      timeZone: chicago,
      now: saturdayAfternoon,
    }),
    false
  )
  assert.equal(
    isSiteFloorOpen({
      hours: {
        ...weekdayHours,
        saturday: { open: "12:00", close: "18:00" },
      },
      timeZone: chicago,
      now: saturdayAfternoon,
    }),
    true
  )
})

test("overnight hours spill into the next morning unless that date is a holiday", () => {
  const overnight = {
    weekdays: { open: "10:00", close: "02:00" },
  }
  assert.equal(
    isSiteFloorOpen({
      hours: overnight,
      timeZone: chicago,
      now: fridayLate,
    }),
    true
  )
  assert.equal(
    isSiteFloorOpen({
      hours: overnight,
      timeZone: chicago,
      now: saturdayEarly,
    }),
    true
  )
  assert.equal(
    isSiteFloorOpen({
      hours: {
        ...overnight,
        holidays: [{ date: "2026-09-19", closed: true }],
      },
      timeZone: chicago,
      now: saturdayEarly,
    }),
    false
  )
})

test("holidays can close the floor or use special hours", () => {
  const hours = {
    weekdays: { open: "10:00", close: "22:00" },
    holidays: [
      { date: "2026-09-16", closed: true as const },
      { date: "2026-09-18", open: "12:00", close: "16:00" },
    ],
  }
  assert.equal(
    isSiteFloorOpen({
      hours,
      timeZone: chicago,
      now: wednesdayAfternoon,
    }),
    false
  )
  // Friday 18 Sep 2026 15:00 CDT = 20:00 UTC — special hours 12–16
  assert.equal(
    isSiteFloorOpen({
      hours,
      timeZone: chicago,
      now: new Date("2026-09-18T20:00:00.000Z"),
    }),
    true
  )
  // Friday 18 Sep 2026 17:00 CDT = 22:00 UTC — after special close
  assert.equal(
    isSiteFloorOpen({
      hours,
      timeZone: chicago,
      now: new Date("2026-09-18T22:00:00.000Z"),
    }),
    false
  )
})

test("holidays-only schedules leave other days open", () => {
  const hours = {
    holidays: [{ date: "2026-09-16", closed: true as const }],
  }
  assert.equal(siteHasVenueHours(hours, chicago), true)
  assert.equal(
    isSiteFloorOpen({
      hours,
      timeZone: chicago,
      now: wednesdayAfternoon,
    }),
    false
  )
  assert.equal(
    isSiteFloorOpen({
      hours,
      timeZone: chicago,
      now: saturdayAfternoon,
    }),
    true
  )
})

test("offline and flap stay quiet only while a scheduled floor is closed", () => {
  const closed = {
    hours: weekdayHours,
    timeZone: chicago,
    now: wednesdayNight,
  }
  const open = {
    hours: weekdayHours,
    timeZone: chicago,
    now: wednesdayAfternoon,
  }
  assert.equal(
    shouldSkipClosedHoursAlert({ kind: "device_offline", ...closed }),
    true
  )
  assert.equal(
    shouldSkipClosedHoursAlert({ kind: "peer_flapping", ...closed }),
    true
  )
  assert.equal(
    shouldSkipClosedHoursAlert({ kind: "new_endpoint", ...closed }),
    false
  )
  assert.equal(
    shouldSkipClosedHoursAlert({
      kind: "archived_device_online",
      ...closed,
    }),
    false
  )
  assert.equal(
    shouldSkipClosedHoursAlert({ kind: "device_offline", ...open }),
    false
  )
  assert.equal(
    shouldSkipClosedHoursAlert({
      kind: "device_offline",
      hours: null,
      timeZone: chicago,
      now: wednesdayNight,
    }),
    false
  )
})

test("reboot and update wait until close; agent restart does not", () => {
  assert.equal(isVenueHeldPlaybookAction("reboot"), true)
  assert.equal(isVenueHeldPlaybookAction("update"), true)
  assert.equal(isVenueHeldPlaybookAction("restart"), false)
  assert.equal(isVenueHeldPlaybookAction("ssh"), false)

  const open = {
    hours: weekdayHours,
    timeZone: chicago,
    now: wednesdayAfternoon,
  }
  const closed = {
    hours: weekdayHours,
    timeZone: chicago,
    now: wednesdayNight,
  }
  assert.equal(
    shouldHoldPlaybookForVenueHours({ action: "reboot", ...open }),
    true
  )
  assert.equal(
    shouldHoldPlaybookForVenueHours({ action: "update", ...open }),
    true
  )
  assert.equal(
    shouldHoldPlaybookForVenueHours({ action: "restart", ...open }),
    false
  )
  assert.equal(
    shouldHoldPlaybookForVenueHours({ action: "reboot", ...closed }),
    false
  )
  assert.equal(
    shouldHoldPlaybookForVenueHours({
      action: "reboot",
      hours: null,
      timeZone: chicago,
      now: wednesdayAfternoon,
    }),
    false
  )
})
