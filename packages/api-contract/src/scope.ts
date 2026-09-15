import { inArray, or, type SQL } from "drizzle-orm"

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

export function combineConditions(conditions: Array<SQL | undefined>) {
  return conditions.filter((entry): entry is SQL => Boolean(entry))
}
