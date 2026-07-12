"use client"

import * as React from "react"

import { detectAdminVpnViaWebRtc } from "@/lib/admin-vpn-detect"
import { trpc } from "@/lib/trpc"

type AdminVpnConnectionContextValue = {
  connected: boolean
  checked: boolean
  refresh: () => Promise<void>
}

const AdminVpnConnectionContext =
  React.createContext<AdminVpnConnectionContextValue | null>(null)

export function AdminVpnConnectionProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const utils = trpc.useUtils()
  const statusQuery = trpc.adminVpn.connectionStatus.useQuery(undefined, {
    refetchInterval: 5_000,
    retry: false,
    staleTime: 2_000,
  })
  const [localConnected, setLocalConnected] = React.useState(false)
  const [localChecked, setLocalChecked] = React.useState(false)

  const refreshLocal = React.useCallback(async () => {
    try {
      const next = await detectAdminVpnViaWebRtc()
      setLocalConnected(next)
    } catch {
      setLocalConnected(false)
    } finally {
      setLocalChecked(true)
    }
  }, [])

  React.useEffect(() => {
    let cancelled = false

    const run = async () => {
      if (cancelled) return
      await refreshLocal()
    }

    void run()
    const id = window.setInterval(() => {
      void run()
    }, 15_000)

    const onFocus = () => {
      void run()
      void utils.adminVpn.connectionStatus.invalidate()
    }

    window.addEventListener("focus", onFocus)
    return () => {
      cancelled = true
      window.clearInterval(id)
      window.removeEventListener("focus", onFocus)
    }
  }, [refreshLocal, utils])

  const handshakeConnected = Boolean(statusQuery.data?.connected)
  const connected = handshakeConnected || localConnected
  const checked = localChecked || statusQuery.isFetched || statusQuery.isError

  const refresh = React.useCallback(async () => {
    await Promise.all([
      refreshLocal(),
      utils.adminVpn.connectionStatus.invalidate(),
    ])
  }, [refreshLocal, utils])

  const value = React.useMemo(
    () => ({ connected, checked, refresh }),
    [checked, connected, refresh]
  )

  return (
    <AdminVpnConnectionContext.Provider value={value}>
      {children}
    </AdminVpnConnectionContext.Provider>
  )
}

export function useAdminVpnConnected() {
  const context = React.useContext(AdminVpnConnectionContext)
  if (!context) {
    throw new Error(
      "useAdminVpnConnected must be used within AdminVpnConnectionProvider"
    )
  }
  return context
}
