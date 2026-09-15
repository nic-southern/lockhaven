"use client"

import * as React from "react"
import { QRCodeSVG } from "qrcode.react"
import { CheckIcon, CopyIcon, DownloadIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/dashboard/form-field"
import { authClient } from "@/lib/auth-client"
import { getClientProductName } from "@/lib/product-name"

type Stage = "password" | "scan" | "backup"

function secretFromUri(uri: string) {
  try {
    return new URL(uri).searchParams.get("secret") ?? ""
  } catch {
    return ""
  }
}

function groupSecret(secret: string) {
  return secret.replace(/(.{4})/g, "$1 ").trim()
}

export function TotpEnrollment({
  onComplete,
  onCancel,
}: {
  onComplete: () => void
  onCancel?: () => void
}) {
  const productName = getClientProductName()
  const [stage, setStage] = React.useState<Stage>("password")
  const [password, setPassword] = React.useState("")
  const [totpUri, setTotpUri] = React.useState("")
  const [backupCodes, setBackupCodes] = React.useState<string[]>([])
  const [code, setCode] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const [acknowledged, setAcknowledged] = React.useState(false)

  async function start(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      const result = await authClient.twoFactor.enable({
        password,
        issuer: productName,
      })
      if (result.error || !result.data) {
        setError(
          result.error?.status === 429
            ? "Too many attempts. Wait a minute and try again."
            : "That password is incorrect."
        )
        return
      }
      setTotpUri(result.data.totpURI)
      setBackupCodes(result.data.backupCodes)
      setStage("scan")
      setPassword("")
    } finally {
      setPending(false)
    }
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      const result = await authClient.twoFactor.verifyTotp({
        code: code.replace(/\s+/g, ""),
      })
      if (result.error) {
        setError("That code didn't work. Codes change every 30 seconds.")
        return
      }
      setStage("backup")
    } finally {
      setPending(false)
    }
  }

  async function copyCodes() {
    try {
      await navigator.clipboard.writeText(backupCodes.join("\n"))
      setCopied(true)
      toast.success("Backup codes copied")
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      toast.error("Couldn't copy")
    }
  }

  function downloadCodes() {
    const blob = new Blob(
      [
        `${productName} backup codes\n\nEach code can be used once.\n\n${backupCodes.join("\n")}\n`,
      ],
      { type: "text/plain" }
    )
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `${productName.toLowerCase().replace(/\s+/g, "-")}-backup-codes.txt`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  if (stage === "password") {
    return (
      <form className="flex flex-col gap-5" onSubmit={start}>
        <p className="text-sm text-muted-foreground">
          Confirm your password to start setting up an authenticator app.
        </p>
        <FormField label="Current password" htmlFor="totp-password">
          <Input
            id="totp-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            autoFocus
          />
        </FormField>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {onCancel ? (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Preparing…" : "Continue"}
          </Button>
        </div>
      </form>
    )
  }

  if (stage === "scan") {
    const secret = secretFromUri(totpUri)
    return (
      <form className="flex flex-col gap-5" onSubmit={verify}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="mx-auto shrink-0 rounded-xl border border-border/80 bg-white p-3 sm:mx-0">
            <QRCodeSVG value={totpUri} size={168} level="M" marginSize={0} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
              Scan this code with an authenticator app such as 1Password, Google
              Authenticator, or Microsoft Authenticator.
            </p>
            {secret ? (
              <div className="rounded-lg border border-border/80 bg-muted/40 p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Can&apos;t scan? Enter this key instead
                </p>
                <p className="mt-1 font-mono text-sm tracking-wide break-all">
                  {groupSecret(secret)}
                </p>
              </div>
            ) : null}
          </div>
        </div>
        <FormField
          label="Enter the 6-digit code from the app"
          htmlFor="totp-code"
        >
          <Input
            id="totp-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="123 456"
            className="h-11 text-center font-mono text-lg tracking-[0.3em]"
            required
            autoFocus
          />
        </FormField>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setStage("password")
              setCode("")
              setError(null)
            }}
          >
            Back
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Verifying…" : "Verify and enable"}
          </Button>
        </div>
      </form>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-800 dark:text-emerald-200">
        <CheckIcon className="mt-0.5 size-4 shrink-0" />
        <p>
          Authenticator app connected. Save your backup codes before you finish.
        </p>
      </div>
      <div>
        <p className="text-sm text-muted-foreground">
          Use a backup code if you lose access to your authenticator. Each code
          works once. Store them somewhere safe, such as a password manager.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-border/80 bg-muted/40 p-3 font-mono text-sm sm:grid-cols-3">
          {backupCodes.map((entry) => (
            <span key={entry} className="tabular-nums">
              {entry}
            </span>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={copyCodes}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            Copy codes
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={downloadCodes}
          >
            <DownloadIcon />
            Download
          </Button>
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1 size-4 accent-primary"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
        />
        <span>I&apos;ve saved these backup codes somewhere safe.</span>
      </label>
      <div className="flex justify-end">
        <Button type="button" disabled={!acknowledged} onClick={onComplete}>
          Done
        </Button>
      </div>
    </div>
  )
}
