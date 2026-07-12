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
 * Renders detail content in a card on desktop, or a bottom sheet on mobile.
 * Only one copy mounts at a time so form field ids stay unique.
 */
export function DetailSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  contentClassName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: React.ReactNode
  className?: string
  contentClassName?: string
}) {
  const isDesktop = useIsDesktop()

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
