import { describe, it, expect } from 'vitest';
import {
  timeToMinutes,
  minutesToTime,
  taskInterval,
  routineIntervals,
  computeOccupiedIntervals,
  mergeIntervals,
  computeAvailableSlots,
  availableMinutes,
  adjustPastConflicts,
  obstacleName,
  describeObstacle,
} from './dayOccupancy.js';

const TODAY = '2026-09-19';
const YESTERDAY = '2026-09-18';
const TOMORROW = '2026-09-20';

const T = (over = {}) => ({
  id: 't1', title: 'Task', startTime: '09:00', duration: 60, isAllDay: false, ...over,
});

const R = (over = {}) => ({
  id: 'r1', name: 'Morning pages', startTime: '07:00', duration: 15, isAllDay: false, ...over,
});

const routineState = (routines, over = {}) => ({
  routines, routinesDate: TODAY, routineCompletions: {}, routinesEnabled: true, todayDate: TODAY, ...over,
});

const FRAME = (over = {}) => ({ start: '09:00', end: '12:00', bufferMinutes: 0, ...over });

// ---------------------------------------------------------------------------
// CHARACTERIZATION: the original algorithm, transcribed verbatim from
// App.jsx:6964 before extraction, minus the two injections. Any divergence
// from it must be one of the two documented changes and nothing else.
// ---------------------------------------------------------------------------
function legacyComputeAvailableSlots(frameInstance, timedTasks, dateStr, todayStr, nowMinutes) {
  const frameStartMin = timeToMinutes(frameInstance.start);
  const frameEndMin = timeToMinutes(frameInstance.end);
  const buffer = frameInstance.bufferMinutes || 0;

  let nowFloor = frameStartMin;
  if (dateStr === todayStr) nowFloor = nowMinutes;
  else if (dateStr < todayStr) nowFloor = frameEndMin;

  const occupied = [];
  for (const task of timedTasks) {
    const tStart = timeToMinutes(task.startTime);
    const tEnd = tStart + (task.duration || 30);
    if (tEnd > frameStartMin && tStart < frameEndMin) {
      occupied.push({ start: Math.max(tStart, frameStartMin), end: Math.min(tEnd, frameEndMin) });
    }
  }
  occupied.sort((a, b) => a.start - b.start);

  const merged = [];
  for (const o of occupied) {
    if (merged.length > 0 && o.start <= merged[merged.length - 1].end + buffer) {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, o.end);
    } else {
      merged.push({ ...o });
    }
  }

  const slots = [];
  let cursor = frameStartMin;
  for (const m of merged) {
    const gapStart = cursor + (cursor === frameStartMin ? 0 : buffer);
    const gapEnd = m.start - buffer;
    const clippedStart = Math.max(gapStart, nowFloor);
    if (gapEnd > clippedStart) {
      slots.push({ start: minutesToTime(clippedStart), end: minutesToTime(gapEnd), minutes: gapEnd - clippedStart });
    }
    cursor = m.end;
  }
  const finalStart = Math.max(cursor + (cursor === frameStartMin ? 0 : buffer), nowFloor);
  if (finalStart < frameEndMin) {
    slots.push({ start: minutesToTime(finalStart), end: minutesToTime(frameEndMin), minutes: frameEndMin - finalStart });
  }
  return slots;
}

