"use client"

import * as React from "react"
import { ChevronDownIcon } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

export function SectionCard({
  title,
  description,
  children,
  className,
  contentClassName,
  collapsibleOnMobile = false,
  defaultOpenOnMobile = false,
  actions,
}: {
  title: string
  description?: string
  children: React.ReactNode
  className?: string
  contentClassName?: string
  collapsibleOnMobile?: boolean
  defaultOpenOnMobile?: boolean
  actions?: React.ReactNode
}) {
  const [mobileOpen, setMobileOpen] = React.useState(defaultOpenOnMobile)

  return (
    <Card className={className}>
      <CardHeader
        className={cn(
          collapsibleOnMobile && "cursor-pointer lg:cursor-default",
          "gap-2"
        )}
        onClick={
          collapsibleOnMobile ? () => setMobileOpen((open) => !open) : undefined
        }
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <CardTitle>{title}</CardTitle>
            {description ? (
              <CardDescription>{description}</CardDescription>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            {collapsibleOnMobile ? (
              <ChevronDownIcon
                className={cn(
                  "size-5 text-muted-foreground transition-transform lg:hidden",
                  mobileOpen && "rotate-180"
                )}
                aria-hidden
              />
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent
        className={cn(
          collapsibleOnMobile && !mobileOpen && "hidden lg:block",
          contentClassName
        )}
      >
        {children}
      </CardContent>
    </Card>
  )
}
