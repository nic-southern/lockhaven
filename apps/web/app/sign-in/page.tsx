"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { FingerprintIcon, KeyRoundIcon, ShieldCheckIcon } from "lucide-react"
import { toast } from "sonner"

import { AuthShell } from "@/components/auth/auth-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { FormField } from "@/components/dashboard/form-field"
import { authClient, signIn } from "@/lib/auth-client"
import { getClientProductName } from "@/lib/product-name"
import {
  resolveSsoStart,
  ssoRedirectUrl,
  SSO_START_ERROR,
} from "@/lib/sso-sign-in"
import { trpc } from "@/lib/trpc"
import { usePasskeySupport } from "@/lib/use-passkey-support"

type Step = "credentials" | "totp" | "backup" | "reset"

function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/"
  }
  return value
}

function SignInForm() {
  const searchParams = useSearchParams()
  const nextPath = safeNextPath(searchParams.get("next"))
  const reason = searchParams.get("reason")
  const productName = getClientProductName()

  const [step, setStep] = React.useState<Step>("credentials")
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [code, setCode] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const [passkeyPending, setPasskeyPending] = React.useState(false)
  const passkeySupported = usePasskeySupport()
  const [resetSent, setResetSent] = React.useState(false)
  const [ssoPending, setSsoPending] = React.useState(false)
  const ssoStatus = trpc.sso.status.useQuery()
  const sso = ssoStatus.data
  const emailLooksComplete = /.+@.+\..+/.test(email.trim())
  const ssoHint = trpc.sso.hint.useQuery(
    { email: email.trim() },
    { enabled: emailLooksComplete }
  )
  const passwordEnabled =
    sso?.passwordEnabled !== false && ssoHint.data?.required !== true

  React.useEffect(() => {
    if (!passkeySupported) {
      return
    }
    // Offer saved passkeys through the browser's autofill UI when available.
    void PublicKeyCredential.isConditionalMediationAvailable?.().then(
      (available) => {
        if (available) {
          void signIn.passkey({ autoFill: true }).then((result) => {
            if (result && !result.error) {
              window.location.assign(nextPath)
            }
          })
        }
      }
    )
  }, [nextPath, passkeySupported])

  function finish() {
    window.location.assign(nextPath)
  }

  async function handleSso() {
    setError(null)
    setSsoPending(true)
    try {
      const start = resolveSsoStart({
        email,
        status: sso,
        hint: emailLooksComplete ? ssoHint.data : null,
      })
      if (start.action === "error") {
        setError(start.message)
        return
      }
      if (start.action === "sso") {
        const result = await authClient.signIn.sso({
          ...(start.providerId ? { providerId: start.providerId } : {}),
          ...(start.email ? { email: start.email } : {}),
          callbackURL: nextPath,
          errorCallbackURL: "/sign-in?reason=sso",
        })
        const ssoUrl = ssoRedirectUrl(result)
        if (ssoUrl) {
          window.location.assign(ssoUrl)
          return
        }
        if (result?.error) {
          setError(SSO_START_ERROR)
        }
        return
      }
      const result = await signIn.oauth2({
        providerId: start.providerId,
        callbackURL: nextPath,
        errorCallbackURL: "/sign-in?reason=sso",
      })
      const oauthUrl = ssoRedirectUrl(result)
      if (oauthUrl) {
        window.location.assign(oauthUrl)
        return
      }
      if (result?.error) {
        setError(SSO_START_ERROR)
      }
    } catch {
      setError(SSO_START_ERROR)
    } finally {
      setSsoPending(false)
    }
  }

  async function handleResetRequest(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      const result = await authClient.requestPasswordReset({
        email,
        redirectTo: "/reset-password",
      })
      if (result.error && result.error.status !== 404) {
        setError("We couldn't send that message. Try again in a moment.")
        return
      }
      setResetSent(true)
    } catch {
      setError("We couldn't send that message. Try again in a moment.")
    } finally {
      setPending(false)
    }
  }

  async function handlePasskey() {
    setError(null)
    setPasskeyPending(true)
    try {
      const result = await signIn.passkey()
      if (result?.error) {
        setError(
          "We couldn't verify that passkey. Try again or use your password."
        )
        return
      }
      finish()
    } catch {
      setError("Passkey sign-in was cancelled.")
    } finally {
      setPasskeyPending(false)
    }
  }

  async function handleCredentials(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      const result = await signIn.email({ email, password })
      if (result.error) {
        const message =
          result.error.status === 429
            ? "Too many attempts. Wait a minute and try again."
            : "Email or password is incorrect."
        setError(message)
        toast.error(message)
        return
      }
      const data = result.data as { twoFactorRedirect?: boolean } | null
      if (data?.twoFactorRedirect) {
        setStep("totp")
        setCode("")
        return
      }
      finish()
    } finally {
      setPending(false)
    }
  }

  async function handleSecondFactor(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      const result =
        step === "backup"
          ? await authClient.twoFactor.verifyBackupCode({
              code: code.trim(),
              disableSession: false,
            })
          : await authClient.twoFactor.verifyTotp({
              code: code.replace(/\s+/g, ""),
              trustDevice: false,
            })
      if (result.error) {
        setError(
          step === "backup"
            ? "That backup code didn't work."
            : "That code didn't work. Codes change every 30 seconds."
        )
        return
      }
      finish()
    } finally {
      setPending(false)
    }
  }

  if (step === "reset") {
    return (
      <AuthShell
        title={resetSent ? "Check your inbox" : "Reset your password"}
        description={
          resetSent
            ? "If an account exists for that address, we sent a message with a link to choose a new password."
            : "Enter the email you use to sign in. We'll send a link if we find a matching account."
        }
        footer={
          <button
            type="button"
            className="underline-offset-4 hover:underline"
            onClick={() => {
              setStep("credentials")
              setResetSent(false)
              setError(null)
            }}
          >
            Back to sign in
          </button>
        }
      >
        {resetSent ? null : (
          <form className="flex flex-col gap-5" onSubmit={handleResetRequest}>
            <FormField label="Email" htmlFor="reset-email">
              <Input
                id="reset-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </FormField>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Sending…" : "Send reset link"}
            </Button>
          </form>
        )}
      </AuthShell>
    )
  }

  if (step !== "credentials") {
    return (
      <AuthShell
        title="Verify it's you"
        description={
          step === "backup"
            ? "Enter one of the backup codes you saved when you set up two-step verification."
            : "Enter the 6-digit code from your authenticator app."
        }
      >
        <form className="flex flex-col gap-5" onSubmit={handleSecondFactor}>
          <FormField
            label={step === "backup" ? "Backup code" : "Verification code"}
            htmlFor="code"
          >
            <Input
              id="code"
              inputMode={step === "backup" ? "text" : "numeric"}
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder={step === "backup" ? "xxxxx-xxxxx" : "123 456"}
              className="h-11 text-center font-mono text-lg tracking-[0.3em]"
              required
            />
          </FormField>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Verifying…" : "Continue"}
          </Button>
          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              className="text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => {
                setStep("credentials")
                setPassword("")
                setCode("")
                setError(null)
              }}
            >
              Start over
            </button>
            <button
              type="button"
              className="text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => {
                setStep(step === "backup" ? "totp" : "backup")
                setCode("")
                setError(null)
              }}
            >
              {step === "backup"
                ? "Use authenticator app"
                : "Use a backup code"}
            </button>
          </div>
        </form>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title={productName}
      description="Sign in to manage devices, sites, and private access."
    >
      {reason === "suspended" ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          This account is currently suspended. Contact an administrator.
        </p>
      ) : null}
      {reason === "sso" ? (
        <p className="text-sm text-destructive">
          {"We couldn't complete sign-in. Try again."}
        </p>
      ) : null}
      {sso?.unavailable ? (
        <p className="text-sm text-destructive">
          Sign-in is temporarily unavailable. Try again later.
        </p>
      ) : null}

      {sso?.enabled && !sso.unavailable ? (
        <Button
          type="button"
          variant="default"
          className="h-11 w-full gap-2"
          onClick={handleSso}
          disabled={ssoPending || pending || passkeyPending}
        >
          <ShieldCheckIcon className="size-4" />
          {ssoPending ? "Redirecting…" : "Sign in with SSO"}
        </Button>
      ) : null}

      {sso?.enabled && !sso.unavailable && passwordEnabled ? (
        <div className="flex items-center gap-3 text-xs text-muted-foreground uppercase">
          <Separator className="flex-1" />
          or
          <Separator className="flex-1" />
        </div>
      ) : null}

      {passwordEnabled && passkeySupported ? (
        <>
          <Button
            type="button"
            variant={sso?.enabled ? "outline" : "default"}
            className="h-11 w-full gap-2"
            onClick={handlePasskey}
            disabled={passkeyPending || pending || ssoPending}
          >
            <FingerprintIcon className="size-4" />
            {passkeyPending
              ? "Waiting for your device…"
              : "Sign in with a passkey"}
          </Button>
          <div className="flex items-center gap-3 text-xs text-muted-foreground uppercase">
            <Separator className="flex-1" />
            or
            <Separator className="flex-1" />
          </div>
        </>
      ) : null}

      {error && !passwordEnabled ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : null}

      {!passwordEnabled ? null : (
        <form className="flex flex-col gap-5" onSubmit={handleCredentials}>
          <FormField label="Email" htmlFor="email">
            <Input
              id="email"
              type="email"
              autoComplete="username webauthn"
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
          <div className="flex justify-end">
            <button
              type="button"
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              onClick={() => {
                setStep("reset")
                setError(null)
                setResetSent(false)
              }}
            >
              Forgot password?
            </button>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button
            type="submit"
            variant={sso?.enabled || passkeySupported ? "outline" : "default"}
            className="w-full gap-2"
            disabled={pending || passkeyPending || ssoPending}
          >
            <KeyRoundIcon className="size-4" />
            {pending ? "Signing in…" : "Sign in with password"}
          </Button>
        </form>
      )}
    </AuthShell>
  )
}

export default function SignInPage() {
  return (
    <React.Suspense fallback={null}>
      <SignInForm />
    </React.Suspense>
  )
}
