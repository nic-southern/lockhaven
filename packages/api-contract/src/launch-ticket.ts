import { createHash, randomBytes } from "node:crypto"

import Redis from "ioredis"

import {
  decryptSecret,
  encryptSecret,
  type EncryptedSecret,
} from "@nms/remote-access"

export const LAUNCH_TICKET_TTL_SECONDS = 60

export type LaunchTicketPayload = {
  userId: string
  remoteSessionId: string
  deviceId: string
  serviceId: string
  serviceType: string
  secretKind: "vnc_password"
  secret: string
}

export interface LaunchTicketStore {
  put(ticketHash: string, value: string, ttlSeconds: number): Promise<void>
  /** Returns and deletes the value atomically so a ticket can only be used once. */
  take(ticketHash: string): Promise<string | null>
}

export class MemoryLaunchTicketStore implements LaunchTicketStore {
  private readonly entries = new Map<
    string,
    { value: string; expiresAt: number }
  >()

  async put(ticketHash: string, value: string, ttlSeconds: number) {
    this.entries.set(ticketHash, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    })
  }

  async take(ticketHash: string) {
    const entry = this.entries.get(ticketHash)
    this.entries.delete(ticketHash)
    if (!entry || entry.expiresAt < Date.now()) {
      return null
    }
    return entry.value
  }
}

export class RedisLaunchTicketStore implements LaunchTicketStore {
  constructor(private readonly redis: Redis) {}

  async put(ticketHash: string, value: string, ttlSeconds: number) {
    await this.redis.set(this.key(ticketHash), value, "EX", ttlSeconds)
  }

  async take(ticketHash: string) {
    return this.redis.getdel(this.key(ticketHash))
  }

  private key(ticketHash: string) {
    return `launch-ticket:${ticketHash}`
  }
}

let defaultStore: LaunchTicketStore | null = null

export function getLaunchTicketStore(): LaunchTicketStore {
  if (defaultStore) {
    return defaultStore
  }

  const redisUrl = process.env.REDIS_URL
  if (redisUrl) {
    defaultStore = new RedisLaunchTicketStore(
      new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 })
    )
  } else {
    defaultStore = new MemoryLaunchTicketStore()
  }

  return defaultStore
}

export function setLaunchTicketStore(store: LaunchTicketStore | null) {
  defaultStore = store
}

export function hashLaunchTicket(ticket: string) {
  return createHash("sha256").update(ticket).digest("hex")
}

export function generateLaunchTicket() {
  return randomBytes(32).toString("base64url")
}

export async function issueLaunchTicket(
  payload: LaunchTicketPayload,
  encryptionKey: string,
  store: LaunchTicketStore = getLaunchTicketStore()
) {
  const ticket = generateLaunchTicket()
  const encrypted = encryptSecret(JSON.stringify(payload), encryptionKey)
  await store.put(
    hashLaunchTicket(ticket),
    JSON.stringify(encrypted),
    LAUNCH_TICKET_TTL_SECONDS
  )
  return ticket
}

export async function redeemLaunchTicket(
  ticket: string,
  encryptionKey: string,
  store: LaunchTicketStore = getLaunchTicketStore()
): Promise<LaunchTicketPayload | null> {
  const raw = await store.take(hashLaunchTicket(ticket))
  if (!raw) {
    return null
  }

  try {
    const encrypted = JSON.parse(raw) as EncryptedSecret
    return JSON.parse(
      decryptSecret(encrypted, encryptionKey)
    ) as LaunchTicketPayload
  } catch {
    return null
  }
}
