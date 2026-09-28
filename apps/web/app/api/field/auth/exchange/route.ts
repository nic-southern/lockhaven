import { parseBearerToken } from "@nms/auth"

import { exchangeFieldHandoff } from "@/lib/field-auth"

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json(
      { error: "Request body could not be read." },
      { status: 400 }
    )
  }

  const code =
    body && typeof body === "object" && "code" in body
      ? String((body as { code?: unknown }).code ?? "")
      : ""

  const result = await exchangeFieldHandoff({
    code,
    headers: request.headers,
  })

  if (!result.ok) {
    const message =
      result.error === "code_expired"
        ? "That sign-in link expired. Try again from the app."
        : result.error === "code_used"
          ? "That sign-in link was already used."
          : result.error === "user_inactive"
            ? "This account cannot sign in right now."
            : "Sign-in could not be completed."
    return Response.json(
      { error: message, code: result.error },
      { status: 400 }
    )
  }

  return Response.json({
    token: result.token,
    expiresAt: result.expiresAt.toISOString(),
    sessionId: result.sessionId,
    user: result.user,
  })
}

/** Reject accidental GET so the exchange is never cacheable or linkable. */
export async function GET(request: Request) {
  const bearer = parseBearerToken(request.headers.get("authorization"))
  if (bearer) {
    return Response.json(
      { error: "Use POST to exchange a code." },
      { status: 405 }
    )
  }
  return Response.json(
    { error: "Use POST to exchange a code." },
    { status: 405 }
  )
}
