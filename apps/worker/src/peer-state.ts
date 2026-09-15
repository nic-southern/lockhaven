import type Redis from "ioredis"

import type { PeerState } from "@nms/vpn"

const PEER_STATE_KEY = "lockhaven:worker:peer-state"
const FIREWALL_STATE_KEY = "lockhaven:worker:firewall-state"

/** Peer state plus the recent up/down flips used for flap detection. */
export type StoredPeerState = PeerState & {
  recentTransitions: string[]
}

export type FirewallState = {
  ok: boolean
  lastError: string | null
  changedAt: string
}

/**
 * Keeps the worker's last observation of every peer between runs. Redis is
 * the right home for this: it is worker-local scratch state, and losing it
 * only re-baselines peers on the next pass instead of emitting false
 * transitions.
 */
export class PeerStateStore {
  constructor(private readonly redis: Redis) {}

  async loadAll(): Promise<Map<string, StoredPeerState>> {
    const raw = await this.redis.hgetall(PEER_STATE_KEY)
    const states = new Map<string, StoredPeerState>()
    for (const [key, value] of Object.entries(raw)) {
      const parsed = parseState(value)
      if (parsed) states.set(key, parsed)
    }
    return states
  }

  async saveAll(states: Map<string, StoredPeerState>, removeKeys: string[]) {
    const pipeline = this.redis.pipeline()
    if (states.size > 0) {
      const flat: Record<string, string> = {}
      for (const [key, state] of states) {
        flat[key] = JSON.stringify(state)
      }
      pipeline.hset(PEER_STATE_KEY, flat)
    }
    if (removeKeys.length > 0) {
      pipeline.hdel(PEER_STATE_KEY, ...removeKeys)
    }
    await pipeline.exec()
  }

  async loadFirewall(): Promise<FirewallState | null> {
    const raw = await this.redis.get(FIREWALL_STATE_KEY)
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as Partial<FirewallState>
      if (typeof parsed.ok !== "boolean") return null
      return {
        ok: parsed.ok,
        lastError: parsed.lastError ?? null,
        changedAt: parsed.changedAt ?? new Date(0).toISOString(),
      }
    } catch {
      return null
    }
  }

  async saveFirewall(state: FirewallState) {
    await this.redis.set(FIREWALL_STATE_KEY, JSON.stringify(state))
  }
}

function parseState(value: string): StoredPeerState | null {
  try {
    const parsed = JSON.parse(value) as Partial<StoredPeerState>
    if (typeof parsed.online !== "boolean") return null
    return {
      online: parsed.online,
      endpoint: parsed.endpoint ?? null,
      lastHandshakeAt: parsed.lastHandshakeAt ?? null,
      rxBytes: Number(parsed.rxBytes ?? 0),
      txBytes: Number(parsed.txBytes ?? 0),
      lastSampleAt: parsed.lastSampleAt ?? null,
      lastOnlineAt: parsed.lastOnlineAt ?? null,
      recentTransitions: Array.isArray(parsed.recentTransitions)
        ? parsed.recentTransitions.filter(
            (item): item is string => typeof item === "string"
          )
        : [],
    }
  } catch {
    return null
  }
}
