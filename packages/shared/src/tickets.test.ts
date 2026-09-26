import assert from "node:assert/strict"
import test from "node:test"

import {
  isOpenTicketStatus,
  priorityFromAlertSeverity,
  shouldCreateTicketForAlert,
  statusAfterAlertResolved,
  ticketTitleFromAlert,
} from "./tickets"

test("open and in-progress tickets still need work; done does not", () => {
  assert.equal(isOpenTicketStatus("open"), true)
  assert.equal(isOpenTicketStatus("in_progress"), true)
  assert.equal(isOpenTicketStatus("done"), false)
})

test("alert resolve moves open tickets to Done and leaves Done alone", () => {
  assert.equal(statusAfterAlertResolved("open"), "done")
  assert.equal(statusAfterAlertResolved("in_progress"), "done")
  assert.equal(statusAfterAlertResolved("done"), "done")
})

test("create-from-alert skips when an open Hub ticket already exists", () => {
  assert.equal(shouldCreateTicketForAlert([]), true)
  assert.equal(shouldCreateTicketForAlert(["done"]), true)
  assert.equal(shouldCreateTicketForAlert(["open"]), false)
  assert.equal(shouldCreateTicketForAlert(["in_progress"]), false)
  assert.equal(shouldCreateTicketForAlert(["done", "open"]), false)
})

test("priority maps from alert severity", () => {
  assert.equal(priorityFromAlertSeverity("critical"), "critical")
  assert.equal(priorityFromAlertSeverity("warning"), "high")
  assert.equal(priorityFromAlertSeverity("notice"), "medium")
  assert.equal(priorityFromAlertSeverity("info"), "low")
  assert.equal(priorityFromAlertSeverity(null), "low")
})

test("ticket title prefers the alert title", () => {
  assert.equal(
    ticketTitleFromAlert({ title: " Disk full ", kindLabel: "Disk full" }),
    "Disk full"
  )
  assert.equal(
    ticketTitleFromAlert({ title: "   ", kindLabel: "Agent not checking in" }),
    "Agent not checking in"
  )
  assert.equal(ticketTitleFromAlert({ title: "" }), "Alert")
})
