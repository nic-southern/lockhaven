/**
 * Morning ops dashboard — pure helpers for tile copy, deep links, and
 * lightweight aggregation over counts already available elsewhere.
 */

import { DEFAULT_ARO_PER_YEAR } from "./asset-risk"

/** Console paths each morning tile deep-links into. */
export const morningOpsLinks = {
  alerts: "/alerts",
  alertsCritical: "/alerts?f.severity=critical",
  alertsAgentStale: "/alerts?f.kind=agent_stale",
  devicesOffline: "/devices?f.connectivity=offline%2Cnever",
  devicesOnline: "/devices?f.connectivity=online",
  software: "/software",
  expectedLoss: "/reports?tab=risk",
  sessions: "/connections",
  activityInfrastructure: "/activity?f.eventType=infrastructure_access_granted",
} as const

export type MorningOpsAlertCounts = {
  open: number
  acknowledged: number
  critical: number
  warning: number
  notice: number
  info: number
  agentStale: number
}

export type MorningOpsPatchCounts = {
  /** Distinct devices with at least one install-now package. */
  deviceCount: number
  /** Total install-now package rows (may exceed deviceCount). */
  packageCount: number
}

export type MorningOpsRiskSummary = {
  available: boolean
  inServiceLinkedCount: number
  withCostCount: number
  noCostCount: number
  totalReplacementValue: string
  totalExpectedLoss: string
  totalAnnualExpectedLoss: string
  aroPerYear: number
}

export type MorningOpsSessionCounts = {
  last24h: number
  active: number
}

export type MorningOpsDeviceCounts = {
  total: number
  online: number
  offline: number
  never: number
  needsAttention: number
}

export type MorningOpsSnapshotInput = {
  alerts: MorningOpsAlertCounts
  devices: MorningOpsDeviceCounts
  patches: MorningOpsPatchCounts
  risk: MorningOpsRiskSummary | null
  sessions: MorningOpsSessionCounts
  liveInfrastructureGrants: number
}

export type MorningOpsTileTone =
  | "neutral"
  | "online"
  | "warning"
  | "danger"
  | "offline"

export type MorningOpsTile = {
  id:
    | "alerts"
    | "patches"
    | "offline"
    | "agent_stale"
    | "expected_loss"
    | "sessions"
    | "live_grants"
  label: string
  /** Primary numeric or money display. */
  value: string
  hint: string
  href: string
  tone: MorningOpsTileTone
  /** True when the tile represents a clear/empty morning. */
  empty: boolean
}

/** Count distinct device ids from install-now package rows. */
export function countInstallNowDevices(
  rows: ReadonlyArray<{ deviceId: string }>
): number {
  const seen = new Set<string>()
  for (const row of rows) {
    if (row.deviceId) seen.add(row.deviceId)
  }
  return seen.size
}

/**
 * Fold raw alert tallies into the open / severity / agent-stale buckets used
 * by morning tiles. Critical and warning are among unresolved (not resolved
 * or suppressed); agentStale is a kind subset of those.
 */
export function summarizeMorningAlertCounts(input: {
  open: number
  acknowledged: number
  critical: number
  warning: number
  notice?: number
  info?: number
  agentStale: number
}): MorningOpsAlertCounts {
  return {
    open: Math.max(0, Math.trunc(input.open)),
    acknowledged: Math.max(0, Math.trunc(input.acknowledged)),
    critical: Math.max(0, Math.trunc(input.critical)),
    warning: Math.max(0, Math.trunc(input.warning)),
    notice: Math.max(0, Math.trunc(input.notice ?? 0)),
    info: Math.max(0, Math.trunc(input.info ?? 0)),
    agentStale: Math.max(0, Math.trunc(input.agentStale)),
  }
}

export function emptyMorningRiskSummary(
  aroPerYear = DEFAULT_ARO_PER_YEAR
): MorningOpsRiskSummary {
  return {
    available: false,
    inServiceLinkedCount: 0,
    withCostCount: 0,
    noCostCount: 0,
    totalReplacementValue: "0.00",
    totalExpectedLoss: "0.00",
    totalAnnualExpectedLoss: "0.00",
    aroPerYear,
  }
}

function formatMoneyDisplay(amount: string): string {
  const n = Number(amount)
  if (!Number.isFinite(n)) return amount
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n % 1 === 0 ? 0 : 2,
  }).format(n)
}

function offlineDeviceCount(devices: MorningOpsDeviceCounts): number {
  return devices.offline + devices.never
}

/**
 * Build the scannable morning tile set from aggregated counts.
 * Empty-state hints stay calm product language when nothing needs attention.
 */
