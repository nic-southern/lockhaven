import { randomBytes, randomUUID, scryptSync } from "node:crypto"
import { resolve } from "node:path"

import { config } from "dotenv"
import pg from "pg"

config({ path: resolve(process.cwd(), "../../.env") })

const email = process.env.ADMIN_EMAIL?.toLowerCase()
const password = process.env.ADMIN_PASSWORD
const name = process.env.ADMIN_NAME ?? email
const role = process.env.ADMIN_ROLE ?? "owner"
const now = new Date()

if (!email || !password) {
  console.error("ADMIN_EMAIL and ADMIN_PASSWORD are required.")
  process.exit(1)
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required.")
  process.exit(1)
}

function hashPassword(value) {
  const salt = randomBytes(16).toString("base64url")
  const derivedKey = scryptSync(value, salt, 64)

  return `scrypt$${salt}$${derivedKey.toString("base64url")}`
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
})

try {
  const userResult = await pool.query(
    `
      insert into "user" (id, email, name, role, status, email_verified, created_at, updated_at)
      values ($1, $2, $3, $4, 'active', true, $5, $5)
      on conflict (email) do update set
        name = excluded.name,
        role = excluded.role,
        status = 'active',
        email_verified = true,
        updated_at = excluded.updated_at
      returning id
    `,
    [randomUUID(), email, name, role, now]
  )
  const userId = userResult.rows[0].id

  await pool.query(
    `
      delete from account
      where user_id = $1 and provider_id = 'credential'
    `,
    [userId]
  )

  await pool.query(
    `
      insert into account (id, user_id, account_id, provider_id, password, created_at, updated_at)
      values ($1, $2, $2, 'credential', $3, $4, $4)
    `,
    [randomUUID(), userId, hashPassword(password), now]
  )

  console.log(`Admin user ready: ${email}`)
} finally {
  await pool.end()
}
