import { describe, it, expect } from 'vitest';
import {
  DAY_MINUTES,
  isTimedBlock,
  overnightSpillMinutes,
  continuationsFromPreviousDay,
  taskEnd,
  hasTaskEnded,
  dayTimedBlocks,
  nowAndNext,
} from './overnight.js';
import {
  computeOccupiedIntervals,
  computeAvailableSlots,
  adjustPastConflicts,
  continuationIntervals,
} from './dayOccupancy.js';

const TUE = '2026-11-03';
const WED = '2026-11-04';

const T = (over = {}) => ({
  id: 't1', title: 'Night shift', date: TUE, startTime: '23:00', duration: 120, isAllDay: false, ...over,
});

describe('overnightSpillMinutes: the carry rule', () => {
  it('23:00 + 2h leaves one hour after midnight', () => {
    expect(overnightSpillMinutes(T())).toBe(60);
  });

  it('a block ending exactly at 24:00 carries nothing', () => {
    expect(overnightSpillMinutes(T({ startTime: '23:00', duration: 60 }))).toBe(0);
    expect(overnightSpillMinutes(T({ startTime: '23:45', duration: 15 }))).toBe(0);
  });

  it('23:45 + 30 carries 15 minutes', () => {
    expect(overnightSpillMinutes(T({ startTime: '23:45', duration: 30 }))).toBe(15);
  });

  it('a 24h block from 00:00 stays on its own date; from 08:00 it runs to 08:00 the next day', () => {
    expect(overnightSpillMinutes(T({ startTime: '00:00', duration: 24 * 60 }))).toBe(0);
    expect(overnightSpillMinutes(T({ startTime: '08:00', duration: 24 * 60 }))).toBe(8 * 60);
  });

  it('never carries past the next date: an imported multi-day block is clipped to one whole day', () => {
    expect(overnightSpillMinutes(T({ startTime: '10:00', duration: 3 * 24 * 60 }))).toBe(DAY_MINUTES);
  });

  it('all-day rows, rows without a start, and rows without a duration never carry', () => {
    expect(overnightSpillMinutes(T({ isAllDay: true }))).toBe(0);
    expect(overnightSpillMinutes(T({ startTime: null }))).toBe(0);
    expect(overnightSpillMinutes(T({ startTime: '' }))).toBe(0);
    expect(overnightSpillMinutes(T({ duration: 0 }))).toBe(0);
    expect(overnightSpillMinutes(T({ duration: undefined }))).toBe(0);
    expect(overnightSpillMinutes(T({ startTime: 'late' }))).toBe(0);
    expect(overnightSpillMinutes(null)).toBe(0);
    expect(isTimedBlock(T({ isAllDay: true }))).toBe(false);
    expect(isTimedBlock(T())).toBe(true);
  });
});

describe('continuationsFromPreviousDay', () => {
  it('returns the row itself, the date it started on, and its piece from 00:00', () => {
    const task = T();
    const [c, ...rest] = continuationsFromPreviousDay([task, T({ id: 't2', startTime: '09:00', duration: 60 })]);
    expect(rest).toEqual([]);
    expect(c.task).toBe(task);
    expect(c).toMatchObject({ fromDate: TUE, startMinutes: 0, endMinutes: 60, minutes: 60 });
  });

  it('a completed task still carries (shown as completed)', () => {
    const [c] = continuationsFromPreviousDay([T({ completed: true })]);
    expect(c.task.completed).toBe(true);
  });

  it('an imported event split per day by the ICS parser never carries twice', () => {
    // expandMultiDayEvent splits only ALL-DAY events into per-day rows, and
    // every one of those is all-day: none of them carries.
    const pieces = [1, 2, 3].map((i) => T({ id: `ev-day${i}`, imported: true, isAllDay: true, startTime: '00:00', duration: 60, title: `Trip (Day ${i}/3)` }));
    expect(continuationsFromPreviousDay(pieces)).toEqual([]);
  });

  it('a recurring occurrence carries with that date’s exception applied, keeping its own id', () => {
    const occurrence = { id: 'recurring-s1-2026-11-03', date: TUE, startTime: '22:30', duration: 120, isRecurring: true };
    const [c] = continuationsFromPreviousDay([occurrence]);
    expect(c.task.id).toBe('recurring-s1-2026-11-03');
    expect(c.minutes).toBe(30);
  });

  it('tolerates an absent list', () => {
    expect(continuationsFromPreviousDay(null)).toEqual([]);
    expect(continuationsFromPreviousDay(undefined)).toEqual([]);
  });
});

