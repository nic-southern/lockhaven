import type Redis from "ioredis"

import type { SiteOpenStateStore } from "@nms/api-contract"

const SITE_OPEN_STATE_KEY = "lockhaven:worker:site-open-state"

/**
 * Last open/closed reading per site. Like peer state, this is worker scratch:
 * losing it means the next pass re-baselines and waits for the following
 * close instead of firing on whatever state it first sees.
 */
export class SiteOpenStateRedisStore implements SiteOpenStateStore {
  constructor(private readonly redis: Redis) {}

  async loadAll(): Promise<Map<string, boolean>> {
    const raw = await this.redis.hgetall(SITE_OPEN_STATE_KEY)
    const states = new Map<string, boolean>()
    for (const [siteId, value] of Object.entries(raw)) {
      if (value === "open") states.set(siteId, true)
      else if (value === "closed") states.set(siteId, false)
    }
    return states
  }

  async saveAll(states: Map<string, boolean>, removeKeys: string[]) {
    const pipeline = this.redis.pipeline()
    if (states.size > 0) {
      const flat: Record<string, string> = {}
      for (const [siteId, open] of states) {
        flat[siteId] = open ? "open" : "closed"
      }
      pipeline.hset(SITE_OPEN_STATE_KEY, flat)
    }
    if (removeKeys.length > 0) {
      pipeline.hdel(SITE_OPEN_STATE_KEY, ...removeKeys)
    }
    await pipeline.exec()
  }
}
