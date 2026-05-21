import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

import dotenv from "dotenv"
import { defineConfig } from "drizzle-kit"

const packageDir = dirname(fileURLToPath(import.meta.url))
const rootEnvPath = resolve(packageDir, "../../.env")

dotenv.config({ path: rootEnvPath })

if (!process.env.DATABASE_URL) {
  throw new Error(
    `DATABASE_URL is required. Expected to load it from ${rootEnvPath}`
  )
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  strict: true,
  verbose: true,
})
