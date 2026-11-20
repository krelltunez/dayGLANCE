// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { blockEnd } from '../src/blockEnd.js';
import { buildDayBlocks, toBlock } from '../src/readModel.js';

// #2429: a block states its own planned end, which may be on the next date,
// and which is not when the task was completed.

const MON = '2026-08-10';
const TUE = '2026-08-11';

const T = (over = {}) => ({
  id: 'id-1', title: 'Task', date: MON, startTime: '09:00',
  duration: 60, completed: false, isAllDay: false, ...over,
});

describe('blockEnd', () => {
  const at = (start_time, duration_minutes, extra = {}) =>
    blockEnd({ date: MON, start_time, duration_minutes, all_day: false, ...extra });

  it('adds the duration to the start on the same date', () => {
    expect(at('15:32', 65)).toEqual({ end_date: MON, end_time: '16:37' });
    expect(at('09:00', 0)).toEqual({ end_date: MON, end_time: '09:00' });
  });

  it('carries the end onto the next date past midnight, and exactly at midnight', () => {
    expect(at('23:00', 120)).toEqual({ end_date: TUE, end_time: '01:00' });
    expect(at('22:00', 120)).toEqual({ end_date: TUE, end_time: '00:00' });
    expect(at('00:00', 1440)).toEqual({ end_date: TUE, end_time: '00:00' });
  });

  it('is null for a block with no span', () => {
    const none = { end_date: null, end_time: null };
    expect(at(null, null, { all_day: true })).toEqual(none);
    expect(at('09:00', 60, { all_day: true })).toEqual(none);
    expect(at(null, 60)).toEqual(none);
    expect(at('09:00', null)).toEqual(none);
    expect(blockEnd({ date: null, start_time: '09:00', duration_minutes: 60, all_day: false })).toEqual(none);
  });
});

describe('blocks carry end_date and end_time', () => {
  it('a task completed late still ends where it was planned; completed_at is separate', () => {
    const block = toBlock(T({ startTime: '15:32', duration: 65, completed: true, completedAt: `${MON}T16:51:00` }));
    expect(block).toMatchObject({ start_time: '15:32', duration_minutes: 65, end_date: MON, end_time: '16:37' });
    expect(block.completed_at).not.toBeNull();
  });

  it('an all-day block has none', () => {
    expect(toBlock(T({ isAllDay: true }))).toMatchObject({ end_date: null, end_time: null });
  });

  it('a task crossing midnight ends on the next date, and its continuation ends at the same moment', () => {
    const state = { tasks: [T({ id: 'night', startTime: '23:00', duration: 120 })], recurringTasks: [] };
    const start = buildDayBlocks(state, { date: MON }).blocks.find((b) => b.id === 'night');
    const cont = buildDayBlocks(state, { date: TUE }).blocks.find((b) => b.id === 'night');
    expect(start).toMatchObject({ date: MON, end_date: TUE, end_time: '01:00' });
    expect(cont).toMatchObject({ date: TUE, start_time: '00:00', duration_minutes: 60, end_date: TUE, end_time: '01:00' });
  });

  it('a routine block has them too', () => {
    const state = {
      tasks: [], recurringTasks: [], frames: [],
      routines: [{ id: 'r1', name: 'Morning pages', startTime: '09:30', duration: 30, isAllDay: false }],
      routinesDate: MON, routineCompletions: {}, routinesEnabled: true, todayDate: MON,
    };
    const routine = buildDayBlocks(state, { date: MON }).blocks.find((b) => b.type === 'routine');
    expect(routine).toMatchObject({ start_time: '09:30', end_date: MON, end_time: '10:00' });
  });
});
