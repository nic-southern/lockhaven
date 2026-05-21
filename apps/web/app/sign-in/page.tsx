"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { signIn } from "@/lib/auth-client"

export default function SignInPage() {
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-6">
      <div className="w-full rounded-2xl border bg-card p-6 shadow-sm">
        <div className="mb-6 space-y-2">
          <h1 className="text-2xl font-semibold">Sign in</h1>
          <p className="text-sm text-muted-foreground">
            Use your work email to continue.
          </p>
        </div>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            setError(null)
            startTransition(() => {
              void signIn
                .email({
                  email,
                  password,
                })
                .then((result) => {
                  if (result.error) {
                    setError("Email or password is incorrect.")
                    return
                  }

                  window.location.assign("/")
                })
            })
          }}
        >
          <label className="flex flex-col gap-2 text-sm">
            <span>Email</span>
            <input
              className="h-10 rounded-md border bg-background px-3"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-2 text-sm">
            <span>Password</span>
            <input
              className="h-10 rounded-md border bg-background px-3"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button
            type="submit"
            disabled={pending || email.length === 0 || password.length === 0}
          >
            Sign in
          </Button>
        </form>
      </div>
    </main>
  )
}
