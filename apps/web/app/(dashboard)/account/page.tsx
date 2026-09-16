"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  FingerprintIcon,
  LaptopIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
} from "lucide-react"
import { toast } from "sonner"

import { ChangePasswordForm } from "@/components/auth/change-password-form"
import { PasskeyManager } from "@/components/auth/passkey-manager"
import { TotpEnrollment } from "@/components/auth/totp-enrollment"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog"
import { FormField } from "@/components/dashboard/form-field"
import { PageHeader } from "@/components/dashboard/page-header"
import { SectionCard } from "@/components/dashboard/section-card"
import { authClient, useSession } from "@/lib/auth-client"
import { formatDate, formatRelativeTime } from "@/lib/dashboard"
import { trpc } from "@/lib/trpc"

type SessionRecord = {
  id: string
  token: string
  ipAddress?: string | null
  userAgent?: string | null
  createdAt: Date | string
  updatedAt: Date | string
  expiresAt: Date | string
}

function describeUserAgent(value: string | null | undefined) {
  if (!value) return "Unknown browser"
  const browser = /Edg\//.test(value)
    ? "Edge"
    : /Chrome\//.test(value)
      ? "Chrome"
      : /Firefox\//.test(value)
        ? "Firefox"
        : /Safari\//.test(value)
          ? "Safari"
          : "Browser"
  const os = /Windows/.test(value)
    ? "Windows"
    : /Mac OS X/.test(value)
      ? "macOS"
      : /iPhone|iPad/.test(value)
        ? "iOS"
        : /Android/.test(value)
          ? "Android"
          : /Linux/.test(value)
            ? "Linux"
            : null
  return os ? `${browser} on ${os}` : browser
}

