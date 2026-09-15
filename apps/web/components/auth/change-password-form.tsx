"use client"

import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/dashboard/form-field"
import { authClient } from "@/lib/auth-client"
import { MIN_PASSWORD_LENGTH } from "@nms/shared"

export function ChangePasswordForm({
  onComplete,
  submitLabel = "Update password",
  description,
}: {
  onComplete?: () => void
  submitLabel?: string
  description?: string
}) {
  const [currentPassword, setCurrentPassword] = React.useState("")
  const [newPassword, setNewPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  const tooShort =
    newPassword.length > 0 && newPassword.length < MIN_PASSWORD_LENGTH
  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    if (newPassword !== confirmPassword) {
      setError("The passwords don't match.")
      return
    }
    setPending(true)
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      })
      if (result.error) {
        const code = result.error.code ?? ""
        setError(
          code.includes("PASSWORD_COMPROMISED")
            ? "That password has appeared in a known data breach. Choose a different one."
            : result.error.status === 429
              ? "Too many attempts. Wait a few minutes and try again."
              : "Your current password is incorrect."
        )
        return
      }
      toast.success("Password updated")
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
      onComplete?.()
    } finally {
      setPending(false)
    }
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={submit}>
      {description ? (
        <p className="text-sm text-muted-foreground">{description}</p>
      ) : null}
      <FormField label="Current password" htmlFor="current-password">
        <Input
          id="current-password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          required
        />
      </FormField>
      <FormField
        label="New password"
        htmlFor="new-password"
        description={`At least ${MIN_PASSWORD_LENGTH} characters. Longer passphrases are stronger.`}
        error={
          tooShort
            ? `Use at least ${MIN_PASSWORD_LENGTH} characters.`
            : undefined
        }
      >
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          aria-invalid={tooShort || undefined}
          required
        />
      </FormField>
      <FormField
        label="Confirm new password"
        htmlFor="confirm-password"
        error={mismatch ? "The passwords don't match." : undefined}
      >
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          aria-invalid={mismatch || undefined}
          required
        />
      </FormField>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Updating…" : submitLabel}
        </Button>
      </div>
    </form>
  )
}
