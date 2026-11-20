import { describe, it, expect } from 'vitest';
import { hasComeDue, isDeferral, movedLater, stampDeferrals, mergeDeferrals, placesAllDayWithinItsDay } from './deferrals.js';

const TODAY = '2026-09-19';
const at = (h, m = 0) => new Date(2026, 8, 19, h, m);
const task = (over = {}) => ({ id: 't1', title: 'Write the report', date: TODAY, startTime: '09:00', ...over });

describe('hasComeDue', () => {
  it('is true once the start time has passed today', () => {
    expect(hasComeDue(task(), at(9, 30), TODAY)).toBe(true);
  });

  it('is true at exactly the start time', () => {
    expect(hasComeDue(task(), at(9, 0), TODAY)).toBe(true);
  });

  it('is false before the start time', () => {
    expect(hasComeDue(task(), at(8, 59), TODAY)).toBe(false);
  });

  it('is true for any earlier day, whatever the clock says', () => {
    expect(hasComeDue(task({ date: '2026-09-18' }), at(0, 1), TODAY)).toBe(true);
  });

  it('is false for a later day, however late in the day it is', () => {
    expect(hasComeDue(task({ date: '2026-09-20' }), at(23, 59), TODAY)).toBe(false);
  });

  it('is false without a schedule: nothing was supposed to begin', () => {
    expect(hasComeDue(task({ date: null }), at(23, 0), TODAY)).toBe(false);
    expect(hasComeDue(task({ startTime: null }), at(23, 0), TODAY)).toBe(false);
    expect(hasComeDue(undefined, at(9, 30), TODAY)).toBe(false);
  });
});

describe('isDeferral distinguishes a slip from planning', () => {
  it('counts a same-day push made after the task came due', () => {
    // The case that cross-day-only would miss: 09:00 moved to 16:00 at 09:30.
    expect(isDeferral(task(), task({ startTime: '16:00' }), at(9, 30), TODAY)).toBe(true);
  });

  it('does NOT count same-day shuffling before anything came due', () => {
    // Laying out the morning at 08:00 is planning, not slipping.
    expect(isDeferral(task(), task({ startTime: '11:00' }), at(8, 0), TODAY)).toBe(false);
  });

  it('counts pushing a task that is already overdue to another day', () => {
    expect(isDeferral(task(), task({ date: '2026-09-20' }), at(14, 0), TODAY)).toBe(true);
  });

  it('does NOT count rescheduling a future task to a different future day', () => {
    // Moving tomorrow's task to Friday is planning, even though the day changed.
    const future = task({ date: '2026-09-20' });
    expect(isDeferral(future, task({ date: '2026-09-25' }), at(14, 0), TODAY)).toBe(false);
  });

  it('needs the schedule to have actually moved', () => {
    expect(isDeferral(task(), task({ title: 'Renamed' }), at(14, 0), TODAY)).toBe(false);
    expect(isDeferral(task(), task({ completed: true }), at(14, 0), TODAY)).toBe(false);
  });

  it('is false for a task with no previous copy to compare against', () => {
    expect(isDeferral(undefined, task(), at(14, 0), TODAY)).toBe(false);
  });
});

// #2434: a slip is a push back. Pulling a due task earlier is the opposite,
// and counted as one it made the number say the reverse of what happened.
describe('only a move that makes the plan later is a slip', () => {
  it('does NOT count pulling a due task earlier on its day (a top-edge resize up)', () => {
    expect(isDeferral(task(), task({ startTime: '08:00' }), at(14, 15), TODAY)).toBe(false);
  });

  it('does NOT count moving an overdue task to an earlier day', () => {
    expect(isDeferral(task(), task({ date: '2026-09-18', startTime: '17:00' }), at(14, 15), TODAY)).toBe(false);
  });

  it('still counts an overdue task moved from yesterday to today, whatever the times', () => {
    // Yesterday 15:00 to today 08:00: the clock time is earlier, the plan is later.
    expect(isDeferral(task({ date: '2026-09-18', startTime: '15:00' }), task({ startTime: '08:00' }), at(14, 15), TODAY)).toBe(true);
  });

  it('compares times as times, not as text', () => {
    expect(movedLater(task({ startTime: '9:00' }), task({ startTime: '10:00' }))).toBe(true);
    expect(movedLater(task({ startTime: '10:00' }), task({ startTime: '9:00' }))).toBe(false);
  });

  it('is false without a date on either side', () => {
    expect(movedLater(task({ date: null }), task())).toBe(false);
    expect(movedLater(task(), task({ date: null }))).toBe(false);
  });

  it('adds no count and no trail stop for an earlier move', async () => {
    const { stampPlanTrail } = await import('./planTrail.js');
    const prev = [task()];
    const next = [task({ startTime: '08:00' })];
    expect(stampDeferrals(next, prev, at(14, 15), TODAY)).toBe(next);
    expect(stampPlanTrail(next, prev, at(14, 15), TODAY)).toBe(next);
  });
});