function SessionsPanel() {
  const { data: current } = useSession()
  const [pending, setPending] = React.useState(false)
  const [confirmOthers, setConfirmOthers] = React.useState(false)

  const sessionsQuery = useQuery({
    queryKey: ["auth", "sessions"],
    queryFn: async () => {
      const result = await authClient.listSessions()
      return (result.data ?? []) as SessionRecord[]
    },
  })
  const sessions = sessionsQuery.data ?? null
  const refresh = sessionsQuery.refetch

  async function revoke(token: string) {
    setPending(true)
    try {
      const result = await authClient.revokeSession({ token })
      if (result.error) {
        toast.error("We couldn't sign out that session.")
        return
      }
      toast.success("Session signed out")
      await refresh()
    } finally {
      setPending(false)
    }
  }

  async function revokeOthers() {
    setPending(true)
    try {
      const result = await authClient.revokeOtherSessions()
      if (result.error) {
        toast.error("We couldn't sign out other sessions.")
        return
      }
      toast.success("Signed out everywhere else")
      await refresh()
    } finally {
      setPending(false)
      setConfirmOthers(false)
    }
  }

  const currentToken = current?.session?.token
  const others = (sessions ?? []).filter(
    (entry) => entry.token !== currentToken
  )

  return (
    <SectionCard
      title="Where you're signed in"
      description="Sessions expire after 12 hours of inactivity. Sign out of any you don't recognize."
      actions={
        others.length > 0 ? (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => setConfirmOthers(true)}
          >
            Sign out everywhere else
          </Button>
        ) : null
      }
    >
      {sessions === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <ul className="divide-y divide-border/70 rounded-lg border border-border/80">
          {sessions.map((entry) => {
            const isCurrent = entry.token === currentToken
            return (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-3 px-3 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <LaptopIcon className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-sm font-medium">
                      {describeUserAgent(entry.userAgent)}
                      {isCurrent ? (
                        <Badge variant="secondary" className="text-[10px]">
                          This device
                        </Badge>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {entry.ipAddress ?? "Unknown address"} · Active{" "}
                      {formatRelativeTime(entry.updatedAt)}
                    </p>
                  </div>
                </div>
                {!isCurrent ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => void revoke(entry.token)}
                  >
                    Sign out
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
      <ConfirmDialog
        open={confirmOthers}
        onOpenChange={setConfirmOthers}
        title="Sign out everywhere else?"
        description="Every other browser and device will need to sign in again."
        confirmLabel="Sign out others"
        pending={pending}
        onConfirm={() => void revokeOthers()}
      />
    </SectionCard>
  )
}

function TwoFactorPanel({
  enabled,
  onChanged,
}: {
  enabled: boolean
  onChanged: () => void
}) {
  const [reenrolling, setReenrolling] = React.useState(false)
  const [regenPassword, setRegenPassword] = React.useState("")
  const [regenCodes, setRegenCodes] = React.useState<string[] | null>(null)
  const [regenOpen, setRegenOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)

  async function regenerate(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    try {
      const result = await authClient.twoFactor.generateBackupCodes({
        password: regenPassword,
      })
      if (result.error || !result.data) {
        toast.error("That password is incorrect.")
        return
      }
      setRegenCodes(result.data.backupCodes)
      setRegenPassword("")
    } finally {
      setPending(false)
    }
  }

  return (
    <SectionCard
      title="Authenticator app"
      description="A 6-digit code from your authenticator is required whenever you sign in with a password."
      actions={
        enabled ? (
          <Badge className="gap-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
            <ShieldCheckIcon className="size-3" />
            On
          </Badge>
        ) : (
          <Badge variant="outline">Off</Badge>
        )
      }
    >
      {reenrolling ? (
        <TotpEnrollment
          onComplete={() => {
            setReenrolling(false)
            onChanged()
          }}
          onCancel={() => setReenrolling(false)}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3 text-sm text-muted-foreground">
            <SmartphoneIcon className="mt-0.5 size-4 shrink-0" />
            <p>
              {enabled
                ? "If you get a new phone, connect a new authenticator here. Your previous one will stop working."
                : "Two-step verification is required. Connect an authenticator app to continue."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={enabled ? "outline" : "default"}
              size="sm"
              onClick={() => setReenrolling(true)}
            >
              {enabled ? "Connect a new app" : "Set up authenticator"}
            </Button>
            {enabled ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setRegenCodes(null)
                  setRegenOpen((open) => !open)
                }}
              >
                New backup codes
              </Button>
            ) : null}
          </div>
          {regenOpen ? (
            regenCodes ? (
              <div className="rounded-lg border border-border/80 bg-muted/40 p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Your previous backup codes no longer work. Save these new
                  ones.
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-3">
                  {regenCodes.map((entry) => (
                    <span key={entry}>{entry}</span>
                  ))}
                </div>
              </div>
            ) : (
              <form
                className="flex flex-col gap-3 rounded-lg border border-border/80 bg-muted/30 p-3 sm:flex-row sm:items-end"
                onSubmit={regenerate}
              >
                <FormField
                  label="Confirm your password"
                  htmlFor="regen-password"
                  className="flex-1"
                >
                  <Input
                    id="regen-password"
                    type="password"
                    autoComplete="current-password"
                    value={regenPassword}
                    onChange={(event) => setRegenPassword(event.target.value)}
                    required
                  />
                </FormField>
                <Button type="submit" size="sm" disabled={pending}>
                  Generate codes
                </Button>
              </form>
            )
          ) : null}
        </div>
      )}
    </SectionCard>
  )
}

export default function AccountPage() {
  const { data: session, refetch } = useSession()
  const meQuery = trpc.access.me.useQuery()
  const user = session?.user

  const twoFactorEnabled = Boolean(
    (user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Account"
        title={user?.name || "Your account"}
        description={user?.email}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="flex flex-col gap-6">
          <SectionCard
            title="Passkeys"
            description="Sign in with Face ID, Touch ID, Windows Hello, or a security key. Passkeys are phishing-resistant and skip the authenticator step."
            actions={
              <Badge variant="outline" className="gap-1">
                <FingerprintIcon className="size-3" />
                {meQuery.data?.security.passkeyCount ?? 0}
              </Badge>
            }
          >
            <PasskeyManager compact onChanged={() => void meQuery.refetch()} />
          </SectionCard>

          <TwoFactorPanel
            enabled={twoFactorEnabled}
            onChanged={() => {
              void refetch()
              void meQuery.refetch()
            }}
          />
        </div>

        <div className="flex flex-col gap-6">
          <SessionsPanel />

          <SectionCard
            title="Password"
            description="Changing your password signs out every other session."
          >
            <ChangePasswordForm />
          </SectionCard>

          <SectionCard title="Access" description="What this account can do.">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Platform role</dt>
                <dd className="mt-0.5 font-medium capitalize">
                  {meQuery.data?.platformRole ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Last sign-in</dt>
                <dd className="mt-0.5 font-medium">
                  {formatDate(meQuery.data?.security.lastLoginAt)}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">Organizations</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {meQuery.data?.organizationMemberships.length ? (
                    meQuery.data.organizationMemberships.map((membership) => (
                      <Badge key={membership.id} variant="secondary">
                        {membership.role}
                      </Badge>
                    ))
                  ) : meQuery.data?.platformRole === "member" ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span className="text-muted-foreground">
                      All organizations
                    </span>
                  )}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">Sites</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {meQuery.data?.siteMemberships.length ? (
                    meQuery.data.siteMemberships.map((membership) => (
                      <Badge key={membership.id} variant="outline">
                        {membership.siteName ?? "Site"} · {membership.role}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-muted-foreground">
                      {meQuery.data?.platformRole === "member"
                        ? "—"
                        : "All sites"}
                    </span>
                  )}
                </dd>
              </div>
            </dl>
          </SectionCard>
        </div>
      </div>
    </div>
  )
}
