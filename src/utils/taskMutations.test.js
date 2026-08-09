import { describe, it, expect } from 'vitest';
import {
  parseRecurringInstanceId,
  applyCreateTask,
  applyScheduleTask,
  applyMoveBlock,
  applyResizeBlock,
  applySetCompletion,
  WRITE_ERROR_CODES,
} from './taskMutations.js';

// The §3.1 (r5) shared pure module under test. Load-bearing assertions:
// each shape matches its cited UI transcription; _native is rejected by
// every mutating function; replays are no-ops returning the existing
// entity; nothing here can touch localStorage (structural — see the
// "never writes an override" test).

const NOW = '2026-08-10T12:00:00.000Z';
const T = (over = {}) => ({
  id: 'b1', title: 'Block', date: '2026-08-10', startTime: '09:00',
  duration: 60, completed: false, isAllDay: false, notes: '', subtasks: [], ...over,
});
const NATIVE = T({ id: 'native-cal-e1', _native: true, nativeEventId: 'e1', imported: true });

describe('parseRecurringInstanceId', () => {
  it('mirrors the App.jsx id shape, uuid template ids included', () => {
    expect(parseRecurringInstanceId('recurring-abc-def-2026-08-10')).toEqual({ templateId: 'abc-def', dateStr: '2026-08-10' });
    expect(parseRecurringInstanceId('recurring-42-2026-08-10')).toEqual({ templateId: 42, dateStr: '2026-08-10' });
    expect(parseRecurringInstanceId('b1')).toBeNull();
    expect(parseRecurringInstanceId(undefined)).toBeNull();
  });
});

describe('applyCreateTask', () => {
  const state = { tasks: [], unscheduledTasks: [{ id: 'u1', title: 'Existing' }] };

  it('appends the addTask inbox shape: duration 30, priority 0, empty notes/subtasks', () => {
    const r = applyCreateTask(state, { taskId: 'new-1', title: '  Buy milk  ', transitionId: 'k1', nowIso: NOW });
    expect(r.ok).toBe(true);
    expect(r.replayed).toBe(false);
    expect(r.task).toMatchObject({
      id: 'new-1', title: 'Buy milk', duration: 30, priority: 0,
      completed: false, isAllDay: false, notes: '', subtasks: [], transitionId: 'k1', lastModified: NOW,
    });
    expect(r.unscheduledTasks).toHaveLength(2);
    expect(state.unscheduledTasks).toHaveLength(1); // pure: input untouched
  });

  it('carries notes and projectId when given', () => {
    const r = applyCreateTask(state, { taskId: 'n2', title: 'T', notes: 'context', projectId: 'p1', nowIso: NOW });
    expect(r.task.notes).toBe('context');
    expect(r.task.projectId).toBe('p1');
  });

  it('replay (deterministic id already present) returns the existing task unchanged — the handleIntent precedent', () => {
    const r = applyCreateTask(state, { taskId: 'u1', title: 'Different title', nowIso: NOW });
    expect(r.ok).toBe(true);
    expect(r.replayed).toBe(true);
    expect(r.task.title).toBe('Existing');
    expect(r.unscheduledTasks).toBe(state.unscheduledTasks);
  });

  it('also detects the replayed id among scheduled tasks (task was scheduled after creation)', () => {
    const r = applyCreateTask({ tasks: [T({ id: 'x' })], unscheduledTasks: [] }, { taskId: 'x', title: 'T', nowIso: NOW });
    expect(r.replayed).toBe(true);
  });

  it('rejects an empty or whitespace title', () => {
    for (const title of ['', '   ', undefined, 42]) {
      const r = applyCreateTask(state, { taskId: 'n3', title, nowIso: NOW });
      expect(r.ok, String(title)).toBe(false);
      expect(r.error.code).toBe(WRITE_ERROR_CODES.VALIDATION);
    }
  });
});

