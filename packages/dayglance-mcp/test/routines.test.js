// @vitest-environment node
// Routines on the read surface: owner scoping, and routine blocks among the
// day's other blocks. The block shape and the date guard are agenda-core's
// (packages/agenda-core/src/routineBlocks.test.js).
import { describe, it, expect } from 'vitest';
import { buildRoutineBlocks, isOwnedBy, isTaskVisibleForUser } from '@glance-apps/agenda-core';
import { buildDayBlocks, buildWeek } from '../src/readModel.js';

const TODAY = '2026-09-19';

const R = (over = {}) => ({
  id: 'r1', name: 'Morning pages', bucket: 'everyday',
  startTime: '07:00', duration: 15, isAllDay: false, ...over,
});

/** A state slice with routines live for TODAY. */
const withRoutines = (routines, over = {}) => ({
  routines,
  routinesDate: TODAY,
  routineCompletions: {},
  routinesEnabled: true,
  todayDate: TODAY,
  ...over,
});

// ---------------------------------------------------------------------------
// The leak this file exists to prevent.
// ---------------------------------------------------------------------------
describe('routine ownership is scoped BEFORE the read model', () => {
  // Routines use single-owner ownerSyncId. Tasks use broadcast-with-filter
  // assignedUserSyncIds. isVisibleForUser understands only the second, so it
  // returns TRUE for every routine ever written, including other members'.
  // buildMcpReadState therefore scopes routines by owner before the read
  // model sees them (readState.test.js pins that, for the app and a host).
  //
  // This is asserted directly rather than inferred from correct threading,
  // because a refactor that drops the scoping leaves every other test green
  // while quietly exposing one user's routines to another.
  const mine = R({ id: 'mine', name: 'My routine', ownerSyncId: 'user-me' });
  const theirs = R({ id: 'theirs', name: 'Their routine', ownerSyncId: 'user-other', startTime: '09:00' });

  // The real predicates, in multi-user mode as user-me.
  const ownedBy = (item, syncId) => isOwnedBy(item, true, 'user-me', syncId);
  const isVisibleForUser = (task) => isTaskVisibleForUser(task, true, 'user-me');

  it('does not surface a routine owned by another user', () => {
    const scoped = [mine, theirs].filter((r) => ownedBy(r, 'user-me'));
    const blocks = buildRoutineBlocks(withRoutines(scoped), TODAY);
    expect(blocks.map((b) => b.title)).toEqual(['My routine']);
    expect(blocks.map((b) => b.title)).not.toContain('Their routine');
  });

  it('proves isVisibleForUser cannot do this job', () => {
    // The mutation this test defends against: filtering routines with the
    // same predicate every other slice uses. It admits BOTH routines, so a
    // refactor that reaches for the familiar filter reintroduces the leak.
    expect([mine, theirs].filter(isVisibleForUser)).toHaveLength(2);
    // Whereas the ownership predicate keeps only mine.
    expect([mine, theirs].filter((r) => ownedBy(r, 'user-me'))).toHaveLength(1);
  });

  it('leaks another user\'s routine into get_day if the unscoped list is passed', () => {
    // Pinning the failure mode itself: this is what the bug LOOKS like, so a
    // reviewer reading a diff that swaps the memo can recognise it.
    const unscoped = buildDayBlocks(
      { tasks: [], recurringTasks: [], ...withRoutines([mine, theirs]) },
      { date: TODAY },
    );
    expect(unscoped.blocks.map((b) => b.title)).toContain('Their routine');

    const scoped = buildDayBlocks(
      { tasks: [], recurringTasks: [], ...withRoutines([mine, theirs].filter((r) => ownedBy(r, 'user-me'))) },
      { date: TODAY },
    );
    expect(scoped.blocks.map((b) => b.title)).not.toContain('Their routine');
  });
});

describe('buildDayBlocks with a third block type', () => {
  const T = (over = {}) => ({
    id: 't1', title: 'Deep work', date: TODAY, startTime: '08:00',
    duration: 60, completed: false, ...over,
  });

  it('reports a routine alongside tasks, typed distinctly', () => {
    const day = buildDayBlocks(
      { tasks: [T()], recurringTasks: [], ...withRoutines([R()]) },
      { date: TODAY },
    );
    expect(day.blocks.map((b) => [b.type, b.start_time])).toEqual([
      ['routine', '07:00'],
      ['task', '08:00'],
    ]);
  });

  it('never types a routine as a plain task', () => {
    const day = buildDayBlocks(
      { tasks: [], recurringTasks: [], ...withRoutines([R()]) },
      { date: TODAY },
    );
    // The silent-failure mode: falling through blockType to 'task' with an
    // empty title and a null date.
    expect(day.blocks[0].type).toBe('routine');
    expect(day.blocks[0].title).not.toBe('');
    expect(day.blocks[0].date).toBe(TODAY);
  });

  it('pins the interleave across all three types', () => {
    // The comparator is not a stable total order for equal start times, so
    // this fixes the observable ordering rather than leaving it to the engine.
    const day = buildDayBlocks(
      {
        tasks: [T({ id: 'am', startTime: '06:00' }), T({ id: 'pm', startTime: '13:00' })],
        recurringTasks: [{
          id: 'rec', title: 'Standup', startTime: '09:30', duration: 15,
          recurrence: { type: 'daily', startDate: '2026-01-01' },
        }],
        ...withRoutines([R({ startTime: '07:00' }), R({ id: 'r2', name: 'Wind down', startTime: '21:00' })]),
      },
      { date: TODAY },
    );
    expect(day.blocks.map((b) => `${b.start_time} ${b.type}`)).toEqual([
      '06:00 task',
      '07:00 routine',
      '09:30 recurring_task',
      '13:00 task',
      '21:00 routine',
    ]);
  });

  it('sorts an unplaced routine into the all-day group ahead of timed blocks', () => {
    const day = buildDayBlocks(
      {
        tasks: [T()],
        recurringTasks: [],
        ...withRoutines([R({ id: 'r9', name: 'Unplaced', startTime: null, isAllDay: true })]),
      },
      { date: TODAY },
    );
    expect(day.blocks.map((b) => b.type)).toEqual(['routine', 'task']);
    expect(day.blocks[0].all_day).toBe(true);
  });

  it('does not gate routines behind the device-calendar consent tier', () => {
    // Routines are dayGLANCE data, so they ride the base read tier: absent
    // include_native they must still appear.
    const day = buildDayBlocks(
      { tasks: [], recurringTasks: [], ...withRoutines([R()]) },
      { date: TODAY, include_native: false },
    );
    expect(day.blocks.map((b) => b.type)).toEqual(['routine']);
  });
});

describe('buildWeek', () => {
  it('carries routines on exactly the one day that can have them', () => {
    const week = buildWeek(
      { tasks: [], recurringTasks: [], weekStartDay: 0, ...withRoutines([R()]) },
      { date: TODAY },
    );
    const withAny = week.days.filter((d) => d.blocks.some((b) => b.type === 'routine'));
    expect(withAny).toHaveLength(1);
    expect(withAny[0].date).toBe(TODAY);
  });
});
