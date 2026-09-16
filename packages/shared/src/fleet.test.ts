import assert from "node:assert/strict"
import test from "node:test"

import { agentCommandKinds, hubCheckInResponse } from "./telemetry"
import {
  applyCommandAcks,
  commandsForCheckIn,
  compareSemver,
  hasOpenCommandOfKind,
  isAgentBehind,
  isAgentCommandKind,
  normalizeAgentPlatform,
  parseSemver,
  pickDesiredRelease,
  resolveAgentChannel,
  sha256HexSchema,
} from "./fleet"

test("semver comparison orders dotted versions numerically", () => {
  assert.equal(compareSemver("1.9.0", "1.10.0") < 0, true)
  assert.equal(compareSemver("1.10.0", "1.9.0") > 0, true)
  assert.equal(compareSemver("1.2.3", "1.2.3"), 0)
  assert.equal(compareSemver("2.0.0", "1.99.99") > 0, true)
  assert.equal(compareSemver("1.2", "1.2.0"), 0)
})

test("semver treats a pre-release as older than the matching release", () => {
  assert.equal(compareSemver("1.0.0-beta", "1.0.0") < 0, true)
  assert.equal(compareSemver("1.0.0", "1.0.0-beta") > 0, true)
  assert.equal(compareSemver("1.0.0-alpha", "1.0.0-beta") < 0, true)
})

test("semver parser ignores build metadata and rejects empty values", () => {
  assert.deepEqual(parseSemver("1.2.3+build.9"), {
    major: 1,
    minor: 2,
    patch: 3,
    prerelease: null,
  })
  assert.equal(parseSemver(""), null)
  assert.equal(parseSemver("   "), null)
  assert.equal(parseSemver("not-a-version"), null)
})

test("a device is behind when its version is older than the desired release", () => {
  assert.equal(isAgentBehind("0.1.0", "0.2.0"), true)
  assert.equal(isAgentBehind("0.2.0", "0.2.0"), false)
  assert.equal(isAgentBehind("0.3.0", "0.2.0"), false)
  assert.equal(isAgentBehind(null, "0.2.0"), true)
  assert.equal(isAgentBehind("0.1.0", null), false)
  assert.equal(isAgentBehind("mystery", "1.0.0"), true)
})

test("channel resolution prefers site, then organization, then stable", () => {
  assert.equal(resolveAgentChannel("beta", "stable"), "beta")
  assert.equal(resolveAgentChannel(null, "beta"), "beta")
  assert.equal(resolveAgentChannel("", "stable"), "stable")
  assert.equal(resolveAgentChannel("nightly", "beta"), "beta")
  assert.equal(resolveAgentChannel(null, "unknown"), "stable")
  assert.equal(resolveAgentChannel(null, null), "stable")
})

test("platform mapping follows the reported operating system family", () => {
  assert.equal(normalizeAgentPlatform("Debian GNU/Linux 12"), "linux")
  assert.equal(normalizeAgentPlatform("Windows 11"), "windows")
  assert.equal(normalizeAgentPlatform("darwin"), "macos")
  assert.equal(normalizeAgentPlatform("macOS 15"), "macos")
  assert.equal(normalizeAgentPlatform("Android 14"), "android")
  assert.equal(normalizeAgentPlatform("FreeBSD"), "all")
  assert.equal(normalizeAgentPlatform(null), "all")
})

