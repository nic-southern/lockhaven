"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes"
import { MoonIcon, SunIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      <ThemeHotkey />
      {children}
    </NextThemesProvider>
  )
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  )
}

function ThemeHotkey() {
  const { resolvedTheme, setTheme } = useTheme()

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) {
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      if (event.key.toLowerCase() !== "d") {
        return
      }

      if (isTypingTarget(event.target)) {
        return
      }

      setTheme(resolvedTheme === "dark" ? "light" : "dark")
    }

    window.addEventListener("keydown", onKeyDown)

    return () => {
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [resolvedTheme, setTheme])

  return null
}

function subscribeToHydrationStore() {
  return () => {}
}

function getHydratedSnapshot() {
  return true
}

function getServerHydrationSnapshot() {
  return false
}

function useIsHydrated() {
  return React.useSyncExternalStore(
    subscribeToHydrationStore,
    getHydratedSnapshot,
    getServerHydrationSnapshot
  )
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const isHydrated = useIsHydrated()
  const isDark = isHydrated && resolvedTheme === "dark"

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={
        isHydrated
          ? isDark
            ? "Switch to light mode"
            : "Switch to dark mode"
          : "Toggle color mode"
      }
      disabled={!isHydrated}
      onClick={() => {
        setTheme(isDark ? "light" : "dark")
      }}
    >
      <MoonIcon className="dark:hidden" aria-hidden="true" />
      <SunIcon className="hidden dark:block" aria-hidden="true" />
    </Button>
  )
}

export { ThemeProvider, ThemeToggle }
