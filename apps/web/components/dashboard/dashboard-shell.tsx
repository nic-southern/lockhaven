"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { signOut, useSession } from "@/lib/auth-client"
import { ThemeToggle } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { getClientProductName, getProductInitials } from "@/lib/product-name"
import { cn } from "@/lib/utils"

const navItems = [
  { href: "/", label: "Overview" },
  { href: "/devices", label: "Devices" },
  { href: "/sites", label: "Sites" },
  { href: "/connections", label: "Connections" },
  { href: "/route-policies", label: "Route policies" },
  { href: "/enrollment-tokens", label: "Enrollment tokens" },
  { href: "/audit", label: "Audit" },
]

export function DashboardShell({
  children,
  hideHeader = false,
}: {
  children: React.ReactNode
  hideHeader?: boolean
}) {
  const pathname = usePathname()
  const { data: session, isPending } = useSession()
  const productName = getClientProductName()

  return (
    <div className="min-h-svh bg-background">
      {hideHeader ? null : (
        <header className="border-b bg-card/70 backdrop-blur">
          <div className="flex h-16 w-full items-center justify-between gap-4 px-6">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground">
                {getProductInitials(productName)}
              </div>
              <div>
                <p className="text-sm leading-none font-semibold">
                  {productName}
                </p>
                <p className="text-xs text-muted-foreground">
                  Management console
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden text-right text-sm sm:block">
                <p className="font-medium">
                  {session?.user?.name ?? session?.user?.email ?? "Signed in"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isPending ? "Loading" : "Signed in"}
                </p>
              </div>
              <ThemeToggle />
              <Button
                variant="outline"
                onClick={() => {
                  void signOut({
                    fetchOptions: {
                      onSuccess() {
                        window.location.assign("/sign-in")
                      },
                    },
                  })
                }}
              >
                Sign out
              </Button>
            </div>
          </div>
        </header>
      )}

      <div className="flex w-full gap-6 px-6 py-8">
        <aside className="hidden w-56 shrink-0 lg:block">
          <nav className="sticky top-8 flex flex-col gap-1 rounded-2xl border bg-card p-3 shadow-sm">
            {navItems.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href)

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted",
                    active
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "text-muted-foreground"
                  )}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </aside>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  )
}