describe('taskEnd / hasTaskEnded: overdue by the real end', () => {
  it('a 23:00-01:00 task ends at 01:00 the next date', () => {
    expect(taskEnd(T())).toEqual({ date: WED, minutes: 60 });
  });

  it('a block ending at 24:00 ends at 00:00 of the next date', () => {
    expect(taskEnd(T({ duration: 60 }))).toEqual({ date: WED, minutes: 0 });
  });

  it('is not over at 00:30 the next day, and is at 01:00 and after', () => {
    expect(hasTaskEnded(T(), { todayStr: WED, nowMinutes: 30 })).toBe(false);
    expect(hasTaskEnded(T(), { todayStr: WED, nowMinutes: 60 })).toBe(true);
    expect(hasTaskEnded(T(), { todayStr: WED, nowMinutes: 61 })).toBe(true);
    expect(hasTaskEnded(T(), { todayStr: TUE, nowMinutes: 23 * 60 + 59 })).toBe(false);
  });

  it('a same-day block is over at its end, and every block of an earlier date is over', () => {
    const morning = T({ startTime: '09:00', duration: 60 });
    expect(hasTaskEnded(morning, { todayStr: TUE, nowMinutes: 9 * 60 + 59 })).toBe(false);
    expect(hasTaskEnded(morning, { todayStr: TUE, nowMinutes: 10 * 60 })).toBe(true);
    expect(hasTaskEnded(morning, { todayStr: WED, nowMinutes: 0 })).toBe(true);
  });

  it('a missing duration counts 30 minutes; an all-day row is over once its date is past', () => {
    expect(taskEnd(T({ startTime: '23:45', duration: undefined }))).toEqual({ date: WED, minutes: 15 });
    expect(hasTaskEnded(T({ isAllDay: true }), { todayStr: TUE, nowMinutes: 1439 })).toBe(false);
    expect(hasTaskEnded(T({ isAllDay: true }), { todayStr: WED, nowMinutes: 0 })).toBe(true);
    expect(taskEnd(T({ isAllDay: true }))).toBeNull();
  });

  it('crosses month and year boundaries by calendar arithmetic', () => {
    expect(taskEnd(T({ date: '2026-12-31' }))).toEqual({ date: '2027-01-01', minutes: 60 });
  });
});

describe('nowAndNext: what runs now and what is next, across midnight', () => {
  // The owner's scenario: a 23:00 task of two hours, looked at from the next
  // date. The next date's own first task is at 09:00.
  const night = T({ id: 'night', title: 'Two-Hour Task' });
  const morning = { id: 'm', date: WED, startTime: '09:00', duration: 30 };

  it('at 00:08 the night before’s task is running, as its piece from 00:00', () => {
    const { current, next, ahead } = nowAndNext([morning], [night], 8);
    expect(current.task).toBe(night);
    expect(current).toMatchObject({ startMinutes: 0, endMinutes: 60, startTime: '00:00', duration: 60 });
    expect(current.continuation).toMatchObject({ fromDate: TUE, minutes: 60 });
    expect(next.task).toBe(morning);
    expect(ahead.map((b) => b.task.id)).toEqual(['night', 'm']);
  });

  it('at 01:30 it is over: nothing runs, and the next is the date’s own first task', () => {
    const { current, next, ahead } = nowAndNext([morning], [night], 90);
    expect(current).toBeNull();
    expect(next.task).toBe(morning);
    expect(ahead.map((b) => b.task.id)).toEqual(['m']);
  });

  it('is over exactly at its end, 01:00', () => {
    expect(nowAndNext([], [night], 59).current?.task).toBe(night);
    expect(nowAndNext([], [night], 60).current).toBeNull();
  });

  it('only the after-midnight piece counts: the previous date’s other rows are not on this clock', () => {
    const { blocks } = nowAndNext([], [T({ id: 'evening', startTime: '20:00', duration: 60 }), T({ id: 'at-24', duration: 60 })], 10);
    expect(blocks).toEqual([]);
  });

  it('a date’s own row is judged by its own start and duration, past 24:00 included', () => {
    const late = { id: 'late', date: TUE, startTime: '23:00', duration: 120 };
    const { current } = nowAndNext([late], [], 23 * 60 + 30);
    expect(current).toMatchObject({ task: late, startMinutes: 1380, endMinutes: 1500, startTime: '23:00', duration: 120, continuation: null });
  });

  it('a piece comes before an own row starting at 00:00, and wins "current"', () => {
    const midnight = { id: 'mid', date: WED, startTime: '00:00', duration: 30 };
    const blocks = dayTimedBlocks([midnight], [night]);
    expect(blocks.map((b) => b.task.id)).toEqual(['night', 'mid']);
    expect(nowAndNext([midnight], [night], 5).current.task).toBe(night);
  });

  it('leaves out all-day rows and unreadable starts; a missing duration takes defaultDuration', () => {
    const rows = [
      { id: 'allday', date: WED, isAllDay: true, startTime: '09:00', duration: 60 },
      { id: 'bad', date: WED, startTime: 'soon', duration: 30 },
      { id: 'point', date: WED, startTime: '10:00' },
    ];
    expect(dayTimedBlocks(rows, []).map((b) => [b.task.id, b.endMinutes])).toEqual([['point', 600]]);
    expect(dayTimedBlocks(rows, [], { defaultDuration: 30 }).map((b) => [b.task.id, b.endMinutes])).toEqual([['point', 630]]);
  });

  it('a zero-length block is ahead until its start has passed, and never running', () => {
    const point = { id: 'p', date: WED, startTime: '10:00', duration: 0 };
    expect(nowAndNext([point], [], 600)).toMatchObject({ current: null, ahead: [{ task: point }] });
    expect(nowAndNext([point], [], 601).ahead).toEqual([]);
  });

  it('tolerates absent lists', () => {
    expect(nowAndNext(null, undefined, 0)).toEqual({ blocks: [], current: null, next: null, ahead: [] });
  });
});

