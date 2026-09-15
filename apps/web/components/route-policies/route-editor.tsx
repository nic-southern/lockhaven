"use client"

import * as React from "react"
import {
  AlertTriangleIcon,
  CircleAlertIcon,
  InfoIcon,
  XIcon,
} from "lucide-react"
import {
  MAX_ROUTE_POLICY_ENTRIES,
  ROUTE_LABEL_MAX_LENGTH,
  normalizeCidr,
  parseRouteInput,
  type RouteAnalysis,
  type RouteIssue,
  type RouteIssueSeverity,
  type RoutePolicyEntry,
} from "@nms/shared"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

const severityRank: Record<RouteIssueSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
}

function worstSeverity(issues: RouteIssue[]): RouteIssueSeverity | null {
  if (issues.length === 0) return null
  return issues.reduce<RouteIssueSeverity>(
    (worst, issue) =>
      severityRank[issue.severity] < severityRank[worst]
        ? issue.severity
        : worst,
    "info"
  )
}

const chipTone: Record<RouteIssueSeverity | "ok", string> = {
  ok: "border-border bg-card",
  error: "border-destructive/60 bg-destructive/5 text-destructive",
  warning:
    "border-amber-500/60 bg-amber-500/5 text-amber-700 dark:text-amber-400",
  info: "border-border bg-card",
}

function SeverityIcon({
  severity,
  className,
}: {
  severity: RouteIssueSeverity
  className?: string
}) {
  const Icon =
    severity === "error"
      ? CircleAlertIcon
      : severity === "warning"
        ? AlertTriangleIcon
        : InfoIcon
  return (
    <Icon
      className={cn(
        "size-3.5 shrink-0",
        severity === "error" && "text-destructive",
        severity === "warning" && "text-amber-600 dark:text-amber-400",
        severity === "info" && "text-muted-foreground",
        className
      )}
      aria-hidden
    />
  )
}

/**
 * Chip-based CIDR editor. Routes are committed on Enter, comma, or paste;
 * clicking a chip edits its label. Validation comes from the parent so the
 * same analysis can merge instant local checks with the server preview.
 */
