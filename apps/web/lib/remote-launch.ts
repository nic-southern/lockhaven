export type RemoteLaunchResult = {
  url: string | null
  nativeUrl: string | null
  clipboardSecret?: string | null
  mode: "guacamole" | "native"
} | null

export type RemoteLaunchOpenResult = {
  mode: "native" | "guacamole"
  copiedSecret: boolean
}

export async function openRemoteLaunchResult(
  result: RemoteLaunchResult
): Promise<RemoteLaunchOpenResult | null> {
  if (!result) {
    return null
  }

  if (result.mode === "native" && result.nativeUrl) {
    let copiedSecret = false
    if (result.clipboardSecret) {
      try {
        await navigator.clipboard.writeText(result.clipboardSecret)
        copiedSecret = true
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
