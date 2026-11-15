import { describe, it, expect } from 'vitest';
import { stampOriginalPlan, applyBaselines, planHistory } from './originalPlan.js';
import { preserveStickyFields } from './preserveStickyFields.js';

const task = (over = {}) => ({ id: 't1', title: 'Write the report', date: '2026-09-17', startTime: '09:00', duration: 60, ...over });

describe('recording the original plan', () => {
  it('records the schedule of a task new to storage', () => {
    const [out] = stampOriginalPlan([task()], []);
    expect(out.originalPlan).toEqual({ date: '2026-09-17', startTime: '09:00', duration: 60 });
  });

  it('records it when a task is scheduled out of the inbox', () => {
    // The stored copy exists but has no date or time: this IS the scheduling
    // moment, and it is the most common one in practice.
    const prev = [{ id: 't1', title: 'Write the report' }];
    const [out] = stampOriginalPlan([task()], prev);
    expect(out.originalPlan).toEqual({ date: '2026-09-17', startTime: '09:00', duration: 60 });
  });

  it('records it for a task dated but not yet timed', () => {
    const prev = [{ id: 't1', title: 'Write the report', date: '2026-09-17' }];
    const [out] = stampOriginalPlan([task()], prev);
    expect(out.originalPlan).toBeDefined();
  });

  it('omits duration when the task has none, rather than storing undefined', () => {
    const [out] = stampOriginalPlan([task({ duration: undefined })], []);
    expect(out.originalPlan).toEqual({ date: '2026-09-17', startTime: '09:00' });
    expect('duration' in out.originalPlan).toBe(false);
  });

  it('treats an all-day task as scheduled, since its date can still move', () => {
    const [out] = stampOriginalPlan([task({ isAllDay: true, startTime: '00:00' })], []);
    // And says it was all-day, so the stored midnight is not read as a planned time.
    expect(out.originalPlan).toEqual({ date: '2026-09-17', startTime: '00:00', duration: 60, allDay: true });
  });

  it('a timed task\'s baseline carries no all-day flag', () => {
    const [out] = stampOriginalPlan([task()], []);
    expect(out.originalPlan).not.toHaveProperty('allDay');
  });
});

describe('what is deliberately NOT recorded', () => {
  it('leaves an unscheduled task alone', () => {
    const [out] = stampOriginalPlan([{ id: 't1', title: 'Someday' }], []);
    expect(out.originalPlan).toBeUndefined();
  });

  it('leaves a dated task with no start time alone', () => {
    const [out] = stampOriginalPlan([{ id: 't1', date: '2026-09-17' }], []);
    expect(out.originalPlan).toBeUndefined();
  });

  it('does NOT backfill a task that was already scheduled in storage', () => {
    // The whole point. This task may have been rescheduled any number of times
    // before the feature existed, so its current schedule is not evidence of
    // anything. Absent means "not known", which is honest; a fabricated value
    // would be indistinguishable from a real one forever after.
    const prev = [task({ date: '2026-09-10', startTime: '14:00' })];
    const [out] = stampOriginalPlan([task()], prev);
    expect(out.originalPlan).toBeUndefined();
  });

  it('returns unchanged tasks by reference, so nothing downstream sees a false edit', () => {
    const existing = task({ originalPlan: { date: '2026-09-01', startTime: '08:00' } });
    const unscheduled = { id: 't2', title: 'Someday' };
    const out = stampOriginalPlan([existing, unscheduled], []);
    expect(out[0]).toBe(existing);
    expect(out[1]).toBe(unscheduled);
  });
});

