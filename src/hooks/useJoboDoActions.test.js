import { describe, it, expect } from 'vitest';
import { continueInitial, doWriteMessageKey, endPatch, timedPatch } from './useJoboDoActions.js';

// The pure parts of the Do actions both JOBO views share (desktop and, since
// slice 8 step 2, the phone).

describe('timedPatch', () => {
  it('an interval within the day', () => {
    expect(timedPatch('2026-10-04', 9 * 60, 9 * 60 + 45)).toEqual({
      timing: 'timed', date: '2026-10-04', startTime: '09:00', endDate: '2026-10-04', endTime: '09:45',
    });
  });
  // MUTATION: keep the end on the same day and a Do to midnight ends at its own start.
  it('an end at midnight is the next day at 00:00', () => {
    expect(timedPatch('2026-10-31', 23 * 60, 1440)).toMatchObject({ endDate: '2026-11-01', endTime: '00:00' });
  });
});

// #2278: the end of a Do past midnight is resized on the next date's piece.
describe('endPatch', () => {
  it('moves only the end, on the date of the column it was resized on', () => {
    expect(endPatch('2026-11-04', 120)).toEqual({ endDate: '2026-11-04', endTime: '02:00' });
    expect(endPatch('2026-12-31', 1440)).toEqual({ endDate: '2027-01-01', endTime: '00:00' });
  });
});

describe('continueInitial', () => {
  it('carries the task and the captured plan, so the new Do joins the attempt', () => {
    const plan = { date: '2026-10-04', startTime: '09:00', duration: 60 };
    expect(continueInitial({ title: 'Spec', taskId: 't1', planSnapshot: plan }, '2026-10-04', 600)).toEqual({
      date: '2026-10-04', startMinute: 600, duration: 30, title: 'Spec', task: { id: 't1' }, planSnapshot: plan, continuing: true,
    });
  });
});

describe('doWriteMessageKey', () => {
  it('names the write the toast offers to undo', () => {
    expect(doWriteMessageKey(null, { id: 'a' })).toBe('jobo.mobile.doAdded');
    expect(doWriteMessageKey({ id: 'a' }, { id: 'a', deleted: true })).toBe('jobo.mobile.doDeleted');
    expect(doWriteMessageKey({ id: 'a' }, { id: 'a', endTime: '10:30' })).toBe('jobo.mobile.doSaved');
  });
});
