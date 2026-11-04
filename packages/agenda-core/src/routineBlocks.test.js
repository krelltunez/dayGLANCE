import { describe, it, expect } from 'vitest';
import {
  ROUTINE_ID_PREFIX,
  routineBlockId,
  parseRoutineBlockId,
  toRoutineBlock,
  buildRoutineBlocks,
} from './routineBlocks.js';

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
