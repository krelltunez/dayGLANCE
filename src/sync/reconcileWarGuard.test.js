import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  shouldSuppressReconcileDelete,
  consumeWarTripped,
  __resetWarGuardForTests,
} from './reconcileWarGuard.js';
import { reconcileCrossList } from './dbAdapter.js';

// THE SAME-ENTITY DELETE-STREAK DETECTOR (#1455). The failure class: every
// cycle of a delete/resupply war SUCCEEDS, so failure-armed braking never
// engages. The guard counts reconcile deletions per id; the same id deleted
// a 3rd time inside 10 minutes is a war — suppress that id's reconcile
// delete for a cooldown (both copies retained, visibly duplicated beats
// invisibly at war), log loudly once, and flag the trip so the sync cycle
// arms its brake after the otherwise-successful cycle.

const T0 = 1_756_500_000_000;
const MIN = 60_000;

let warnSpy;
beforeEach(() => {
  __resetWarGuardForTests();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  __resetWarGuardForTests();
  vi.restoreAllMocks();
});

describe('shouldSuppressReconcileDelete — N=3 in M=10min', () => {
  it('two deletions inside the window pass — the benign convergence allowance (resolution + one race replay)', () => {
    expect(shouldSuppressReconcileDelete('id-1', T0)).toBe(false);
    expect(shouldSuppressReconcileDelete('id-1', T0 + MIN)).toBe(false);
    expect(consumeWarTripped()).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('the third deletion inside 10 minutes trips: suppressed, ONE loud log, trip flagged once', () => {
    shouldSuppressReconcileDelete('id-1', T0);
    shouldSuppressReconcileDelete('id-1', T0 + MIN);
    expect(shouldSuppressReconcileDelete('id-1', T0 + 2 * MIN)).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('WAR GUARD: id-1');
    // Read-and-clear: the cycle arms its brake exactly once per trip.
    expect(consumeWarTripped()).toBe(true);
    expect(consumeWarTripped()).toBe(false);
  });

  it('while suppressed, further deletions stay suppressed WITHOUT re-logging or re-tripping', () => {
    shouldSuppressReconcileDelete('id-1', T0);
    shouldSuppressReconcileDelete('id-1', T0 + MIN);
    shouldSuppressReconcileDelete('id-1', T0 + 2 * MIN); // trips
    consumeWarTripped();
    expect(shouldSuppressReconcileDelete('id-1', T0 + 5 * MIN)).toBe(true);
    expect(shouldSuppressReconcileDelete('id-1', T0 + 9 * MIN)).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(consumeWarTripped()).toBe(false);
  });

  it('after the 10-minute cooldown the id starts a FRESH count — one deletion passes again', () => {
    shouldSuppressReconcileDelete('id-1', T0);
    shouldSuppressReconcileDelete('id-1', T0 + MIN);
    shouldSuppressReconcileDelete('id-1', T0 + 2 * MIN); // suppressed until T0+12min
    expect(shouldSuppressReconcileDelete('id-1', T0 + 13 * MIN)).toBe(false);
  });

  it('hits older than the window are pruned — a slow, legitimate cadence never trips', () => {
    shouldSuppressReconcileDelete('id-1', T0);
    shouldSuppressReconcileDelete('id-1', T0 + 6 * MIN);
    // Third hit at +12min: the T0 hit has aged out — only two in window.
    expect(shouldSuppressReconcileDelete('id-1', T0 + 12 * MIN)).toBe(false);
  });

  it('ids are independent — a war on one id never suppresses another', () => {
    shouldSuppressReconcileDelete('id-1', T0);
    shouldSuppressReconcileDelete('id-1', T0 + 1);
    expect(shouldSuppressReconcileDelete('id-1', T0 + 2)).toBe(true);
    expect(shouldSuppressReconcileDelete('id-2', T0 + 3)).toBe(false);
  });
});

describe('reconcileCrossList under suppression', () => {
  // The production war's exact collision shape: the same id live under
  // tasks AND unscheduledTasks after a cross-device race.
  const warData = () => ({
    tasks: [{ id: 'obsidian-2026-08-29-lsx681', lastModified: '2026-08-29T10:00:00Z' }],
    unscheduledTasks: [{ id: 'obsidian-2026-08-29-lsx681', lastModified: '2026-08-29T09:00:00Z' }],
  });

  it('unsuppressed: the loser is deleted and reported (baseline behavior intact)', () => {
    const data = warData();
    const losers = [];
    reconcileCrossList(data, (id) => losers.push(id), undefined, () => false);
    expect(data.tasks).toHaveLength(1);
    expect(data.unscheduledTasks).toHaveLength(0);
    expect(losers).toEqual(['unscheduledTasks:obsidian-2026-08-29-lsx681']);
  });

  it('suppressed: BOTH copies retained, nothing reported — visibly duplicated beats invisibly at war', () => {
    const data = warData();
    const losers = [];
    reconcileCrossList(data, (id) => losers.push(id), undefined, () => true);
    expect(data.tasks).toHaveLength(1);
    expect(data.unscheduledTasks).toHaveLength(1);
    expect(losers).toEqual([]);
  });

  it('suppression is per-id: other collisions in the same cycle still resolve', () => {
    const data = {
      tasks: [
        { id: 'warring', lastModified: '2026-08-29T10:00:00Z' },
        { id: 'benign', lastModified: '2026-08-29T10:00:00Z' },
      ],
      unscheduledTasks: [
        { id: 'warring', lastModified: '2026-08-29T09:00:00Z' },
        { id: 'benign', lastModified: '2026-08-29T09:00:00Z' },
      ],
    };
    const losers = [];
    reconcileCrossList(data, (id) => losers.push(id), undefined, (id) => id === 'warring');
    expect(data.unscheduledTasks.map((t) => t.id)).toEqual(['warring']);
    expect(losers).toEqual(['unscheduledTasks:benign']);
  });

  it('END TO END with the real guard: cycles 1–2 resolve, cycle 3 retains both copies and flags the brake', () => {
    // Each "cycle" is a resupplied collision — the war's resupply loop.
    for (let cycle = 0; cycle < 2; cycle++) {
      const data = warData();
      reconcileCrossList(data, () => {}, undefined,
        (id) => shouldSuppressReconcileDelete(id, T0 + cycle * MIN));
      expect(data.unscheduledTasks).toHaveLength(0); // resolved normally
      expect(consumeWarTripped()).toBe(false);       // brake untouched
    }
    const data = warData();
    reconcileCrossList(data, () => {}, undefined,
      (id) => shouldSuppressReconcileDelete(id, T0 + 2 * MIN));
    expect(data.tasks).toHaveLength(1);
    expect(data.unscheduledTasks).toHaveLength(1);   // war: both retained
    expect(consumeWarTripped()).toBe(true);          // cycle arms the brake
  });
});
