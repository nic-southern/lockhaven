"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { FormField } from "@/components/dashboard/form-field"

export function AccessReasonDialog({
  open,
  onOpenChange,
  requireReason,
  requireApproval,
  pending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  requireReason: boolean
  requireApproval: boolean
  pending?: boolean
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = React.useState("")

  function handleOpenChange(next: boolean) {
    if (!next) setReason("")
    onOpenChange(next)
  }

  const title = requireApproval ? "Request access?" : "Why do you need access?"
  const description = requireApproval
    ? requireReason
      ? "Tell us why you need this session. Someone who can approve access will review it."
      : "Someone who can approve access will review this before the session starts."
    : "This site asks for a short reason before a session starts."
  const confirmLabel = requireApproval ? "Send request" : "Start session"
  const tooShort = requireReason && reason.trim().length < 3

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {requireReason || requireApproval ? (
          <FormField
            label={requireReason ? "Reason" : "Reason (optional)"}
            htmlFor="access-reason"
          >
            <Textarea
              id="access-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              rows={4}
            />
          </FormField>
        ) : null}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            disabled={pending || tooShort}
            onClick={() => onConfirm(reason.trim())}
          >
            {pending ? "Sending…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
