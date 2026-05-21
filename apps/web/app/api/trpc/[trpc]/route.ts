import { randomUUID } from "node:crypto"

import { fetchRequestHandler } from "@trpc/server/adapters/fetch"

import { auth } from "@/auth"
import { appRouter, type ApiContext } from "@nms/api-contract"
import { resolveAdminPrincipalByEmail } from "@nms/auth/server"
import { db } from "@nms/db/client"

async function createTRPCContext(req: Request): Promise<ApiContext> {
  const session = await auth.api.getSession({
    headers: req.headers,
  })
  const email = session?.user?.email
  const actor = email ? await resolveAdminPrincipalByEmail(email) : null

  return {
    db,
    actor,
    requestId: randomUUID(),
  }
}

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createTRPCContext(req),
  })

export { handler as GET, handler as POST }
