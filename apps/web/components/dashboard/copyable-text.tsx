"use client"

import * as React from "react"
import { CheckIcon, CopyIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function CopyableText({
  value,
  emptyLabel = "—",
  className,
  mono = true,
}: {
  value: string | null | undefined
  emptyLabel?: string
  className?: string
  mono?: boolean
}) {
  const [copied, setCopied] = React.useState(false)
  const display = value?.trim() ? value.trim().split("/")[0] : null

  async function handleCopy(event: React.MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    if (!display) {
      return
    }

    try {
      await navigator.clipboard.writeText(display)
      setCopied(true)
      toast.success("Copied")
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      toast.error("Couldn't copy")
    }
  }

  if (!display) {
    return (
      <span className={cn(mono && "font-mono", className)}>{emptyLabel}</span>
    )
  }

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span className={cn(mono && "font-mono text-xs")}>{display}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground"
        aria-label="Copy address"
        onClick={(event) => {
          void handleCopy(event)
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </span>
  )
}
