import { isValidTimeZone, zonedParts } from "./alert-lifecycle"
import type { SiteBusinessHours, SiteHoliday } from "./assets"
import type { AlertKind } from "./events"

/**
 * Offline/down kinds that must stay quiet while a venue is closed.
 * Same list archive uses for warehoused devices. Other kinds, including
 * archived-device-online and disk-full, still page.
 */
export const quietOfflineAlertKinds = [
  "device_offline",
  "peer_flapping",
  "agent_stale",
] as const satisfies readonly AlertKind[]

export type QuietOfflineAlertKind = (typeof quietOfflineAlertKinds)[number]

/** Playbooks that wait until the floor is closed. Agent restart is not held. */
export const playbookActionsWaitingForClose = ["reboot", "update"] as const

export type SiteHoursWindow = {
  open: string
  close: string
}

export type SiteHoursFields = {
  timezone?: string | null
  businessHours?: SiteBusinessHours | null
}

function windowKeyForWeekday(
  weekday: number
): "weekdays" | "saturday" | "sunday" {
  if (weekday === 0) return "sunday"
  if (weekday === 6) return "saturday"
  return "weekdays"
}

function asHoursWindow(
  window: { open?: string | null; close?: string | null } | null | undefined
): SiteHoursWindow | null {
  if (!window?.open || !window.close) return null
  if (parseMinutes(window.open) == null || parseMinutes(window.close) == null) {
    return null
  }
  return { open: window.open, close: window.close }
}

function windowForWeekday(
  hours: SiteBusinessHours,
  weekday: number
): SiteHoursWindow | null {
  return asHoursWindow(hours[windowKeyForWeekday(weekday)])
}

function parseMinutes(value: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim())
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function isOvernightWindow(window: SiteHoursWindow) {
  const open = parseMinutes(window.open)
  const close = parseMinutes(window.close)
  if (open == null || close == null) return false
  return close < open
}

function isTwentyFourHourWindow(window: SiteHoursWindow) {
  const open = parseMinutes(window.open)
  const close = parseMinutes(window.close)
  return open != null && close != null && open === close
}

function windowCoversMinutes(window: SiteHoursWindow, minutes: number) {
  const open = parseMinutes(window.open)
  const close = parseMinutes(window.close)
  if (open == null || close == null) return false
  if (open === close) return true
  if (close > open) {
    return minutes >= open && minutes < close
  }
  return minutes >= open || minutes < close
}

function calendarDateKey(parts: { year: number; month: number; day: number }) {
  const month = String(parts.month).padStart(2, "0")
  const day = String(parts.day).padStart(2, "0")
  return `${parts.year}-${month}-${day}`
}

function addLocalDays(
  parts: { year: number; month: number; day: number },
  days: number
) {
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day + days)
  const date = new Date(utc)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  }
}

function holidayOnDate(
  holidays: SiteHoliday[] | undefined,
  dateKey: string
): SiteHoliday | undefined {
  return holidays?.find((holiday) => holiday.date === dateKey)
}

function holidayClosedAllDay(holiday: SiteHoliday) {
  if (holiday.closed) return true
  return !holiday.open || !holiday.close
}

export function hasWeeklySiteHours(
  hours: SiteBusinessHours | null | undefined
) {
  if (!hours) return false
  return Boolean(hours.weekdays || hours.saturday || hours.sunday)
}

export function hasConfiguredSiteHours(
  hours: SiteBusinessHours | null | undefined
) {
  if (!hours) return false
  return hasWeeklySiteHours(hours) || Boolean(hours.holidays?.length)
}

export function isClosedHoursQuietKind(
  kind: AlertKind
): kind is QuietOfflineAlertKind {
  return (quietOfflineAlertKinds as readonly string[]).includes(kind)
}

/**
 * Whether the site is open at `now`.
 * `true` open, `false` closed, `null` when hours are not configured (or the
 * timezone is missing/invalid). Unconfigured hours do not hold alerts or
 * delay playbooks.
 */
export function siteOpenState(
  site: SiteHoursFields | null | undefined,
  now: Date
): boolean | null {
  const hours = site?.businessHours ?? null
  if (!hasConfiguredSiteHours(hours) || !hours) return null
  const timeZone = site?.timezone?.trim() ?? ""
  if (!isValidTimeZone(timeZone)) return null

  const parts = zonedParts(now, timeZone)
  const todayKey = calendarDateKey(parts)
  const minutes = parts.hour * 60 + parts.minute
  const todayHoliday = holidayOnDate(hours.holidays, todayKey)

  if (todayHoliday) {
    if (holidayClosedAllDay(todayHoliday)) return false
    const special = asHoursWindow(todayHoliday)
    if (!special) return false
    return windowCoversMinutes(special, minutes)
  }

  const hasWeekly = hasWeeklySiteHours(hours)
  if (!hasWeekly) {
    return true
  }

  const yesterdayParts = addLocalDays(parts, -1)
  const yesterdayKey = calendarDateKey(yesterdayParts)
  const yesterdayHoliday = holidayOnDate(hours.holidays, yesterdayKey)
  const yesterdayWeekday = (parts.weekday + 6) % 7
  const yesterdayWindow = yesterdayHoliday
    ? holidayClosedAllDay(yesterdayHoliday)
      ? null
      : asHoursWindow(yesterdayHoliday)
    : windowForWeekday(hours, yesterdayWeekday)

  if (
    yesterdayWindow &&
    isOvernightWindow(yesterdayWindow) &&
    minutes < (parseMinutes(yesterdayWindow.close) ?? 0)
  ) {
    return true
  }

  const todayWindow = windowForWeekday(hours, parts.weekday)
  if (!todayWindow) return false
  if (isTwentyFourHourWindow(todayWindow)) return true
  return todayPortionCoversMinutes(todayWindow, minutes)
}

/**
 * The part of a window that belongs to its own calendar day. An overnight
 * window (close earlier than open) covers open -> midnight today; the
 * midnight -> close part belongs to the next day and is handled as
 * yesterday's spill there.
 */
function todayPortionCoversMinutes(window: SiteHoursWindow, minutes: number) {
  const open = parseMinutes(window.open)
  const close = parseMinutes(window.close)
  if (open == null || close == null) return false
  if (open === close) return true
  if (close > open) {
    return minutes >= open && minutes < close
  }
  return minutes >= open
}

/** Offline/down that begins while closed is not opened. Maintenance still suppresses. */
export function shouldSkipRaisingAlertForClosedHours(
  kind: AlertKind,
  siteOpen: boolean | null | undefined
) {
  return siteOpen === false && isClosedHoursQuietKind(kind)
}

export function shouldHoldAlertForClosedHours(
  kind: AlertKind,
  siteOpen: boolean | null | undefined
) {
  return shouldSkipRaisingAlertForClosedHours(kind, siteOpen)
}

/** Reboot and update wait while the floor is open. Restart does not. */
export function shouldWaitForSiteClose(
  action: string,
  siteOpen: boolean | null | undefined
) {
  if (siteOpen !== true) return false
  return (playbookActionsWaitingForClose as readonly string[]).includes(action)
}

export function shouldSuppressNewAlert(args: {
  kind: AlertKind
  inMaintenanceWindow: boolean
  siteOpen: boolean | null | undefined
}) {
  if (args.inMaintenanceWindow) return true
  return false
}

export function siteOpenLabel(siteOpen: boolean | null | undefined) {
  if (siteOpen === true) return "Open"
  if (siteOpen === false) return "Closed"
  return "Hours not set"
}
