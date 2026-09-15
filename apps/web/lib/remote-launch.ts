export type RemoteLaunchResult = {
  url: string | null
  nativeUrl: string | null
  /** One-time ticket that can be exchanged for the session secret. */
  launchTicket?: string | null
  mode: "guacamole" | "native"
} | null

export type RemoteLaunchOpenResult = {
  mode: "native" | "guacamole"
  copiedSecret: boolean
}

export type RemoteLaunchOptions = {
  /**
   * Exchanges a one-time launch ticket for the secret to place on the
   * clipboard. Resolves to `null` when the ticket is invalid or expired.
   */
  redeemTicket?: (ticket: string) => Promise<string | null>
}

export async function openRemoteLaunchResult(
  result: RemoteLaunchResult,
  options: RemoteLaunchOptions = {}
): Promise<RemoteLaunchOpenResult | null> {
  if (!result) {
    return null
  }

  if (result.mode === "native" && result.nativeUrl) {
    let copiedSecret = false
    if (result.launchTicket && options.redeemTicket) {
      try {
        const secret = await options.redeemTicket(result.launchTicket)
        if (secret) {
          await navigator.clipboard.writeText(secret)
          copiedSecret = true
        }
      } catch {
        copiedSecret = false
      }
    }

    const link = document.createElement("a")
    link.href = result.nativeUrl
    link.rel = "noopener"
    document.body.appendChild(link)
    link.click()
    link.remove()
    return { mode: "native", copiedSecret }
  }

  if (result.url) {
    window.open(result.url, "_blank", "noopener,noreferrer")
    return { mode: "guacamole", copiedSecret: false }
  }

  return null
}

export function preferredConnectionMethod(args: {
  vpnConnected: boolean
  serviceType: "vnc" | "rdp" | "ssh" | "winrm_https" | string
}): "native" | "guacamole" {
  if (!args.vpnConnected) {
    return "guacamole"
  }

  if (args.serviceType === "vnc" || args.serviceType === "ssh") {
    return "native"
  }

  return "guacamole"
}
