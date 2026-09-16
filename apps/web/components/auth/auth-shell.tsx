"use client"

import * as React from "react"

import { ThemeToggle } from "@/components/theme-provider"
import { getClientProductName, getProductInitials } from "@/lib/product-name"
import { cn } from "@/lib/utils"

export function AuthShell({
  title,
  description,
  children,
  footer,
  width = "sm",
}: {
  title: string
  description?: string
  children: React.ReactNode
  footer?: React.ReactNode
  width?: "sm" | "md" | "lg"
}) {
  const productName = getClientProductName()

  return (
    <main className="relative flex min-h-svh overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,oklch(0.72_0.08_186_/_0.22),transparent_55%),radial-gradient(ellipse_at_bottom_right,oklch(0.7_0.04_240_/_0.18),transparent_50%),linear-gradient(180deg,var(--background),oklch(0.96_0.01_210))] dark:bg-[radial-gradient(ellipse_at_top_left,oklch(0.45_0.08_186_/_0.28),transparent_55%),radial-gradient(ellipse_at_bottom_right,oklch(0.35_0.04_240_/_0.35),transparent_50%),linear-gradient(180deg,var(--background),oklch(0.14_0.02_240))]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,oklch(0.55_0.02_220_/_0.08)_1px,transparent_1px),linear-gradient(to_bottom,oklch(0.55_0.02_220_/_0.08)_1px,transparent_1px)] [background-size:48px_48px] opacity-[0.35] dark:opacity-20"
      />

      <div className="relative z-10 flex w-full flex-col">
        <header className="flex items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
              {getProductInitials(productName)}
            </div>
            <p className="text-sm font-semibold tracking-tight">
              {productName}
            </p>
          </div>
          <ThemeToggle />
        </header>

        <div className="flex flex-1 items-start justify-center px-6 pt-6 pb-16 sm:items-center sm:pt-0">
          <div
            className={cn(
              "w-full animate-fade-up",
              width === "sm" && "max-w-sm",
              width === "md" && "max-w-md",
              width === "lg" && "max-w-2xl"
            )}
          >
            <div className="mb-8 flex flex-col gap-3">
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                {title}
              </h1>
              {description ? (
                <p className="text-sm text-pretty text-muted-foreground">
                  {description}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-5 rounded-2xl border border-border/80 bg-card/80 p-6 shadow-sm backdrop-blur">
              {children}
            </div>

            {footer ? (
              <div className="mt-6 text-center text-sm text-muted-foreground">
                {footer}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  )
}
