import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { config } from "dotenv"
import pg from "pg"

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")

config({ path: resolve(packageDir, "../../.env") })

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required.")
  process.exit(1)
}

const journalPath = resolve(packageDir, "drizzle/meta/_journal.json")
const migrationsDir = resolve(packageDir, "drizzle")
const journal = JSON.parse(await readFile(journalPath, "utf8"))
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
})

function checksum(value) {
  return createHash("sha256").update(value).digest("hex")
}

try {
  await pool.query("select pg_advisory_lock(hashtext('lockhaven_migrations'))")
  await pool.query(`
    create table if not exists lockhaven_migrations (
      tag text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `)

  const applied = new Map(
    (
      await pool.query("select tag, checksum from lockhaven_migrations")
    ).rows.map((row) => [row.tag, row.checksum])
  )

  for (const entry of journal.entries) {
    const filename = `${entry.tag}.sql`
    const sql = await readFile(resolve(migrationsDir, filename), "utf8")
    const hash = checksum(sql)
    const appliedChecksum = applied.get(entry.tag)

    if (appliedChecksum) {
      if (appliedChecksum !== hash) {
        throw new Error(`Migration checksum changed: ${entry.tag}`)
      }

      console.log(`Skipping migration: ${entry.tag}`)
      continue
    }

    console.log(`Applying migration: ${entry.tag}`)
    await pool.query("begin")
    try {
      await pool.query(sql)
      await pool.query(
        "insert into lockhaven_migrations (tag, checksum) values ($1, $2)",
        [entry.tag, hash]
      )
      await pool.query("commit")
    } catch (error) {
      await pool.query("rollback")
      throw error
    }
  }

  console.log("Database migrations ready.")
} finally {
  await pool.query(
    "select pg_advisory_unlock(hashtext('lockhaven_migrations'))"
  )
  await pool.end()
}
