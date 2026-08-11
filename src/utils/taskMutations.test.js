import { describe, it, expect } from 'vitest';
import {
  parseRecurringInstanceId,
  applyCreateTask,
  applyScheduleTask,
  applyMoveBlock,
  applyResizeBlock,
  applySetCompletion,
  applyUndoOps,
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

describe('applyUndoOps — the §4.3 bulk undo (Phase 5b)', () => {
  const NOW2 = '2026-08-10T13:00:00.000Z';
  const run = (state, ops) => applyUndoOps(state, ops, { nowIso: NOW2 });

  it('remove_created is a recycle-bin move (the UI delete shape), not a bare removal', () => {
    const state = { tasks: [T({ id: 's1' })], unscheduledTasks: [{ id: 'c1', title: 'Created', lastModified: '2026-08-10T09:00:00.000Z' }], recycleBin: [] };
    const r = run(state, [{ kind: 'remove_created', taskId: 'c1' }]);
    expect(r.unscheduledTasks).toEqual([]);
    expect(r.recycleBin).toHaveLength(1);
    // The exact shape undeleteTask (useRecycleBin.js) consumes on restore:
    // _deletedFrom routes the destination, deletedAt is stripped.
    expect(r.recycleBin[0]).toMatchObject({
      id: 'c1', title: 'Created', _deletedFrom: 'inbox', deletedAt: NOW2, lastModified: NOW2,
    });
    expect(r.undone).toBe(1);
    expect(state.unscheduledTasks).toHaveLength(1); // pure: input untouched
    expect(state.recycleBin).toEqual([]);
  });

  it('remove_created carries the anti-zombie stamp: strictly newer than the task lastModified', () => {
    // A task whose lastModified IS the undo instant (stamped by an earlier op
    // in the same pass) must get deletedAt = lastModified + 1s, exactly like
    // moveToRecycleBin — a same-instant stamp would lose the cross-list
    // reconciliation and resurrect (the zombie the UI comment describes).
    const state = { tasks: [], unscheduledTasks: [{ id: 'c1', title: 'x', lastModified: NOW2 }], recycleBin: [] };
    const r = run(state, [{ kind: 'remove_created', taskId: 'c1' }]);
    const expected = new Date(Date.parse(NOW2) + 1000).toISOString();
    expect(r.recycleBin[0].deletedAt).toBe(expected);
    expect(r.recycleBin[0].lastModified).toBe(expected);
  });

  it('restore_unscheduled moves the block back to the inbox with the FULL before-task (priority/deadline survive)', () => {
    const beforeTask = { id: 'u1', title: 'Inbox task', priority: 2, deadline: '2026-08-20', duration: 45 };
    const state = { tasks: [T({ id: 'u1', title: 'Inbox task', date: '2026-08-11' })], unscheduledTasks: [] };
    const r = run(state, [{ kind: 'restore_unscheduled', taskId: 'u1', beforeTask }]);
    expect(r.tasks).toEqual([]);
    expect(r.unscheduledTasks[0]).toMatchObject({ priority: 2, deadline: '2026-08-20', duration: 45, lastModified: NOW2 });
    expect(r.undone).toBe(1);
  });

  it('restore_block_fields puts back exactly the touched fields and stamps lastModified for sync', () => {
    const state = { tasks: [T({ id: 'b1', date: '2026-08-12', startTime: '15:00', duration: 90 })] };
    const r = run(state, [
      { kind: 'restore_block_fields', blockId: 'b1', before: { duration: 60 } },
      { kind: 'restore_block_fields', blockId: 'b1', before: { date: '2026-08-10', startTime: '09:00', isAllDay: false } },
    ]);
    expect(r.tasks[0]).toMatchObject({ date: '2026-08-10', startTime: '09:00', duration: 60, lastModified: NOW2 });
    expect(r.undone).toBe(2);
  });

  it('restore_completion restores completed AND completedAt on inbox and scheduled tasks', () => {
    const state = {
      tasks: [T({ id: 'b1', completed: true })],
      unscheduledTasks: [{ id: 'u1', title: 'x', completed: true, completedAt: '2026-08-10' }],
    };
    const r = run(state, [
      { kind: 'restore_completion', taskId: 'b1', before: { completed: false, completedAt: null } },
      { kind: 'restore_completion', taskId: 'u1', before: { completed: false, completedAt: null } },
    ]);
    expect(r.tasks[0].completed).toBe(false);
    expect(r.unscheduledTasks[0]).toMatchObject({ completed: false, completedAt: null });
    expect(r.undone).toBe(2);
  });

  it('restore_recurring_completion restores membership with a fresh per-date timestamp', () => {
    const state = {
      recurringTasks: [{ id: 'r1', title: 'Standup', completedDates: ['2026-08-10'], completedDatesTimestamps: {} }],
    };
    const r = run(state, [{ kind: 'restore_recurring_completion', templateId: 'r1', dateStr: '2026-08-10', wasCompleted: false }]);
    expect(r.recurringTasks[0].completedDates).toEqual([]);
    expect(r.recurringTasks[0].completedDatesTimestamps['2026-08-10']).toBe(NOW2);
    expect(r.recurringTasks[0].lastModified).toBe(NOW2);
    const back = run(state, [{ kind: 'restore_recurring_completion', templateId: 'r1', dateStr: '2026-08-10', wasCompleted: true }]);
    expect(back.recurringTasks[0].completedDates).toEqual(['2026-08-10']); // already there → undone, unchanged
    expect(back.undone).toBe(1);
  });

  it('a compound create→schedule→move history unwinds in reverse order into the bin', () => {
    // Forward: created in inbox, scheduled to 08-10 09:00, moved to 08-12 15:00.
    const state = { tasks: [T({ id: 'c1', title: 'Agent task', date: '2026-08-12', startTime: '15:00' })], unscheduledTasks: [], recycleBin: [] };
    const ops = [ // reverse chronological, as buildUndoPlan produces
      { kind: 'restore_block_fields', blockId: 'c1', before: { date: '2026-08-10', startTime: '09:00', isAllDay: false } },
      { kind: 'restore_unscheduled', taskId: 'c1', beforeTask: { id: 'c1', title: 'Agent task', priority: 0 } },
      { kind: 'remove_created', taskId: 'c1' },
    ];
    const r = run(state, ops);
    expect(r.tasks).toEqual([]);
    expect(r.unscheduledTasks).toEqual([]);
    expect(r.recycleBin.map((t) => t.id)).toEqual(['c1']); // recoverable, and a sync fingerprint
    expect(r.undone).toBe(3);
    expect(r.skipped).toBe(0);
  });

  it('remove_created on a created task the user later scheduled manually bins it as a calendar delete', () => {
    const state = { tasks: [T({ id: 'c2', title: 'Created then dragged' })], unscheduledTasks: [], recycleBin: [] };
    const r = run(state, [{ kind: 'remove_created', taskId: 'c2' }]);
    expect(r.tasks).toEqual([]);
    expect(r.recycleBin[0]).toMatchObject({ id: 'c2', _deletedFrom: 'calendar' });
    expect(r.undone).toBe(1);
  });

  it('remove_created skips a task already gone (user deleted it) without touching the bin', () => {
    const state = { tasks: [], unscheduledTasks: [], recycleBin: [{ id: 'c3', title: 'already binned' }] };
    const r = run(state, [{ kind: 'remove_created', taskId: 'gone' }, { kind: 'remove_created', taskId: 'c3' }]);
    expect(r.skipped).toBe(2); // missing entirely, and only-in-bin: nothing to move
    expect(r.recycleBin).toHaveLength(1);
  });

  it('restore_unscheduled never duplicates a task already back in the inbox', () => {
    const state = {
      tasks: [T({ id: 'u2', title: 'Dup risk' })],
      unscheduledTasks: [{ id: 'u2', title: 'Dup risk' }],
    };
    const r = run(state, [{ kind: 'restore_unscheduled', taskId: 'u2', beforeTask: { id: 'u2', title: 'Dup risk' } }]);
    expect(r.unscheduledTasks.filter((t) => t.id === 'u2')).toHaveLength(1);
    expect(r.tasks).toEqual([]);
  });

  it('SYNC SHAPE: an undone create classifies as a cross-list move, never a glitch (the resurrection bug)', async () => {
    // The property that was previously unasserted: the vault push guard
    // (src/sync/snapshotDeleteGuard.js) must see the undone create as a
    // legitimate delete. A bare filter leaves no fingerprint — no tombstone,
    // no surviving copy under another kind — which the guard classifies as
    // 'glitch', skips, and heals BACK from the vault: the undone task
    // reappeared seconds later on any machine with GLANCEvault active.
    const { partitionSnapshotDeletes } = await import('../sync/snapshotDeleteGuard.js');
    const { TASK_KINDS } = await import('../sync/dbAdapter.js');

    const state = { tasks: [], unscheduledTasks: [{ id: 'c1', title: 'Created', lastModified: NOW2 }], recycleBin: [] };
    const r = run(state, [{ kind: 'remove_created', taskId: 'c1' }]);

    // Shred the post-undo state the way the engine does: entityId = 'kind:id'
    // per task-shaped kind (dbAdapter.js TASK_KINDS).
    const slices = { tasks: r.tasks, unscheduledTasks: r.unscheduledTasks, recurringTasks: r.recurringTasks, recycleBin: r.recycleBin };
    const cur = {};
    for (const kind of TASK_KINDS) {
      for (const t of slices[kind] ?? []) cur[`${kind}:${t.id}`] = '{}';
    }

    // The snapshot diff wants to delete the vanished inbox row; no tombstone
    // bundles exist (mirror empty) — only the bin copy can legitimize it.
    const verdict = partitionSnapshotDeletes(['unscheduledTasks:c1'], cur, {});
    expect(verdict.reasons['unscheduledTasks:c1']).toBe('cross-list');
    expect(verdict.propagate).toEqual(['unscheduledTasks:c1']);
    expect(verdict.skipped).toEqual([]);

    // Discriminating control: the OLD behavior (no bin entry) is exactly the
    // fingerprint-less vanish the guard skips as a suspected glitch — this is
    // what the fix exists to prevent, pinned so a regression cannot pass.
    const curWithoutBin = { ...cur };
    delete curWithoutBin['recycleBin:c1'];
    const regression = partitionSnapshotDeletes(['unscheduledTasks:c1'], curWithoutBin, {});
    expect(regression.reasons['unscheduledTasks:c1']).toBe('glitch');
    expect(regression.skipped).toEqual(['unscheduledTasks:c1']);
  });

  it('tolerant: user-deleted tasks, _native targets, and unknown ops are skipped, never errors', () => {
    const state = { tasks: [NATIVE], unscheduledTasks: [] };
    const r = run(state, [
      { kind: 'restore_block_fields', blockId: 'gone', before: { duration: 30 } },
      { kind: 'restore_block_fields', blockId: NATIVE.id, before: { duration: 30 } },
      { kind: 'restore_completion', taskId: 'gone', before: { completed: false } },
      { kind: 'restore_completion', taskId: NATIVE.id, before: { completed: true } },
      { kind: 'restore_unscheduled', taskId: 'gone', beforeTask: { id: 'gone' } },
      { kind: 'time_travel' },
    ]);
    expect(r.ok).toBe(true);
    expect(r.undone).toBe(0);
    expect(r.skipped).toBe(6);
    expect(r.tasks).toEqual([NATIVE]); // native untouched — fields AND completion
  });
});
