import type { AdminPrincipal } from "@nms/auth"
import type { db as dbClient } from "@nms/db/client"

export type ApiContext = {
  db: typeof dbClient
  actor: AdminPrincipal | null
  requestId: string
}
