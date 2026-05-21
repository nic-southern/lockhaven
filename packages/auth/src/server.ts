import type { IncomingMessage } from "node:http"

import { eq, user } from "@nms/db"
import { db } from "@nms/db/client"

import { auth, type AdminPrincipal, permissionsForRole } from "./index"

export async function resolveAdminPrincipalFromRequest(
  req: IncomingMessage
): Promise<AdminPrincipal | null> {
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") {
      headers[key] = value
    } else if (Array.isArray(value) && value.length > 0) {
      headers[key] = value[0]
    }
  }

  const session = await auth.api.getSession({
    headers: new Headers(headers),
  })

  if (!session?.user.email) {
    return null
  }

  return resolveAdminPrincipalByEmail(session.user.email)
}

export async function resolveAdminPrincipalByEmail(
  email: string
): Promise<AdminPrincipal | null> {
  const [record] = await db
    .select()
    .from(user)
    .where(eq(user.email, email.toLowerCase()))

  if (!record || record.status !== "active") {
    return null
  }

  return {
    id: record.id,
    email: record.email,
    name: record.name,
    permissions: permissionsForRole(record.role),
  }
}
