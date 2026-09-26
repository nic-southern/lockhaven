"use client"

import * as React from "react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { useIsDesktop } from "@/lib/use-media-query"
import { cn } from "@/lib/utils"

/**
 * `overlay` (default): right-side sheet on every breakpoint so list pages
 * stay full-width (portal + backdrop).
 * `inline`: card on desktop, bottom sheet on mobile — for master-detail
 * layouts that intentionally keep detail in the page flow.
 */
export function DetailSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  contentClassName,
  variant = "overlay",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: React.ReactNode
  className?: string
  contentClassName?: string
  variant?: "inline" | "overlay"
}) {
  const isDesktop = useIsDesktop()

  if (variant === "overlay") {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className={cn(
            "flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl",
            className
          )}
        >
          <SheetHeader className="sticky top-0 z-10 border-b bg-popover/95 px-6 py-5 text-left backdrop-blur-md">
            <SheetTitle>{title}</SheetTitle>
            {description ? (
              <SheetDescription>{description}</SheetDescription>
            ) : null}
          </SheetHeader>
          <div
            className={cn(
              "flex flex-1 flex-col gap-6 overflow-y-auto px-6 py-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]",
              contentClassName
            )}
          >
            {children}
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  // Treat SSR / pre-hydration as desktop to keep the admin layout stable.
  // On mobile, hide the card until the media query resolves, then use a sheet.
  if (isDesktop !== false) {
    return (
      <Card className={cn(isDesktop === null && "max-lg:hidden", className)}>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description ? (
            <CardDescription>{description}</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className={cn("flex flex-col gap-6", contentClassName)}>
          {children}
        </CardContent>
      </Card>
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className={cn(
          "max-h-[min(92dvh,920px)] gap-0 overflow-y-auto rounded-t-2xl p-0",
          className
        )}
      >
        <SheetHeader className="sticky top-0 z-10 border-b bg-popover/95 px-4 py-4 text-left backdrop-blur-md">
          <SheetTitle>{title}</SheetTitle>
          {description ? (
            <SheetDescription>{description}</SheetDescription>
          ) : null}
        </SheetHeader>
        <div
          className={cn(
            "flex flex-col gap-6 px-4 py-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]",
            contentClassName
          )}
        >
          {children}
        </div>
      </SheetContent>
    </Sheet>
  )
}
