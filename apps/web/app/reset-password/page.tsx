"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"

import { AuthShell } from "@/components/auth/auth-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/dashboard/form-field"
import { authClient } from "@/lib/auth-client"
import { MIN_PASSWORD_LENGTH } from "@nms/shared"

function ResetPasswordForm() {
  const searchParams = useSearchParams()
  const token = searchParams.get("token") ?? ""
  const [password, setPassword] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const [done, setDone] = React.useState(false)

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH
  const mismatch = confirm.length > 0 && confirm !== password

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    if (password !== confirm) {
      setError("The passwords don't match.")
      return
    }
    setPending(true)
    try {
      const result = await authClient.resetPassword({
        newPassword: password,
        token,
      })
      if (result.error) {
        setError("This reset link isn't valid. Request a new one from sign in.")
        return
      }
      setDone(true)
      toast.success("Password updated")
    } catch {
      setError("We couldn't update your password. Try again.")
    } finally {
      setPending(false)
    }
  }

  if (!token) {
    return (
      <AuthShell
        title="This reset link isn't valid"
        description="Request a new one from the sign-in page."
        footer={
          <Link href="/sign-in" className="underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        }
      >
        <p className="text-sm text-muted-foreground">
          Reset links expire after one hour and can only be used once.
        </p>
      </AuthShell>
    )
  }

  if (done) {
    return (
      <AuthShell
        title="Password updated"
        description="Sign in with your new password."
        footer={
          <Link href="/sign-in" className="underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        }
      >
        <Button asChild className="w-full">
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Choose a new password"
      description={`Use at least ${MIN_PASSWORD_LENGTH} characters.`}
      footer={
        <Link href="/sign-in" className="underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form className="flex flex-col gap-5" onSubmit={submit}>
        <FormField
          label="New password"
          htmlFor="new-password"
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
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </FormField>
        <FormField
          label="Confirm password"
          htmlFor="confirm-password"
          error={mismatch ? "The passwords don't match." : undefined}
        >
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            required
          />
        </FormField>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Saving…" : "Update password"}
        </Button>
      </form>
    </AuthShell>
  )
}

export default function ResetPasswordPage() {
  return (
    <React.Suspense fallback={null}>
      <ResetPasswordForm />
    </React.Suspense>
  )
}
