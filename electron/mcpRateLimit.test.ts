import { describe, it, expect } from 'vitest';
import {
  createWriteRateLimiter,
  DEFAULT_WRITE_LIMIT_PER_MINUTE,
  DEFAULT_WRITE_WINDOW_MS,
} from './mcpRateLimit.js';

// §4.3's damage bound under test. The limiter is the only thing standing
// between a runaway agent loop and an unbounded write storm (plus the tray
// reload volume each write triggers per §3.6), so the denial direction
// matters as much as the allow direction.

// Injectable clock, same shape as calendarCache.test.ts.
function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; }, rewind: (ms: number) => { t -= ms; } };
}

describe('createWriteRateLimiter', () => {
  it('defaults to 30 writes per 60s window (spec §4.3)', () => {
    expect(DEFAULT_WRITE_LIMIT_PER_MINUTE).toBe(30);
    expect(DEFAULT_WRITE_WINDOW_MS).toBe(60_000);
    const clock = fakeClock();
    const limiter = createWriteRateLimiter({ now: clock.now });
    for (let i = 0; i < 30; i++) expect(limiter.tryAcquire('tok')).toBe(true);
    expect(limiter.tryAcquire('tok')).toBe(false);
  });

  it('allows up to the limit and refuses the write after it', () => {
    const clock = fakeClock();
    const limiter = createWriteRateLimiter({ limit: 3, windowMs: 1000, now: clock.now });
    expect(limiter.tryAcquire('tok')).toBe(true);
    expect(limiter.tryAcquire('tok')).toBe(true);
    expect(limiter.tryAcquire('tok')).toBe(true);
    expect(limiter.tryAcquire('tok')).toBe(false);
  });

  it('frees capacity as admissions age out of the sliding window', () => {
    const clock = fakeClock();
    const limiter = createWriteRateLimiter({ limit: 2, windowMs: 1000, now: clock.now });
    limiter.tryAcquire('tok');            // t=0
    clock.advance(600);
    limiter.tryAcquire('tok');            // t=600
    expect(limiter.tryAcquire('tok')).toBe(false); // both in window
    clock.advance(500);                   // t=1100: the t=0 entry has aged out
    expect(limiter.tryAcquire('tok')).toBe(true);
    expect(limiter.tryAcquire('tok')).toBe(false); // t=600 + t=1100 fill it again
  });

  it('expires an admission at exactly windowMs age (trailing window is exclusive)', () => {
    const clock = fakeClock();
    const limiter = createWriteRateLimiter({ limit: 1, windowMs: 1000, now: clock.now });
    expect(limiter.tryAcquire('tok')).toBe(true);
    clock.advance(1000); // exactly windowMs later
    expect(limiter.tryAcquire('tok')).toBe(true);
  });

  it('is sliding, not fixed-bucket: a boundary-straddling burst cannot double the rate', () => {
    const clock = fakeClock();
    const limiter = createWriteRateLimiter({ limit: 2, windowMs: 1000, now: clock.now });
    clock.advance(900);
    expect(limiter.tryAcquire('tok')).toBe(true);  // t=900
    expect(limiter.tryAcquire('tok')).toBe(true);  // t=900
    clock.advance(200);                            // t=1100 — a new "minute" in bucket terms
    expect(limiter.tryAcquire('tok')).toBe(false); // still 2 in the trailing 1000ms
  });

  it('refused writes are not recorded and do not extend the lockout', () => {
    const clock = fakeClock();
    const limiter = createWriteRateLimiter({ limit: 1, windowMs: 1000, now: clock.now });
    expect(limiter.tryAcquire('tok')).toBe(true);   // t=0, expires at t>1000
    for (let i = 0; i < 10; i++) expect(limiter.tryAcquire('tok')).toBe(false);
    clock.advance(1001);
    // If refusals had been recorded, capacity would still be exhausted here.
    expect(limiter.tryAcquire('tok')).toBe(true);
  });

  it('keys buckets independently per token', () => {
    const clock = fakeClock();
    const limiter = createWriteRateLimiter({ limit: 1, windowMs: 1000, now: clock.now });
    expect(limiter.tryAcquire('tok-a')).toBe(true);
    expect(limiter.tryAcquire('tok-a')).toBe(false);
    expect(limiter.tryAcquire('tok-b')).toBe(true); // a's exhaustion never touches b
  });

  it('fails closed on a backwards clock jump: past admissions still count', () => {
    const clock = fakeClock();
    const limiter = createWriteRateLimiter({ limit: 2, windowMs: 1000, now: clock.now });
    limiter.tryAcquire('tok');
    limiter.tryAcquire('tok');
    clock.rewind(5000); // NTP step: recorded timestamps are now in the "future"
    expect(limiter.tryAcquire('tok')).toBe(false); // no fresh burst granted
  });

  it('never allows writes with a non-positive limit', () => {
    const clock = fakeClock();
    expect(createWriteRateLimiter({ limit: 0, now: clock.now }).tryAcquire('tok')).toBe(false);
    expect(createWriteRateLimiter({ limit: -5, now: clock.now }).tryAcquire('tok')).toBe(false);
  });

  it('reports the in-window admission count for the write journal surface', () => {
    const clock = fakeClock();
    const limiter = createWriteRateLimiter({ limit: 5, windowMs: 1000, now: clock.now });
    expect(limiter.countInWindow('tok')).toBe(0);
    limiter.tryAcquire('tok');
    limiter.tryAcquire('tok');
    expect(limiter.countInWindow('tok')).toBe(2);
    clock.advance(1001);
    expect(limiter.countInWindow('tok')).toBe(0);
  });

  it('reset() drops all buckets (token rotation invalidates old keys wholesale)', () => {
    const clock = fakeClock();
    const limiter = createWriteRateLimiter({ limit: 1, windowMs: 1000, now: clock.now });
    limiter.tryAcquire('tok');
    expect(limiter.tryAcquire('tok')).toBe(false);
    limiter.reset();
    expect(limiter.tryAcquire('tok')).toBe(true);
  });
});
