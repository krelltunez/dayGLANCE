// Client-side brakes for the GLANCEvault DB sync cycle.
//
// FINDING (the phase2TransitionSyncLoop repro, PR #1449): nothing on the client
// could stop a sync loop from hammering the vault at network speed. The brakes
// that existed — the in-flight guard, the 3s push debounce, the 400ms SSE nudge
// coalescer, the heal's per-cycle cap and first-429 bail — all bound a SINGLE
// cycle's cost; none bounds the CYCLE RATE. Two gaps did the damage:
//
//   1. A cycle that fails (e.g. `list failed: 429`) was immediately eligible
//      for the next trigger — interval, debounced push, or SSE nudge — so a
//      rate-limited client retried as fast as it was triggered, feeding the
//      very limiter that was rejecting it.
//
//   2. A cycle that always WRITES self-perpetuates: every vault write advances
//      the account seq, every seq advance is an SSE 'activity' nudge, and the
//      nudge drains straight into the next dbSyncCycle. pushDirtyRows has no
//      content dedup, so a stale diff baseline (a withheld snapshot) re-marked
//      the same unchanged rows dirty every cycle and re-wrote them — a ~1/s
//      self-nudge loop made entirely of "successful" cycles, which backoff on
//      FAILURE can never brake. (The dedup half of the fix lives in
//      dbEngine.js — the acked-hash skip; this module provides the failure
//      side.)
//
// This module is the failure-side brake: a consecutive-failure circuit breaker
// with capped exponential backoff, rate-limit-aware (a 429 starts from a much
// higher floor than a transient network error — the vault TOLD us to slow
// down). Pure and clock-injectable; the engine wires it around dbSyncCycle.
//
// Deliberately NOT included: suppressing a device's own SSE echo nudge (a nudge
// whose seq equals our own last push). It would also end write-driven loops,
// but a peer write that lands between our pull and our push carries a lower
// seq than ours and its nudge would be swallowed with the echo — trading a
// pathological loop for missed real nudges. The content dedup removes the
// loop's fuel instead, at no freshness cost.

import { backoffDelayMs } from './vaultEventStream.js';

// A vault rate-limit, however it surfaces: a structured status on the error, or
// the vaultClient's message text ("list failed: 429", "get row failed: 429").
// Shared with dbEngine's heal bail so the two detectors cannot drift.
export const isRateLimitedError = (err) =>
  err?.status === 429 || /\b429\b/.test(String(err?.message || ''));

/**
 * Consecutive-failure circuit breaker for the sync cycle.
 *
 * beforeCycle() → { allowed:true } | { allowed:false, waitMs, reason } — gate
 *   every cycle start on this; a disallowed cycle should return without any
 *   network traffic.
 * onFailure(err) → delayMs — call on a failed cycle (or a rate-limited heal in
 *   an otherwise-successful cycle); starts/extends the cooldown. Backoff is
 *   capped-exponential with equal jitter (the same shape the SSE reconnect
 *   uses, via backoffDelayMs) so a fleet of throttled clients de-synchronizes
 *   instead of retrying in waves.
 * onSuccess() — call on a clean cycle; resets the breaker entirely.
 *
 * The cooldown only ever extends (Math.max), so an in-flight cycle finishing
 * with a failure cannot shorten a longer cooldown already imposed.
 *
 * @param {object} [opts]
 * @param {() => number} [opts.now]      clock (epoch ms), injectable for tests
 * @param {() => number} [opts.random]   uniform [0,1) jitter source
 * @param {number} [opts.failureBaseMs]   first-failure backoff base (transient errors)
 * @param {number} [opts.failureMaxMs]    backoff cap for transient errors
 * @param {number} [opts.rateLimitBaseMs] first-failure backoff base after a 429
 * @param {number} [opts.rateLimitMaxMs]  backoff cap after 429s
 */
export function createSyncCycleBreaker({
  now = () => Date.now(),
  random = Math.random,
  failureBaseMs = 2000,
  failureMaxMs = 60000,
  rateLimitBaseMs = 15000,
  rateLimitMaxMs = 300000,
} = {}) {
  let failures = 0;
  let cooldownUntil = 0;
  let reason = null;

  return {
    beforeCycle() {
      const waitMs = cooldownUntil - now();
      if (waitMs > 0) return { allowed: false, waitMs, reason };
      return { allowed: true };
    },
    onSuccess() {
      failures = 0;
      cooldownUntil = 0;
      reason = null;
    },
    onFailure(err) {
      const rateLimited = isRateLimitedError(err);
      const delayMs = backoffDelayMs({
        attempt: failures,
        baseMs: rateLimited ? rateLimitBaseMs : failureBaseMs,
        maxMs: rateLimited ? rateLimitMaxMs : failureMaxMs,
        random,
      });
      failures += 1;
      reason = rateLimited ? 'rate-limited' : 'error';
      cooldownUntil = Math.max(cooldownUntil, now() + delayMs);
      return delayMs;
    },
    getState() {
      return { failures, cooldownUntil, reason };
    },
  };
}
