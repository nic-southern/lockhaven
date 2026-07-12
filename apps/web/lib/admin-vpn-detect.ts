import { ADMIN_VPN_POOL_CIDR } from "@nms/vpn"

const ADMIN_POOL_PREFIX = "10.80.100."

function isAdminVpnAddress(address: string) {
  const host = address.trim().replace(/^\[|\]$/g, "")
  if (!host.startsWith(ADMIN_POOL_PREFIX)) {
    return false
  }

  const lastOctet = Number(host.slice(ADMIN_POOL_PREFIX.length))
  return Number.isInteger(lastOctet) && lastOctet >= 1 && lastOctet <= 254
}

function collectCandidateAddresses(candidate: string) {
  const addresses: string[] = []
  const parts = candidate.split(" ")
  for (const part of parts) {
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(part)) {
      addresses.push(part)
    }
  }

  return addresses
}

/**
 * Detect whether this machine has an admin WireGuard address
 * (`10.80.100.0/24`) via local ICE host candidates.
 */
export async function detectAdminVpnConnected(
  timeoutMs = 1500
): Promise<boolean> {
  if (
    typeof window === "undefined" ||
    typeof RTCPeerConnection === "undefined"
  ) {
    return false
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
      const candidate = event.candidate?.candidate
      if (!candidate) {
        return
      }

      for (const address of collectCandidateAddresses(candidate)) {
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

export function adminVpnPoolCidr() {
  return ADMIN_VPN_POOL_CIDR
}
