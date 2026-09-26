"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ActivityIcon,
  BellRingIcon,
  BoxesIcon,
  ClipboardCheckIcon,
  CableIcon,
  CalendarClockIcon,
  ChevronDownIcon,
  PackageIcon,
  PuzzleIcon,
  FileBarChartIcon,
  KeyRoundIcon,
  KeySquareIcon,
  WorkflowIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MailIcon,
  MapPinIcon,
  MenuIcon,
  MonitorIcon,
  NetworkIcon,
  RouteIcon,
  ServerIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldIcon,
  SlidersHorizontalIcon,
  TagIcon,
  TicketIcon,
  UserRoundIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react"

import { signOut, useSession } from "@/lib/auth-client"
import { trpc } from "@/lib/trpc"
import { ThemeToggle } from "@/components/theme-provider"
import { AccessDenied } from "@/components/dashboard/access-denied"
import { SelectField } from "@/components/dashboard/select-field"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { getClientProductName, getProductInitials } from "@/lib/product-name"
import { SiteScopeProvider, useSiteScope } from "@/lib/site-scope"
import { useAdminVpnConnected } from "@/lib/use-admin-vpn-connected"
import { cn } from "@/lib/utils"
import type { Permission, UiScope } from "@nms/shared"

type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  /** Any one of these permissions unlocks the item. Omit for everyone. */
  permissions?: Permission[]
  /** Restrict to a particular console experience. */
  scopes?: UiScope[]
  /** Uses `canManageUsers` from `access.me` instead of a permission. */
  requiresUserManagement?: boolean
  /** Platform owner or platform admin only. */
  requiresPlatformAdmin?: boolean
}

type NavSection = {
  label: string
  items: NavItem[]
}

const navSections: NavSection[] = [
  {
    label: "Operate",
    items: [
      { href: "/", label: "Morning ops", icon: LayoutDashboardIcon },
      {
        href: "/devices",
        label: "Devices",
        icon: MonitorIcon,
        permissions: ["device:view"],
      },
      {
        href: "/software",
        label: "Software",
        icon: ShieldAlertIcon,
        permissions: ["device:view"],
      },
      {
        href: "/fleet",
        label: "Fleet",
        icon: BoxesIcon,
        permissions: ["device:view"],
      },
      {
        href: "/assets",
        label: "Assets",
        icon: PackageIcon,
        permissions: ["device:view"],
      },
      {
        href: "/sites",
        label: "Sites",
        icon: MapPinIcon,
        permissions: ["site:admin", "organization:admin"],
        scopes: ["admin"],
      },
      {
        href: "/connections",
        label: "Sessions",
        icon: CableIcon,
        permissions: ["device:view"],
      },
      {
        href: "/approvals",
        label: "Approvals",
        icon: ClipboardCheckIcon,
        permissions: ["organization:admin", "site:admin"],
        scopes: ["admin"],
      },
      {
        href: "/alerts",
        label: "Alerts",
        icon: BellRingIcon,
        permissions: ["device:view"],
      },
      {
        href: "/tickets",
        label: "Tickets",
        icon: TicketIcon,
        permissions: ["device:view"],
      },
      {
        href: "/playbooks",
        label: "Playbooks",
        icon: WorkflowIcon,
        permissions: ["device:view"],
      },
      {
        href: "/modules",
        label: "Modules",
        icon: PuzzleIcon,
        permissions: ["device:view"],
      },
      {
        href: "/services",
        label: "Services",
        icon: ServerIcon,
        permissions: ["device:view"],
      },
      {
        href: "/maintenance",
        label: "Maintenance",
        icon: CalendarClockIcon,
        permissions: ["device:view"],
      },
      {
        href: "/activity",
        label: "Activity",
        icon: ActivityIcon,
        permissions: ["audit:view"],
      },
      {
        href: "/reports",
        label: "Reports",
        icon: FileBarChartIcon,
        permissions: ["audit:view"],
      },
    ],
  },
  {
    label: "Network",
    items: [
      {
        href: "/network",
        label: "Connections",
        icon: NetworkIcon,
        permissions: ["device:view"],
      },
      {
        href: "/admin-vpn",
        label: "Admin VPN",
        icon: ShieldIcon,
        permissions: ["vpn:admin_profile"],
        scopes: ["admin"],
      },
      {
        href: "/route-policies",
        label: "Route policies",
        icon: RouteIcon,
        permissions: ["organization:admin"],
        scopes: ["admin"],
      },
    ],
  },
  {
    label: "Access",
    items: [
      {
        href: "/enrollment-tokens",
        label: "Enrollment tokens",
        icon: KeyRoundIcon,
        permissions: ["device:enroll"],
        scopes: ["admin"],
      },
      {
        href: "/users",
        label: "Users",
        icon: UsersIcon,
        requiresUserManagement: true,
        scopes: ["admin"],
      },
    ],
  },
  {
    label: "Settings",
    items: [
      {
        href: "/settings/notifications",
        label: "Notifications",
        icon: MailIcon,
        permissions: ["organization:admin"],
        scopes: ["admin"],
      },
      {
        href: "/settings/api-keys",
        label: "API keys",
        icon: KeySquareIcon,
        permissions: ["organization:admin"],
        scopes: ["admin"],
      },
      {
        href: "/settings/sso",
        label: "Single sign-on",
        icon: ShieldCheckIcon,
        permissions: ["organization:admin"],
        scopes: ["admin"],
      },
      {
        href: "/settings/alerts",
        label: "Alert policies",
        icon: SlidersHorizontalIcon,
        permissions: ["organization:admin"],
        scopes: ["admin"],
      },
      {
        href: "/settings/fields",
        label: "Custom fields",
        icon: TagIcon,
        permissions: ["organization:admin"],
        scopes: ["admin"],
      },
      {
        href: "/settings/device-models",
        label: "Device models",
        icon: PackageIcon,
        permissions: ["organization:admin"],
        scopes: ["admin"],
      },
      {
        href: "/system",
        label: "System",
        icon: ServerIcon,
        requiresPlatformAdmin: true,
        scopes: ["admin"],
      },
    ],
  },
]

