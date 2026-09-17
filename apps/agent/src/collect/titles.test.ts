import assert from "node:assert/strict"
import test from "node:test"

import {
  collectTitles,
  hashConfigBytes,
  parseTitlesWatchList,
  processNameMatches,
  titlesFromWatches,
  titlesFileCandidates,
} from "./titles"

test("parses a titles watch list object or array", () => {
  const fromObject = parseTitlesWatchList(`{
    "titles": [
      {
        "key": "cabinet-a",
        "title": "Cabinet A",
        "process": "game-bin",
        "build_file": "/opt/game/BUILD",
        "config_path": "/opt/game/config.json"
      }
    ]
  }`)
  assert.equal(fromObject.length, 1)
  assert.equal(fromObject[0]?.title, "Cabinet A")
  assert.equal(fromObject[0]?.process, "game-bin")

  const fromArray = parseTitlesWatchList(
    `[{"title":"Cabinet B","build":"1.2.3"}]`
  )
  assert.equal(fromArray[0]?.title, "Cabinet B")
  assert.equal(fromArray[0]?.build, "1.2.3")
})

test("ignores invalid JSON and rows without a title", () => {
  assert.deepEqual(parseTitlesWatchList("{"), [])
  assert.deepEqual(parseTitlesWatchList(`[{"process":"game-bin"}]`), [])
})

test("process match uses comm and cmdline basename", () => {
  const entries = [
    { comm: "game-bin", cmdline: "/opt/game/game-bin\0--kiosk" },
    { comm: "sshd", cmdline: "/usr/sbin/sshd" },
  ]
  assert.equal(processNameMatches("game-bin", entries), true)
  assert.equal(processNameMatches("GAME-BIN", entries), true)
  assert.equal(processNameMatches("/opt/game/game-bin", entries), true)
  assert.equal(processNameMatches("sshd", entries), true)
  assert.equal(processNameMatches("other", entries), false)
})

test("config hash is stable across input order", () => {
  const left = hashConfigBytes([
    { path: "b.txt", content: Buffer.from("b") },
    { path: "a.txt", content: Buffer.from("a") },
  ])
  const right = hashConfigBytes([
    { path: "a.txt", content: Buffer.from("a") },
    { path: "b.txt", content: Buffer.from("b") },
  ])
  assert.equal(left, right)
  assert.equal(left.length, 64)
})

test("titlesFromWatches fills build, hash, and process fields", async () => {
  const payload = await titlesFromWatches(
    [
      {
        key: "cabinet-a",
        title: "Cabinet A",
        process: "game-bin",
        build_file: "/opt/game/BUILD",
        config_path: "/opt/game/config.json",
      },
    ],
    {
      readText: async (filePath) =>
        filePath === "/opt/game/BUILD" ? "2026.04.11\n" : null,
      configParts: async () => [
        { path: "config.json", content: Buffer.from('{"theme":"dark"}') },
      ],
      processes: [{ comm: "game-bin", cmdline: "/opt/game/game-bin" }],
    }
  )

  assert.equal(payload.items.length, 1)
  assert.equal(payload.items[0]?.key, "cabinet-a")
  assert.equal(payload.items[0]?.build, "2026.04.11")
  assert.equal(payload.items[0]?.process_running, true)
  assert.equal(payload.items[0]?.config_hash?.length, 64)
})

test("collectTitles omits the payload when no watch file exists", async () => {
  const result = await collectTitles({
    LOCKHAVEN_TITLES_FILE: "/tmp/lockhaven-missing-titles.json",
  } as NodeJS.ProcessEnv)
  assert.equal(result, undefined)
})

test("titles file candidates use LOCKHAVEN_TITLES_FILE alone when set", () => {
  const paths = titlesFileCandidates({
    LOCKHAVEN_TITLES_FILE: "/tmp/titles.json",
  } as NodeJS.ProcessEnv)
  assert.deepEqual(paths, ["/tmp/titles.json"])
})
