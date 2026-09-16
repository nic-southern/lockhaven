import { randomUUID } from "node:crypto"

import { appRouter, requestInfoFromHeaders } from "@nms/api-contract"
import { parseBearerToken } from "@nms/auth"
import { resolveApiKeyPrincipal } from "@nms/auth/server"
import { db } from "@nms/db/client"

import {
  addressKey,
  enforceRateLimit,
  rateLimitPolicies,
} from "@/lib/rate-limit-server"
import { restV1OpenApi } from "@/lib/rest-v1-openapi"
import {
  dispatchRestV1,
  restErrorFromUnknown,
  type RestV1Caller,
} from "@/lib/rest-v1"

function jsonResponse(body: unknown, status: number) {
  return Response.json(body, { status })
}

async function readJsonBody(request: Request) {
  const contentType = request.headers.get("content-type") ?? ""
  if (request.method === "GET" || request.method === "HEAD") {
    return undefined
  }
  if (!contentType.includes("application/json")) {
    const text = await request.text()
    if (!text.trim()) return undefined
    throw new SyntaxError("Expected JSON")
  }
  return request.json()
}

export async function handleRestV1Request(request: Request, path: string[]) {
  if (
    request.method === "GET" &&
    path.length === 1 &&
    path[0] === "openapi.json"
  ) {
    const limited = await enforceRateLimit(
      `apikey:openapi:ip:${addressKey(request.headers)}`,
      rateLimitPolicies.apiKeyAuthPerAddress
    )
    if (limited) return limited
    return jsonResponse(restV1OpenApi, 200)
  }

  const secret = parseBearerToken(request.headers.get("authorization"))
  if (!secret) {
    const limited = await enforceRateLimit(
      `apikey:auth:ip:${addressKey(request.headers)}`,
      rateLimitPolicies.apiKeyAuthPerAddress
    )
    if (limited) return limited
    return jsonResponse({ error: "Sign in with a key to continue." }, 401)
  }

  const authLimited = await enforceRateLimit(
    `apikey:auth:ip:${addressKey(request.headers)}`,
    rateLimitPolicies.apiKeyAuthPerAddress
  )
  if (authLimited) return authLimited

  const actor = await resolveApiKeyPrincipal(secret)
  if (!actor) {
    return jsonResponse({ error: "Invalid or expired key." }, 401)
  }

  const keyLimited = await enforceRateLimit(
    `apikey:${actor.apiKeyId}`,
    rateLimitPolicies.apiKeyPerKey
  )
  if (keyLimited) return keyLimited

  let body: unknown
  try {
    body = await readJsonBody(request)
  } catch {
    return jsonResponse({ error: "Request body could not be read." }, 400)
  }

  const caller = appRouter.createCaller({
    db,
    actor,
    requestId: randomUUID(),
    request: requestInfoFromHeaders(request.headers),
  }) as RestV1Caller

  try {
    const result = await dispatchRestV1({
      method: request.method,
      path,
      searchParams: new URL(request.url).searchParams,
      body,
      caller,
    })
    return jsonResponse(result.body, result.status)
  } catch (error) {
    const mapped = restErrorFromUnknown(error)
    return jsonResponse(mapped.body, mapped.status)
  }
}
