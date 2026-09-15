"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import {
  paramsToViewState,
  viewStateToParams,
  type SavedView,
  type TableViewState,
} from "@/lib/table-view-state"

/**
 * Keeps sorting, filters, search, and hidden columns in the URL so a filtered
 * table can be shared as a link, and exposes setters shaped for DataTable.
 */
export function useUrlTableView(defaults: TableViewState) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const state = React.useMemo(
    () => paramsToViewState(new URLSearchParams(searchParams), defaults),
    [searchParams, defaults]
  )

  const replace = React.useCallback(
    (next: TableViewState) => {
      const params = viewStateToParams(next, defaults)
      const query = params.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      })
    },
    [router, pathname, defaults]
  )

  const update = React.useCallback(
    (
      patch:
        | Partial<TableViewState>
        | ((current: TableViewState) => Partial<TableViewState>)
    ) => {
      const current = paramsToViewState(
        new URLSearchParams(window.location.search),
        defaults
      )
      const resolved = typeof patch === "function" ? patch(current) : patch
      replace({ ...current, ...resolved })
    },
    [replace, defaults]
  )

  return { state, replace, update }
}

const STORAGE_PREFIX = "lockhaven.views."
const EMPTY_VIEWS: SavedView[] = []

function readViews(key: string): SavedView[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as SavedView[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeViews(key: string, views: SavedView[]) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(views))
  } catch {
    // Storage may be unavailable; the view still applies for this session.
  }
}

const listeners = new Set<() => void>()
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
function notify() {
  for (const listener of listeners) listener()
}

/** User-saved table views, persisted per browser. */
export function useSavedViews(key: string, builtIns: SavedView[]) {
  const snapshotRef = React.useRef<{ raw: string; views: SavedView[] }>({
    raw: "",
    views: [],
  })

  const getSnapshot = React.useCallback(() => {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key) ?? ""
    if (raw !== snapshotRef.current.raw) {
      snapshotRef.current = { raw, views: readViews(key) }
    }
    return snapshotRef.current.views
  }, [key])

  const custom = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => EMPTY_VIEWS
  )

  const views = React.useMemo(
    () => [...builtIns, ...custom],
    [builtIns, custom]
  )

  const save = React.useCallback(
    (name: string, state: TableViewState) => {
      const trimmed = name.trim()
      if (!trimmed) return null
      const existing = readViews(key)
      const id = `view-${Date.now().toString(36)}`
      const view: SavedView = { id, name: trimmed, state }
      writeViews(key, [
        ...existing.filter((entry) => entry.name !== trimmed),
        view,
      ])
      notify()
      return view
    },
    [key]
  )

  const remove = React.useCallback(
    (id: string) => {
      writeViews(
        key,
        readViews(key).filter((entry) => entry.id !== id)
      )
      notify()
    },
    [key]
  )

  return { views, save, remove }
}
