"use client"

import * as React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { trpc, createTrpcLinks } from "@/lib/trpc"
import { AdminVpnConnectionProvider } from "@/lib/use-admin-vpn-connected"

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(() => new QueryClient())
  const [trpcClient] = React.useState(() =>
    trpc.createClient({
      links: createTrpcLinks(),
    })
  )

  return (
    <QueryClientProvider client={queryClient}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <AdminVpnConnectionProvider>{children}</AdminVpnConnectionProvider>
      </trpc.Provider>
    </QueryClientProvider>
  )
}
