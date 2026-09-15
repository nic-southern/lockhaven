"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"

import { AuthShell } from "@/components/auth/auth-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { FormField } from "@/components/dashboard/form-field"
import { signIn } from "@/lib/auth-client"
import { getClientProductName } from "@/lib/product-name"
import { trpc } from "@/lib/trpc"
import { MIN_PASSWORD_LENGTH } from "@nms/shared"

function AcceptInviteForm() {
  const searchParams = useSearchParams()
  const token = searchParams.get("token") ?? ""
  const productName = getClientProductName()

  const preview = trpc.users.invitationPreview.useQuery(
    { token },
    { enabled: token.length >= 20, retry: false }
  )
  const accept = trpc.users.acceptInvitation.useMutation()

  // The invitation's name is the default until the user edits the field.
  const [nameOverride, setNameOverride] = React.useState<string | null>(null)
  const name = nameOverride ?? (preview.data?.valid ? preview.data.name : "")
  const setName = setNameOverride
  const [password, setPassword] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  if (!token || token.length < 20 || (preview.data && !preview.data.valid)) {
    return (
      <AuthShell
        title="This invitation isn't valid"
        description="It may have expired or already been used. Ask the person who invited you to send a new one."
        footer={
          <Link href="/sign-in" className="underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        }
      >
        <p className="text-sm text-muted-foreground">
          Invitations expire after 7 days and can only be used once.
        </p>
      </AuthShell>
    )
  }

  if (!preview.data) {
    return (
      <AuthShell title="Checking your invitation…">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-2/3" />
      </AuthShell>
    )
  }

  const invitation = preview.data
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
      await accept.mutateAsync({ token, name: name.trim(), password })
      const result = await signIn.email({ email: invitation.email, password })
      if (result.error) {
        toast.success("Your account is ready. Sign in to continue.")
        window.location.assign("/sign-in")
        return
      }
      window.location.assign("/setup-security")
    } catch (mutationError) {
      setError(
        mutationError instanceof Error && mutationError.message
          ? mutationError.message
          : "We couldn't finish setting up your account."
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthShell
      title={`Join ${invitation.organizationName ?? productName}`}
      description={`You've been invited to ${productName}. Create a password to finish setting up your account.`}
      width="md"
    >
      <form className="flex flex-col gap-5" onSubmit={submit}>
        <FormField label="Email" htmlFor="invite-email">
          <Input
            id="invite-email"
            type="email"
            value={invitation.email}
            readOnly
            className="bg-muted/40"
          />
        </FormField>
        <FormField label="Your name" htmlFor="invite-name">
          <Input
            id="invite-name"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </FormField>
        <FormField
          label="Password"
          htmlFor="invite-password"
          description={`At least ${MIN_PASSWORD_LENGTH} characters. Longer passphrases are stronger.`}
          error={
            tooShort
              ? `Use at least ${MIN_PASSWORD_LENGTH} characters.`
              : undefined
          }
        >
          <Input
            id="invite-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={tooShort || undefined}
            required
          />
        </FormField>
        <FormField
          label="Confirm password"
          htmlFor="invite-confirm"
          error={mismatch ? "The passwords don't match." : undefined}
        >
          <Input
            id="invite-confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            aria-invalid={mismatch || undefined}
            required
          />
        </FormField>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Creating your account…" : "Create account"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Next, you&apos;ll set up two-step verification.
        </p>
      </form>
    </AuthShell>
  )
}

export default function AcceptInvitePage() {
  return (
    <React.Suspense fallback={null}>
      <AcceptInviteForm />
    </React.Suspense>
  )
}
