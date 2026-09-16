"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { FingerprintIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog"
import { FormField } from "@/components/dashboard/form-field"
import { authClient } from "@/lib/auth-client"
import { formatDate } from "@/lib/dashboard"
import { usePasskeySupport } from "@/lib/use-passkey-support"

type PasskeyRecord = {
  id: string
  name?: string | null
  deviceType?: string | null
  backedUp?: boolean | null
  createdAt?: Date | string | null
}

function defaultPasskeyName() {
  if (typeof navigator === "undefined") {
    return "This device"
  }
  const ua = navigator.userAgent
  if (/iPhone|iPad/.test(ua)) return "iPhone or iPad"
  if (/Android/.test(ua)) return "Android device"
  if (/Macintosh/.test(ua)) return "Mac"
  if (/Windows/.test(ua)) return "Windows PC"
  if (/Linux/.test(ua)) return "Linux device"
  return "This device"
}

export function PasskeyManager({
  onChanged,
  compact = false,
}: {
  onChanged?: (count: number) => void
  compact?: boolean
}) {
  const [name, setName] = React.useState("")
  const [adding, setAdding] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [removeTarget, setRemoveTarget] = React.useState<PasskeyRecord | null>(
    null
  )
  const supported = usePasskeySupport()

  const passkeysQuery = useQuery({
    queryKey: ["auth", "passkeys"],
    queryFn: async () => {
      const result = await authClient.passkey.listUserPasskeys()
      return (result.data ?? []) as PasskeyRecord[]
    },
  })
  const passkeys = passkeysQuery.data ?? null
  const refetchPasskeys = passkeysQuery.refetch

  const refresh = React.useCallback(async () => {
    const result = await refetchPasskeys()
    onChanged?.((result.data ?? []).length)
  }, [onChanged, refetchPasskeys])

  async function add(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    try {
      const result = await authClient.passkey.addPasskey({
        name: name.trim() || defaultPasskeyName(),
      })
      if (result?.error) {
        toast.error("We couldn't add that passkey.")
        return
      }
      toast.success("Passkey added")
      setName("")
      setAdding(false)
      await refresh()
    } catch {
      toast.error("Passkey setup was cancelled.")
    } finally {
      setPending(false)
    }
  }

  async function remove(target: PasskeyRecord) {
    setPending(true)
    try {
      const result = await authClient.passkey.deletePasskey({ id: target.id })
      if (result?.error) {
        toast.error("We couldn't remove that passkey.")
        return
      }
      toast.success("Passkey removed")
      await refresh()
    } finally {
      setPending(false)
      setRemoveTarget(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!supported ? (
        <p className="text-sm text-muted-foreground">
          This browser doesn&apos;t support passkeys. You can still sign in with
          your password and authenticator app.
        </p>
      ) : null}

      {passkeys === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : passkeys.length === 0 ? (
        <div className="flex items-center gap-3 rounded-lg border border-dashed border-border/80 px-3 py-3 text-sm text-muted-foreground">
          <FingerprintIcon className="size-4 shrink-0" />
          No passkeys yet. Add one to sign in with Face ID, Touch ID, Windows
          Hello, or a security key.
        </div>
      ) : (
        <ul className="divide-y divide-border/70 rounded-lg border border-border/80">
          {passkeys.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center justify-between gap-3 px-3 py-2.5"
            >
              <div className="flex min-w-0 items-center gap-3">
                <FingerprintIcon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {entry.name || "Passkey"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {entry.backedUp ? "Synced" : "Device-bound"}
                    {entry.createdAt
                      ? ` · Added ${formatDate(entry.createdAt)}`
                      : ""}
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Remove passkey"
                className="text-muted-foreground hover:text-destructive"
                disabled={pending}
                onClick={() => setRemoveTarget(entry)}
              >
                <Trash2Icon />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {supported ? (
        adding ? (
          <form
            className="flex flex-col gap-3 rounded-lg border border-border/80 bg-muted/30 p-3"
            onSubmit={add}
          >
            <FormField
              label="Name this passkey"
              htmlFor="passkey-name"
              description="Helps you recognize it later, for example “Work laptop”."
            >
              <Input
                id="passkey-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={defaultPasskeyName()}
                autoFocus
              />
            </FormField>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setAdding(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
                <FingerprintIcon />
                {pending ? "Waiting for your device…" : "Create passkey"}
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <Button
              type="button"
              variant={compact ? "outline" : "default"}
              size="sm"
              onClick={() => setAdding(true)}
              disabled={pending}
            >
              <PlusIcon />
              Add passkey
            </Button>
          </div>
        )
      ) : null}

      <ConfirmDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null)
        }}
        title="Remove this passkey?"
        description="You won't be able to sign in with it anymore. You can add it again later."
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (removeTarget) void remove(removeTarget)
        }}
      />
    </div>
  )
}
