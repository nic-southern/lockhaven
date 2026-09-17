import assert from "node:assert/strict"
import test from "node:test"

import {
  canDecidePlaybookRun,
  decidePlaybookAction,
  effectivePlaybookRunStatus,
  isPlaybookAction,
  parsePlaybookAction,
  pickMatchingPlaybook,
  playbookActionSchema,
  playbookActions,
  type PlaybookMatchFields,
} from "./playbooks"

const now = new Date("2026-09-16T12:00:00.000Z")

const orgPlaybook: PlaybookMatchFields = {
  id: "org",
  organizationId: "org-1",
  siteId: null,
  alertKind: "agent_outdated",
  action: "update",
  enabled: true,
  requireApproval: false,
  cooldownMinutes: 60,
}

const sitePlaybook: PlaybookMatchFields = {
  id: "site",
  organizationId: "org-1",
  siteId: "site-1",
  alertKind: "agent_outdated",
  action: "restart",
  enabled: true,
  requireApproval: true,
  cooldownMinutes: 30,
}

test("playbook actions are the closed fleet whitelist only", () => {
  assert.deepEqual([...playbookActions], ["reboot", "restart", "update"])
  assert.equal(isPlaybookAction("reboot"), true)
  assert.equal(isPlaybookAction("restart"), true)
  assert.equal(isPlaybookAction("update"), true)
  assert.equal(isPlaybookAction("ssh"), false)
  assert.equal(isPlaybookAction("shell"), false)
  assert.equal(isPlaybookAction("script"), false)
  assert.equal(parsePlaybookAction("reboot"), "reboot")
  assert.equal(parsePlaybookAction(" ssh "), null)
  assert.equal(parsePlaybookAction("rm -rf /"), null)
  assert.equal(parsePlaybookAction("bash -c 'reboot'"), null)
  assert.equal(playbookActionSchema.safeParse("ssh").success, false)
  assert.equal(playbookActionSchema.safeParse("update").success, true)
})

test("site playbooks override organization playbooks for the same kind", () => {
  const picked = pickMatchingPlaybook(
    [orgPlaybook, sitePlaybook],
    "agent_outdated",
    "org-1",
    "site-1"
  )
  assert.equal(picked?.id, "site")
  assert.equal(picked?.action, "restart")
})

test("organization playbook applies when the site has none", () => {
  const picked = pickMatchingPlaybook(
    [orgPlaybook, sitePlaybook],
    "agent_outdated",
    "org-1",
    "site-2"
  )
  assert.equal(picked?.id, "org")
})

test("a disabled site playbook does not fall through to the organization", () => {
  const picked = pickMatchingPlaybook(
    [orgPlaybook, { ...sitePlaybook, enabled: false }],
    "agent_outdated",
    "org-1",
    "site-1"
  )
  assert.equal(picked, null)
})

test("disabled organization playbooks are ignored", () => {
  const picked = pickMatchingPlaybook(
    [{ ...orgPlaybook, enabled: false }],
    "agent_outdated",
    "org-1",
    null
  )
  assert.equal(picked, null)
})

test("alerts without an organization never match", () => {
  assert.equal(
    pickMatchingPlaybook([orgPlaybook], "agent_outdated", null, null),
    null
  )
})

test("auto playbooks queue an allowlisted action", () => {
  const decision = decidePlaybookAction({
    action: "update",
    requireApproval: false,
    alertStatus: "open",
    snoozedUntil: null,
    deviceId: "device-1",
    now,
    lastQueuedAt: null,
    cooldownMinutes: 60,
    hasOpenCommand: false,
    existingRunStatus: null,
  })
  assert.deepEqual(decision, { kind: "queue" })
})

test("approval-required playbooks wait for review", () => {
  const decision = decidePlaybookAction({
    action: "reboot",
    requireApproval: true,
    alertStatus: "acknowledged",
    snoozedUntil: null,
    deviceId: "device-1",
    now,
    lastQueuedAt: null,
    cooldownMinutes: 60,
    hasOpenCommand: false,
    existingRunStatus: null,
  })
  assert.deepEqual(decision, { kind: "approve" })
})

test("unknown actions are refused before any command is queued", () => {
  for (const action of ["ssh", "shell", "/bin/bash", "custom-script"]) {
    const decision = decidePlaybookAction({
      action,
      requireApproval: false,
      alertStatus: "open",
      snoozedUntil: null,
      deviceId: "device-1",
      now,
      lastQueuedAt: null,
      cooldownMinutes: 0,
      hasOpenCommand: false,
      existingRunStatus: null,
    })
    assert.deepEqual(decision, { kind: "skip", reason: "unknown_action" })
  }
})