describe('applyScheduleTask', () => {
  const state = {
    tasks: [T()],
    unscheduledTasks: [{ id: 'u1', title: 'Inbox', priority: 2, deadline: '2026-09-01', duration: 45, notes: '', subtasks: [] }],
  };

  it('moves inbox → calendar with the scheduleDeadlineTaskAt shape: priority/deadline stripped', () => {
    const r = applyScheduleTask(state, {
      taskId: 'u1', date: '2026-08-11', startTime: '14:00', durationMinutes: 90, transitionId: 'k1', nowIso: NOW,
    });
    expect(r.ok).toBe(true);
    expect(r.task).toMatchObject({
      id: 'u1', date: '2026-08-11', startTime: '14:00', duration: 90,
      isAllDay: false, transitionId: 'k1', lastModified: NOW,
    });
    expect(r.task).not.toHaveProperty('priority');
    expect(r.task).not.toHaveProperty('deadline');
    expect(r.unscheduledTasks).toEqual([]);
    expect(r.tasks).toHaveLength(2);
  });

  it('defaults duration to the task duration, then 30', () => {
    const r = applyScheduleTask(state, { taskId: 'u1', date: '2026-08-11', startTime: '14:00', nowIso: NOW });
    expect(r.task.duration).toBe(45);
    const bare = { unscheduledTasks: [{ id: 'u2', title: 'x' }], tasks: [] };
    const r2 = applyScheduleTask(bare, { taskId: 'u2', date: '2026-08-11', startTime: '14:00', nowIso: NOW });
    expect(r2.task.duration).toBe(30);
  });

  it('replay: an already-scheduled task with the same transitionId no-ops; without it, a validation error points at move_block', () => {
    const scheduled = { tasks: [T({ id: 'u1', transitionId: 'k1' })], unscheduledTasks: [] };
    const replay = applyScheduleTask(scheduled, { taskId: 'u1', date: '2026-08-11', startTime: '14:00', transitionId: 'k1', nowIso: NOW });
    expect(replay.ok).toBe(true);
    expect(replay.replayed).toBe(true);
    const fresh = applyScheduleTask(scheduled, { taskId: 'u1', date: '2026-08-11', startTime: '14:00', transitionId: 'other', nowIso: NOW });
    expect(fresh.ok).toBe(false);
    expect(fresh.error.message).toContain('move_block');
  });

  it('not_found for unknown ids; _native rejected with the typed code', () => {
    expect(applyScheduleTask(state, { taskId: 'nope', date: '2026-08-11', startTime: '14:00', nowIso: NOW }).error.code)
      .toBe(WRITE_ERROR_CODES.NOT_FOUND);
    const withNative = { tasks: [NATIVE], unscheduledTasks: [] };
    expect(applyScheduleTask(withNative, { taskId: 'native-cal-e1', date: '2026-08-11', startTime: '14:00', nowIso: NOW }).error.code)
      .toBe(WRITE_ERROR_CODES.NATIVE_READONLY);
  });
});

describe('applyMoveBlock', () => {
  const state = { tasks: [T(), NATIVE] };

  it('applies the canonical drop shape: startTime, date, isAllDay false, transitionId', () => {
    const r = applyMoveBlock(state, { blockId: 'b1', date: '2026-08-12', startTime: '16:30', transitionId: 'k2' });
    expect(r.ok).toBe(true);
    expect(r.task).toMatchObject({ id: 'b1', date: '2026-08-12', startTime: '16:30', isAllDay: false, transitionId: 'k2' });
    expect(r.tasks.find((t) => t.id === 'b1').startTime).toBe('16:30');
  });

  it('rejects _native with device_calendar_readonly — and cannot write an override (no storage access exists here)', () => {
    const r = applyMoveBlock(state, { blockId: 'native-cal-e1', date: '2026-08-12', startTime: '16:30' });
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe(WRITE_ERROR_CODES.NATIVE_READONLY);
    expect(r.error.message).toContain('read-only');
  });

  it('rejects recurring instances in v1 with a message pointing at the series', () => {
    const r = applyMoveBlock(state, { blockId: 'recurring-r1-2026-08-10', date: '2026-08-12', startTime: '16:30' });
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe(WRITE_ERROR_CODES.VALIDATION);
    expect(r.error.message).toContain('recurring');
  });

  it('not_found for unknown block ids; replay with the same transitionId no-ops', () => {
    expect(applyMoveBlock(state, { blockId: 'zzz', date: '2026-08-12', startTime: '10:00' }).error.code)
      .toBe(WRITE_ERROR_CODES.NOT_FOUND);
    const moved = { tasks: [T({ transitionId: 'k2' })] };
    const r = applyMoveBlock(moved, { blockId: 'b1', date: '2026-08-13', startTime: '08:00', transitionId: 'k2' });
    expect(r.replayed).toBe(true);
    expect(r.task.date).toBe('2026-08-10'); // unchanged — the first application stands
  });
});

describe('applyResizeBlock', () => {
  const state = { tasks: [T(), NATIVE] };

  it('applies the canonical resize shape: duration only', () => {
    const r = applyResizeBlock(state, { blockId: 'b1', durationMinutes: 120, transitionId: 'k3' });
    expect(r.ok).toBe(true);
    expect(r.task.duration).toBe(120);
    expect(r.task.startTime).toBe('09:00'); // untouched
  });

  it('rejects _native and recurring instances, not_found otherwise', () => {
    expect(applyResizeBlock(state, { blockId: 'native-cal-e1', durationMinutes: 120 }).error.code)
      .toBe(WRITE_ERROR_CODES.NATIVE_READONLY);
    expect(applyResizeBlock(state, { blockId: 'recurring-r1-2026-08-10', durationMinutes: 120 }).error.code)
      .toBe(WRITE_ERROR_CODES.VALIDATION);
    expect(applyResizeBlock(state, { blockId: 'zzz', durationMinutes: 120 }).error.code)
      .toBe(WRITE_ERROR_CODES.NOT_FOUND);
  });
});

