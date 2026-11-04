// Write admission control for MCP (dayGLANCE MCP spec §4.3), composing the
// rate limiter with the "repeated violation auto-disables writes" escalation.
// Pure factory with an injectable clock, same idiom as rateLimit.js.
//
// §4.3: exceeding the rate limit returns a tool error; if it RECURS, writes
// auto-disable with a notification. "Recurs" here: a violation while already
// in the post-violation grace window — i.e. the caller ignored the first
// rate-limited error and kept hammering. One burst that trips the limit once
// is an agent being eager; violations in consecutive windows are a runaway
// loop, which is exactly what §4.3 exists to bound.
//
// Auto-disable is process-lifetime: only an explicit re-enable (reset()) lifts
// it. A runaway loop must not get writes back by waiting.

import { createWriteRateLimiter } from './rateLimit.js';

export const DEFAULT_VIOLATION_LIMIT = 3;
export const DEFAULT_VIOLATION_WINDOW_MS = 5 * 60_000;

/**
 * @param {{ limit?: number, windowMs?: number, now?: () => number, violationLimit?: number, violationWindowMs?: number }} [opts]
 *   The rate limiter's options, plus `violationLimit` violations within
 *   `violationWindowMs` that trigger auto-disable.
 */
export function createWriteGate(opts = {}) {
  const now = opts.now ?? Date.now;
  const violationLimit = opts.violationLimit ?? DEFAULT_VIOLATION_LIMIT;
  const violationWindowMs = opts.violationWindowMs ?? DEFAULT_VIOLATION_WINDOW_MS;
  const limiter = createWriteRateLimiter(opts);

  /** Violation timestamps per key, same sliding-window shape as the limiter. */
  const violations = new Map();
  let disabled = false;

  return {
    /**
     * Admit or refuse one write for `key` (the bearer token). Refusals are
     * typed errors upstream. `disabledNow` is true exactly once: on the
     * violation that flipped writes off, so the wiring can notify on it.
     */
    tryWrite(key) {
      if (disabled) return { allowed: false, reason: 'writes_disabled', disabledNow: false };
      if (limiter.tryAcquire(key)) return { allowed: true };

      const t = now();
      const kept = (violations.get(key) ?? []).filter((ts) => ts > t - violationWindowMs);
      kept.push(t);
      violations.set(key, kept);
      if (kept.length >= violationLimit) {
        disabled = true;
        return { allowed: false, reason: 'writes_disabled', disabledNow: true };
      }
      return { allowed: false, reason: 'rate_limited', disabledNow: false };
    },

    writesDisabled() {
      return disabled;
    },

    /** Explicit re-enable (a settings surface, or a restart). */
    reset() {
      disabled = false;
      violations.clear();
      limiter.reset();
    },
  };
}
