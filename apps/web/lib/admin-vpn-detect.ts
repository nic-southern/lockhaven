/**
 * Best-effort local interface detection via WebRTC host candidates.
 * Modern browsers often hide private IPs, so this is only a supplement to
 * server-side WireGuard handshake status.
 */
export async function detectAdminVpnViaWebRtc(
  timeoutMs = 1200
): Promise<boolean> {
  if (
    typeof window === "undefined" ||
    typeof RTCPeerConnection === "undefined"
  ) {
    return false
  }

  const adminPoolPrefix = "10.80.100."

  const isAdminVpnAddress = (address: string) => {
    const host = address.trim().replace(/^\[|\]$/g, "")
    if (!host.startsWith(adminPoolPrefix)) {
      return false
    }
    const lastOctet = Number(host.slice(adminPoolPrefix.length))
    return Number.isInteger(lastOctet) && lastOctet >= 1 && lastOctet <= 254
  }

  const collectAddresses = (candidate: RTCIceCandidate | null | undefined) => {
    const addresses: string[] = []
    if (!candidate) {
      return addresses
    }
    if (
      candidate.address &&
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(candidate.address)
    ) {
      addresses.push(candidate.address)
    }
    for (const part of (candidate.candidate ?? "").split(" ")) {
      if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(part)) {
        addresses.push(part)
      }
    }
    return addresses
  }

  return await new Promise<boolean>((resolve) => {
    let settled = false
    const pc = new RTCPeerConnection({ iceServers: [] })

    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      try {
        pc.close()
      } catch {
        // ignore
      }
      resolve(value)
    }

    const timer = window.setTimeout(() => finish(false), timeoutMs)

    pc.addEventListener("icecandidate", (event) => {
      for (const address of collectAddresses(event.candidate)) {
        if (isAdminVpnAddress(address)) {
          finish(true)
          return
        }
      }
    })

    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") {
        finish(false)
      }
    })

    pc.createDataChannel("lockhaven-vpn-detect")

    void pc
      .createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .catch(() => finish(false))
  })
}
