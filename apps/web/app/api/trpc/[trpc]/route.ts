import { randomUUID } from "node:crypto"

import { fetchRequestHandler } from "@trpc/server/adapters/fetch"

import { auth } from "@/auth"
import { verifyRequestOrigin } from "@/lib/request-origin"
import {
  appRouter,
  requestInfoFromHeaders,
  type ApiContext,
} from "@nms/api-contract"
import { parseBearerToken } from "@nms/auth"
import {
  resolveAdminPrincipalByEmail,
  resolveSessionPrincipal,
} from "@nms/auth/server"
import { db } from "@nms/db/client"

async function createTRPCContext(req: Request): Promise<ApiContext> {
  const session = await auth.api.getSession({
    headers: req.headers,
  })
  const email = session?.user?.email ?? null

  if (!email) {
    const bearer = parseBearerToken(req.headers.get("authorization"))
    if (bearer) {
      const actor = await resolveSessionPrincipal(bearer)
      if (actor) {
        return {
          db,
          actor,
          requestId: randomUUID(),
          request: requestInfoFromHeaders(req.headers),
        }
      }
    }
  }

  const actor = email ? await resolveAdminPrincipalByEmail(email) : null

  return {
    db,
    actor,
    requestId: randomUUID(),
    request: requestInfoFromHeaders(req.headers),
  }
}

function trustedOrigins() {
  return [
    process.env.BETTER_AUTH_URL,
    process.env.NEXTAUTH_URL,
    process.env.APP_BASE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
  ].filter((value): value is string => Boolean(value))
}

const handler = (req: Request) => {
  // Mutations ride on the session cookie, so a request that did not come
  // from a Console page must not be allowed to change anything.
  // Bearer session tokens (field app) are not cookie CSRF targets: the
  // origin guard already allows scripted callers without cookies.
  const verdict = verifyRequestOrigin({
    method: req.method,
    headers: req.headers,
    trustedOrigins: trustedOrigins(),
  })
  if (!verdict.ok) {
    return Response.json(
      { error: "Request origin not allowed", code: verdict.reason },
      { status: 403 }
    )
  }

  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createTRPCContext(req),
  })
}

export { handler as GET, handler as POST }