export function RouteEditor({
  value,
  onChange,
  analysis,
  disabled,
  id,
  autoFocus,
}: {
  value: RoutePolicyEntry[]
  onChange: (entries: RoutePolicyEntry[]) => void
  analysis: RouteAnalysis | null
  disabled?: boolean
  id?: string
  autoFocus?: boolean
}) {
  const [draft, setDraft] = React.useState("")
  const [editingIndex, setEditingIndex] = React.useState<number | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const commit = React.useCallback(
    (raw: string) => {
      const incoming = parseRouteInput(raw)
      if (incoming.length === 0) {
        setDraft("")
        return
      }
      const known = new Set(value.map((entry) => normalizeCidr(entry.cidr)))
      const additions: RoutePolicyEntry[] = []
      for (const entry of incoming) {
        const key = normalizeCidr(entry.cidr)
        if (known.has(key)) continue
        known.add(key)
        additions.push({ cidr: entry.cidr, label: entry.label ?? null })
      }
      setDraft("")
      if (additions.length > 0) {
        onChange([...value, ...additions].slice(0, MAX_ROUTE_POLICY_ENTRIES))
      }
    },
    [value, onChange]
  )

  const remove = (index: number) => {
    onChange(value.filter((_, entryIndex) => entryIndex !== index))
    setEditingIndex(null)
  }

  const updateLabel = (index: number, label: string) => {
    onChange(
      value.map((entry, entryIndex) =>
        entryIndex === index
          ? { ...entry, label: label.slice(0, ROUTE_LABEL_MAX_LENGTH) || null }
          : entry
      )
    )
  }

  const issuesByIndex = React.useMemo(() => {
    const map = new Map<number, RouteIssue[]>()
    for (const issue of analysis?.issues ?? []) {
      if (issue.index === null) continue
      map.set(issue.index, [...(map.get(issue.index) ?? []), issue])
    }
    return map
  }, [analysis])

  const generalIssues = React.useMemo(() => {
    const seen = new Set<string>()
    return (analysis?.issues ?? [])
      .filter((issue) => {
        const key = `${issue.code}:${issue.message}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .sort((a, b) => severityRank[a.severity] - severityRank[b.severity])
  }, [analysis])

  const atLimit = value.length >= MAX_ROUTE_POLICY_ENTRIES

  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          "flex min-h-11 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-card/80 px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring/40",
          disabled && "opacity-60"
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((entry, index) => {
          const issues = issuesByIndex.get(index) ?? []
          const severity = worstSeverity(issues)
          const canonical = normalizeCidr(entry.cidr)
          return (
            <Popover
              key={`${entry.cidr}-${index}`}
              open={editingIndex === index}
              onOpenChange={(open) => setEditingIndex(open ? index : null)}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={(event) => event.stopPropagation()}
                  className={cn(
                    "inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border px-2 font-mono text-[11px] transition-colors hover:bg-accent",
                    chipTone[severity ?? "ok"]
                  )}
                  title={
                    issues.length > 0
                      ? issues.map((issue) => issue.message).join("\n")
                      : entry.label
                        ? `${canonical} — ${entry.label}`
                        : canonical
                  }
                >
                  {severity ? <SeverityIcon severity={severity} /> : null}
                  <span className="truncate">{entry.cidr.trim()}</span>
                  {entry.label ? (
                    <span className="truncate font-sans font-normal text-muted-foreground">
                      {entry.label}
                    </span>
                  ) : null}
                  <span
                    role="button"
                    aria-label={`Remove route ${entry.cidr}`}
                    className="ml-0.5 rounded-sm text-muted-foreground hover:text-foreground"
                    onClick={(event) => {
                      event.stopPropagation()
                      remove(index)
                    }}
                  >
                    <XIcon className="size-3" />
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-72 p-3"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <p className="font-mono text-sm">{canonical}</p>
                    {issues.length > 0 ? (
                      <ul className="flex flex-col gap-1">
                        {issues.map((issue) => (
                          <li
                            key={issue.code + issue.message}
                            className="flex items-start gap-1.5 text-xs text-muted-foreground"
                          >
                            <SeverityIcon
                              severity={issue.severity}
                              className="mt-0.5"
                            />
                            <span>{issue.message}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <label className="flex flex-col gap-1 text-xs font-medium">
                    Label
                    <Input
                      value={entry.label ?? ""}
                      maxLength={ROUTE_LABEL_MAX_LENGTH}
                      placeholder="e.g. Office LAN"
                      className="h-8 text-sm font-normal"
                      onChange={(event) =>
                        updateLabel(index, event.target.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault()
                          setEditingIndex(null)
                        }
                      }}
                    />
                  </label>
                  <div className="flex justify-between">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => remove(index)}
                    >
                      Remove
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => setEditingIndex(null)}
                    >
                      Done
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )
        })}
        <input
          ref={inputRef}
          id={id}
          value={draft}
          disabled={disabled || atLimit}
          autoFocus={autoFocus}
          placeholder={
            atLimit
              ? `Up to ${MAX_ROUTE_POLICY_ENTRIES} routes`
              : value.length === 0
                ? "10.0.0.0/24 Office LAN"
                : "Add a route"
          }
          className="min-w-[12rem] flex-1 bg-transparent px-1 font-mono text-xs outline-none placeholder:font-sans placeholder:text-muted-foreground"
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault()
              commit(draft)
            } else if (
              event.key === "Backspace" &&
              draft === "" &&
              value.length > 0
            ) {
              event.preventDefault()
              remove(value.length - 1)
            }
          }}
          onPaste={(event) => {
            const text = event.clipboardData.getData("text")
            if (/[\n,;]/.test(text)) {
              event.preventDefault()
              commit(`${draft} ${text}`)
            }
          }}
          onBlur={() => {
            if (draft.trim()) commit(draft)
          }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Type a network and press Enter. Add a label after a space (for example{" "}
        <span className="font-mono">192.168.10.0/24 Printers</span>). Paste a
        list to add several at once.
      </p>
      {generalIssues.length > 0 ? (
        <ul className="flex flex-col gap-1.5 rounded-lg border bg-muted/30 p-3">
          {generalIssues.map((issue) => (
            <li
              key={issue.code + issue.message}
              className="flex items-start gap-2 text-xs"
            >
              <SeverityIcon severity={issue.severity} className="mt-0.5" />
              <span
                className={cn(
                  issue.severity === "error"
                    ? "text-destructive"
                    : "text-muted-foreground"
                )}
              >
                {issue.message}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
