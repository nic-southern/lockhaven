/**
 * Creates or refreshes the least-privilege login the Console web tier uses.
 *
 * The web role can read and write ordinary inventory tables but cannot alter
 * or remove history: audit events, connection logs, rollups, and peer samples
 * are insert/select only for it. Retention is the worker's job and it keeps
 * the owning connection. Safe to re-run; it also installs default privileges
 * so tables added by future migrations inherit the same grants.
 *
 * Required: DATABASE_URL (owner connection), WEB_DB_PASSWORD.
 * Optional: WEB_DB_USER (default lockhaven_web).
 */
import { resolve } from "node:path"

import { config } from "dotenv"
import pg from "pg"

config({ path: resolve(process.cwd(), "../../.env") })

const APPEND_ONLY_TABLES = [
  "audit_events",
  "connection_events",
  "connection_daily",
  "vpn_peer_samples",
]

const databaseUrl = process.env.DATABASE_URL
const password = process.env.WEB_DB_PASSWORD
const roleName = process.env.WEB_DB_USER ?? "lockhaven_web"

if (!databaseUrl) {
  console.error("DATABASE_URL is required.")
  process.exit(1)
}

if (!password) {
  console.log(
    "WEB_DB_PASSWORD is not set; skipping web database role provisioning."
  )
  process.exit(0)
}

if (!/^[a-z_][a-z0-9_]*$/.test(roleName)) {
  console.error("WEB_DB_USER must be a plain lowercase identifier.")
  process.exit(1)
}

const client = new pg.Client({ connectionString: databaseUrl })
await client.connect()

const ident = (value) => `"${value.replace(/"/g, '""')}"`
const literal = (value) => `'${String(value).replace(/'/g, "''")}'`

try {
  const {
    rows: [{ current_database: databaseName, current_user: owner }],
  } = await client.query("select current_database(), current_user")

  await client.query("begin")

  const existing = await client.query(
    "select 1 from pg_roles where rolname = $1",
    [roleName]
  )
  if (existing.rowCount === 0) {
    await client.query(
      `create role ${ident(roleName)} with login password ${literal(password)}`
    )
    console.log(`Created role ${roleName}.`)
  } else {
    await client.query(
      `alter role ${ident(roleName)} with login password ${literal(password)}`
    )
    console.log(`Refreshed password for role ${roleName}.`)
  }

  await client.query(
    `grant connect on database ${ident(databaseName)} to ${ident(roleName)}`
  )
  await client.query(`grant usage on schema public to ${ident(roleName)}`)
  await client.query(
    `grant select, insert, update, delete on all tables in schema public to ${ident(roleName)}`
  )
  await client.query(
    `grant usage, select on all sequences in schema public to ${ident(roleName)}`
  )

  for (const table of APPEND_ONLY_TABLES) {
    const present = await client.query("select to_regclass($1) as oid", [
      `public.${table}`,
    ])
    if (!present.rows[0]?.oid) continue
    await client.query(
      `revoke update, delete, truncate on table ${ident(table)} from ${ident(roleName)}`
    )
  }

  // Tables created later by the migration owner inherit the same shape.
  await client.query(
    `alter default privileges for role ${ident(owner)} in schema public grant select, insert, update, delete on tables to ${ident(roleName)}`
  )
  await client.query(
    `alter default privileges for role ${ident(owner)} in schema public grant usage, select on sequences to ${ident(roleName)}`
  )

  // The migration ledger is the owner's alone.
  const ledger = await client.query(
    "select to_regclass('public.lockhaven_migrations') as oid"
  )
  if (ledger.rows[0]?.oid) {
    await client.query(
      `revoke all on table lockhaven_migrations from ${ident(roleName)}`
    )
  }

  await client.query("commit")

  const check = await client.query(
    `
      select table_name, string_agg(privilege_type, ',' order by privilege_type) as privileges
      from information_schema.role_table_grants
      where grantee = $1 and table_name = any($2::text[])
      group by table_name
      order by table_name
    `,
    [roleName, APPEND_ONLY_TABLES]
  )
  for (const row of check.rows) {
    console.log(`  ${row.table_name}: ${row.privileges}`)
  }
  console.log(`Web database role ${roleName} ready.`)
} catch (error) {
  await client.query("rollback").catch(() => {})
  throw error
} finally {
  await client.end()
}