export function buildMorningOpsTiles(
  input: MorningOpsSnapshotInput
): MorningOpsTile[] {
  const alerts = summarizeMorningAlertCounts(input.alerts)
  const offline = offlineDeviceCount(input.devices)
  const patches = input.patches
  const sessions = input.sessions
  const risk = input.risk
  const liveGrants = Math.max(0, Math.trunc(input.liveInfrastructureGrants))

  const alertHint =
    alerts.open === 0
      ? "Nothing waiting on you"
      : alerts.critical > 0
        ? `${alerts.critical} critical`
        : alerts.warning > 0
          ? `${alerts.warning} warning`
          : alerts.acknowledged > 0
            ? `${alerts.acknowledged} acknowledged`
            : "Review open items"

  const patchEmpty = patches.deviceCount === 0
  const patchHint = patchEmpty
    ? "No security updates waiting"
    : patches.packageCount > patches.deviceCount
      ? `${patches.packageCount} updates across devices`
      : "Install as soon as you can"

  const offlineEmpty = offline === 0
  const offlineHint = offlineEmpty
    ? "Every enrolled device has connected"
    : input.devices.never > 0
      ? `${input.devices.never} never connected`
      : "Unreachable right now"

  const staleEmpty = alerts.agentStale === 0
  const staleHint = staleEmpty
    ? "Agents are checking in"
    : "Quiet longer than expected"

  const riskAvailable = Boolean(risk?.available)
  const riskEmpty =
    !riskAvailable || (risk!.withCostCount === 0 && risk!.noCostCount === 0)
  let riskValue = "—"
  let riskHint = "Open the expected loss report"
  let riskTone: MorningOpsTileTone = "neutral"
  if (riskAvailable && risk) {
    if (risk.withCostCount === 0 && risk.noCostCount === 0) {
      riskValue = formatMoneyDisplay("0.00")
      riskHint = "No linked in-service assets yet"
    } else if (risk.withCostCount === 0) {
      riskValue = formatMoneyDisplay("0.00")
      riskHint = `${risk.noCostCount} with no cost set`
      riskTone = "warning"
    } else {
      riskValue = formatMoneyDisplay(risk.totalExpectedLoss)
      riskHint =
        risk.noCostCount > 0
          ? `Annual ${formatMoneyDisplay(risk.totalAnnualExpectedLoss)} · ${risk.noCostCount} missing cost`
          : `Annual ${formatMoneyDisplay(risk.totalAnnualExpectedLoss)}`
    }
  }

  const sessionsEmpty = sessions.last24h === 0 && sessions.active === 0
  const sessionsHint = sessionsEmpty
    ? "No remote sessions in the last day"
    : sessions.active > 0
      ? `${sessions.active} still open`
      : "Closed within the last day"

  const grantsEmpty = liveGrants === 0
  const grantsHint = grantsEmpty
    ? "No live infrastructure access"
    : "Time-boxed access still open"

  return [
    {
      id: "alerts",
      label: "Open alerts",
      value: String(alerts.open),
      hint: alertHint,
      href:
        alerts.critical > 0
          ? morningOpsLinks.alertsCritical
          : morningOpsLinks.alerts,
      tone:
        alerts.critical > 0
          ? "danger"
          : alerts.open > 0
            ? "warning"
            : "neutral",
      empty: alerts.open === 0,
    },
    {
      id: "patches",
      label: "Security updates",
      value: String(patches.deviceCount),
      hint: patchHint,
      href: morningOpsLinks.software,
      tone: patchEmpty ? "neutral" : "warning",
      empty: patchEmpty,
    },
    {
      id: "offline",
      label: "Offline",
      value: String(offline),
      hint: offlineHint,
      href: morningOpsLinks.devicesOffline,
      tone: offlineEmpty ? "neutral" : "offline",
      empty: offlineEmpty,
    },
    {
      id: "agent_stale",
      label: "Quiet agents",
      value: String(alerts.agentStale),
      hint: staleHint,
      href: morningOpsLinks.alertsAgentStale,
      tone: staleEmpty ? "neutral" : "warning",
      empty: staleEmpty,
    },
    {
      id: "expected_loss",
      label: "Expected loss",
      value: riskValue,
      hint: riskHint,
      href: morningOpsLinks.expectedLoss,
      tone: riskTone,
      empty: riskEmpty,
    },
    {
      id: "sessions",
      label: "Sessions · 24h",
      value: String(sessions.last24h),
      hint: sessionsHint,
      href: morningOpsLinks.sessions,
      tone: "neutral",
      empty: sessionsEmpty,
    },
    {
      id: "live_grants",
      label: "Live access",
      value: String(liveGrants),
      hint: grantsHint,
      href: morningOpsLinks.activityInfrastructure,
      tone: grantsEmpty ? "neutral" : "online",
      empty: grantsEmpty,
    },
  ]
}

/** True when every attention-oriented tile is clear. */
export function morningOpsAllClear(tiles: readonly MorningOpsTile[]): boolean {
  const attention = tiles.filter((tile) =>
    ["alerts", "patches", "offline", "agent_stale"].includes(tile.id)
  )
  return attention.every((tile) => tile.empty)
}
