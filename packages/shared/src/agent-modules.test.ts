import assert from "node:assert/strict"
import test from "node:test"

import {
  agentModuleCreateSchema,
  agentModuleObservationSchema,
  checkInModuleReportSchema,
  encodeHubModules,
  hasPoisonedKeys,
  hubModuleDefinitionSchema,
  isExecutableCollectorPath,
  isSafeCollectorPath,
  isSafeProcessName,
  looksLikeScriptOrBinary,
  validateReportedModules,
  type HubModuleDefinition,
} from "./agent-modules"

const collectorId = "11111111-1111-4111-8111-111111111111"
const otherCollectorId = "22222222-2222-4222-8222-222222222222"
const moduleId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

const observationModule: HubModuleDefinition = {
  id: moduleId,
  kind: "observations",
  name: "Cabinet facts",
  collectors: [
    {
      id: collectorId,
      type: "process_running",
      process: "Game.exe",
    },
    {
      id: otherCollectorId,
      type: "file_text",
      path: "C:/Games/build.txt",
    },
  ],
}

test("process names reject path and shell characters", () => {
  assert.equal(isSafeProcessName("Game.exe"), true)
  assert.equal(isSafeProcessName("Game Client"), true)
  assert.equal(isSafeProcessName("C:\\Games\\Game.exe"), false)
  assert.equal(isSafeProcessName("Game.exe; calc"), false)
  assert.equal(isSafeProcessName("Game|exe"), false)
  assert.equal(isSafeProcessName(".."), false)
})

test("collector paths must be absolute and cannot walk up", () => {
  assert.equal(isSafeCollectorPath("C:/Games/build.txt"), true)
  assert.equal(isSafeCollectorPath("C:\\Games\\build.txt"), true)
  assert.equal(isSafeCollectorPath("/var/lib/game/build.txt"), true)
  assert.equal(isSafeCollectorPath("build.txt"), false)
  assert.equal(
    isSafeCollectorPath("C:/Games/../Windows/System32/cmd.exe"),
    false
  )
  assert.equal(isSafeCollectorPath("//server/share/file.txt"), false)
  assert.equal(isExecutableCollectorPath("C:/Games/Game.exe"), true)
  assert.equal(isExecutableCollectorPath("C:/Games/build.txt"), false)
})

test("Hub refuses a file_text collector that points at an executable", () => {
  const parsed = agentModuleCreateSchema.safeParse({
    organizationId: "33333333-3333-4333-8333-333333333333",
    name: "Bad module",
    kind: "observations",
    collectors: [{ type: "file_text", path: "C:/Games/Game.exe" }],
  })
  assert.equal(parsed.success, false)
})

test("Hub refuses unknown collector types and extra fields", () => {
  const extra = hubModuleDefinitionSchema.safeParse({
    ...observationModule,
    collectors: [
      {
        id: collectorId,
        type: "process_running",
        process: "Game.exe",
        shell: true,
      },
    ],
  })
  assert.equal(extra.success, false)

  const unknown = agentModuleCreateSchema.safeParse({
    organizationId: "33333333-3333-4333-8333-333333333333",
    name: "Shell",
    kind: "observations",
    collectors: [{ type: "shell", command: "reboot" }],
  })
  assert.equal(unknown.success, false)
})

test("agents cannot register a new module kind", () => {
  const parsed = agentModuleCreateSchema.safeParse({
    organizationId: "33333333-3333-4333-8333-333333333333",
    name: "Dropper",
    kind: "payload",
    collectors: [{ type: "process_running", process: "Game.exe" }],
  })
  assert.equal(parsed.success, false)
})

test("observations reject unknown fields and nested shell strings", () => {
  const ok = agentModuleObservationSchema.safeParse({
    id: collectorId,
    type: "file_text",
    exists: true,
    value: "1.4.2",
  })
  assert.equal(ok.success, true)

  const extra = agentModuleObservationSchema.safeParse({
    id: collectorId,
    type: "file_text",
    exists: true,
    value: "1.4.2",
    shell: true,
  })
  assert.equal(extra.success, false)

  const control = agentModuleObservationSchema.safeParse({
    id: collectorId,
    type: "file_text",
    exists: true,
    value: "1.4.2\ncmd.exe",
  })
  assert.equal(control.success, false)
})

test("poisoned keys, scripts, and binaries fail closed", () => {
  assert.equal(
    hasPoisonedKeys(JSON.parse('{"__proto__":{"admin":true}}')),
    true
  )
  assert.equal(hasPoisonedKeys({ constructor: { prototype: {} } }), true)
  assert.equal(looksLikeScriptOrBinary("#!/bin/sh"), true)
  assert.equal(looksLikeScriptOrBinary("<script>alert(1)</script>"), true)
  assert.equal(looksLikeScriptOrBinary("1.4.2"), false)

  const scriptValue = agentModuleObservationSchema.safeParse({
    id: collectorId,
    type: "file_text",
    exists: true,
    value: "#!/bin/bash",
  })
  assert.equal(scriptValue.success, false)
})

test("reported modules must match Hub-assigned ids and kinds", () => {
  const report = checkInModuleReportSchema.parse({
    module_id: moduleId,
    kind: "observations",
    observations: [
      { id: collectorId, type: "process_running", running: true },
      { id: otherCollectorId, type: "file_text", exists: true, value: "1.4.2" },
    ],
  })

  const accepted = validateReportedModules([observationModule], [report])
  assert.equal(accepted.ok, true)
  if (accepted.ok) assert.equal(accepted.reports.length, 1)

  // Stale module ids after delete/re-add are dropped so check-in can heal.
  const unknown = validateReportedModules(
    [observationModule],
    [{ ...report, module_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }]
  )
  assert.equal(unknown.ok, true)
  if (unknown.ok) assert.equal(unknown.reports.length, 0)

  const mixed = validateReportedModules(
    [observationModule],
    [{ ...report, module_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }, report]
  )
  assert.equal(mixed.ok, true)
  if (mixed.ok) {
    assert.equal(mixed.reports.length, 1)
    assert.equal(mixed.reports[0]?.module_id, moduleId)
  }

  // Unknown collector ids are dropped; known observations still ingest.
  const extraCollector = validateReportedModules(
    [observationModule],
    [
      {
        ...report,
        observations: [
          ...report.observations,
          {
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            type: "file_exists",
            exists: true,
          },
        ],
      },
    ]
  )
  assert.equal(extraCollector.ok, true)
  if (extraCollector.ok) {
    assert.equal(extraCollector.reports[0]?.observations.length, 2)
  }

  const typeMismatch = validateReportedModules(
    [observationModule],
    [
      {
        ...report,
        observations: [{ id: collectorId, type: "file_exists", exists: true }],
      },
    ]
  )
  assert.equal(typeMismatch.ok, false)
  if (!typeMismatch.ok)
    assert.equal(typeMismatch.reason, "collector_type_mismatch")
})

test("omitting modules is allowed so older agents keep checking in", () => {
  const accepted = validateReportedModules([observationModule], undefined)
  assert.equal(accepted.ok, true)
  if (accepted.ok) assert.equal(accepted.reports.length, 0)
})

test("Hub encoder drops unknown module kinds before they reach the agent", () => {
  const encoded = encodeHubModules([
    observationModule,
    {
      ...observationModule,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      kind: "shell" as HubModuleDefinition["kind"],
    },
  ])
  assert.equal(encoded.length, 1)
  assert.equal(encoded[0]?.id, moduleId)
})
