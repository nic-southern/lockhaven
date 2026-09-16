import {
  auditSeverities,
  type AlertKind,
  type AuditSeverity,
} from "@nms/shared"

export type ChannelFilter = {
  minSeverity: AuditSeverity
  /** Empty means every kind. */
  alertKinds: AlertKind[]
  /** Empty means every site, including alerts with no site. */
  siteIds: string[]
}

export type AlertMatchInput = {
  kind: AlertKind
  severity: AuditSeverity
  siteId: string | null | undefined
}

export function severityRank(severity: AuditSeverity) {
  const rank = auditSeverities.indexOf(severity)
  return rank === -1 ? 0 : rank
}

export function channelMatchesSite(
  filter: Pick<ChannelFilter, "siteIds">,
  siteId: string | null | undefined
) {
  if (filter.siteIds.length === 0) return true
  if (!siteId) return false
  return filter.siteIds.includes(siteId)
}

export function channelMatchesAlert(
  filter: ChannelFilter,
  alert: AlertMatchInput
) {
  if (severityRank(alert.severity) < severityRank(filter.minSeverity)) {
    return false
  }
  if (filter.alertKinds.length > 0 && !filter.alertKinds.includes(alert.kind)) {
    return false
  }
  return channelMatchesSite(filter, alert.siteId)
}
