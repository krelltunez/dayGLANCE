import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ROUTINE_ID_PREFIX,
  routineBlockId,
  parseRoutineBlockId,
  toRoutineBlock,
  buildRoutineBlocks,
} from './mcpRoutines.js';
import { buildDayBlocks, buildWeek } from './mcpReadModel.js';

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

describe('routine block ids', () => {
  it('namespaces the id so it cannot collide with a task id', () => {
    expect(routineBlockId('r1')).toBe('routine-r1');
    expect(routineBlockId('r1').startsWith(ROUTINE_ID_PREFIX)).toBe(true);
  });

  it('round-trips through parseRoutineBlockId', () => {
    expect(parseRoutineBlockId(routineBlockId('abc-def-123'))).toBe('abc-def-123');
  });

  it('returns null for anything that is not a routine block id', () => {
    expect(parseRoutineBlockId('task-1')).toBeNull();
    expect(parseRoutineBlockId('recurring-5-2026-09-19')).toBeNull();
    expect(parseRoutineBlockId('routine-')).toBeNull(); // prefix with no id
    expect(parseRoutineBlockId(undefined)).toBeNull();
    expect(parseRoutineBlockId(42)).toBeNull();
  });
});

describe('toRoutineBlock', () => {
  it('reads the title from `name`, not `title`', () => {
    // The whole reason this module exists: a routine has no `title`, so the
    // task-shaped toBlock would emit ''.
    expect(toRoutineBlock(R(), TODAY, false).title).toBe('Morning pages');
  });

  it('carries the occupied span and the read-only flag', () => {
    expect(toRoutineBlock(R(), TODAY, false)).toEqual({
      id: 'routine-r1',
      type: 'routine',
      title: 'Morning pages',
      date: TODAY,
      start_time: '07:00',
      duration_minutes: 15,
      all_day: false,
      completed: false,
      read_only: true,
    });
  });

  it('reports completion from the external map, never from the row', () => {
    expect(toRoutineBlock(R(), TODAY, true).completed).toBe(true);
    // A stray `completed` on the row must not be believed: completion lives
    // in routineCompletions and nowhere else.
    expect(toRoutineBlock(R({ completed: true }), TODAY, undefined).completed).toBe(false);
  });

  it('reports no span for an unplaced routine rather than the placeholder 15', () => {
    const block = toRoutineBlock(R({ startTime: null, isAllDay: true }), TODAY, false);
    expect(block.all_day).toBe(true);
    expect(block.start_time).toBeNull();
    // handleRoutinesDone stores duration: 15 as a seed for a later drag.
    // Echoing it would invent fifteen minutes of occupied time.
    expect(block.duration_minutes).toBeNull();
  });

  it('treats a missing startTime as all-day even when isAllDay says otherwise', () => {
    const block = toRoutineBlock(R({ startTime: null, isAllDay: false }), TODAY, false);
    expect(block.all_day).toBe(true);
    expect(block.start_time).toBeNull();
  });
});

describe('buildRoutineBlocks: the date guard', () => {
  it('reports routines for today', () => {
    const blocks = buildRoutineBlocks(withRoutines([R()]), TODAY);
    expect(blocks.map((b) => b.id)).toEqual(['routine-r1']);
  });

  it('reports nothing when routines are disabled', () => {
    expect(buildRoutineBlocks(withRoutines([R()], { routinesEnabled: false }), TODAY)).toEqual([]);
  });

  it('reports nothing for a date that is not today', () => {
    expect(buildRoutineBlocks(withRoutines([R()]), '2026-09-18')).toEqual([]);
    expect(buildRoutineBlocks(withRoutines([R()]), '2026-09-20')).toEqual([]);
  });

  it('reports nothing when routinesDate is stale, for either date', () => {
    // The app sat open across midnight and the rollover effect has not run:
    // routinesDate still reads yesterday while the clock reads today.
    const stale = withRoutines([R()], { routinesDate: '2026-09-18', todayDate: TODAY });
    // Not under today: these are yesterday's routines.
    expect(buildRoutineBlocks(stale, TODAY)).toEqual([]);
    // And not under yesterday either: the rollover is about to erase them.
    expect(buildRoutineBlocks(stale, '2026-09-18')).toEqual([]);
  });

  it('tolerates missing slices rather than throwing', () => {
    expect(buildRoutineBlocks(undefined, TODAY)).toEqual([]);
    expect(buildRoutineBlocks({}, TODAY)).toEqual([]);
    expect(buildRoutineBlocks(withRoutines([R()]), undefined)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The leak this file exists to prevent.
// ---------------------------------------------------------------------------
describe('routine ownership is scoped BEFORE the bridge', () => {
  // Routines use single-owner ownerSyncId. Tasks use broadcast-with-filter
  // assignedUserSyncIds. isVisibleForUser understands only the second, so it
  // returns TRUE for every routine ever written, including other members'.
  // The renderer therefore passes the already-filtered todayRoutines memo.
  //
  // This is asserted directly rather than inferred from correct threading,
  // because a refactor that swaps the filtered memo for allTodayRoutines
  // leaves every other test in this repo green while quietly exposing one
  // user's routines to another.
  const mine = R({ id: 'mine', name: 'My routine', ownerSyncId: 'user-me' });
  const theirs = R({ id: 'theirs', name: 'Their routine', ownerSyncId: 'user-other', startTime: '09:00' });

  // The real App.jsx predicate, transcribed.
  const ownedBy = (item, syncId) => !item.ownerSyncId || item.ownerSyncId === syncId;
  const isVisibleForUser = (task) => {
    const assigned = task.assignedUserSyncIds ?? [];
    return assigned.length === 0 || assigned.includes('user-me');
  };

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

  it('pins App.jsx to the SCOPED memo, which is the only place the swap can happen', () => {
    // The mutation this guards: `routines: todayRoutines` becoming
    // `routines: allTodayRoutines` in the useMcpBridge call. That edit lives
    // in App.jsx wiring, which no unit test in this file can reach. Every
    // assertion below operates on a list someone already filtered. Without
    // this guard the swap ships with the whole suite green.
    const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
    const bridgeCall = app.slice(app.indexOf('useMcpBridge({'));
    const routinesArg = /\n\s*routines:\s*(\w+),/.exec(bridgeCall);
    expect(routinesArg).not.toBeNull();
    expect(routinesArg[1]).toBe('todayRoutines');
    expect(routinesArg[1]).not.toBe('allTodayRoutines');
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
