/** First delay after a failed attempt, doubled on each later failure. */
export const NOTIFY_BACKOFF_BASE_MS = 15_000

export const MAX_NOTIFICATION_ATTEMPTS = 8

/**
 * Delay before the next attempt after `failedAttempts` unsuccessful sends.
 * Attempt 1 → 15s, then 30s, 60s, 120s, 240s, 480s, 960s, 1920s.
 */
export function backoffDelayMs(failedAttempts: number) {
  const attempt = Math.max(1, Math.trunc(failedAttempts))
  return NOTIFY_BACKOFF_BASE_MS * 2 ** (attempt - 1)
}

export function nextAttemptAt(failedAttempts: number, now = new Date()) {
  return new Date(now.getTime() + backoffDelayMs(failedAttempts))
}

export function hasAttemptsRemaining(attempts: number) {
  return attempts < MAX_NOTIFICATION_ATTEMPTS
}
