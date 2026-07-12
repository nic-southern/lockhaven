export type RemoteLaunchResult = {
  url: string | null
  nativeUrl: string | null
  mode: "guacamole" | "native"
} | null

export function openRemoteLaunchResult(result: RemoteLaunchResult) {
  if (!result) {
    return
  }

  if (result.mode === "native" && result.nativeUrl) {
    const link = document.createElement("a")
    link.href = result.nativeUrl
    link.rel = "noopener"
    document.body.appendChild(link)
    link.click()
    link.remove()
    return
  }

  if (result.url) {
    window.open(result.url, "_blank", "noopener,noreferrer")
  }
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
