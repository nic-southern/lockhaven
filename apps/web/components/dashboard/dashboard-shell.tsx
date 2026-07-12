"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { LogOutIcon, MenuIcon } from "lucide-react"

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
import { useAdminVpnConnected } from "@/lib/use-admin-vpn-connected"
import { cn } from "@/lib/utils"

const navItems = [
  { href: "/", label: "Overview" },
  { href: "/devices", label: "Devices" },
  { href: "/sites", label: "Sites" },
  { href: "/connections", label: "Connections" },
  { href: "/admin-vpn", label: "Admin VPN" },
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
              "inline-flex min-h-11 items-center rounded-lg px-3 py-2.5 text-sm transition-colors lg:min-h-0 lg:py-2",
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

function AdminVpnStatusIndicator({
  connected,
  checked,
}: {
  connected: boolean
  checked: boolean
}) {
  const label = !checked
    ? "Checking admin VPN"
    : connected
      ? "Admin VPN connected"
      : "Admin VPN offline"

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium",
        connected
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "border-border/80 bg-muted/40 text-muted-foreground"
      )}
      title={label}
      aria-label={label}
    >
      <span className="relative flex size-2.5">
        {connected ? (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        ) : null}
        <span
          className={cn(
            "relative inline-flex size-2.5 rounded-full",
            connected
              ? "bg-emerald-500"
              : checked
                ? "bg-muted-foreground/50"
                : "bg-muted-foreground/30"
          )}
        />
      </span>
      <span className="hidden sm:inline">
        {connected ? "VPN on" : "VPN off"}
      </span>
    </div>
  )
}

function handleSignOut() {
  void signOut({
    fetchOptions: {
      onSuccess() {
        window.location.assign("/sign-in")
      },
    },
  })
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
  const { connected: adminVpnConnected, checked: adminVpnChecked } =
    useAdminVpnConnected()
  const productName = getClientProductName()
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const userLabel = session?.user?.name ?? session?.user?.email ?? "—"
  const visibleNavItems = React.useMemo(() => {
    if (accessQuery.data?.canManageUsers === false) {
      return navItems.filter((item) => item.href !== "/users")
    }

    return navItems
  }, [accessQuery.data?.canManageUsers])

  const vpnStatus = (
    <AdminVpnStatusIndicator
      connected={adminVpnConnected}
      checked={adminVpnChecked}
    />
  )

  return (
    <div className="min-h-svh bg-background">
      {hideHeader ? null : (
        <header className="sticky top-0 z-40 border-b border-border/80 bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
          <div className="flex h-14 w-full items-center justify-between gap-3 px-4 sm:gap-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0 lg:hidden"
                    aria-label="Open navigation"
                  >
                    <MenuIcon />
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side="left"
                  className="flex w-[min(20rem,100%)] flex-col gap-0 p-0"
                >
                  <SheetHeader className="border-b px-4 py-4 text-left">
                    <SheetTitle className="flex items-center gap-3">
                      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground">
                        {getProductInitials(productName)}
                      </span>
                      <span className="truncate">{productName}</span>
                    </SheetTitle>
                    <p className="truncate text-sm text-muted-foreground">
                      {userLabel}
                    </p>
                    <div className="pt-1">{vpnStatus}</div>
                  </SheetHeader>
                  <div className="flex-1 overflow-y-auto p-3">
                    <NavLinks
                      items={visibleNavItems}
                      pathname={pathname}
                      onNavigate={() => setMobileOpen(false)}
                    />
                  </div>
                  <div className="mt-auto flex flex-col gap-2 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                    <div className="flex items-center justify-between gap-2 px-1">
                      <span className="text-sm text-muted-foreground">
                        Appearance
                      </span>
                      <ThemeToggle />
                    </div>
                    <Button
                      variant="outline"
                      className="w-full justify-start gap-2"
                      onClick={handleSignOut}
                    >
                      <LogOutIcon className="size-4" />
                      Sign out
                    </Button>
                  </div>
                </SheetContent>
              </Sheet>

              <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-semibold tracking-wide text-primary-foreground">
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
              {vpnStatus}
              <p className="hidden max-w-[14rem] truncate text-sm text-muted-foreground lg:block">
                {userLabel}
              </p>
              <div className="hidden lg:block">
                <ThemeToggle />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="hidden lg:inline-flex"
                onClick={handleSignOut}
              >
                Sign out
              </Button>
            </div>
          </div>
        </header>
      )}

      <div className="flex w-full gap-6 px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-8">
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