/** Routes that are always available to a signed-in user. */
const alwaysAllowedPrefixes = ["/account"]

type AccessInfo = {
  permissions: Permission[]
  uiScope: UiScope
  canManageUsers: boolean
  platformRole: string | null
}

function itemAllowed(item: NavItem, access: AccessInfo) {
  if (item.scopes && !item.scopes.includes(access.uiScope)) {
    return false
  }
  if (item.requiresUserManagement) {
    return access.canManageUsers
  }
  if (item.requiresPlatformAdmin) {
    return access.platformRole === "owner" || access.platformRole === "admin"
  }
  if (!item.permissions || item.permissions.length === 0) {
    return true
  }
  return item.permissions.some((permission) =>
    access.permissions.includes(permission)
  )
}

function findNavItem(pathname: string) {
  const items = navSections.flatMap((section) => section.items)
  return (
    items.find((item) => item.href !== "/" && pathname.startsWith(item.href)) ??
    items.find((item) => item.href === "/" && pathname === "/") ??
    null
  )
}

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
    <nav className={cn("flex flex-col gap-3", className)}>
      {sections.map((section) => (
        <div key={section.label} className="flex flex-col gap-0.5">
          <p className="px-2 text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
            {section.label}
          </p>
          <div className="flex flex-col gap-px">
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
                    "group relative inline-flex min-h-10 items-center gap-2 rounded-md px-2 py-2 text-sm transition-[background-color,color] duration-150 lg:min-h-0 lg:py-1.5",
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
  showLabel = false,
}: {
  connected: boolean
  checked: boolean
  /** Always show the text; by default it appears from `sm` up. */
  showLabel?: boolean
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
      <span className={cn(!showLabel && "hidden sm:inline")}>
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

function SiteSwitcher({
  sites,
  className,
}: {
  sites: Array<{ id: string; name: string }>
  className?: string
}) {
  const { siteId, setSiteId } = useSiteScope()

  if (sites.length <= 1) {
    return sites.length === 1 ? (
      <div
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-border/80 bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground",
          className
        )}
      >
        <MapPinIcon className="size-3.5" />
        <span className="truncate">{sites[0].name}</span>
      </div>
    ) : null
  }

  const selected =
    siteId && sites.some((site) => site.id === siteId) ? siteId : "__all"

  return (
    <SelectField
      value={selected}
      onValueChange={(value) => setSiteId(value === "__all" ? null : value)}
      size="sm"
      className={cn("h-8 w-44", className)}
      aria-label="Site"
      options={[
        { value: "__all", label: "All my sites" },
        ...sites.map((site) => ({ value: site.id, label: site.name })),
      ]}
    />
  )
}

function UserMenu({
  label,
  email,
  scopeLabel,
}: {
  label: string
  email: string | null
  scopeLabel: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="hidden max-w-[16rem] gap-2 lg:inline-flex"
        >
          <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold uppercase">
            {label.slice(0, 2)}
          </span>
          <span className="truncate text-sm font-normal">{label}</span>
          <ChevronDownIcon className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate font-medium">{label}</span>
          {email ? (
            <span className="truncate text-xs font-normal text-muted-foreground">
              {email}
            </span>
          ) : null}
          <span className="text-[11px] font-normal tracking-wide text-muted-foreground uppercase">
            {scopeLabel}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account">
            <UserRoundIcon />
            Account &amp; security
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ShellContent({
  children,
  hideHeader,
}: {
  children: React.ReactNode
  hideHeader: boolean
}) {
  const pathname = usePathname()
  const { data: session } = useSession()
  const accessQuery = trpc.access.me.useQuery()
  const { connected: adminVpnConnected, checked: adminVpnChecked } =
    useAdminVpnConnected()
  const productName = getClientProductName()
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const userLabel = session?.user?.name ?? session?.user?.email ?? "—"
  const userEmail = session?.user?.email ?? null

  const accessData = accessQuery.data
  const access = React.useMemo<AccessInfo | null>(
    () =>
      accessData
        ? {
            permissions: accessData.permissions,
            uiScope: accessData.uiScope,
            canManageUsers: accessData.canManageUsers,
            platformRole: accessData.platformRole,
          }
        : null,
    [accessData]
  )

  const visibleNavSections = React.useMemo(() => {
    if (!access) {
      return []
    }
    return navSections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => itemAllowed(item, access)),
      }))
      .filter((section) => section.items.length > 0)
  }, [access])

  const technicianSites = React.useMemo(() => {
    const memberships = accessQuery.data?.siteMemberships ?? []
    const seen = new Map<string, string>()
    for (const membership of memberships) {
      if (membership.status !== "active") continue
      seen.set(membership.siteId, membership.siteName ?? "Site")
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }))
  }, [accessQuery.data?.siteMemberships])

  const currentItem = findNavItem(pathname)
  const alwaysAllowed = alwaysAllowedPrefixes.some((prefix) =>
    pathname.startsWith(prefix)
  )
  const pageAllowed =
    alwaysAllowed || !access || !currentItem || itemAllowed(currentItem, access)

  const isTechnician = access?.uiScope === "technician"
  const scopeLabel = isTechnician
    ? "Technician"
    : accessQuery.data?.platformRole === "owner"
      ? "Platform owner"
      : accessQuery.data?.platformRole === "admin"
        ? "Platform admin"
        : "Administrator"

  const vpnStatus = (
    <AdminVpnStatusIndicator
      connected={adminVpnConnected}
      checked={adminVpnChecked}
    />
  )

  const navContent =
    accessQuery.isLoading && !access ? (
      <div className="flex flex-col gap-2 px-1">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-8 w-full" />
        ))}
      </div>
    ) : (
      <NavLinks
        sections={visibleNavSections}
        pathname={pathname}
        onNavigate={() => setMobileOpen(false)}
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
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <AdminVpnStatusIndicator
                        connected={adminVpnConnected}
                        checked={adminVpnChecked}
                        showLabel
                      />
                      {isTechnician ? (
                        <SiteSwitcher sites={technicianSites} />
                      ) : null}
                    </div>
                  </SheetHeader>
                  <div className="flex-1 overflow-y-auto p-2">{navContent}</div>
                  <div className="mt-auto flex flex-col gap-2 border-t border-sidebar-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                    <Button
                      asChild
                      variant="ghost"
                      className="w-full justify-start gap-2"
                    >
                      <Link
                        href="/account"
                        onClick={() => setMobileOpen(false)}
                      >
                        <UserRoundIcon className="size-4" />
                        Account &amp; security
                      </Link>
                    </Button>
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
                    {isTechnician ? "Technician console" : "Console"}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              {isTechnician ? (
                <SiteSwitcher
                  sites={technicianSites}
                  className="hidden md:inline-flex"
                />
              ) : null}
              {vpnStatus}
              <ThemeToggle />
              <UserMenu
                label={userLabel}
                email={userEmail}
                scopeLabel={scopeLabel}
              />
              <div className="hidden lg:block">
                <ThemeToggle />
              </div>
            </div>
          </div>
        </header>
      )}

      <div className="relative flex w-full gap-5 px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-5 sm:py-6">
        <aside className="hidden w-48 shrink-0 lg:block">
          <div className="sticky top-20 flex flex-col gap-3 rounded-xl border border-sidebar-border/80 bg-sidebar/80 p-1.5 backdrop-blur-sm">
            {navContent}
          </div>
        </aside>

        <main className="min-w-0 flex-1 animate-fade-up overflow-x-clip">
          {pageAllowed ? children : <AccessDenied />}
        </main>
      </div>
    </div>
  )
}

export function DashboardShell({
  children,
  hideHeader = false,
}: {
  children: React.ReactNode
  hideHeader?: boolean
}) {
  return (
    <SiteScopeProvider>
      <ShellContent hideHeader={hideHeader}>{children}</ShellContent>
    </SiteScopeProvider>
  )
}
