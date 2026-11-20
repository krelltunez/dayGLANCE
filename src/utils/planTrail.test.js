import { describe, it, expect } from 'vitest';
import {
  TRAIL_CAP, stampPlanTrail, mergePlanTrail, sameTrail, applyPlanTrail,
  intermediatePlans, hiddenStops,
} from './planTrail.js';

const NOW = new Date('2026-09-19T10:00:00');
const TODAY = '2026-09-19';

const task = (over = {}) => ({ id: 't1', date: TODAY, startTime: '09:00', ...over });
const stop = (at, date, startTime) => ({ at, date, startTime });

describe('stampPlanTrail', () => {
  it('records the schedule a slipped task moved TO', () => {
    const prev = [task({ date: '2026-09-18', startTime: '09:00' })];
    const next = [task({ date: '2026-09-20', startTime: '14:00' })];
    const out = stampPlanTrail(next, prev, NOW, TODAY);
    expect(out[0].planTrail).toEqual([
      { at: NOW.getTime(), date: '2026-09-20', startTime: '14:00' },
    ]);
  });

  // The trail is the detail behind the count, so it answers to the same rule:
  // moving work that has not come due is planning, and planning is not history.
  it('ignores a planning move, exactly as the count does', () => {
    const prev = [task({ date: '2026-09-25', startTime: '09:00' })];
    const next = [task({ date: '2026-09-28', startTime: '09:00' })];
    expect(stampPlanTrail(next, prev, NOW, TODAY)[0].planTrail).toBeUndefined();
  });

  // #2434: and a slip goes one way. A due task pulled earlier made no stop.
  it('records a due task pushed later, not one pulled earlier', () => {
    const prev = [task()];
    const later = [task({ startTime: '11:00' })];
    const earlier = [task({ startTime: '08:00' })];
    expect(stampPlanTrail(later, prev, NOW, TODAY)[0].planTrail).toEqual([{ at: NOW.getTime(), date: TODAY, startTime: '11:00' }]);
    expect(stampPlanTrail(earlier, prev, NOW, TODAY)).toBe(earlier);
  });

  it('appends to an existing trail rather than replacing it', () => {
    const prev = [task({ date: '2026-09-18', startTime: '09:00', planTrail: [stop(1, '2026-09-18', '09:00')] })];
    const next = [task({ date: '2026-09-20', startTime: '14:00', planTrail: [stop(1, '2026-09-18', '09:00')] })];
    expect(stampPlanTrail(next, prev, NOW, TODAY)[0].planTrail).toHaveLength(2);
  });

  it('keeps only the most recent stops', () => {
    const old = Array.from({ length: TRAIL_CAP }, (_, i) => stop(i + 1, '2026-09-01', '09:00'));
    const prev = [task({ date: '2026-09-18', startTime: '09:00', planTrail: old })];
    const next = [task({ date: '2026-09-20', startTime: '14:00', planTrail: old })];
    const trail = stampPlanTrail(next, prev, NOW, TODAY)[0].planTrail;
    expect(trail).toHaveLength(TRAIL_CAP);
    expect(trail[0].at).toBe(2); // the oldest fell off the front
    expect(trail[TRAIL_CAP - 1].date).toBe('2026-09-20');
  });

  // The contract the persist pass reads by identity. `originalPlan` shipped once
  // without it and reached storage but never React state, where the sync layer
  // could see it.
  it('returns the SAME array when nothing slipped', () => {
    const list = [task()];
    expect(stampPlanTrail(list, list, NOW, TODAY)).toBe(list);
  });
});

describe('mergePlanTrail', () => {
  it('unions stops neither side has alone', () => {
    const merged = mergePlanTrail([stop(1, '2026-09-10', '09:00')], [stop(2, '2026-09-12', '10:00')]);
    expect(merged.map((e) => e.at)).toEqual([1, 2]);
  });

  it('does not double-count the same stop seen twice', () => {
    const shared = [stop(1, '2026-09-10', '09:00')];
    expect(mergePlanTrail(shared, [...shared])).toHaveLength(1);
  });

  // Order-independent and idempotent, which is what lets two devices apply it
  // without agreeing on anything first — the same property the count's max has.
  it('gives the same answer whichever side goes first, and twice over', () => {
    const a = [stop(3, '2026-09-14', '09:00')];
    const b = [stop(1, '2026-09-10', '08:00')];
    const once = mergePlanTrail(a, b);
    expect(mergePlanTrail(b, a)).toEqual(once);
    expect(mergePlanTrail(once, once)).toEqual(once);
  });

  it('cannot grow past the cap', () => {
    const a = Array.from({ length: TRAIL_CAP }, (_, i) => stop(i + 1, '2026-09-01', '09:00'));
    const b = Array.from({ length: TRAIL_CAP }, (_, i) => stop(i + 100, '2026-09-02', '09:00'));
    expect(mergePlanTrail(a, b)).toHaveLength(TRAIL_CAP);
  });

  it('carries one side forward when the other never had the field', () => {
    const a = [stop(1, '2026-09-10', '09:00')];
    expect(mergePlanTrail(a, undefined)).toEqual(a);
    expect(mergePlanTrail(undefined, a)).toEqual(a);
    expect(mergePlanTrail(undefined, undefined)).toBeUndefined();
  });

  it('drops malformed entries rather than rendering them', () => {
    expect(mergePlanTrail([{ at: 1 }, null, stop(2, '2026-09-10', '09:00')], [])).toHaveLength(1);
    expect(mergePlanTrail('not a list', undefined)).toBeUndefined();
  });
});

