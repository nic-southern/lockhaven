import "dotenv/config"

import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

const databaseUrl = process.env.DATABASE_URL

export const pool = new Pool({
  ...(databaseUrl ? { connectionString: databaseUrl } : {}),
  max: Number(process.env.PGPOOL_SIZE ?? 10),
})

export const db = drizzle(pool)