// A chore sent by another GLANCE app arrives all-day and is then put at a
// time. Stored at 00:00, it had "come due" at midnight, so that counted as a slip.
describe('giving an all-day task a time on its own day is placing it, not a slip', () => {
  const allDay = (over = {}) => task({ isAllDay: true, startTime: '00:00', ...over });
  const timed = (startTime, over = {}) => task({ isAllDay: false, startTime, ...over });

  it('is not a deferral, at any time of that day', () => {
    for (const hour of [0, 9, 15, 23]) {
      expect(isDeferral(allDay(), timed('14:00'), at(hour, 30), TODAY), `at ${hour}:30`).toBe(false);
    }
    expect(placesAllDayWithinItsDay(allDay(), timed('14:00'))).toBe(true);
  });

  it('moving an all-day task to another day is still judged as before', () => {
    // Today's, pushed to tomorrow (all-day or timed): its day is being left.
    expect(isDeferral(allDay(), allDay({ date: '2026-09-20' }), at(15), TODAY)).toBe(true);
    expect(isDeferral(allDay(), timed('10:00', { date: '2026-09-20' }), at(15), TODAY)).toBe(true);
    // Yesterday's, given a time today: it was overdue.
    expect(isDeferral(allDay({ date: '2026-09-18' }), timed('14:00'), at(9), TODAY)).toBe(true);
    // Tomorrow's, given a time tomorrow or moved further out: planning.
    expect(isDeferral(allDay({ date: '2026-09-20' }), timed('14:00', { date: '2026-09-20' }), at(9), TODAY)).toBe(false);
  });

  it('a timed task that came due is unaffected, including one made all-day', () => {
    expect(isDeferral(timed('09:00'), timed('14:00'), at(9, 30), TODAY)).toBe(true);
    expect(isDeferral(timed('09:00'), allDay(), at(9, 30), TODAY)).toBe(true);
    expect(placesAllDayWithinItsDay(timed('09:00'), timed('14:00'))).toBe(false);
    expect(placesAllDayWithinItsDay(allDay(), allDay())).toBe(false);
  });

  it('adds no count and no trail stop', async () => {
    const { stampPlanTrail } = await import('./planTrail.js');
    const prev = [allDay()];
    const next = [timed('14:00')];
    expect(stampDeferrals(next, prev, at(15), TODAY)).toBe(next);
    expect(stampPlanTrail(next, prev, at(15), TODAY)).toBe(next);
    // The same edit on a timed task that had come due adds both.
    const slipped = [timed('09:00')];
    expect(stampDeferrals(next, slipped, at(15), TODAY)[0].deferrals).toBe(1);
    expect(stampPlanTrail(next, slipped, at(15), TODAY)[0].planTrail).toHaveLength(1);
  });
});

describe('stampDeferrals', () => {
  it('starts a count at one', () => {
    const [out] = stampDeferrals([task({ startTime: '16:00' })], [task()], at(9, 30), TODAY);
    expect(out.deferrals).toBe(1);
  });

  it('adds to an existing count', () => {
    const prev = task({ deferrals: 4 });
    const [out] = stampDeferrals([task({ startTime: '16:00', deferrals: 4 })], [prev], at(9, 30), TODAY);
    expect(out.deferrals).toBe(5);
  });

  it('returns the same array when nothing slipped, so the persist pass can tell', () => {
    const tasks = [task()];
    expect(stampDeferrals(tasks, tasks, at(9, 30), TODAY)).toBe(tasks);
  });

  it('leaves planning alone', () => {
    const tasks = [task({ startTime: '11:00' })];
    expect(stampDeferrals(tasks, [task()], at(8, 0), TODAY)).toBe(tasks);
  });

  it('only ever rises, which is what lets two devices merge by max', () => {
    let stored = [task()];
    for (const t of ['10:00', '12:00', '16:00']) {
      const next = [{ ...stored[0], startTime: t }];
      stored = stampDeferrals(next, stored, at(23, 0), TODAY);
    }
    expect(stored[0].deferrals).toBe(3);
  });

  it('derives today from the clock when not given one', () => {
    const now = at(9, 30);
    const [out] = stampDeferrals([task({ startTime: '16:00' })], [task()], now);
    expect(out.deferrals).toBe(1);
  });
});

describe('mergeDeferrals', () => {
  it('takes the higher count rather than summing the same slip twice', () => {
    expect(mergeDeferrals(3, 5)).toBe(5);
    expect(mergeDeferrals(5, 3)).toBe(5);
  });

  it('treats a device that never carried the field as zero, not as an erasure', () => {
    expect(mergeDeferrals(undefined, 4)).toBe(4);
    expect(mergeDeferrals(4, undefined)).toBe(4);
  });

  it('stays absent when neither side has one, rather than writing a zero', () => {
    expect(mergeDeferrals(undefined, undefined)).toBeUndefined();
    expect(mergeDeferrals(0, 0)).toBeUndefined();
  });

  it('ignores junk rather than producing NaN', () => {
    expect(mergeDeferrals('four', 2)).toBe(2);
    expect(mergeDeferrals(null, null)).toBeUndefined();
  });
});
