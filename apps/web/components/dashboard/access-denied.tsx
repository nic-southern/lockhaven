import Link from "next/link"
import { ShieldOffIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

export function AccessDenied({
  title = "You don't have access to this page",
  description = "Ask an administrator if you need this permission.",
}: {
  title?: string
  description?: string
}) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <ShieldOffIcon className="size-5" />
        </div>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/">Back to overview</Link>
        </Button>
      </div>
    </div>
  )
}
