"use client"

import * as React from "react"
import { CheckIcon, CopyIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function CodeBlock({
  value,
  label,
  className,
}: {
  value: string
  label?: string
  className?: string
}) {
  const [copied, setCopied] = React.useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast.success("Copied")
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      toast.error("Couldn't copy")
    }
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border bg-muted/30 text-sm",
        className
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
        <p className="text-xs font-medium text-muted-foreground">
          {label ?? "Command"}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => {
            void handleCopy()
          }}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="overflow-auto p-3 font-mono text-xs break-all whitespace-pre-wrap">
        {value}
      </pre>
    </div>
  )
}
