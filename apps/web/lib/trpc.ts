import { createTRPCReact, httpBatchLink } from "@trpc/react-query"
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server"

import type { AppRouter } from "@nms/api-contract"

export const trpc = createTRPCReact<AppRouter>()

export type RouterInputs = inferRouterInputs<AppRouter>
export type RouterOutputs = inferRouterOutputs<AppRouter>

export function getApiBaseUrl() {
  if (typeof window !== "undefined") {
    return window.location.origin
  }

  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
}

export function createTrpcLinks() {
  return [
    httpBatchLink({
      url: `${getApiBaseUrl()}/api/trpc`,
      fetch(url, options) {
        return fetch(url, {
          ...options,
          credentials: "include",
        })
      },
    }),
  ]
}
