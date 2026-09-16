import { inArray, or, sql, type SQL } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"

import type { ActorPrincipal } from "@nms/auth"
import { devices } from "@nms/db"

import { actorOrganizationIds, actorSiteIds } from "./access"

export type ScopeCondition =
  | { kind: "all" }
  | { kind: "none" }
  | { kind: "where"; condition: SQL }

/**
 * Resolves the row-level scope an actor may see on the devices table.
 * Platform owners/admins see everything; other actors are limited to devices
 * inside their active organization or site memberships.
 */
export function deviceScopeCondition(
  actor: ActorPrincipal | null
): ScopeCondition {
  const organizationIds = actorOrganizationIds(actor)
  const siteIds = actorSiteIds(actor) ?? []

  if (organizationIds === null) {
    return { kind: "all" }
  }

  const filters: SQL[] = []
  if (organizationIds.length > 0) {
    filters.push(inArray(devices.organizationId, organizationIds))
  }
  if (siteIds.length > 0) {
    filters.push(inArray(devices.siteId, siteIds))
  }

  if (filters.length === 0) {
    return { kind: "none" }
  }

  const condition = filters.length === 1 ? filters[0] : or(...filters)
  return condition ? { kind: "where", condition } : { kind: "none" }
}

type ScopedColumns = {
  organizationId: AnyPgColumn
  siteId: AnyPgColumn
  deviceId: AnyPgColumn
}

/**
 * Row-level scope for event-style tables (audit events, alerts, connection
 * logs) that carry their own organization/site/device columns. Site members
 * see rows tagged with their site directly or through one of its devices.
 */
export function eventScopeCondition(
  actor: ActorPrincipal | null,
  columns: ScopedColumns
): ScopeCondition {
  const organizationIds = actorOrganizationIds(actor)
  const siteIds = actorSiteIds(actor) ?? []

  if (organizationIds === null) {
    return { kind: "all" }
  }

  const filters: SQL[] = []
  if (organizationIds.length > 0) {
    filters.push(inArray(columns.organizationId, organizationIds))
  }
  if (siteIds.length > 0) {
    filters.push(inArray(columns.siteId, siteIds))
    filters.push(
      sql`${columns.deviceId} in (select ${devices.id} from ${devices} where ${inArray(devices.siteId, siteIds)})`
    )
  }

  if (filters.length === 0) {
    return { kind: "none" }
  }

  const condition = filters.length === 1 ? filters[0] : or(...filters)
  return condition ? { kind: "where", condition } : { kind: "none" }
}

export function combineConditions(conditions: Array<SQL | undefined>) {
  return conditions.filter((entry): entry is SQL => Boolean(entry))
}

/**
 * Org/site scope for inventory rows that are not devices (assets, and similar).
 * Organization memberships cover the whole org; site memberships add those sites.
 */
export function inventoryScopeCondition(
  actor: ActorPrincipal | null,
  columns: { organizationId: AnyPgColumn; siteId: AnyPgColumn }
): ScopeCondition {
  const organizationIds = actorOrganizationIds(actor)
  const siteIds = actorSiteIds(actor) ?? []

  if (organizationIds === null) {
    return { kind: "all" }
  }

  const filters: SQL[] = []
  if (organizationIds.length > 0) {
    filters.push(inArray(columns.organizationId, organizationIds))
  }
  if (siteIds.length > 0) {
    filters.push(inArray(columns.siteId, siteIds))
  }

  if (filters.length === 0) {
    return { kind: "none" }
  }

  const condition = filters.length === 1 ? filters[0] : or(...filters)
  return condition ? { kind: "where", condition } : { kind: "none" }
}
