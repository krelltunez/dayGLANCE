import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  shouldSuppressRetirementHeal,
  consumeRetirementHealTripped,
  isDeletePropagationLatched,
  recordDeletePropagation,
  consumeDeletePropagationTripped,
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

describe('delete-propagation latch — the propagate-arm wall (2026-08-31 war, fix 3; count-on-ack per audit fix H2)', () => {
  beforeEach(() => {
    __resetRetirementHealBreakerForTests();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("THE WAR SHAPE: the same entityId ACK-recorded at ~2s cadence latches on the 4th — under the '(retired)'/'(tombstoned)' classifications the heal breaker never sees", () => {
    const id = 'tasks:obsidian-2026-08-30-j1wnjt';
    recordDeletePropagation(id, 'retired', T0);
    expect(isDeletePropagationLatched(id)).toBe(false);
    recordDeletePropagation(id, 'retired', T0 + 2_000);
    recordDeletePropagation(id, 'tombstoned', T0 + 4_000);
    expect(isDeletePropagationLatched(id)).toBe(false); // three landed deletes stay allowed
    recordDeletePropagation(id, 'tombstoned', T0 + 6_000);
    expect(isDeletePropagationLatched(id)).toBe(true);
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error.mock.calls[0][0]).toContain(id);

    // LATCHED for the session: no cooldown, one loud line, further records no-op.
    recordDeletePropagation(id, 'retired', T0 + 3 * 60 * 60_000);
    expect(isDeletePropagationLatched(id)).toBe(true);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('COUNT ON ACK (audit fix H2): the diff-phase CHECK never counts — an offline delete re-proposed every failed cycle can never latch', () => {
    // The pre-fix shape: user deletes offline; focus flips + deferred
    // retries re-run the diff at short intervals; every attempt counted.
    // Now the check is pure — a hundred failed-cycle re-checks record
    // nothing, and the genuine delete pushes cleanly when the network
    // returns.
    const id = 'tasks:deleted-while-offline';
    for (let i = 0; i < 100; i++) {
      expect(isDeletePropagationLatched(id)).toBe(false);
    }
    // Connectivity returns: ONE acked push records ONE hit — no latch.
    recordDeletePropagation(id, 'tombstoned', T0 + 100_000);
    expect(isDeletePropagationLatched(id)).toBe(false);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('WALL-CLOCK WINDOW: four acked propagations spread past 10 minutes never latch; per-entity streaks only', () => {
    for (let i = 0; i < 4; i++) {
      recordDeletePropagation('tasks:slow', 'tombstoned', T0 + i * 11 * 60_000);
    }
    expect(isDeletePropagationLatched('tasks:slow')).toBe(false);
    // Four DIFFERENT entities in seconds (a real bulk delete) never latch.
    for (let i = 0; i < 4; i++) {
      recordDeletePropagation(`tasks:bulk-${i}`, 'tombstoned', T0 + i * 100);
      expect(isDeletePropagationLatched(`tasks:bulk-${i}`)).toBe(false);
    }
  });

  it('consumeDeletePropagationTripped: the strike flag fires once per latch and is independent of the heal breaker flag', () => {
    expect(consumeDeletePropagationTripped()).toBe(false);
    for (let i = 0; i < 3; i++) recordDeletePropagation('tasks:W', 'retired', T0 + i * 1_000);
    expect(consumeDeletePropagationTripped()).toBe(false); // not yet latched
    recordDeletePropagation('tasks:W', 'retired', T0 + 3_000);
    expect(consumeDeletePropagationTripped()).toBe(true);
    expect(consumeDeletePropagationTripped()).toBe(false);
    expect(consumeRetirementHealTripped()).toBe(false); // the sibling flag never crossed
  });
});
