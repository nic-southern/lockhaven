import { handleRestV1Request } from "@/lib/rest-v1-handler"

type RouteContext = {
  params: Promise<{ path?: string[] }>
}

async function handle(request: Request, context: RouteContext) {
  const { path = [] } = await context.params
  return handleRestV1Request(request, path)
}

export const GET = handle
export const POST = handle
