"use client"

import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import { trpc } from "@/lib/trpc"

export function OpenTicketDialog({
  open,
  onOpenChange,
  deviceId,
  deviceName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  deviceId: string
  deviceName: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <OpenTicketForm
          key={deviceId}
          deviceId={deviceId}
          deviceName={deviceName}
          onOpenChange={onOpenChange}
        />
      ) : null}
    </Dialog>
  )
}

function OpenTicketForm({
  deviceId,
  deviceName,
  onOpenChange,
}: {
  deviceId: string
  deviceName: string
  onOpenChange: (open: boolean) => void
}) {
  const [title, setTitle] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [includeLastSession, setIncludeLastSession] = React.useState(true)
  const openTicket = trpc.tickets.openOnDevice.useMutation()

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    try {
      const result = await openTicket.mutateAsync({
        deviceId,
        title: title.trim() || undefined,
        notes: notes.trim() || undefined,
        includeLastSession,
      })
      if (result.created) {
        toast.success(
          result.ticketNumber
            ? `Ticket ${result.ticketNumber} opened`
            : "Ticket opened"
        )
      } else {
        toast.success(
          result.ticketNumber
            ? `Ticket ${result.ticketNumber} is already open`
            : "A ticket for this device is already open"
        )
      }
      onOpenChange(false)
      if (result.ticketsUrl) {
        window.open(result.ticketsUrl, "_blank", "noopener,noreferrer")
      }
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "We couldn't open a ticket."
      )
    }
  }

  return (
    <DialogContent className="sm:max-w-lg">
      <form className="flex flex-col gap-5" onSubmit={submit}>
        <DialogHeader>
          <DialogTitle>Open a ticket</DialogTitle>
          <DialogDescription>
            Start a ticket for {deviceName}. Site, device, and your name are
            included.
          </DialogDescription>
        </DialogHeader>

        <FormField label="Title" htmlFor="ticket-title">
          <Input
            id="ticket-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={`Work on ${deviceName}`}
            maxLength={240}
          />
        </FormField>

        <FormField
          label="Notes"
          htmlFor="ticket-notes"
          description="What you saw, and anything a teammate should know."
        >
          <Textarea
            id="ticket-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={4}
            maxLength={8000}
          />
        </FormField>

        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={includeLastSession}
            onCheckedChange={(next) => setIncludeLastSession(Boolean(next))}
            className="mt-0.5"
          />
          <span>
            Include the latest remote session, including any recording and
            access reason.
          </span>
        </label>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={openTicket.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={openTicket.isPending}>
            Open ticket
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
