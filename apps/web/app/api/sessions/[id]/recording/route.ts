import { createReadStream } from "node:fs"
import { Readable } from "node:stream"
import { stat } from "node:fs/promises"

import { eq } from "drizzle-orm"
import { type NextRequest, NextResponse } from "next/server"

import { auth } from "@/auth"
import { authorize } from "@nms/auth"
import { resolveAdminPrincipalByEmail } from "@nms/auth/server"
import { devices, remoteSessions } from "@nms/db"
import { db } from "@nms/db/client"
import {
  resolveRecordingFilePath,
  sessionRecordingRoot,
} from "@nms/shared/session-recording"

async function authorizedSession(request: NextRequest, sessionId: string) {
  const session = await auth.api.getSession({
    headers: request.headers,
  })
  const email = session?.user?.email
  if (!email) {
    return {
      error: NextResponse.json(
        { error: "Sign in to continue." },
        { status: 401 }
      ),
    }
  }
  const actor = await resolveAdminPrincipalByEmail(email)
  if (!actor) {
    return {
      error: NextResponse.json(
        { error: "Sign in to continue." },
        { status: 401 }
      ),
    }
  }

  const [row] = await db
    .select({
      session: remoteSessions,
      organizationId: devices.organizationId,
      siteId: devices.siteId,
    })
    .from(remoteSessions)
    .innerJoin(devices, eq(devices.id, remoteSessions.deviceId))
    .where(eq(remoteSessions.id, sessionId))

  if (!row) {
    return {
      error: NextResponse.json({ error: "Not found." }, { status: 404 }),
    }
  }

  const decision = authorize(actor, "device:view", {
    kind: "device",
    organizationId: row.organizationId,
    siteId: row.siteId,
  })
  if (!decision.allowed) {
    return {
      error: NextResponse.json(
        { error: "You don't have access." },
        { status: 403 }
      ),
    }
  }

  return { row }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params
  const result = await authorizedSession(request, id)
  if ("error" in result && result.error) return result.error
  if (!("row" in result) || !result.row) {
    return NextResponse.json({ error: "Not found." }, { status: 404 })
  }

  const filePath = resolveRecordingFilePath(
    sessionRecordingRoot(),
    result.row.session.recordingPath
  )
  if (!filePath) {
    return NextResponse.json(
      { error: "No recording is available." },
      { status: 404 }
    )
  }

  try {
    const info = await stat(filePath)
    if (!info.isFile()) {
      return NextResponse.json(
        { error: "No recording is available." },
        { status: 404 }
      )
    }
    const stream = createReadStream(filePath)
    return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="session-${id}.guac"`,
        "Content-Length": String(info.size),
        "Cache-Control": "private, no-store",
      },
    })
  } catch {
    return NextResponse.json(
      { error: "No recording is available." },
      { status: 404 }
    )
  }
}
