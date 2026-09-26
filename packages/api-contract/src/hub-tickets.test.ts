import assert from "node:assert/strict"
import test from "node:test"

import { PgDialect } from "drizzle-orm/pg-core"

import type { ActorPrincipal } from "@nms/auth"
import { tickets } from "@nms/db"
import {
  shouldCreateTicketForAlert,
  statusAfterAlertResolved,
  type TicketStatus,
} from "@nms/shared"

import { eventScopeCondition } from "./scope"

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

const ticketColumns = {
  organizationId: tickets.organizationId,
  siteId: tickets.siteId,
  deviceId: tickets.deviceId,
}

test("create-from-alert reuses an open ticket and allows a new one after Done", () => {
  const open: TicketStatus[] = ["open"]
  const done: TicketStatus[] = ["done"]
  assert.equal(shouldCreateTicketForAlert(open), false)
  assert.equal(shouldCreateTicketForAlert(done), true)
})

test("resolve moves linked open Hub tickets to Done", () => {
  assert.equal(statusAfterAlertResolved("open"), "done")
  assert.equal(statusAfterAlertResolved("in_progress"), "done")
})

test("ticket list scope follows org membership", () => {
  const orgOperator = actor({
    organizationMemberships: [
      {
        id: "m-1",
        organizationId: "org-a",
        role: "operator",
        status: "active",
      },
    ],
  })
  const { sql, params } = render(
    eventScopeCondition(orgOperator, ticketColumns)
  )
  assert.match(sql, /"tickets"\."organization_id" in \(\$1\)/)
  assert.deepEqual(params, ["org-a"])
})

test("ticket list scope for a site technician matches site or its devices", () => {
  const siteTechnician = actor({
    siteMemberships: [
      {
        id: "m-3",
        siteId: "site-1",
        organizationId: "org-a",
        role: "technician",
        status: "active",
      },
    ],
  })
  const { sql, params } = render(
    eventScopeCondition(siteTechnician, ticketColumns)
  )
  assert.match(sql, /"tickets"\."site_id" in \(\$1\)/)
  assert.match(sql, /"tickets"\."device_id" in \(select/)
  assert.deepEqual(params, ["site-1", "site-1"])
})

test("platform staff see all tickets; anonymous callers see none", () => {
  const platformAdmin = actor({ platformRole: "admin" })
  assert.deepEqual(eventScopeCondition(platformAdmin, ticketColumns), {
    kind: "all",
  })
  assert.deepEqual(eventScopeCondition(null, ticketColumns), { kind: "none" })
})
