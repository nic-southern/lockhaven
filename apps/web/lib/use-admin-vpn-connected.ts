"use client"

import * as React from "react"

import { detectAdminVpnConnected } from "@/lib/admin-vpn-detect"

const POLL_INTERVAL_MS = 20_000

export function useAdminVpnConnected() {
  const [connected, setConnected] = React.useState(false)
  const [checked, setChecked] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false

    const refresh = async () => {
      try {
        const next = await detectAdminVpnConnected()
        if (!cancelled) {
          setConnected(next)
        }
      } catch {
        if (!cancelled) {
          setConnected(false)
        }
      } finally {
        if (!cancelled) {
          setChecked(true)
        }
      }
    }

    void refresh()
    const id = window.setInterval(() => {
      void refresh()
    }, POLL_INTERVAL_MS)

    const onFocus = () => {
      void refresh()
    }
    window.addEventListener("focus", onFocus)

    return () => {
      cancelled = true
      window.clearInterval(id)
      window.removeEventListener("focus", onFocus)
    }
  }, [])

  return { connected, checked }
}
