"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { MenuIcon } from "lucide-react"

import { signOut, useSession } from "@/lib/auth-client"
import { trpc } from "@/lib/trpc"
import { ThemeToggle } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { getClientProductName, getProductInitials } from "@/lib/product-name"
import { cn } from "@/lib/utils"

const navItems = [
  { href: "/", label: "Overview" },
  { href: "/devices", label: "Devices" },
  { href: "/sites", label: "Sites" },
  { href: "/connections", label: "Connections" },
  { href: "/route-policies", label: "Route policies" },
  { href: "/enrollment-tokens", label: "Enrollment tokens" },
  { href: "/users", label: "Users" },
  { href: "/audit", label: "Audit" },
]

function NavLinks({
  items,
  pathname,
  onNavigate,
  className,
}: {
  items: typeof navItems
  pathname: string
  onNavigate?: () => void
  className?: string
}) {
  return (
    <nav className={cn("flex flex-col gap-1", className)}>
      {items.map((item) => {
        const active =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "rounded-lg px-3 py-2 text-sm transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

export function DashboardShell({
  children,
  hideHeader = false,
}: {
  children: React.ReactNode
  hideHeader?: boolean
}) {
  const pathname = usePathname()
  const { data: session } = useSession()
  const accessQuery = trpc.access.me.useQuery()
  const productName = getClientProductName()
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const visibleNavItems = React.useMemo(() => {
    if (accessQuery.data?.canManageUsers === false) {
      return navItems.filter((item) => item.href !== "/users")
    }

    return navItems
  }, [accessQuery.data?.canManageUsers])

  return (
    <div className="min-h-svh bg-background">
      {hideHeader ? null : (
        <header className="sticky top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur-md">
          <div className="flex h-14 w-full items-center justify-between gap-4 px-4 sm:px-6">
            <div className="flex items-center gap-3">
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="lg:hidden"
                    aria-label="Open navigation"
                  >
                    <MenuIcon />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-72 p-0">
                  <SheetHeader className="border-b px-4 py-4 text-left">
                    <SheetTitle className="flex items-center gap-3">
                      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground">
                        {getProductInitials(productName)}
                      </span>
                      <span>{productName}</span>
                    </SheetTitle>
                  </SheetHeader>
                  <div className="p-3">
                    <NavLinks
                      items={visibleNavItems}
                      pathname={pathname}
                      onNavigate={() => setMobileOpen(false)}
                    />
                  </div>
                </SheetContent>
              </Sheet>

              <div className="flex items-center gap-3">
                <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-xs font-semibold tracking-wide text-primary-foreground">
                  {getProductInitials(productName)}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold tracking-tight">
                    {productName}
                  </p>
                  <p className="hidden text-xs text-muted-foreground sm:block">
                    Console
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <p className="hidden max-w-[14rem] truncate text-sm text-muted-foreground md:block">
                {session?.user?.name ?? session?.user?.email ?? "—"}
              </p>
              <ThemeToggle />
              <Button
                variant="outline"
                size="sm"
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

      <div className="flex w-full gap-6 px-4 py-6 sm:px-6 sm:py-8">
        <aside className="hidden w-52 shrink-0 lg:block xl:w-56">
          <div className="sticky top-20 rounded-xl border border-border/80 bg-card/60 p-2">
            <NavLinks items={visibleNavItems} pathname={pathname} />
          </div>
        </aside>

        <main className="min-w-0 flex-1 animate-fade-up">{children}</main>
      </div>
    </div>
  )
}
