import assert from "node:assert/strict"
import test from "node:test"

import { PgDialect } from "drizzle-orm/pg-core"

import type { ActorPrincipal } from "@nms/auth"
import { auditEvents, devices } from "@nms/db"

import { actorOrganizationIds, actorSiteIds } from "./access"
import { deviceScopeCondition, eventScopeCondition } from "./scope"

const dialect = new PgDialect()

function render(condition: { kind: string; condition?: unknown }) {
  assert.equal(condition.kind, "where")
  const query = dialect.sqlToQuery(
    (condition as { condition: Parameters<PgDialect["sqlToQuery"]>[0] })
      .condition
  )
  return { sql: query.sql, params: query.params }
}

function actor(overrides: Partial<ActorPrincipal>): ActorPrincipal {
  return {
    id: "user-1",
    email: "person@example.test",
    name: "Person",
    platformRole: "member",
    platformPermissions: [],
    permissions: [],
    organizationMemberships: [],
    siteMemberships: [],
    ...overrides,
  }
}

const platformAdmin = actor({ platformRole: "admin" })

const orgOperator = actor({
  organizationMemberships: [
    {
      id: "m-1",
      organizationId: "org-a",
      role: "operator",
      status: "active",
    },
    {
      id: "m-2",
      organizationId: "org-suspended",
      role: "operator",
      status: "suspended",
    },
  ],
})

const siteTechnician = actor({
  siteMemberships: [
    {
      id: "m-3",
      siteId: "site-1",
      organizationId: "org-a",
      role: "technician",
      status: "active",
    },
    {
      id: "m-4",
      siteId: "site-1",
      organizationId: "org-a",
      role: "viewer",
      status: "active",
    },
    {
      id: "m-5",
      siteId: "site-gone",
      organizationId: "org-a",
      role: "technician",
      status: "suspended",
    },
  ],
})

const eventColumns = {
  organizationId: auditEvents.organizationId,
  siteId: auditEvents.siteId,
  deviceId: auditEvents.deviceId,
}

test("platform staff are unrestricted; anonymous callers get nothing", () => {
  assert.equal(actorOrganizationIds(platformAdmin), null)
  assert.equal(actorSiteIds(platformAdmin), null)
  assert.deepEqual(deviceScopeCondition(platformAdmin), { kind: "all" })
  assert.deepEqual(eventScopeCondition(platformAdmin, eventColumns), {
    kind: "all",
  })

  assert.deepEqual(deviceScopeCondition(null), { kind: "none" })
  assert.deepEqual(eventScopeCondition(null, eventColumns), { kind: "none" })
})

test("a member with no active memberships sees no rows", () => {
  const nobody = actor({})
  assert.deepEqual(deviceScopeCondition(nobody), { kind: "none" })
  assert.deepEqual(eventScopeCondition(nobody, eventColumns), { kind: "none" })
})

test("organization memberships filter by organization and skip suspended ones", () => {
  assert.deepEqual(actorOrganizationIds(orgOperator), ["org-a"])
  const { sql, params } = render(deviceScopeCondition(orgOperator))
  assert.match(sql, /"devices"\."organization_id" in \(\$1\)/)
  assert.deepEqual(params, ["org-a"])
  assert.equal(sql.includes("site_id"), false)
})

test("site memberships filter devices by site, deduplicating grants", () => {
  assert.deepEqual(actorSiteIds(siteTechnician), ["site-1"])
  const { sql, params } = render(deviceScopeCondition(siteTechnician))
  assert.match(sql, /"devices"\."site_id" in \(\$1\)/)
  assert.deepEqual(params, ["site-1"])
  assert.equal(sql.includes("organization_id"), false)
})

test("event scope for a site technician matches the site column or one of its devices", () => {
  const { sql, params } = render(
    eventScopeCondition(siteTechnician, eventColumns)
  )
  assert.match(sql, /"audit_events"\."site_id" in \(\$1\)/)
  assert.match(
    sql,
    /"audit_events"\."device_id" in \(select "devices"\."id" from "devices" where "devices"\."site_id" in \(\$2\)\)/
  )
  assert.match(sql, / or /)
  assert.deepEqual(params, ["site-1", "site-1"])
  assert.equal(sql.includes("organization_id"), false)
})

test("event scope combines organization and site grants with OR", () => {
  const mixed = actor({
    organizationMemberships: orgOperator.organizationMemberships,
    siteMemberships: [
      {
        id: "m-6",
        siteId: "site-9",
        organizationId: "org-b",
        role: "technician",
        status: "active",
      },
    ],
  })
  const { sql, params } = render(eventScopeCondition(mixed, eventColumns))
  assert.match(sql, /"audit_events"\."organization_id" in \(\$1\)/)
  assert.match(sql, /"audit_events"\."site_id" in \(\$2\)/)
  assert.deepEqual(params, ["org-a", "site-9", "site-9"])
  assert.equal(sql.split(" or ").length, 3)
})

test("event scope works against a different table's columns", () => {
  const { sql } = render(
    eventScopeCondition(orgOperator, {
      organizationId: devices.organizationId,
      siteId: devices.siteId,
      deviceId: devices.id,
    })
  )
  assert.match(sql, /"devices"\."organization_id" in \(\$1\)/)
})
