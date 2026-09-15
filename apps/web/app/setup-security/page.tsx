"use client"

import * as React from "react"
import {
  CheckIcon,
  FingerprintIcon,
  KeyRoundIcon,
  SmartphoneIcon,
} from "lucide-react"

import { AuthShell } from "@/components/auth/auth-shell"
import { ChangePasswordForm } from "@/components/auth/change-password-form"
import { PasskeyManager } from "@/components/auth/passkey-manager"
import { TotpEnrollment } from "@/components/auth/totp-enrollment"
import { Button } from "@/components/ui/button"
import { signOut, useSession } from "@/lib/auth-client"
import { cn } from "@/lib/utils"

type StepId = "password" | "totp" | "passkey"

function StepBadge({
  index,
  done,
  active,
}: {
  index: number
  done: boolean
  active: boolean
}) {
  return (
    <span
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
        done
          ? "bg-emerald-500 text-white"
          : active
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground"
      )}
    >
      {done ? <CheckIcon className="size-3.5" /> : index}
    </span>
  )
}

export default function SetupSecurityPage() {
  const { data: session, refetch } = useSession()
  const user = session?.user as
    | { mustChangePassword?: boolean; twoFactorEnabled?: boolean }
    | undefined

  const [passwordDone, setPasswordDone] = React.useState(false)
  // Verifying the code flips the session flag immediately; keep the step open
  // until the user has acknowledged their backup codes.
  const [totpStarted, setTotpStarted] = React.useState(false)
  const [totpDone, setTotpDone] = React.useState(false)
  const [passkeyCount, setPasskeyCount] = React.useState(0)

  const needsPassword = Boolean(user?.mustChangePassword) && !passwordDone
  const needsTotp = !totpDone && (totpStarted || !user?.twoFactorEnabled)

  const steps: Array<{ id: StepId; label: string; required: boolean }> = [
    ...(user?.mustChangePassword
      ? [
          {
            id: "password" as const,
            label: "Set a new password",
            required: true,
          },
        ]
      : []),
    { id: "totp", label: "Add an authenticator app", required: true },
    { id: "passkey", label: "Add a passkey", required: false },
  ]

  const activeStep: StepId = needsPassword
    ? "password"
    : needsTotp
      ? "totp"
      : "passkey"

  const isDone = (id: StepId) =>
    id === "password"
      ? !needsPassword
      : id === "totp"
        ? !needsTotp
        : passkeyCount > 0

  function finish() {
    void refetch().finally(() => window.location.assign("/"))
  }

  return (
    <AuthShell
      title="Secure your account"
      description="Two-step verification is required for everyone. It takes about a minute."
      width="md"
      footer={
        <button
          type="button"
          className="underline-offset-4 hover:underline"
          onClick={() => {
            void signOut({
              fetchOptions: {
                onSuccess() {
                  window.location.assign("/sign-in")
                },
              },
            })
          }}
        >
          Sign out
        </button>
      }
    >
      <ol className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className={cn(
              "flex items-center gap-2 text-sm",
              activeStep === step.id
                ? "text-foreground"
                : "text-muted-foreground"
            )}
          >
            <StepBadge
              index={index + 1}
              done={isDone(step.id)}
              active={activeStep === step.id}
            />
            <span className="truncate">
              {step.label}
              {!step.required ? (
                <span className="text-xs text-muted-foreground">
                  {" "}
                  · optional
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>

      <div className="border-t border-border/70 pt-5">
        {activeStep === "password" ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <KeyRoundIcon className="size-4 text-muted-foreground" />
              Choose a new password
            </div>
            <ChangePasswordForm
              description="You signed in with a temporary password. Replace it with one only you know."
              submitLabel="Save password"
              onComplete={() => {
                setPasswordDone(true)
                void refetch()
              }}
            />
          </div>
        ) : null}

        {activeStep === "totp" ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <SmartphoneIcon className="size-4 text-muted-foreground" />
              Connect an authenticator app
            </div>
            <TotpEnrollment
              onStarted={() => setTotpStarted(true)}
              onComplete={() => {
                setTotpDone(true)
                void refetch()
              }}
            />
          </div>
        ) : null}

        {activeStep === "passkey" ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FingerprintIcon className="size-4 text-muted-foreground" />
              Add a passkey for faster sign-in
            </div>
            <p className="text-sm text-muted-foreground">
              Passkeys let you sign in with Face ID, Touch ID, Windows Hello, or
              a security key instead of typing a password and code.
            </p>
            <PasskeyManager onChanged={setPasskeyCount} />
            <div className="flex flex-col-reverse gap-2 border-t border-border/70 pt-4 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant={passkeyCount > 0 ? "default" : "outline"}
                onClick={finish}
              >
                {passkeyCount > 0 ? "Go to the console" : "Skip for now"}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </AuthShell>
  )
}
