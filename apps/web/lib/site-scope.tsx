"use client"

import * as React from "react"

const STORAGE_KEY = "lockhaven.site-scope"

type SiteScopeContextValue = {
  /** Selected site id, or `null` for "all my sites". */
  siteId: string | null
  setSiteId: (siteId: string | null) => void
}

const SiteScopeContext = React.createContext<SiteScopeContextValue>({
  siteId: null,
  setSiteId: () => {},
})

export function SiteScopeProvider({ children }: { children: React.ReactNode }) {
  const [siteId, setSiteIdState] = React.useState<string | null>(null)

  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSiteIdState(stored)
      }
    } catch {
      // Storage may be unavailable in private browsing modes.
    }
  }, [])

  const setSiteId = React.useCallback((value: string | null) => {
    setSiteIdState(value)
    try {
      if (value) {
        window.localStorage.setItem(STORAGE_KEY, value)
      } else {
        window.localStorage.removeItem(STORAGE_KEY)
      }
    } catch {
      // Ignore storage failures; the selection still applies for this session.
    }
  }, [])

  const value = React.useMemo(
    () => ({ siteId, setSiteId }),
    [siteId, setSiteId]
  )

  return (
    <SiteScopeContext.Provider value={value}>
      {children}
    </SiteScopeContext.Provider>
  )
}

export function useSiteScope() {
  return React.useContext(SiteScopeContext)
}

/**
 * Filters rows by the active site scope. Rows without a site are hidden when a
 * specific site is selected.
 */
export function applySiteScope<T extends { siteId?: string | null }>(
  rows: T[],
  siteId: string | null
) {
  if (!siteId) {
    return rows
  }
  return rows.filter((row) => row.siteId === siteId)
}
