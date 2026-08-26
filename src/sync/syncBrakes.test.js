import { describe, it, expect } from 'vitest';
import { createSyncCycleBreaker, isRateLimitedError } from './syncBrakes.js';

// Deterministic jitter: random() = 1 - ε makes backoffDelayMs return the full
// exponential (exp/2 + ~exp/2 ≈ exp); random() = 0 returns exactly exp/2.
const FULL = () => 0.999999;
const HALF = () => 0;

describe('isRateLimitedError', () => {
  it('matches a structured 429 status', () => {
    expect(isRateLimitedError({ status: 429 })).toBe(true);
  });
  it('matches the vaultClient message shapes', () => {
    expect(isRateLimitedError(new Error('list failed: 429'))).toBe(true);
    expect(isRateLimitedError(new Error('get row failed: 429'))).toBe(true);
  });
  it('does not match other failures', () => {
    expect(isRateLimitedError(new Error('network blip'))).toBe(false);
    expect(isRateLimitedError({ status: 503 })).toBe(false);
    expect(isRateLimitedError(null)).toBe(false);
    // "429" as part of a larger number is not a rate limit.
    expect(isRateLimitedError(new Error('entity 14290 rejected'))).toBe(false);
  });
});

describe('createSyncCycleBreaker', () => {
  it('allows cycles until a failure, then gates for the backoff window', () => {
    let t = 1000000;
    const b = createSyncCycleBreaker({ now: () => t, random: FULL });
    expect(b.beforeCycle().allowed).toBe(true);

    const delay = b.onFailure(new Error('network blip'));
    expect(delay).toBeGreaterThan(0);
    const gate = b.beforeCycle();
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe('error');
    expect(gate.waitMs).toBeGreaterThan(0);

    t += delay + 1; // cooldown passes
    expect(b.beforeCycle().allowed).toBe(true);
  });

  it('backs off exponentially on consecutive failures, up to the cap', () => {
    let t = 0;
    const b = createSyncCycleBreaker({ now: () => t, random: HALF, failureBaseMs: 2000, failureMaxMs: 60000 });
    // random=0 → delay is exactly exp/2 = base * 2^attempt / 2.
    expect(b.onFailure(new Error('x'))).toBe(1000);   // attempt 0: 2000/2
    expect(b.onFailure(new Error('x'))).toBe(2000);   // attempt 1: 4000/2
    expect(b.onFailure(new Error('x'))).toBe(4000);   // attempt 2: 8000/2
    for (let i = 0; i < 10; i++) b.onFailure(new Error('x'));
    expect(b.onFailure(new Error('x'))).toBe(30000);  // capped: 60000/2
  });

  it('a 429 starts from the rate-limit floor, far above the generic-failure base', () => {
    let t = 0;
    const b = createSyncCycleBreaker({ now: () => t, random: HALF, failureBaseMs: 2000, rateLimitBaseMs: 15000 });
    const delay = b.onFailure({ status: 429 });
    expect(delay).toBe(7500); // 15000/2 — vs 1000 for a generic first failure
    expect(b.beforeCycle().reason).toBe('rate-limited');
  });

  it('rate-limit backoff caps at rateLimitMaxMs', () => {
    let t = 0;
    const b = createSyncCycleBreaker({ now: () => t, random: FULL, rateLimitBaseMs: 15000, rateLimitMaxMs: 300000 });
    let last = 0;
    for (let i = 0; i < 12; i++) last = b.onFailure({ status: 429 });
    expect(last).toBeLessThan(300000);
    expect(last).toBeGreaterThan(150000); // full jitter of the capped exponential
  });

  it('success resets the breaker completely', () => {
    let t = 0;
    const b = createSyncCycleBreaker({ now: () => t, random: HALF });
    b.onFailure({ status: 429 });
    b.onFailure({ status: 429 });
    expect(b.beforeCycle().allowed).toBe(false);
    b.onSuccess();
    expect(b.beforeCycle().allowed).toBe(true);
    // The attempt counter reset too: the next failure backs off from the base again.
    expect(b.onFailure(new Error('x'))).toBe(1000);
  });

  it('a cooldown only ever extends — a shorter late verdict cannot shorten it', () => {
    let t = 0;
    const b = createSyncCycleBreaker({ now: () => t, random: HALF, failureBaseMs: 2000, rateLimitBaseMs: 60000 });
    b.onFailure({ status: 429 });               // cooldown until t+30000
    const before = b.beforeCycle().waitMs;
    b.onFailure(new Error('network blip'));     // attempt 1 generic: 2000 — must not shrink the window
    expect(b.beforeCycle().waitMs).toBeGreaterThanOrEqual(before);
  });
});