describe('extraction is faithful: differential against the pre-extraction algorithm', () => {
  // No routines anywhere in this block, so the new function must agree with
  // the old one exactly. Disagreement means the extraction changed something
  // it was not supposed to.
  const noRoutines = routineState([], { routinesEnabled: false });

  const cases = [
    ['empty day', FRAME(), []],
    ['one task mid-frame', FRAME(), [T({ startTime: '10:00', duration: 60 })]],
    ['task filling the frame', FRAME(), [T({ startTime: '09:00', duration: 180 })]],
    ['task starting before the frame', FRAME(), [T({ startTime: '08:00', duration: 120 })]],
    ['task ending after the frame', FRAME(), [T({ startTime: '11:00', duration: 180 })]],
    ['task entirely outside', FRAME(), [T({ startTime: '14:00', duration: 60 })]],
    ['two adjacent tasks', FRAME(), [T({ id: 'a', startTime: '09:00', duration: 60 }), T({ id: 'b', startTime: '10:00', duration: 60 })]],
    ['two overlapping tasks', FRAME(), [T({ id: 'a', startTime: '09:30', duration: 90 }), T({ id: 'b', startTime: '10:00', duration: 60 })]],
    ['two tasks with a gap', FRAME(), [T({ id: 'a', startTime: '09:00', duration: 30 }), T({ id: 'b', startTime: '11:00', duration: 30 })]],
    ['out-of-order input', FRAME(), [T({ id: 'b', startTime: '11:00', duration: 30 }), T({ id: 'a', startTime: '09:00', duration: 30 })]],
    ['buffer 5, small gap swallowed', FRAME({ bufferMinutes: 5 }), [T({ id: 'a', startTime: '09:00', duration: 30 }), T({ id: 'b', startTime: '09:33', duration: 30 })]],
    ['buffer 15, wide gap survives', FRAME({ bufferMinutes: 15 }), [T({ id: 'a', startTime: '09:00', duration: 30 }), T({ id: 'b', startTime: '11:00', duration: 30 })]],
    ['missing duration defaults to 30', FRAME(), [T({ startTime: '10:00', duration: undefined })]],
    ['three stacked tasks', FRAME(), [
      T({ id: 'a', startTime: '09:00', duration: 30 }),
      T({ id: 'b', startTime: '09:15', duration: 30 }),
      T({ id: 'c', startTime: '10:30', duration: 30 }),
    ]],
  ];

  for (const [name, frame, tasks] of cases) {
    for (const [label, dateStr, nowMinutes] of [
      ['future date', TOMORROW, 0],
      ['past date', YESTERDAY, 0],
      ['today, before the frame', TODAY, 8 * 60],
      ['today, mid-frame', TODAY, 10 * 60 + 20],
      ['today, after the frame', TODAY, 23 * 60],
    ]) {
      it(`${name} / ${label}`, () => {
        const mine = computeAvailableSlots(frame, { state: noRoutines, tasks, dateStr, todayStr: TODAY, nowMinutes });
        const legacy = legacyComputeAvailableSlots(frame, tasks, dateStr, TODAY, nowMinutes);
        expect(mine).toEqual(legacy);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// THE BUG THIS PR CLOSES.
// ---------------------------------------------------------------------------
describe('routines occupy frame time', () => {
  const frame = FRAME({ start: '07:00', end: '09:00' });

  it('the pre-extraction algorithm reports a routine slot as free', () => {
    // Pinning the old behaviour so the fix below is unambiguous: the legacy
    // function never saw routines at all, so it reports the whole frame free.
    const legacy = legacyComputeAvailableSlots(frame, [], TODAY, TODAY, 0);
    expect(legacy).toEqual([{ start: '07:00', end: '09:00', minutes: 120 }]);
  });

  it('subtracts a routine from the frame', () => {
    const slots = computeAvailableSlots(frame, {
      state: routineState([R({ startTime: '07:00', duration: 15 })]),
      tasks: [], dateStr: TODAY, todayStr: TODAY, nowMinutes: 0,
    });
    expect(slots).toEqual([{ start: '07:15', end: '09:00', minutes: 105 }]);
  });

  it('splits a frame around a routine in the middle', () => {
    const slots = computeAvailableSlots(frame, {
      state: routineState([R({ startTime: '08:00', duration: 30 })]),
      tasks: [], dateStr: TODAY, todayStr: TODAY, nowMinutes: 0,
    });
    expect(slots).toEqual([
      { start: '07:00', end: '08:00', minutes: 60 },
      { start: '08:30', end: '09:00', minutes: 30 },
    ]);
  });

  it('merges a routine with an abutting task', () => {
    const slots = computeAvailableSlots(frame, {
      state: routineState([R({ startTime: '07:00', duration: 30 })]),
      tasks: [T({ startTime: '07:30', duration: 30 })],
      dateStr: TODAY, todayStr: TODAY, nowMinutes: 0,
    });
    expect(slots).toEqual([{ start: '08:00', end: '09:00', minutes: 60 }]);
  });

  it('reports a frame fully covered by routines as having no free time', () => {
    expect(availableMinutes(frame, {
      state: routineState([R({ startTime: '07:00', duration: 120 })]),
      tasks: [], dateStr: TODAY, todayStr: TODAY, nowMinutes: 0,
    })).toBe(0);
  });

  it('ignores routines when the feature is off', () => {
    const slots = computeAvailableSlots(frame, {
      state: routineState([R({ startTime: '07:00', duration: 15 })], { routinesEnabled: false }),
      tasks: [], dateStr: TODAY, todayStr: TODAY, nowMinutes: 0,
    });
    expect(slots).toEqual([{ start: '07:00', end: '09:00', minutes: 120 }]);
  });

  it('does not subtract routines from a date that is not today', () => {
    // Routines exist for one date only; the guard lives in buildRoutineBlocks.
    const slots = computeAvailableSlots(frame, {
      state: routineState([R({ startTime: '07:00', duration: 15 })]),
      tasks: [], dateStr: TOMORROW, todayStr: TODAY, nowMinutes: 0,
    });
    expect(slots).toEqual([{ start: '07:00', end: '09:00', minutes: 120 }]);
  });

  it('ignores an unplaced routine, which occupies nothing', () => {
    const slots = computeAvailableSlots(frame, {
      state: routineState([R({ startTime: null, isAllDay: true })]),
      tasks: [], dateStr: TODAY, todayStr: TODAY, nowMinutes: 0,
    });
    expect(slots).toEqual([{ start: '07:00', end: '09:00', minutes: 120 }]);
  });
});

describe('computeOccupiedIntervals', () => {
  it('folds routines in alongside the caller\'s tasks, sorted', () => {
    const intervals = computeOccupiedIntervals(
      routineState([R({ startTime: '07:00', duration: 15 })]),
      TODAY,
      { tasks: [T({ startTime: '09:00', duration: 60 })] },
    );
    expect(intervals.map((i) => [i.start, i.end])).toEqual([[420, 435], [540, 600]]);
  });

  it('honours excludeId for tasks', () => {
    const intervals = computeOccupiedIntervals(routineState([]), TODAY, {
      tasks: [T({ id: 'keep', startTime: '09:00' }), T({ id: 'drop', startTime: '10:00' })],
      excludeId: 'drop',
    });
    expect(intervals.map((i) => i.id)).toEqual(['keep']);
  });

  it('never lets excludeId drop a routine', () => {
    // A routine is not the thing being dragged, so its id can never be the
    // exclusion. Passing one must not punch a hole in occupancy.
    const intervals = computeOccupiedIntervals(
      routineState([R({ startTime: '07:00', duration: 15 })]),
      TODAY,
      { tasks: [], excludeId: 'routine-r1' },
    );
    expect(intervals).toHaveLength(1);
  });

  it('skips all-day and untimed rows', () => {
    const intervals = computeOccupiedIntervals(routineState([]), TODAY, {
      tasks: [T({ id: 'a', isAllDay: true }), T({ id: 'b', startTime: null }), T({ id: 'c', startTime: 'garbage' })],
    });
    expect(intervals).toEqual([]);
  });
});

describe('mergeIntervals', () => {
  it('merges overlaps and is order-independent', () => {
    const a = mergeIntervals([{ start: 0, end: 30 }, { start: 20, end: 50 }]);
    const b = mergeIntervals([{ start: 20, end: 50 }, { start: 0, end: 30 }]);
    expect(a).toEqual(b);
    expect(a.map((i) => [i.start, i.end])).toEqual([[0, 50]]);
  });

  it('treats a sub-buffer gap as contiguous', () => {
    expect(mergeIntervals([{ start: 0, end: 30 }, { start: 33, end: 60 }], 5).map((i) => [i.start, i.end]))
      .toEqual([[0, 60]]);
  });

  it('keeps a gap wider than the buffer', () => {
    expect(mergeIntervals([{ start: 0, end: 30 }, { start: 40, end: 60 }], 5)).toHaveLength(2);
  });

  it('does not mutate its input', () => {
    const input = [{ start: 0, end: 30 }, { start: 20, end: 50 }];
    const snapshot = JSON.parse(JSON.stringify(input));
    mergeIntervals(input);
    expect(input).toEqual(snapshot);
  });
});

describe('adjustPastConflicts', () => {
  const imported = (over = {}) => T({ imported: true, ...over });

  it('leaves a clear placement alone', () => {
    const r = adjustPastConflicts(routineState([]), TODAY, {
      startTime: '14:00', duration: 30, tasks: [imported({ startTime: '09:00' })],
    });
    expect(r).toEqual({ conflicted: false, adjustedStartTime: '14:00', conflictingEvent: null });
  });

  it('slides past an imported event', () => {
    const r = adjustPastConflicts(routineState([]), TODAY, {
      startTime: '09:30', duration: 30, tasks: [imported({ startTime: '09:00', duration: 60 })],
    });
    expect(r.conflicted).toBe(true);
    expect(r.adjustedStartTime).toBe('10:00');
  });

  it('slides past a routine, and names it', () => {
    const r = adjustPastConflicts(routineState([R({ startTime: '07:00', duration: 15 })]), TODAY, {
      startTime: '07:00', duration: 30, tasks: [],
    });
    expect(r.conflicted).toBe(true);
    expect(r.adjustedStartTime).toBe('07:15');
    expect(r.conflictingEvent.label).toBe('Morning pages');
  });

  it('slides past a chain of back-to-back obstacles', () => {
    const r = adjustPastConflicts(routineState([R({ startTime: '09:00', duration: 30 })]), TODAY, {
      startTime: '09:00',
      duration: 30,
      tasks: [imported({ id: 'x', startTime: '09:30', duration: 30 }), imported({ id: 'y', startTime: '10:00', duration: 30 })],
    });
    expect(r.adjustedStartTime).toBe('10:30');
  });

  it('caps at the end of the day rather than spilling past midnight', () => {
    const r = adjustPastConflicts(routineState([]), TODAY, {
      startTime: '23:30', duration: 60, tasks: [imported({ startTime: '23:00', duration: 120 })],
    });
    expect(timeToMinutes(r.adjustedStartTime) + 60).toBeLessThanOrEqual(24 * 60);
  });

  it('terminates on a pathological obstacle set', () => {
    const tasks = Array.from({ length: 200 }, (_, i) => imported({ id: `x${i}`, startTime: '09:00', duration: 30 }));
    const r = adjustPastConflicts(routineState([]), TODAY, { startTime: '09:00', duration: 30, tasks, maxIterations: 5 });
    expect(typeof r.adjustedStartTime).toBe('string');
  });
});

describe('time helpers', () => {
  it('round-trips', () => {
    for (const m of [0, 1, 59, 60, 545, 1439]) expect(timeToMinutes(minutesToTime(m))).toBe(m);
  });

  it('returns null for unparseable input rather than NaN', () => {
    // NaN propagates silently through interval arithmetic and produces slots
    // that look plausible; null is caught at the boundary.
    for (const bad of ['', '9:5', 'noon', undefined, null, '1230']) expect(timeToMinutes(bad)).toBeNull();
  });
});

describe('frame edge cases', () => {
  it('returns no slots for a zero-length or inverted frame', () => {
    const opts = { state: routineState([]), tasks: [], dateStr: TODAY, todayStr: TODAY, nowMinutes: 0 };
    expect(computeAvailableSlots(FRAME({ start: '09:00', end: '09:00' }), opts)).toEqual([]);
    expect(computeAvailableSlots(FRAME({ start: '12:00', end: '09:00' }), opts)).toEqual([]);
  });

  it('returns no slots for an unparseable frame rather than throwing', () => {
    const opts = { state: routineState([]), tasks: [], dateStr: TODAY, todayStr: TODAY, nowMinutes: 0 };
    expect(computeAvailableSlots(FRAME({ start: 'x' }), opts)).toEqual([]);
    expect(computeAvailableSlots(undefined, opts)).toEqual([]);
  });

  it('reports a past date as fully elapsed', () => {
    expect(availableMinutes(FRAME(), {
      state: routineState([]), tasks: [], dateStr: YESTERDAY, todayStr: TODAY, nowMinutes: 0,
    })).toBe(0);
  });
});

describe('taskInterval', () => {
  it('defaults a missing duration to 30, matching the original', () => {
    expect(taskInterval(T({ startTime: '09:00', duration: undefined }))).toMatchObject({ start: 540, end: 570 });
  });

  it('returns null rather than a zero-length interval for all-day rows', () => {
    expect(taskInterval(T({ isAllDay: true }))).toBeNull();
  });
});

describe('routineIntervals', () => {
  it('skips all-day routines, which have no span', () => {
    expect(routineIntervals(routineState([R({ startTime: null, isAllDay: true })]), TODAY)).toEqual([]);
  });

  it('carries the routine name as the label for conflict reporting', () => {
    expect(routineIntervals(routineState([R()]), TODAY)[0]).toMatchObject({ label: 'Morning pages', id: 'routine-r1' });
  });
});

describe('obstacleName and describeObstacle', () => {
  const slide = (state, tasks) => adjustPastConflicts(state, TODAY, { startTime: '09:00', duration: 30, tasks }).conflictingEvent;

  it('names an imported event the placement hit', () => {
    const hit = slide(routineState([]), [T({ imported: true, title: 'Standup' })]);
    expect(obstacleName(hit)).toBe('Standup');
    expect(describeObstacle(hit)).toBe('"Standup"');
  });
  it('names a routine the placement hit', () => {
    const hit = slide(routineState([R({ startTime: '09:00', duration: 15 })]), []);
    expect(obstacleName(hit)).toBe('Morning pages');
  });
  it('falls back to a generic phrase for an untitled event, never "undefined"', () => {
    const hit = slide(routineState([]), [T({ imported: true, title: '  ' })]);
    expect(obstacleName(hit)).toBeNull();
    expect(describeObstacle(hit)).toBe('a calendar event');
    expect(describeObstacle(null)).toBe('a calendar event');
  });
});
