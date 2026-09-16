import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import test from "node:test"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const backupScript = join(repoRoot, "scripts/backup.sh")
const restoreScript = join(repoRoot, "scripts/restore.sh")

function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      cwd: repoRoot,
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
    })
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8")
    })
    child.on("error", reject)
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

test("backup dry-run requires a passphrase and never prints it", async () => {
  const root = await mkdtemp(join(tmpdir(), "lockhaven-backup-"))
  const passphrase = `test-${randomBytes(16).toString("hex")}`
  await writeFile(
    join(root, ".env.deploy"),
    "DATABASE_URL=postgresql://postgres:unused@127.0.0.1:5432/nms_vpn\n",
    { mode: 0o600 }
  )

  const missing = await run("bash", [backupScript], {
    ...process.env,
    DRY_RUN: "1",
    LOCKHAVEN_ROOT: root,
    LOCKHAVEN_ENV_FILE: join(root, ".env.deploy"),
    LOCKHAVEN_BACKUP_DIR: join(root, "backups"),
    BACKUP_PASSPHRASE: "",
  })
  assert.notEqual(missing.code, 0)
  assert.match(missing.stderr, /BACKUP_PASSPHRASE/)

  const ok = await run("bash", [backupScript], {
    ...process.env,
    DRY_RUN: "1",
    LOCKHAVEN_ROOT: root,
    LOCKHAVEN_ENV_FILE: join(root, ".env.deploy"),
    LOCKHAVEN_BACKUP_DIR: join(root, "backups"),
    LOCKHAVEN_WG_DIR: join(root, "wg-missing"),
    BACKUP_PASSPHRASE: passphrase,
  })
  assert.equal(ok.code, 0, ok.stderr)
  assert.match(ok.stdout, /Dry run/)
  assert.equal(ok.stdout.includes(passphrase), false)
  assert.equal(ok.stderr.includes(passphrase), false)
})

test("backup encrypts an archive that restore can dry-run decrypt", async () => {
  const root = await mkdtemp(join(tmpdir(), "lockhaven-backup-rt-"))
  const passphrase = randomBytes(16).toString("hex")
  const bin = join(root, "bin")
  await mkdir(bin)
  await writeFile(
    join(bin, "pg_dump"),
    `#!/bin/sh
file=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --file)
      file="$2"
      shift 2
      ;;
    --file=*)
      file="\${1#--file=}"
      shift
      ;;
    *)
      shift
      ;;
  esac
done
printf 'fixture-dump' > "$file"
`,
    { mode: 0o755 }
  )
  await writeFile(
    join(root, ".env.deploy"),
    "DATABASE_URL=postgresql://postgres:unused@127.0.0.1:5432/nms_vpn\n",
    { mode: 0o600 }
  )
  await mkdir(join(root, "wg"))
  await writeFile(join(root, "wg", "server-public.key"), "not-a-real-key\n", {
    mode: 0o644,
  })

  const backup = await run("bash", [backupScript], {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    LOCKHAVEN_ROOT: root,
    LOCKHAVEN_ENV_FILE: join(root, ".env.deploy"),
    LOCKHAVEN_BACKUP_DIR: join(root, "backups"),
    LOCKHAVEN_WG_DIR: join(root, "wg"),
    BACKUP_PASSPHRASE: passphrase,
  })
  assert.equal(backup.code, 0, backup.stderr)
  assert.equal(backup.stdout.includes(passphrase), false)
  assert.equal(backup.stderr.includes(passphrase), false)
  assert.equal(backup.stdout.includes("fixture-dump"), false)

  const { readdir } = await import("node:fs/promises")
  const archives = (await readdir(join(root, "backups"))).filter((name) =>
    name.endsWith(".tar.enc")
  )
  assert.equal(archives.length, 1)
  const archive = join(root, "backups", archives[0] ?? "")
  const ciphertext = await readFile(archive)
  assert.equal(ciphertext.includes(Buffer.from("fixture-dump")), false)

  const restore = await run("bash", [restoreScript, archive], {
    ...process.env,
    DRY_RUN: "1",
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    LOCKHAVEN_ROOT: root,
    BACKUP_PASSPHRASE: passphrase,
  })
  assert.equal(restore.code, 0, restore.stderr)
  assert.match(restore.stdout, /Control-plane dump is present/)
  assert.equal(restore.stdout.includes(passphrase), false)
  assert.equal(restore.stderr.includes(passphrase), false)
  assert.equal(restore.stdout.includes("fixture-dump"), false)
})