test("desired release picks the newest version for the channel and platform", () => {
  const releases = [
    {
      version: "1.0.0",
      channel: "stable" as const,
      platform: "linux" as const,
      downloadUrl: "https://example.com/1.0.0",
    },
    {
      version: "1.1.0",
      channel: "stable" as const,
      platform: "linux" as const,
      downloadUrl: "https://example.com/1.1.0",
    },
    {
      version: "2.0.0-beta",
      channel: "beta" as const,
      platform: "linux" as const,
      downloadUrl: "https://example.com/2.0.0-beta",
    },
    {
      version: "1.2.0",
      channel: "stable" as const,
      platform: "all" as const,
      downloadUrl: "https://example.com/1.2.0-all",
    },
  ]

  const linuxStable = pickDesiredRelease(releases, "stable", "linux")
  assert.equal(linuxStable?.version, "1.1.0")
  assert.equal(linuxStable?.downloadUrl, "https://example.com/1.1.0")

  const windowsStable = pickDesiredRelease(releases, "stable", "windows")
  assert.equal(windowsStable?.version, "1.2.0")

  const linuxBeta = pickDesiredRelease(releases, "beta", "linux")
  assert.equal(linuxBeta?.version, "2.0.0-beta")

  assert.equal(pickDesiredRelease(releases, "beta", "windows"), null)
})

test("check-in delivery includes only pending allowlisted commands", () => {
  const delivered = commandsForCheckIn([
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      kind: "reboot",
      status: "pending",
    },
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      kind: "restart",
      status: "sent",
    },
    {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      kind: "ssh",
      status: "pending",
    },
    {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      kind: "update",
      status: "succeeded",
    },
  ])

  assert.deepEqual(delivered, [
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", kind: "reboot" },
  ])
  assert.ok(delivered.every((command) => Object.keys(command).length === 2))
  assert.ok(
    delivered.every((command) =>
      (agentCommandKinds as readonly string[]).includes(command.kind)
    )
  )
})

test("command acknowledgements move open rows to a terminal status", () => {
  const updated = applyCommandAcks(
    [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        kind: "reboot",
        status: "sent",
      },
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        kind: "restart",
        status: "pending",
      },
      {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        kind: "update",
        status: "succeeded",
      },
    ],
    [
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "succeeded" },
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", status: "refused" },
      { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", status: "failed" },
      { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", status: "succeeded" },
    ]
  )

  assert.equal(updated[0]?.status, "succeeded")
  assert.equal(updated[1]?.status, "refused")
  assert.equal(updated[2]?.status, "succeeded")
})

test("a second open command of the same kind is rejected", () => {
  const existing = [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      kind: "reboot",
      status: "pending" as const,
    },
  ]
  assert.equal(hasOpenCommandOfKind(existing, "reboot"), true)
  assert.equal(hasOpenCommandOfKind(existing, "restart"), false)
  assert.equal(
    hasOpenCommandOfKind([{ ...existing[0]!, status: "succeeded" }], "reboot"),
    false
  )
})

test("command kinds are a closed whitelist", () => {
  assert.equal(isAgentCommandKind("reboot"), true)
  assert.equal(isAgentCommandKind("restart"), true)
  assert.equal(isAgentCommandKind("update"), true)
  assert.equal(isAgentCommandKind("ssh"), false)
  assert.equal(isAgentCommandKind("rm -rf /"), false)
})

test("release checksums must be 64 hex characters", () => {
  assert.equal(sha256HexSchema.safeParse("a".repeat(64)).success, true)
  assert.equal(sha256HexSchema.safeParse("zz".repeat(32)).success, false)
  assert.equal(sha256HexSchema.safeParse("abc").success, false)
})

test("check-in response carries desired version, download link, and typed commands", () => {
  const commandId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  const response = hubCheckInResponse({
    desiredAgentVersion: "1.4.0",
    downloadUrl: "https://downloads.example.com/agent-1.4.0",
    commands: commandsForCheckIn([
      { id: commandId, kind: "update", status: "pending" },
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        kind: "reboot",
        status: "sent",
      },
    ]),
  })

  assert.equal(response.ok, true)
  assert.equal(response.desired_agent_version, "1.4.0")
  assert.equal(
    response.download_url,
    "https://downloads.example.com/agent-1.4.0"
  )
  assert.deepEqual(response.commands, [{ id: commandId, kind: "update" }])
  const serialized = JSON.stringify(response)
  assert.equal(serialized.includes("script"), false)
  assert.equal(serialized.includes("ssh"), false)
})
