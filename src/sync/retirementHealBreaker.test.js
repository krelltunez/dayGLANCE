import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  shouldSuppressRetirementHeal,
  consumeRetirementHealTripped,
  __resetRetirementHealBreakerForTests,
} from './retirementHealBreaker.js';

// The retire/tombstone oscillation breaker (fix 4 of the 2026-08-31 war
// commission): #1455's streak shape, but LATCHING — the contradiction it
// detects (retirement says the content moved, tombstone says the successor
// is dead) does not resolve by waiting, so there is no cooldown expiry.

const T0 = Date.parse('2026-08-31T09:00:00.000Z');

describe('shouldSuppressRetirementHeal', () => {
  beforeEach(() => {
    __resetRetirementHealBreakerForTests();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('THE WAR SHAPE: at SSE speed (~1.5s rounds) the third heal latches within seconds — and stays latched forever', () => {
    // Two heals are every benign story's budget (one genuine transient plus
    // one replay racing a peer); the third within the window is the war.
    expect(shouldSuppressRetirementHeal('tasks:OLD', 'NEW', T0)).toBe(false);
    expect(shouldSuppressRetirementHeal('tasks:OLD', 'NEW', T0 + 1_500)).toBe(false);
    expect(shouldSuppressRetirementHeal('tasks:OLD', 'NEW', T0 + 3_000)).toBe(true);
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error.mock.calls[0][0]).toContain('tasks:OLD');
    expect(console.error.mock.calls[0][0]).toContain('NEW');

    // LATCHED: no cooldown expiry — hours later it still suppresses, and
    // does not log again (one loud line, not a stream).
    expect(shouldSuppressRetirementHeal('tasks:OLD', 'NEW', T0 + 6 * 60 * 60_000)).toBe(true);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('WALL-CLOCK WINDOW: three heals spread over MORE than 10 minutes never latch — slow, legitimate churn is not a war', () => {
    expect(shouldSuppressRetirementHeal('tasks:OLD', 'NEW', T0)).toBe(false);
    expect(shouldSuppressRetirementHeal('tasks:OLD', 'NEW', T0 + 11 * 60_000)).toBe(false);
    expect(shouldSuppressRetirementHeal('tasks:OLD', 'NEW', T0 + 22 * 60_000)).toBe(false);
    // At poll speed (5-minute cycles) the same war still trips: three rounds
    // fit inside ten minutes.
    expect(shouldSuppressRetirementHeal('tasks:P', 'S', T0)).toBe(false);
    expect(shouldSuppressRetirementHeal('tasks:P', 'S', T0 + 5 * 60_000)).toBe(false);
    expect(shouldSuppressRetirementHeal('tasks:P', 'S', T0 + 9 * 60_000)).toBe(true);
  });

  it('SAME-ENTITY streaks only: three different entities healing once each never latch', () => {
    expect(shouldSuppressRetirementHeal('tasks:A', 'SA', T0)).toBe(false);
    expect(shouldSuppressRetirementHeal('tasks:B', 'SB', T0 + 1_000)).toBe(false);
    expect(shouldSuppressRetirementHeal('tasks:C', 'SC', T0 + 2_000)).toBe(false);
  });

  it('consumeRetirementHealTripped: true exactly once per latch cycle, then cleared (the cycle-brake strike)', () => {
    expect(consumeRetirementHealTripped()).toBe(false);
    shouldSuppressRetirementHeal('tasks:OLD', 'NEW', T0);
    shouldSuppressRetirementHeal('tasks:OLD', 'NEW', T0 + 1_000);
    expect(consumeRetirementHealTripped()).toBe(false); // not yet latched
    shouldSuppressRetirementHeal('tasks:OLD', 'NEW', T0 + 2_000);
    expect(consumeRetirementHealTripped()).toBe(true);
    expect(consumeRetirementHealTripped()).toBe(false); // reading cleared it
    // Suppressed calls after the latch never re-flag.
    shouldSuppressRetirementHeal('tasks:OLD', 'NEW', T0 + 3_000);
    expect(consumeRetirementHealTripped()).toBe(false);
  });
});
