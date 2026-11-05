// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildDayBlocks, continuationBlock } from '../src/readModel.js';
import { buildFrames } from '../src/frames.js';

// #2278: a task that runs past midnight belongs to the date it starts on. The
// next date reports the part after midnight as a block marked as such, so a
// client does not take 00:00 to its end as free, and the frames there count
// it as busy.

const T = (over = {}) => ({
  id: 'id-1', title: 'Task', date: '2026-08-10', startTime: '09:00',
  duration: 60, completed: false, isAllDay: false, ...over,
});

const MON = '2026-08-10';
const TUE = '2026-08-11';
const WED = '2026-08-12';

describe('get_day: a task crossing midnight', () => {
  const state = {
    tasks: [
      T({ id: 'night', title: 'Night shift', date: MON, startTime: '23:00', duration: 120 }),
      T({ id: 'tue', date: TUE, startTime: '00:30', duration: 30 }),
      T({ id: 'to-midnight', date: MON, startTime: '22:00', duration: 120 }),
      T({ id: 'native-night', date: MON, _native: true, imported: true, startTime: '23:30', duration: 60 }),
    ],
    recurringTasks: [{
      id: 'r1', title: 'Backup', startTime: '23:45', duration: 30,
      recurrence: { type: 'daily', startDate: '2026-01-01' },
      exceptions: { [MON]: { startTime: '23:30', duration: 90 } },
    }],
  };

  it('the start date lists the task once, with its full duration, unchanged', () => {
    const { blocks } = buildDayBlocks(state, { date: MON });
    const night = blocks.find((b) => b.id === 'night');
    expect(night).toMatchObject({ date: MON, start_time: '23:00', duration_minutes: 120 });
    expect('continues_from' in night).toBe(false);
  });

  it('the next date carries the continuation: same id, 00:00, the spill, continues_from the start date', () => {
    const { blocks } = buildDayBlocks(state, { date: TUE });
    expect(blocks.find((b) => b.id === 'night')).toMatchObject({
      id: 'night', type: 'task', title: 'Night shift', date: TUE,
      start_time: '00:00', duration_minutes: 60, continues_from: MON, completed: false,
    });
    expect(blocks.filter((b) => b.id === 'night')).toHaveLength(1);
    // Continuations lead the date's timed blocks, which keep their order.
    expect(blocks.map((b) => b.id)).toEqual(['night', `recurring-r1-${MON}`, 'tue', `recurring-r1-${TUE}`]);
  });

  it('a recurring occurrence carries with its own date\'s exception, under its own id', () => {
    expect(buildDayBlocks(state, { date: TUE }).blocks.find((b) => b.id === `recurring-r1-${MON}`)).toMatchObject({
      type: 'recurring_task', start_time: '00:00', duration_minutes: 60, continues_from: MON, series_id: 'r1',
    });
    // Tuesday's own occurrence (23:45, 30m) carries 15 minutes into Wednesday.
    expect(buildDayBlocks(state, { date: WED }).blocks.find((b) => b.id === `recurring-r1-${TUE}`))
      .toMatchObject({ start_time: '00:00', duration_minutes: 15, continues_from: TUE });
  });

  it('a task ending exactly at midnight carries nothing', () => {
    expect(buildDayBlocks(state, { date: TUE }).blocks.some((b) => b.id === 'to-midnight')).toBe(false);
  });

  it('a device event carries only under the calendar consent tier, as its own block does', () => {
    expect(buildDayBlocks(state, { date: TUE }).blocks.some((b) => b.id === 'native-night')).toBe(false);
    expect(buildDayBlocks(state, { date: TUE, include_native: true }).blocks.find((b) => b.id === 'native-night'))
      .toMatchObject({ type: 'device_calendar_event', read_only: true, continues_from: MON, duration_minutes: 30 });
  });

  it('honours the multi-user visibility predicate', () => {
    const scoped = { ...state, isVisibleForUser: (t) => t.id !== 'night' };
    expect(buildDayBlocks(scoped, { date: TUE }).blocks.some((b) => b.id === 'night')).toBe(false);
  });

  it('continuationBlock is the task\'s own block, moved', () => {
    const task = T({ id: 'x', date: MON, startTime: '23:00', duration: 90, notes: 'n' });
    expect(continuationBlock({ task, fromDate: MON, minutes: 30 }, TUE)).toMatchObject({
      id: 'x', type: 'task', date: TUE, start_time: '00:00', duration_minutes: 30, continues_from: MON, notes: 'n',
    });
  });
});

describe('frames: availability counts a task still running from the night before', () => {
  const F = { id: 'f1', label: 'Early', enabled: true, days: [2], start: '00:00', end: '03:00', bufferMinutes: 0 };
  const state = (tasks) => ({
    frames: [F], tasks, recurringTasks: [], routines: [], routinesDate: MON, routineCompletions: {},
    routinesEnabled: true, todayDate: MON, nowMinutes: 0,
  });

  it('the next date\'s frame is busy from midnight to the task\'s real end', () => {
    const [frame] = buildFrames(state([T({ id: 'night', date: MON, startTime: '23:00', duration: 120 })]), TUE);
    expect(frame.available_slots).toEqual([{ start: '01:00', end: '03:00', minutes: 120 }]);
    expect(frame.available_minutes).toBe(120);
  });

  it('a task ending exactly at midnight leaves it free', () => {
    expect(buildFrames(state([T({ date: MON, startTime: '23:00', duration: 60 })]), TUE)[0].available_minutes).toBe(180);
  });

  it('a device event from the night before counts only under the consent tier', () => {
    const s = state([T({ id: 'native-cal-x', date: MON, startTime: '23:00', duration: 120, _native: true, imported: true })]);
    expect(buildFrames(s, TUE)[0].available_minutes).toBe(180);
    expect(buildFrames(s, TUE, { includeNative: true })[0].available_minutes).toBe(120);
  });

  it('get_day carries both: the continuation block, and the frame net of it', () => {
    const day = buildDayBlocks(state([T({ id: 'night', date: MON, startTime: '23:00', duration: 120 })]), { date: TUE });
    expect(day.blocks.map((b) => [b.id, b.start_time, b.continues_from])).toEqual([['night', '00:00', MON]]);
    expect(day.frames[0].available_minutes).toBe(120);
  });
});