describe('occupancy counts the previous night’s spill as busy', () => {
  const frame = { start: '00:00', end: '03:00', bufferMinutes: 0 };

  it('continuationIntervals: [00:00, spill) named after the task', () => {
    expect(continuationIntervals([T()])).toEqual([{ start: 0, end: 60, label: 'Night shift', id: 't1', continuesFrom: TUE }]);
    expect(continuationIntervals([T()], { excludeId: 't1' })).toEqual([]);
  });

  it('computeOccupiedIntervals folds the spill in beside the day’s own rows', () => {
    const intervals = computeOccupiedIntervals({}, WED, { tasks: [T({ id: 'w', date: WED, startTime: '02:00', duration: 30 })], prevDayTasks: [T()] });
    expect(intervals.map((i) => [i.start, i.end, i.id])).toEqual([[0, 60, 't1'], [120, 150, 'w']]);
  });

  it('a frame from midnight is not free while last night’s task runs', () => {
    const slots = computeAvailableSlots(frame, { tasks: [], prevDayTasks: [T()], dateStr: WED, todayStr: TUE, nowMinutes: 0 });
    expect(slots).toEqual([{ start: '01:00', end: '03:00', minutes: 120 }]);
  });

  it('without the previous date the same frame is wholly free (the guard is the prevDayTasks input)', () => {
    const slots = computeAvailableSlots(frame, { tasks: [], dateStr: WED, todayStr: TUE, nowMinutes: 0 });
    expect(slots).toEqual([{ start: '00:00', end: '03:00', minutes: 180 }]);
  });

  it('a block ending exactly at midnight leaves the next date free', () => {
    const slots = computeAvailableSlots(frame, { tasks: [], prevDayTasks: [T({ duration: 60 })], dateStr: WED, todayStr: TUE, nowMinutes: 0 });
    expect(slots).toEqual([{ start: '00:00', end: '03:00', minutes: 180 }]);
  });

  it('the drop resolver slides past an imported overnight event, and never past the task being moved', () => {
    const imported = T({ id: 'ev', imported: true });
    expect(adjustPastConflicts({}, WED, { startTime: '00:30', duration: 30, prevDayTasks: [imported] }))
      .toMatchObject({ conflicted: true, adjustedStartTime: '01:00' });
    expect(adjustPastConflicts({}, WED, { startTime: '00:30', duration: 30, prevDayTasks: [imported], excludeId: 'ev' }))
      .toMatchObject({ conflicted: false, adjustedStartTime: '00:30' });
  });
});
