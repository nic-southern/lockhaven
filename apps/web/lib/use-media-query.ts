"use client"

import * as React from "react"

export function useMediaQuery(query: string) {
  const [matches, setMatches] = React.useState<boolean | null>(null)

  React.useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = () => setMatches(media.matches)

    onChange()
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [query])

  return matches
}

export function useIsDesktop() {
  return useMediaQuery("(min-width: 1024px)")
}