describe('applySetCompletion', () => {
  const recurringState = {
    tasks: [], unscheduledTasks: [],
    recurringTasks: [{ id: 'r1', title: 'Standup', completedDates: ['2026-08-09'], completedDatesTimestamps: {} }],
  };

  it('completes a scheduled task with a transitionId and no completedAt (matching the UI scheduled branch)', () => {
    const r = applySetCompletion({ tasks: [T()], unscheduledTasks: [] }, { taskId: 'b1', completed: true, transitionId: 'k4', todayStr: '2026-08-10', nowIso: NOW });
    expect(r.ok).toBe(true);
    expect(r.task).toMatchObject({ id: 'b1', completed: true, transitionId: 'k4' });
    expect(r.task).not.toHaveProperty('completedAt');
  });

  it('completes an inbox task WITH completedAt (matching the UI inbox branch)', () => {
    const r = applySetCompletion(
      { tasks: [], unscheduledTasks: [{ id: 'u1', title: 'x', completed: false }] },
      { taskId: 'u1', completed: true, transitionId: 'k5', todayStr: '2026-08-10', nowIso: NOW },
    );
    expect(r.task.completedAt).toBe('2026-08-10');
    const undo = applySetCompletion(
      { tasks: [], unscheduledTasks: [r.task] },
      { taskId: 'u1', completed: false, todayStr: '2026-08-10', nowIso: NOW },
    );
    expect(undo.task.completedAt).toBeNull();
  });

  it('is a setter, so it is naturally idempotent: setting the current state is a replay no-op', () => {
    const done = { tasks: [T({ completed: true })], unscheduledTasks: [] };
    const r = applySetCompletion(done, { taskId: 'b1', completed: true, todayStr: '2026-08-10', nowIso: NOW });
    expect(r.replayed).toBe(true);
    expect(r.tasks).toBe(done.tasks);
  });

  it('recurring instance: toggles completedDates membership with a per-date timestamp (sync LWW per date)', () => {
    const r = applySetCompletion(recurringState, { taskId: 'recurring-r1-2026-08-10', completed: true, todayStr: '2026-08-10', nowIso: NOW });
    expect(r.ok).toBe(true);
    const template = r.recurringTasks[0];
    expect(template.completedDates).toEqual(['2026-08-09', '2026-08-10']);
    expect(template.completedDatesTimestamps['2026-08-10']).toBe(NOW);
    expect(template.lastModified).toBe(NOW);

    const uncomplete = applySetCompletion(
      { ...recurringState, recurringTasks: r.recurringTasks },
      { taskId: 'recurring-r1-2026-08-09', completed: false, todayStr: '2026-08-10', nowIso: NOW },
    );
    expect(uncomplete.recurringTasks[0].completedDates).toEqual(['2026-08-10']);
  });

  it('recurring replay: already in the requested state is a no-op', () => {
    const r = applySetCompletion(recurringState, { taskId: 'recurring-r1-2026-08-09', completed: true, todayStr: '2026-08-10', nowIso: NOW });
    expect(r.replayed).toBe(true);
    expect(r.recurringTasks).toBe(recurringState.recurringTasks);
  });

  it('rejects _native, CalDAV task-calendar tasks, and unknown ids with distinct codes', () => {
    const s = {
      tasks: [NATIVE, T({ id: 'cal1', isTaskCalendar: true, icalUid: 'uid-1', imported: true })],
      unscheduledTasks: [],
    };
    expect(applySetCompletion(s, { taskId: 'native-cal-e1', completed: true, todayStr: '2026-08-10', nowIso: NOW }).error.code)
      .toBe(WRITE_ERROR_CODES.NATIVE_READONLY);
    const caldav = applySetCompletion(s, { taskId: 'cal1', completed: true, todayStr: '2026-08-10', nowIso: NOW });
    expect(caldav.error.code).toBe(WRITE_ERROR_CODES.VALIDATION);
    expect(caldav.error.message).toContain('CalDAV');
    expect(applySetCompletion(s, { taskId: 'zzz', completed: true, todayStr: '2026-08-10', nowIso: NOW }).error.code)
      .toBe(WRITE_ERROR_CODES.NOT_FOUND);
    expect(applySetCompletion({ tasks: [], unscheduledTasks: [], recurringTasks: [] }, { taskId: 'recurring-gone-2026-08-10', completed: true, todayStr: '2026-08-10', nowIso: NOW }).error.code)
      .toBe(WRITE_ERROR_CODES.NOT_FOUND);
  });
});

describe('structural: the module can never write a native override', () => {
  it('taskMutations.js contains no storage or override access at all', async () => {
    // The §5.2 guarantee "no override entry is written" is structural: the
    // module has no localStorage reference to misuse. Read the source and pin
    // it, so a future edit that adds one fails a test, not a review.
    const fs = await import('node:fs');
    const raw = fs.readFileSync(new URL('./taskMutations.js', import.meta.url), 'utf8');
    // Strip comments — the header legitimately DISCUSSES storage; the code must not touch it.
    const code = raw
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\/?\*)/.test(line))
      .join('\n');
    expect(code).not.toMatch(/localStorage/);
    expect(code).not.toMatch(/native-time-overrides/);
    expect(code).not.toMatch(/window\./);
  });
});
