"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  CableIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MapPinIcon,
  MenuIcon,
  MonitorIcon,
  RouteIcon,
  ScrollTextIcon,
  ShieldIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react"

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

type NavItem = {
  href: string
  label: string
  icon: LucideIcon
}

type NavSection = {
  label: string
  items: NavItem[]
}

const navSections: NavSection[] = [
  {
    label: "Operate",
    items: [
      { href: "/", label: "Overview", icon: LayoutDashboardIcon },
      { href: "/devices", label: "Devices", icon: MonitorIcon },
      { href: "/sites", label: "Sites", icon: MapPinIcon },
      { href: "/connections", label: "Connections", icon: CableIcon },
    ],
  },
  {
    label: "Network",
    items: [
      { href: "/admin-vpn", label: "Admin VPN", icon: ShieldIcon },
      { href: "/route-policies", label: "Route policies", icon: RouteIcon },
    ],
  },
  {
    label: "Access",
    items: [
      {
        href: "/enrollment-tokens",
        label: "Enrollment tokens",
        icon: KeyRoundIcon,
      },
      { href: "/users", label: "Users", icon: UsersIcon },
      { href: "/audit", label: "Audit", icon: ScrollTextIcon },
    ],
  },
]

function NavLinks({
  sections,
  pathname,
  onNavigate,
  className,
}: {
  sections: NavSection[]
  pathname: string
  onNavigate?: () => void
  className?: string
}) {
  return (
    <nav className={cn("flex flex-col gap-5", className)}>
      {sections.map((section) => (
        <div key={section.label} className="flex flex-col gap-1">
          <p className="px-3 text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
            {section.label}
          </p>
          <div className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href)
              const Icon = item.icon

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    "group relative inline-flex min-h-11 items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-[background-color,color] duration-150 lg:min-h-0 lg:py-2",
                    active
                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-sidebar-primary"
                      : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                  )}
                >
                  <Icon
                    className={cn(
                      "size-4 shrink-0 transition-colors",
                      active
                        ? "text-sidebar-primary"
                        : "text-muted-foreground group-hover:text-foreground"
                    )}
                  />
                  <span className="truncate">{item.label}</span>
                </Link>
              )
            })}
          </div>
        </div>
      ))}
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
  const visibleNavSections = React.useMemo(() => {
    if (accessQuery.data?.canManageUsers === false) {
      return navSections
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => item.href !== "/users"),
        }))
        .filter((section) => section.items.length > 0)
    }

    return navSections
  }, [accessQuery.data?.canManageUsers])

  const vpnStatus = (
    <AdminVpnStatusIndicator
      connected={adminVpnConnected}
      checked={adminVpnChecked}
    />
  )

  return (
    <div className="relative min-h-svh bg-background">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_at_top,oklch(0.72_0.06_186/0.12),transparent_70%)] dark:bg-[radial-gradient(ellipse_at_top,oklch(0.45_0.06_186/0.18),transparent_70%)]"
      />
      {hideHeader ? null : (
        <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 pt-[env(safe-area-inset-top)] backdrop-blur-md">
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
                  className="flex w-[min(20rem,100%)] flex-col gap-0 bg-sidebar p-0"
                >
                  <SheetHeader className="border-b border-sidebar-border px-4 py-4 text-left">
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
                      sections={visibleNavSections}
                      pathname={pathname}
                      onNavigate={() => setMobileOpen(false)}
                    />
                  </div>
                  <div className="mt-auto flex flex-col gap-2 border-t border-sidebar-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
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
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-semibold tracking-wide text-primary-foreground shadow-sm shadow-primary/20">
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

      <div className="relative flex w-full gap-6 px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-8">
        <aside className="hidden w-56 shrink-0 lg:block xl:w-60">
          <div className="sticky top-20 flex flex-col gap-4 rounded-2xl border border-sidebar-border/80 bg-sidebar/80 p-3 backdrop-blur-sm">
            <NavLinks sections={visibleNavSections} pathname={pathname} />
          </div>
        </aside>

        <main className="min-w-0 flex-1 animate-fade-up">{children}</main>
      </div>
    </div>
  )
}
