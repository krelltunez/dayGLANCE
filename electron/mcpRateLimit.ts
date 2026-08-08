// Write rate limiting for the MCP listener (spec §4.3), extracted as a pure
// factory so the limiting decisions can be unit-tested with an injectable
// clock (same pattern as calendarCache.ts).
//
// WHY: the client-side approval flow is the consent surface; this limiter is
// the damage bound for a runaway agent loop. 30 writes/minute (configurable)
// also bounds tray-reload volume per §3.6.
//
// KEYING: there are no MCP sessions (spec §3.7 — the 2026-07-28 era has no
// Mcp-Session-Id, and 2025-era clients are served statelessly), so buckets key
// on the bearer token, the only stable per-caller identity. Module-scope state
// closed over by the handler factory, never state on an McpServer instance.

/** Spec §4.3 suggested cap. */
export const DEFAULT_WRITE_LIMIT_PER_MINUTE = 30;
export const DEFAULT_WRITE_WINDOW_MS = 60_000;

export interface WriteRateLimiterOptions {
  /** Writes allowed per window. Non-positive means writes are never allowed. */
  limit?: number;
  windowMs?: number;
  /** Injectable clock so tests can advance time without waiting. */
  now?: () => number;
}

/**
 * Sliding-window limiter: a write is allowed while fewer than `limit` writes
 * were admitted in the trailing `windowMs`. Sliding rather than fixed-bucket,
 * so a burst straddling a bucket boundary cannot double the effective rate.
 *
 * Clock-jump posture is the OPPOSITE of calendarCache.isFresh: there, negative
 * age fails open (one extra spawn is cheap); here, timestamps that appear to
 * be in the future still COUNT against the limit (fail closed — the limiter is
 * a safety bound, and a backwards NTP step must not grant a fresh burst).
 */
export function createWriteRateLimiter(opts: WriteRateLimiterOptions = {}) {
  const limit = opts.limit ?? DEFAULT_WRITE_LIMIT_PER_MINUTE;
  const windowMs = opts.windowMs ?? DEFAULT_WRITE_WINDOW_MS;
  const now = opts.now ?? Date.now;

  /** Admission timestamps per key, oldest first, pruned on each check. */
  const buckets = new Map<string, number[]>();

  return {
    /**
     * Try to admit one write for `key` (the bearer token). Returns whether the
     * write may proceed; an admitted write is recorded, a refused one is not
     * (refusals must not extend the lockout).
     */
    tryAcquire(key: string): boolean {
      // No explicit limit<=0 early-out: `kept.length < limit` is already false
      // for every non-positive limit (pinned by tests).
      const t = now();
      // A single lower bound implements both rules: in-window entries survive,
      // and future entries (backwards clock jump) survive too, since ts > t
      // implies ts > t - windowMs for any positive window.
      const kept = (buckets.get(key) ?? []).filter((ts) => ts > t - windowMs);
      const allowed = kept.length < limit;
      if (allowed) kept.push(t);
      if (kept.length > 0) {
        buckets.set(key, kept);
      } else {
        buckets.delete(key);
      }
      return allowed;
    },

    /** Admissions currently counted against `key` — for the §4.3 journal/UI later. */
    countInWindow(key: string): number {
      const t = now();
      return (buckets.get(key) ?? []).filter((ts) => ts > t - windowMs).length;
    },

    /** Drop all state — token rotation invalidates old keys wholesale. */
    reset(): void {
      buckets.clear();
    },
  };
}
