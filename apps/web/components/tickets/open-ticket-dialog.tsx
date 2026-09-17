"use client"

import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { FormField } from "@/components/dashboard/form-field"
import { SelectField } from "@/components/dashboard/select-field"
import { formatRelativeTime } from "@/lib/dashboard"
import { trpc } from "@/lib/trpc"

function ticketErrorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "We couldn't open a ticket. Try again in a moment."
}

export function OpenDeviceTicketDialog({
  deviceId,
  deviceName,
  siteName,
  open,
  onOpenChange,
}: {
  deviceId: string
  deviceName: string
  siteName: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [reason, setReason] = React.useState("")
  const [sessionId, setSessionId] = React.useState("")
  const sessionsQuery = trpc.tickets.recentSessions.useQuery(
    { deviceId },
    { enabled: open }
  )
  const openTicket = trpc.tickets.openFromDevice.useMutation()
  const sessions = sessionsQuery.data ?? []

  function handleOpenChange(next: boolean) {
    if (!next) {
      setReason("")
      setSessionId("")
    }
    onOpenChange(next)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    try {
      const result = await openTicket.mutateAsync({
        deviceId,
        sessionId: sessionId || undefined,
        reason: reason.trim() || undefined,
      })
      toast.success(
        result.created ? "Ticket opened" : "A ticket is already open"
      )
      handleOpenChange(false)
    } catch (error) {
      toast.error(ticketErrorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form className="flex flex-col gap-5" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Open a ticket</DialogTitle>
            <DialogDescription>
              Send {deviceName}
              {siteName ? ` at ${siteName}` : ""} to the desk. You can attach a
              recent session or a short reason.
            </DialogDescription>
          </DialogHeader>
          <FormField
            label="Reason"
            htmlFor="device-ticket-reason"
            description="Optional. Helps the desk see why this came up."
          >
            <Textarea
              id="device-ticket-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={4000}
              rows={4}
            />
          </FormField>
          <FormField label="Session" htmlFor="device-ticket-session">
            <SelectField
              id="device-ticket-session"
              value={sessionId}
              onValueChange={setSessionId}
              placeholder="Choose a session"
              emptyLabel="No session"
              options={sessions.map((session) => ({
                value: session.id,
                label: [
                  session.serviceType,
                  formatRelativeTime(session.startedAt),
                  session.endedAt ? "ended" : "open",
                ]
                  .filter(Boolean)
                  .join(" · "),
              }))}
            />
          </FormField>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={openTicket.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={openTicket.isPending}>
              {openTicket.isPending ? "Opening…" : "Open ticket"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function OpenAssetTicketDialog({
  assetId,
  assetTag,
  siteName,
  open,
  onOpenChange,
}: {
  assetId: string
  assetTag: string
  siteName: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [title, setTitle] = React.useState(`Work on ${assetTag}`)
  const [notes, setNotes] = React.useState("")
  const [severity, setSeverity] = React.useState("")
  const openTicket = trpc.tickets.openFromAsset.useMutation()

  function handleOpenChange(next: boolean) {
    if (!next) {
      setTitle(`Work on ${assetTag}`)
      setNotes("")
      setSeverity("")
    }
    onOpenChange(next)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    try {
      const result = await openTicket.mutateAsync({
        assetId,
        title: title.trim(),
        notes: notes.trim() || undefined,
        severity:
          severity === "low" ||
          severity === "medium" ||
          severity === "high" ||
          severity === "critical"
            ? severity
            : undefined,
      })
      toast.success(
        result.created ? "Ticket opened" : "A ticket is already open"
      )
      handleOpenChange(false)
    } catch (error) {
      toast.error(ticketErrorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form className="flex flex-col gap-5" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Open a ticket</DialogTitle>
            <DialogDescription>
              Open work against {assetTag}
              {siteName ? ` at ${siteName}` : ""}. A network connection is not
              required.
            </DialogDescription>
          </DialogHeader>
          <FormField label="Summary" htmlFor="asset-ticket-title">
            <Input
              id="asset-ticket-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              maxLength={240}
            />
          </FormField>
          <FormField label="Notes" htmlFor="asset-ticket-notes">
            <Textarea
              id="asset-ticket-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={8000}
              rows={4}
            />
          </FormField>
          <FormField label="Severity" htmlFor="asset-ticket-severity">
            <SelectField
              id="asset-ticket-severity"
              value={severity}
              onValueChange={setSeverity}
              emptyLabel="Not set"
              options={[
                { value: "low", label: "Low" },
                { value: "medium", label: "Medium" },
                { value: "high", label: "High" },
                { value: "critical", label: "Critical" },
              ]}
            />
          </FormField>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={openTicket.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={openTicket.isPending || title.trim().length === 0}
            >
              {openTicket.isPending ? "Opening…" : "Open ticket"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
