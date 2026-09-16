"use client"

import { toast } from "sonner"

import { trpc } from "@/lib/trpc"
import { openRemoteLaunchResult } from "@/lib/remote-launch"

/**
 * Starts a remote session and opens the result. Native VNC launches exchange
 * a one-time ticket for the password right before it is placed on the
 * clipboard, so the secret is never part of a cached query response.
 */
export function useRemoteLaunch(options?: { onSettled?: () => void }) {
  const redeem = trpc.sessions.redeemLaunchTicket.useMutation()

  return trpc.sessions.create.useMutation({
    async onSuccess(result) {
      const opened = await openRemoteLaunchResult(result, {
        redeemTicket: async (ticket) => {
          const redeemed = await redeem.mutateAsync({ ticket })
          return redeemed.secret
        },
      })
      if (opened?.mode === "pending_approval") {
        toast.message("Waiting for approval")
        return
      }
      if (opened?.mode === "native" && opened.copiedSecret) {
        toast.success("VNC password copied — paste it when prompted")
      }
    },
    onError() {
      toast.error("Couldn't start the session.")
    },
    onSettled() {
      options?.onSettled?.()
    },
  })
}
