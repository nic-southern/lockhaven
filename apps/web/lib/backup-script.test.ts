import assert from "node:assert/strict"
import {
  chmod,
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import test from "node:test"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const backupScript = join(repoRoot, "scripts/backup.sh")
const restoreScript = join(repoRoot, "scripts/restore.sh")
const installBackupScript = join(repoRoot, "infra/systemd/install-backup.sh")
const backupService = join(repoRoot, "infra/systemd/lockhaven-backup.service")
const backupTimer = join(repoRoot, "infra/systemd/lockhaven-backup.timer")

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

async function modeOf(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777
}

async function stageHostTree(root: string): Promise<void> {
  await mkdir(join(root, "scripts"), { recursive: true })
  await mkdir(join(root, "infra/systemd"), { recursive: true })
  await copyFile(backupScript, join(root, "scripts/backup.sh"))
  await copyFile(restoreScript, join(root, "scripts/restore.sh"))
  await copyFile(
    installBackupScript,
    join(root, "infra/systemd/install-backup.sh")
  )
  await copyFile(
    backupService,
    join(root, "infra/systemd/lockhaven-backup.service")
  )
  await copyFile(
    backupTimer,
    join(root, "infra/systemd/lockhaven-backup.timer")
  )
  await chmod(join(root, "infra/systemd/install-backup.sh"), 0o755)
}

async function stubRootCommands(bin: string): Promise<string> {
  await mkdir(bin, { recursive: true })
  await writeFile(
    join(bin, "id"),
    `#!/bin/sh
if [ "$1" = "-u" ]; then echo 0; exit 0; fi
exec /usr/bin/id "$@"
`,
    { mode: 0o755 }
  )
  await writeFile(
    join(bin, "systemctl"),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$SYSTEMCTL_LOG"
`,
    { mode: 0o755 }
  )
  return `${bin}:${process.env.PATH ?? ""}`
}

test("install-backup skips copy when source and dest are the same file", async () => {
  const root = await mkdtemp(join(tmpdir(), "lockhaven-install-same-"))
  await stageHostTree(root)
  await chmod(join(root, "scripts/backup.sh"), 0o644)
  await chmod(join(root, "scripts/restore.sh"), 0o644)
  const units = join(root, "units")
  await mkdir(units)
  const systemctlLog = join(root, "systemctl.log")
  await writeFile(systemctlLog, "")
  const path = await stubRootCommands(join(root, "bin"))

  const src = await realpath(
    join(root, "infra/systemd/../../scripts/backup.sh")
  )
  const dest = await realpath(join(root, "scripts/backup.sh"))
  assert.equal(src, dest)

  const result = await run(
    "bash",
    [join(root, "infra/systemd/install-backup.sh")],
    {
      ...process.env,
      PATH: path,
      LOCKHAVEN_ROOT: root,
      LOCKHAVEN_SYSTEMD_DIR: units,
      SYSTEMCTL_LOG: systemctlLog,
    }
  )
  assert.equal(result.code, 0, result.stderr)
  assert.doesNotMatch(result.stderr, /are the same file/)
  assert.equal(await modeOf(join(root, "scripts/backup.sh")), 0o755)
  assert.equal(await modeOf(join(root, "scripts/restore.sh")), 0o755)
  assert.equal(await modeOf(join(root, "backup.env")), 0o600)
  const envFile = await readFile(join(root, "backup.env"), "utf8")
  assert.match(envFile, /^BACKUP_PASSPHRASE=$/m)
  const ctl = await readFile(systemctlLog, "utf8")
  assert.match(ctl, /daemon-reload/)
  assert.doesNotMatch(ctl, /enable/)
  assert.match(result.stdout, /Units installed/)
})

test("install-backup copies scripts when ROOT_DIR is a different prefix", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "lockhaven-install-src-"))
  const destRoot = await mkdtemp(join(tmpdir(), "lockhaven-install-dest-"))
  await stageHostTree(workspace)
  await writeFile(
    join(workspace, "scripts/backup.sh"),
    "#!/bin/sh\necho staged-backup\n",
    { mode: 0o644 }
  )
  await mkdir(join(destRoot, "scripts"), { recursive: true })
  await writeFile(
    join(destRoot, "scripts/backup.sh"),
    "#!/bin/sh\necho stale\n"
  )
  const units = join(destRoot, "units")
  await mkdir(units, { recursive: true })
  const systemctlLog = join(destRoot, "systemctl.log")
  await writeFile(systemctlLog, "")
  const path = await stubRootCommands(join(destRoot, "bin"))

  const src = await realpath(join(workspace, "scripts/backup.sh"))
  assert.notEqual(src, await realpath(join(destRoot, "scripts/backup.sh")))

  const result = await run(
    "bash",
    [join(workspace, "infra/systemd/install-backup.sh")],
    {
      ...process.env,
      PATH: path,
      LOCKHAVEN_ROOT: destRoot,
      LOCKHAVEN_SYSTEMD_DIR: units,
      SYSTEMCTL_LOG: systemctlLog,
    }
  )
  assert.equal(result.code, 0, result.stderr)
  assert.notEqual(await realpath(join(destRoot, "scripts/backup.sh")), src)
  assert.equal(
    await readFile(join(destRoot, "scripts/backup.sh"), "utf8"),
    "#!/bin/sh\necho staged-backup\n"
  )
  assert.equal(await modeOf(join(destRoot, "scripts/backup.sh")), 0o755)
  assert.equal(await modeOf(join(destRoot, "scripts/restore.sh")), 0o755)
  assert.equal(
    await readFile(join(destRoot, "scripts/restore.sh"), "utf8"),
    await readFile(join(workspace, "scripts/restore.sh"), "utf8")
  )
})

test("install-backup keeps existing backup.env and enables the timer when a passphrase is set", async () => {
  const root = await mkdtemp(join(tmpdir(), "lockhaven-install-env-"))
  await stageHostTree(root)
  const passphrase = `test-${randomBytes(16).toString("hex")}`
  await writeFile(
    join(root, "backup.env"),
    `BACKUP_PASSPHRASE=${passphrase}\nKEEP=1\n`,
    { mode: 0o600 }
  )
  const units = join(root, "units")
  await mkdir(units)
  const systemctlLog = join(root, "systemctl.log")
  await writeFile(systemctlLog, "")
  const path = await stubRootCommands(join(root, "bin"))

  const result = await run(
    "bash",
    [join(root, "infra/systemd/install-backup.sh")],
    {
      ...process.env,
      PATH: path,
      LOCKHAVEN_ROOT: root,
      LOCKHAVEN_SYSTEMD_DIR: units,
      SYSTEMCTL_LOG: systemctlLog,
    }
  )
  assert.equal(result.code, 0, result.stderr)
  const envFile = await readFile(join(root, "backup.env"), "utf8")
  assert.equal(envFile, `BACKUP_PASSPHRASE=${passphrase}\nKEEP=1\n`)
  assert.equal(result.stdout.includes(passphrase), false)
  assert.equal(result.stderr.includes(passphrase), false)
  const ctl = await readFile(systemctlLog, "utf8")
  assert.match(ctl, /enable --now lockhaven-backup.timer/)
  assert.match(result.stdout, /Backup timer installed and enabled/)
})
