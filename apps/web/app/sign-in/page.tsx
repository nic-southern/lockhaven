"use client"

import * as React from "react"
import { toast } from "sonner"

import { ThemeToggle } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/dashboard/form-field"
import { signIn } from "@/lib/auth-client"
import { getClientProductName, getProductInitials } from "@/lib/product-name"

export default function SignInPage() {
  const productName = getClientProductName()
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  return (
    <main className="relative flex min-h-svh overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,oklch(0.72_0.08_186_/_0.22),transparent_55%),radial-gradient(ellipse_at_bottom_right,oklch(0.7_0.04_240_/_0.18),transparent_50%),linear-gradient(180deg,var(--background),oklch(0.96_0.01_210))] dark:bg-[radial-gradient(ellipse_at_top_left,oklch(0.45_0.08_186_/_0.28),transparent_55%),radial-gradient(ellipse_at_bottom_right,oklch(0.35_0.04_240_/_0.35),transparent_50%),linear-gradient(180deg,var(--background),oklch(0.14_0.02_240))]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,oklch(0.55_0.02_220_/_0.08)_1px,transparent_1px),linear-gradient(to_bottom,oklch(0.55_0.02_220_/_0.08)_1px,transparent_1px)] [background-size:48px_48px] opacity-[0.35] dark:opacity-20"
      />

      <div className="relative z-10 flex w-full flex-col">
        <header className="flex items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
              {getProductInitials(productName)}
            </div>
            <p className="text-sm font-semibold tracking-tight">
              {productName}
            </p>
          </div>
          <ThemeToggle />
        </header>

        <div className="flex flex-1 items-center justify-center px-6 pb-16">
          <div className="w-full max-w-sm animate-fade-up">
            <div className="mb-8 flex flex-col gap-3">
              <h1 className="text-4xl font-semibold tracking-tight">
                {productName}
              </h1>
              <p className="text-sm text-pretty text-muted-foreground">
                Sign in to manage devices, sites, and private access.
              </p>
            </div>

            <form
              className="flex flex-col gap-5 rounded-2xl border border-border/80 bg-card/80 p-6 shadow-sm backdrop-blur"
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
                        toast.error("Email or password is incorrect.")
                        return
                      }

                      window.location.assign("/")
                    })
                })
              }}
            >
              <FormField label="Email" htmlFor="email">
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </FormField>
              <FormField label="Password" htmlFor="password">
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </FormField>
              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </main>
  )
}
