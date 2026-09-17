import { getZonedParts, isValidTimeZone } from "./alert-lifecycle"
import type { SiteBusinessHours, SiteHoliday } from "./assets"
import type { AlertKind } from "./events"
import { isPlaybookAction, type PlaybookAction } from "./playbooks"

export type HoursWindow = {
  open: string
  close: string
}

/** Offline/down kinds that stay quiet while the floor is closed. */
export const closedHoursQuietAlertKinds = [
  "device_offline",
  "peer_flapping",
] as const satisfies readonly AlertKind[]

export type ClosedHoursQuietAlertKind =
  (typeof closedHoursQuietAlertKinds)[number]

/** Playbook actions that wait until the location is closed. */
export const venueHeldPlaybookActions = [
  "reboot",
  "update",
] as const satisfies readonly PlaybookAction[]

function pad2(value: number) {
  return String(value).padStart(2, "0")
}

function minutesFromTime(value: string) {
  const [hourText, minuteText] = value.split(":")
  const hour = Number(hourText)
  const minute = Number(minuteText)
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null
  }
  return hour * 60 + minute
}

function isWithinWindow(window: HoursWindow, hour: number, minute: number) {
  const open = minutesFromTime(window.open)
  const close = minutesFromTime(window.close)
  if (open == null || close == null) return false
  const now = hour * 60 + minute
  if (open === close) return true
  if (close > open) return now >= open && now < close
  return now >= open || now < close
}

function isOvernightWindow(window: HoursWindow) {
  const open = minutesFromTime(window.open)
  const close = minutesFromTime(window.close)
  if (open == null || close == null) return false
  return close < open
}

function calendarDateKey(year: number, month: number, day: number) {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

function shiftCalendarDate(
  year: number,
  month: number,
  day: number,
  deltaDays: number
) {
  const utc = Date.UTC(year, month - 1, day + deltaDays)
  const date = new Date(utc)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  }
}

function holidayForDate(
  holidays: SiteHoliday[] | undefined,
  dateKey: string
): SiteHoliday | null {
  if (!holidays?.length) return null
  const matches = holidays.filter((holiday) => holiday.date === dateKey)
  return matches[matches.length - 1] ?? null
}

function weeklyWindowForWeekday(
  hours: SiteBusinessHours,
  weekday: number
): HoursWindow | null {
  if (weekday === 0) return hours.sunday ?? null
  if (weekday === 6) return hours.saturday ?? null
  return hours.weekdays ?? null
}

function windowFromHoliday(holiday: SiteHoliday): HoursWindow | null {
  if (holiday.closed) return null
  if (holiday.open && holiday.close) {
    return { open: holiday.open, close: holiday.close }
  }
  return null
}

function windowForCalendarDate(
  hours: SiteBusinessHours,
  year: number,
  month: number,
  day: number,
  weekday: number
): { window: HoursWindow | null; holiday: boolean } {
  const dateKey = calendarDateKey(year, month, day)
  const holiday = holidayForDate(hours.holidays, dateKey)
  if (holiday) {
    return { window: windowFromHoliday(holiday), holiday: true }
  }
  return { window: weeklyWindowForWeekday(hours, weekday), holiday: false }
}

function hasWeeklyWindows(hours: SiteBusinessHours) {
  return Boolean(hours.weekdays || hours.saturday || hours.sunday)
}

function hasHolidayRows(hours: SiteBusinessHours) {
  return Boolean(hours.holidays && hours.holidays.length > 0)
}

export function siteHoursHaveContent(
  hours: SiteBusinessHours | null | undefined
) {
  if (!hours) return false
  return hasWeeklyWindows(hours) || hasHolidayRows(hours)
}

/**
 * A site only follows venue hours when it has open/close (or holidays)
 * and a valid timezone. Missing hours keep current Hub behavior.
 */
export function siteHasVenueHours(
  hours: SiteBusinessHours | null | undefined,
  timeZone: string | null | undefined
) {
  if (!siteHoursHaveContent(hours)) return false
  if (!timeZone || !isValidTimeZone(timeZone)) return false
  return true
}

export function isSiteFloorOpen(args: {
  hours: SiteBusinessHours | null | undefined
  timeZone: string | null | undefined
  now: Date
}) {
  if (!siteHasVenueHours(args.hours, args.timeZone) || !args.hours) {
    return true
  }
  const timeZone = args.timeZone as string
  const parts = getZonedParts(args.now, timeZone)
  const today = windowForCalendarDate(
    args.hours,
    parts.year,
    parts.month,
    parts.day,
    parts.weekday
  )
  if (today.holiday) {
    return Boolean(
      today.window && isWithinWindow(today.window, parts.hour, parts.minute)
    )
  }
  if (today.window && isWithinWindow(today.window, parts.hour, parts.minute)) {
    return true
  }

  const yesterdayDate = shiftCalendarDate(
    parts.year,
    parts.month,
    parts.day,
    -1
  )
  const yesterdayWeekday = (parts.weekday + 6) % 7
  const yesterday = windowForCalendarDate(
    args.hours,
    yesterdayDate.year,
    yesterdayDate.month,
    yesterdayDate.day,
    yesterdayWeekday
  )
  if (
    !yesterday.holiday &&
    yesterday.window &&
    isOvernightWindow(yesterday.window) &&
    isWithinWindow(yesterday.window, parts.hour, parts.minute)
  ) {
    return true
  }

  return !hasWeeklyWindows(args.hours)
}

export function shouldSkipClosedHoursAlert(args: {
  kind: AlertKind
  hours: SiteBusinessHours | null | undefined
  timeZone: string | null | undefined
  now: Date
}) {
  if (!siteHasVenueHours(args.hours, args.timeZone)) return false
  if (isSiteFloorOpen(args)) return false
  return (closedHoursQuietAlertKinds as readonly string[]).includes(args.kind)
}

export function isVenueHeldPlaybookAction(
  action: string | null | undefined
): boolean {
  if (!action || !isPlaybookAction(action)) return false
  return (venueHeldPlaybookActions as readonly string[]).includes(action)
}

export function shouldHoldPlaybookForVenueHours(args: {
  action: string
  hours: SiteBusinessHours | null | undefined
  timeZone: string | null | undefined
  now: Date
}) {
  if (!isVenueHeldPlaybookAction(args.action)) return false
  if (!siteHasVenueHours(args.hours, args.timeZone)) return false
  return isSiteFloorOpen(args)
}

export function venueFloorLabel(args: {
  hours: SiteBusinessHours | null | undefined
  timeZone: string | null | undefined
  now?: Date
}): "open" | "closed" | "none" {
  if (!siteHasVenueHours(args.hours, args.timeZone)) return "none"
  return isSiteFloorOpen({
    hours: args.hours,
    timeZone: args.timeZone,
    now: args.now ?? new Date(),
  })
    ? "open"
    : "closed"
}