describe('write-once', () => {
  it('never overwrites an existing baseline when the task is rescheduled', () => {
    const planned = stampOriginalPlan([task()], [])[0];
    const moved = { ...planned, date: '2026-09-18', startTime: '16:00' };
    const [out] = stampOriginalPlan([moved], [planned]);
    expect(out.originalPlan).toEqual({ date: '2026-09-17', startTime: '09:00', duration: 60 });
  });

  it('survives a round trip through the inbox and back onto the calendar', () => {
    // Unscheduling drops the task out of the scheduled store, so re-scheduling it
    // looks like a first scheduling. The carried baseline is what stops the
    // original plan being silently replaced by the second one.
    const planned = stampOriginalPlan([task()], [])[0];
    const backOnCalendar = { ...planned, date: '2026-09-20', startTime: '11:00' };
    const [out] = stampOriginalPlan([backOnCalendar], []);
    expect(out.originalPlan).toEqual({ date: '2026-09-17', startTime: '09:00', duration: 60 });
  });

  it('carries a stored baseline back onto an in-memory task that lacks it', () => {
    // The persist pass writes to storage, never back into React state, so the
    // in-memory task never grows the field. Without this the next save would
    // write state over the stored baseline and it would survive one save only.
    const stored = task({ originalPlan: { date: '2026-09-17', startTime: '09:00', duration: 60 } });
    const inMemory = task({ date: '2026-09-18', startTime: '16:00' });
    const [out] = stampOriginalPlan([inMemory], [stored]);
    expect(out.originalPlan).toEqual({ date: '2026-09-17', startTime: '09:00', duration: 60 });
  });

  it('survives repeated saves from a state that never carries the field', () => {
    const state = [task()];
    let stored = stampOriginalPlan(state, []);
    for (let i = 0; i < 5; i++) stored = stampOriginalPlan(state, stored);
    expect(stored[0].originalPlan).toEqual({ date: '2026-09-17', startTime: '09:00', duration: 60 });
  });

  it('keeps a baseline that arrived from another device', () => {
    const fromSync = task({ originalPlan: { date: '2026-08-01', startTime: '07:30' }, date: '2026-09-17' });
    const [out] = stampOriginalPlan([fromSync], []);
    expect(out.originalPlan).toEqual({ date: '2026-08-01', startTime: '07:30' });
  });
});

describe('the reschedule story from #1623, end to end', () => {
  it('keeps 09:00 recoverable after the task moves to 16:00', () => {
    let stored = [];
    const save = (live) => { stored = stampOriginalPlan(live, stored); return stored; };

    save([task({ date: '2026-09-17', startTime: '09:00', duration: 60 })]);
    const afterMove = save([{ ...stored[0], startTime: '16:00', duration: 45 }]);

    expect(afterMove[0].startTime).toBe('16:00');
    expect(afterMove[0].originalPlan).toEqual({ date: '2026-09-17', startTime: '09:00', duration: 60 });
  });

  it('is stable across repeated saves with no changes', () => {
    let stored = stampOriginalPlan([task()], []);
    const first = stored[0].originalPlan;
    for (let i = 0; i < 3; i++) stored = stampOriginalPlan(stored, stored);
    expect(stored[0].originalPlan).toEqual(first);
  });
});

describe('robustness', () => {
  it('tolerates a missing prev array', () => {
    expect(stampOriginalPlan([task()], undefined)[0].originalPlan).toBeDefined();
  });

  it('matches ids across the string/number boundary', () => {
    // Stored ids round-trip through JSON and are not always the same type as the
    // in-memory ones; a mismatch here would read as "new" and re-record.
    const prev = [task({ id: 7 })];
    const [out] = stampOriginalPlan([task({ id: '7', startTime: '16:00' })], prev);
    expect(out.originalPlan).toBeUndefined();
  });

  it('handles an empty task list', () => {
    expect(stampOriginalPlan([], [])).toEqual([]);
  });
});

describe('identity stability', () => {
  // The persist pass writes the result back into React state, so "did anything
  // change?" has to be answerable by reference or every save re-renders and
  // re-saves forever.
  it('returns the same array when nothing was added', () => {
    const tasks = [task({ originalPlan: { date: '2026-09-01', startTime: '08:00' } }), { id: 't2' }];
    expect(stampOriginalPlan(tasks, tasks)).toBe(tasks);
  });

  it('returns a new array when a baseline was added', () => {
    const tasks = [task()];
    expect(stampOriginalPlan(tasks, [])).not.toBe(tasks);
  });

  it('settles after exactly one pass', () => {
    const first = stampOriginalPlan([task()], []);
    expect(stampOriginalPlan(first, first)).toBe(first);
  });
});

describe('applyBaselines', () => {
  const PLAN = { date: '2026-09-17', startTime: '09:00', duration: 60 };

  it('copies a baseline onto the matching task', () => {
    const all = [task(), { id: 't2', title: 'Other' }];
    const out = applyBaselines(all, [task({ originalPlan: PLAN })]);
    expect(out[0].originalPlan).toEqual(PLAN);
    expect(out[1].originalPlan).toBeUndefined();
  });

  it('keeps rows the persist pass filtered out', () => {
    // saveData drops _native rows before persisting. Writing its array back
    // wholesale would delete them from state.
    const native = { id: 'n1', title: 'Calendar event', _native: true };
    const out = applyBaselines([task(), native], [task({ originalPlan: PLAN })]);
    expect(out).toHaveLength(2);
    expect(out[1]).toBe(native);
  });

  it('never overwrites a baseline a task already has', () => {
    const existing = task({ originalPlan: { date: '2026-01-01', startTime: '07:00' } });
    const out = applyBaselines([existing], [task({ originalPlan: PLAN })]);
    expect(out[0]).toBe(existing);
  });

  it('returns the same array when there is nothing to copy', () => {
    const all = [task()];
    expect(applyBaselines(all, [])).toBe(all);
  });

  it('tolerates null rows and a missing list', () => {
    expect(applyBaselines(undefined, [])).toEqual([]);
    expect(applyBaselines([null], [task({ originalPlan: PLAN })])).toEqual([null]);
  });
});

