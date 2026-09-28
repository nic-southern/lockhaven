import { parseBearerToken } from "@nms/auth"

import { revokeFieldSession } from "@/lib/field-auth"

export async function POST(request: Request) {
  const token = parseBearerToken(request.headers.get("authorization"))
  if (!token) {
    return Response.json({ error: "Sign in to continue." }, { status: 401 })
  }

  const result = await revokeFieldSession({
    token,
    headers: request.headers,
  })

  if (!result.ok) {
    return Response.json({ error: "Session not found." }, { status: 404 })
  }

  return Response.json({ ok: true })
}