describe('applyPlanTrail', () => {
  it('merges the computed trail onto the live list', () => {
    const all = [task({ planTrail: [stop(1, '2026-09-10', '09:00')] }), { id: 'other' }];
    const computed = [task({ planTrail: [stop(2, '2026-09-12', '10:00')] })];
    const out = applyPlanTrail(all, computed);
    expect(out[0].planTrail.map((e) => e.at)).toEqual([1, 2]);
    expect(out[1]).toBe(all[1]);
  });

  it('returns the same list when the merge changes nothing', () => {
    const trail = [stop(1, '2026-09-10', '09:00')];
    const all = [task({ planTrail: trail })];
    expect(applyPlanTrail(all, [task({ planTrail: trail })])).toBe(all);
  });
});

describe('intermediatePlans', () => {
  it('drops the last stop, which is where the task sits now', () => {
    const t = task({
      date: '2026-09-20', startTime: '14:00',
      planTrail: [stop(1, '2026-09-19', '09:00'), stop(2, '2026-09-20', '14:00')],
    });
    expect(intermediatePlans(t)).toEqual([stop(1, '2026-09-19', '09:00')]);
  });

  // A planning move after the final slip leaves the task somewhere no stop
  // records, and then every stop really is in between.
  it('keeps the last stop when the task has since moved off it', () => {
    const t = task({
      date: '2026-09-30', startTime: '08:00',
      planTrail: [stop(1, '2026-09-19', '09:00'), stop(2, '2026-09-20', '14:00')],
    });
    expect(intermediatePlans(t)).toHaveLength(2);
  });

  it('has nothing to show for a task that never slipped', () => {
    expect(intermediatePlans(task())).toEqual([]);
    expect(intermediatePlans(undefined)).toEqual([]);
  });
});

describe('hiddenStops', () => {
  // The count is uncapped and the trail is not, which is the whole reason both
  // exist: the number stays true while the detail is necessarily partial.
  it('reports the slips that fell off the front', () => {
    const t = task({
      deferrals: 30,
      planTrail: Array.from({ length: TRAIL_CAP }, (_, i) => stop(i + 1, '2026-09-01', '09:00')),
    });
    expect(hiddenStops(t)).toBe(30 - TRAIL_CAP);
  });

  it('reports none while the trail still holds every slip', () => {
    expect(hiddenStops(task({ deferrals: 2, planTrail: [stop(1, '2026-09-10', '09:00'), stop(2, '2026-09-11', '09:00')] }))).toBe(0);
  });

  it('never goes negative when a union outruns an unmerged count', () => {
    expect(hiddenStops(task({ deferrals: 1, planTrail: [stop(1, '2026-09-10', '09:00'), stop(2, '2026-09-11', '09:00')] }))).toBe(0);
  });
});

describe('sameTrail', () => {
  it('compares contents, not identity', () => {
    expect(sameTrail([stop(1, '2026-09-10', '09:00')], [stop(1, '2026-09-10', '09:00')])).toBe(true);
    expect(sameTrail([stop(1, '2026-09-10', '09:00')], [stop(2, '2026-09-10', '09:00')])).toBe(false);
    expect(sameTrail(undefined, [])).toBe(true);
  });
});

// ── One walk through the whole cycle ─────────────────────────────────────────
// `originalPlan` had unit tests on every boundary and still shipped in a state
// where it never survived a single sync round, because nothing exercised the
// path BETWEEN the modules. This does: the stamp writes a stop, the state
// write-back carries it, the file tier merges against a newer copy from a device
// that never had it, and the apply puts it back on top of engine data.
describe('a stop survives save → state → push → apply', () => {
  it('is still there at the end, and does not claim the task was edited', async () => {
    const { mergeSyncData } = await import('../mergeSync.js');
    const { preserveStickyFields } = await import('./preserveStickyFields.js');
    const { stampTimestamps } = await import('./stampTimestamps.js');

    const before = { id: 'x1', title: 'Report', date: '2026-01-05', startTime: '09:00', lastModified: '2026-01-05T00:00:00.000Z' };
    const moved = { ...before, date: '2026-01-07', startTime: '14:00' };

    // 1. SAVE — the persist pass sees the old schedule beside the new one.
    const [stamped] = stampPlanTrail([moved], [before], NOW, TODAY);
    expect(stamped.planTrail).toHaveLength(1);

    // 2. STATE — the write-back enriches the live list in place.
    const [inState] = applyPlanTrail([moved], [stamped]);
    expect(inState.planTrail).toEqual(stamped.planTrail);

    // ...without the stamp pass reading that as a user edit. A fabricated
    // timestamp here outranks a real completion made on another device.
    const [persisted] = stampTimestamps([inState], [moved], 'FABRICATED');
    expect(persisted.lastModified).toBe(before.lastModified);

    // 3. PUSH — merged against a NEWER copy from a device that never had it.
    const remote = { tasks: [{ ...moved, title: 'Report v2', lastModified: '2026-01-08T00:00:00.000Z' }] };
    const { data } = mergeSyncData({ tasks: [persisted] }, remote, 90);
    expect(data.tasks[0].title).toBe('Report v2'); // the newer copy did win
    expect(data.tasks[0].planTrail).toEqual(stamped.planTrail);

    // 4. APPLY — back over state, which is where the last version was lost.
    const [applied] = preserveStickyFields(data.tasks, [inState]);
    expect(applied.planTrail).toEqual(stamped.planTrail);
    expect(intermediatePlans(applied)).toEqual([]); // the one stop IS where it sits now
  });
});