describe('the vault round trip that erased the baseline in the field', () => {
  // Reported from a real install: 0 of 626 tasks carried a baseline, including a
  // task created seconds earlier. The persist pass was stamping correctly; the
  // field just never reached React state, and state is what the sync layer reads.
  //
  //   save      → storage gets originalPlan, state does not
  //   push      → buildSyncPayload reads STATE, so the vault gets a row without it
  //   pull      → applyEngineData hands preserveStickyFields the live STATE as the
  //               source of sticky values, which also does not have it
  //   apply     → state and storage rewritten without it; gone for good, because a
  //               task already scheduled in storage is never re-stamped
  //
  // Every link needs state to carry the field, which is what the write-back does.
  const live = () => [{ id: 't1', title: 'Report', date: '2026-09-17', startTime: '09:00', duration: 60 }];

  it('survives a pull from a device that never had the field', () => {
    // 1. the save pass stamps, and the result goes back into state
    const stored = stampOriginalPlan(live(), []);
    const state = applyBaselines(live(), stored);
    expect(state[0].originalPlan).toBeDefined(); // the link that was missing

    // 2. the old-build device edits the duration and pushes; its row has no baseline
    const pulled = [{ ...live()[0], duration: 90, lastModified: '2026-09-18T10:00:00Z' }];

    // 3. the apply carries sticky fields from the live state
    const applied = preserveStickyFields(pulled, state);

    expect(applied[0].originalPlan).toEqual({ date: '2026-09-17', startTime: '09:00', duration: 60 });
    expect(applied[0].duration).toBe(90); // the remote edit still wins
  });

  it('is unrecoverable without it, which is why the write-back matters', () => {
    // The same sequence with state left un-enriched, as originally shipped.
    const stateWithoutBaseline = live();
    const pulled = [{ ...live()[0], duration: 90 }];
    const applied = preserveStickyFields(pulled, stateWithoutBaseline);
    expect(applied[0].originalPlan).toBeUndefined();

    // And the next save cannot put it back: storage now shows the task as already
    // scheduled, so the no-backfill rule correctly refuses to invent one.
    expect(stampOriginalPlan(applied, applied)[0].originalPlan).toBeUndefined();
  });
});

describe('planHistory', () => {
  const planned = (over = {}) => ({
    id: 't1', date: '2026-09-17', startTime: '09:00', duration: 60,
    originalPlan: { date: '2026-09-17', startTime: '09:00', duration: 60 },
    ...over,
  });

  it('reports nothing for a task with no baseline', () => {
    expect(planHistory({ id: 't1', date: '2026-09-17', startTime: '09:00' })).toBeNull();
  });

  it('reports nothing for a task still where it was first put', () => {
    // The affordance must not appear on a task with no story to tell.
    expect(planHistory(planned())).toBeNull();
  });

  it('reports a moved date', () => {
    const h = planHistory(planned({ date: '2026-09-20' }));
    expect(h.changed).toMatchObject({ date: true, startTime: false, duration: false });
    expect(h.plan.date).toBe('2026-09-17');
  });

  it('reports a moved time', () => {
    expect(planHistory(planned({ startTime: '16:00' })).changed.startTime).toBe(true);
  });

  it('reports a changed duration', () => {
    expect(planHistory(planned({ duration: 15 })).changed.duration).toBe(true);
  });

  it('reports several changes at once', () => {
    const h = planHistory(planned({ date: '2026-09-20', startTime: '16:00', duration: 15 }));
    expect(h.changed).toEqual({ date: true, startTime: true, duration: true });
  });

  it('does not treat a baseline without a duration as a duration change', () => {
    // Baselines recorded from a task that had no duration carry no duration.
    const task = planned({ originalPlan: { date: '2026-09-17', startTime: '09:00' } });
    expect(planHistory(task)).toBeNull();
    expect(planHistory({ ...task, startTime: '16:00' }).changed.duration).toBe(false);
  });

  it('tolerates a missing task', () => {
    expect(planHistory(undefined)).toBeNull();
    expect(planHistory(null)).toBeNull();
  });
});
