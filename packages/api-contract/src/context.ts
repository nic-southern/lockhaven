import type { ActorPrincipal } from "@nms/auth"
import type { db as dbClient } from "@nms/db/client"

export type ApiContext = {
  db: typeof dbClient
  actor: ActorPrincipal | null
  requestId: string
}
