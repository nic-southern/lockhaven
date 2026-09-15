"use client"

import * as React from "react"
import { XIcon } from "lucide-react"
import { DEVICE_TAG_PATTERN, MAX_DEVICE_TAGS, parseTagInput } from "@nms/shared"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export function TagChips({
  tags,
  max = 3,
  onClick,
  className,
}: {
  tags: string[]
  /** Chips shown before collapsing the rest into a "+N" pill. */
  max?: number
  onClick?: (tag: string) => void
  className?: string
}) {
  if (tags.length === 0) {
    return <span className="text-muted-foreground">—</span>
  }
  const visible = tags.slice(0, max)
  const hidden = tags.length - visible.length

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {visible.map((tag) =>
        onClick ? (
          <button
            key={tag}
            type="button"
            className="rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            onClick={(event) => {
              event.stopPropagation()
              onClick(tag)
            }}
          >
            <Badge variant="outline" className="font-mono text-[11px]">
              {tag}
            </Badge>
          </button>
        ) : (
          <Badge key={tag} variant="outline" className="font-mono text-[11px]">
            {tag}
          </Badge>
        )
      )}
      {hidden > 0 ? (
        <Badge
          variant="secondary"
          className="text-[11px]"
          title={tags.slice(max).join(", ")}
        >
          +{hidden}
        </Badge>
      ) : null}
    </div>
  )
}

/**
 * Controlled chip editor. Tags are committed on Enter, comma, or blur and
 * validated against the shared tag pattern so the API never rejects them.
 */
export function TagEditor({
  value,
  onChange,
  suggestions = [],
  disabled,
  placeholder = "Add a tag",
  id,
}: {
  value: string[]
  onChange: (tags: string[]) => void
  suggestions?: string[]
  disabled?: boolean
  placeholder?: string
  id?: string
}) {
  const [draft, setDraft] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  const commit = React.useCallback(
    (raw: string) => {
      const incoming = parseTagInput(raw)
      if (incoming.length === 0) {
        setDraft("")
        return
      }
      const invalid = incoming.find((tag) => !DEVICE_TAG_PATTERN.test(tag))
      if (invalid) {
        setError(
          `"${invalid}" isn't a valid tag. Use lowercase letters, numbers, and . _ : -`
        )
        return
      }
      const next = [...new Set([...value, ...incoming])].sort()
      if (next.length > MAX_DEVICE_TAGS) {
        setError(`Devices can have up to ${MAX_DEVICE_TAGS} tags.`)
        return
      }
      setError(null)
      setDraft("")
      onChange(next)
    },
    [value, onChange]
  )

  const available = suggestions.filter(
    (tag) =>
      !value.includes(tag) &&
      (draft ? tag.includes(draft.trim().toLowerCase()) : true)
  )

  return (
    <div className="flex flex-col gap-2">
      <div
        className={cn(
          "flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-card/80 px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring/40",
          disabled && "opacity-60"
        )}
      >
        {value.map((tag) => (
          <Badge
            key={tag}
            variant="outline"
            className="gap-1 pr-1 font-mono text-[11px]"
          >
            {tag}
            <button
              type="button"
              className="rounded-sm text-muted-foreground hover:text-foreground"
              aria-label={`Remove tag ${tag}`}
              disabled={disabled}
              onClick={() => onChange(value.filter((entry) => entry !== tag))}
            >
              <XIcon className="size-3" />
            </button>
          </Badge>
        ))}
        <Input
          id={id}
          value={draft}
          disabled={disabled}
          placeholder={value.length === 0 ? placeholder : ""}
          className="h-7 min-w-24 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
          onChange={(event) => {
            setDraft(event.target.value)
            if (error) setError(null)
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault()
              commit(draft)
            } else if (
              event.key === "Backspace" &&
              draft === "" &&
              value.length > 0
            ) {
              onChange(value.slice(0, -1))
            }
          }}
          onBlur={() => {
            if (draft.trim()) commit(draft)
          }}
        />
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {available.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-muted-foreground">Suggestions:</span>
          {available.slice(0, 8).map((tag) => (
            <Button
              key={tag}
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 font-mono text-[11px]"
              disabled={disabled}
              onClick={() => commit(tag)}
            >
              + {tag}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