test("reboot and update wait while the floor is open", () => {
  const base = {
    requireApproval: false,
    alertStatus: "open" as const,
    snoozedUntil: null as Date | null,
    deviceId: "device-1",
    now,
    lastQueuedAt: null as Date | null,
    cooldownMinutes: 0,
    hasOpenCommand: false,
    existingRunStatus: null as null,
    holdForVenueHours: true,
  }
  assert.deepEqual(decidePlaybookAction({ ...base, action: "reboot" }), {
    kind: "skip",
    reason: "floor_open",
  })
  assert.deepEqual(decidePlaybookAction({ ...base, action: "update" }), {
    kind: "skip",
    reason: "floor_open",
  })
  assert.deepEqual(
    decidePlaybookAction({
      ...base,
      action: "reboot",
      holdForVenueHours: false,
    }),
    { kind: "queue" }
  )
})

test("alerts without a device are skipped", () => {
  const decision = decidePlaybookAction({
    action: "reboot",
    requireApproval: false,
    alertStatus: "open",
    snoozedUntil: null,
    deviceId: null,
    now,
    lastQueuedAt: null,
    cooldownMinutes: 0,
    hasOpenCommand: false,
    existingRunStatus: null,
  })
  assert.deepEqual(decision, { kind: "skip", reason: "no_device" })
})

test("suppressed, resolved, and snoozed alerts are not acted on", () => {
  const base = {
    action: "restart" as const,
    requireApproval: false,
    snoozedUntil: null as Date | null,
    deviceId: "device-1",
    now,
    lastQueuedAt: null as Date | null,
    cooldownMinutes: 0,
    hasOpenCommand: false,
    existingRunStatus: null as null,
  }
  assert.deepEqual(
    decidePlaybookAction({ ...base, alertStatus: "suppressed" }),
    { kind: "skip", reason: "not_open" }
  )
  assert.deepEqual(decidePlaybookAction({ ...base, alertStatus: "resolved" }), {
    kind: "skip",
    reason: "not_open",
  })
  assert.deepEqual(
    decidePlaybookAction({
      ...base,
      alertStatus: "open",
      snoozedUntil: new Date("2026-09-16T18:00:00.000Z"),
    }),
    { kind: "skip", reason: "not_open" }
  )
})

test("cooldown and an already-open command skip a second run", () => {
  const recent = new Date("2026-09-16T11:30:00.000Z")
  assert.deepEqual(
    decidePlaybookAction({
      action: "reboot",
      requireApproval: false,
      alertStatus: "open",
      snoozedUntil: null,
      deviceId: "device-1",
      now,
      lastQueuedAt: recent,
      cooldownMinutes: 60,
      hasOpenCommand: false,
      existingRunStatus: null,
    }),
    { kind: "skip", reason: "cooldown" }
  )
  assert.deepEqual(
    decidePlaybookAction({
      action: "reboot",
      requireApproval: false,
      alertStatus: "open",
      snoozedUntil: null,
      deviceId: "device-1",
      now,
      lastQueuedAt: null,
      cooldownMinutes: 60,
      hasOpenCommand: true,
      existingRunStatus: null,
    }),
    { kind: "skip", reason: "open_command" }
  )
})

test("an existing run for the same alert is not repeated", () => {
  const decision = decidePlaybookAction({
    action: "update",
    requireApproval: false,
    alertStatus: "open",
    snoozedUntil: null,
    deviceId: "device-1",
    now,
    lastQueuedAt: null,
    cooldownMinutes: 0,
    hasOpenCommand: false,
    existingRunStatus: "queued",
  })
  assert.deepEqual(decision, { kind: "skip", reason: "already_handled" })
})

test("pending playbook runs expire and can no longer be decided", () => {
  const later = new Date("2026-09-16T20:00:00.000Z")
  const expiresAt = new Date("2026-09-16T18:00:00.000Z")
  assert.equal(
    effectivePlaybookRunStatus("pending_approval", expiresAt, now),
    "pending_approval"
  )
  assert.equal(
    effectivePlaybookRunStatus("pending_approval", expiresAt, later),
    "expired"
  )
  assert.equal(canDecidePlaybookRun("pending_approval", expiresAt, now), true)
  assert.equal(
    canDecidePlaybookRun("pending_approval", expiresAt, later),
    false
  )
  assert.equal(canDecidePlaybookRun("queued", expiresAt, now), false)
})
