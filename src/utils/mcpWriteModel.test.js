import { describe, it, expect, vi } from 'vitest';
import { handleMcpWrite, isWriteMethod, scheduleDroppedFields, resolveMcpTaskId } from './mcpWriteModel.js';

// Phase 5b additions to the write dispatcher: every successful non-replayed
// write returns a §4.3 undo descriptor { summary, op } captured from the
// BEFORE-state (the only place it still exists — schedule strips priority and
// deadline), replays return none, and undo_mcp_writes applies reversal ops
// through the same setters as every other write.

const NOW_RE = /^\d{4}-\d{2}-\d{2}T/;

const makeSetters = () => ({
  setTasks: vi.fn(),
  setUnscheduledTasks: vi.fn(),
  setRecurringTasks: vi.fn(),
  setRecycleBin: vi.fn(),
  setGoals: vi.fn(),
  setProjects: vi.fn(),
  deleteGoal: vi.fn(),
  deleteProject: vi.fn(),
});

const B = (over = {}) => ({
  id: 'b1', title: 'Block', date: '2026-08-10', startTime: '09:00',
  duration: 60, completed: false, isAllDay: false, ...over,
});

describe('isWriteMethod', () => {
  it('routes the write tools plus undo_mcp_writes', () => {
    for (const m of ['create_task', 'schedule_task', 'move_block', 'resize_block', 'set_completion', 'update_task', 'undo_mcp_writes',
      'add_subtask', 'update_subtask', 'create_goal', 'update_goal', 'create_project', 'update_project']) {
      expect(isWriteMethod(m)).toBe(true);
    }
    expect(isWriteMethod('get_day')).toBe(false);
  });
});

describe('update_task — dispatch, undo capture, one-quoted-span summaries', () => {
  const inbox = () => ({ id: 'u1', title: 'Old title', priority: 1, notes: 'old', completed: false });

  it('applies through the inbox setter and returns the task entity', () => {
    const setters = makeSetters();
    const r = handleMcpWrite({ tasks: [], unscheduledTasks: [inbox()], users: [] }, setters, {
      method: 'update_task', params: { taskId: 'u1', set: { title: 'New title', deadline: '2026-09-01' }, clear: [] },
    });
    expect(r.ok).toBe(true);
    expect(r.data.task).toMatchObject({ id: 'u1', title: 'New title', deadline: '2026-09-01' });
    expect(setters.setUnscheduledTasks).toHaveBeenCalledTimes(1);
    expect(setters.setTasks).not.toHaveBeenCalled();
  });

  it('undo captures before-values, routes added fields to absentBefore, and quotes ONLY the new title', () => {
    const r = handleMcpWrite({ tasks: [], unscheduledTasks: [inbox()], users: [] }, makeSetters(), {
      method: 'update_task', params: { taskId: 'u1', set: { title: 'New title', deadline: '2026-09-01' }, clear: ['notes'] },
    });
    expect(r.undo.op).toEqual({
      kind: 'restore_task_fields',
      taskId: 'u1',
      before: { title: 'Old title', notes: 'old' },
      absentBefore: ['deadline'],
    });
    // ONE-QUOTED-SPAN RULE: summaryTitle spans first “ to last ”, so the
    // summary must quote exactly one title, the post-edit one. A second
    // quoted span (the old title) would extract garbage.
    expect(r.undo.summary).toBe('Edited “New title” (title, deadline, notes)');
    expect([...r.undo.summary].filter((c) => c === '“')).toHaveLength(1);
    expect(r.undo.summary).not.toContain('Old title');
  });

  it('summary field list uses wire names: assignee, never the assignedUserSyncIds storage key', () => {
    const state = { tasks: [], unscheduledTasks: [inbox()], users: [{ syncId: 'user-a', name: 'A' }] };
    const r = handleMcpWrite(state, makeSetters(), {
      method: 'update_task', params: { taskId: 'u1', set: { assigneeSyncId: 'user-a' }, clear: [] },
    });
    expect(r.ok).toBe(true);
    expect(r.undo.summary).toBe('Edited “Old title” (assignee)');
    expect(r.undo.summary).not.toContain('assignedUserSyncIds');
    expect(r.data.assignee_id).toBe('user-a');
  });

  it('a scheduled task routes through setTasks and returns a block entity', () => {
    const setters = makeSetters();
    const r = handleMcpWrite({ tasks: [B()], unscheduledTasks: [], users: [] }, setters, {
      method: 'update_task', params: { taskId: 'b1', set: { notes: 'annotated' }, clear: [] },
    });
    expect(r.ok).toBe(true);
    expect(r.data.block).toMatchObject({ id: 'b1' });
    expect(setters.setTasks).toHaveBeenCalledTimes(1);
    expect(setters.setUnscheduledTasks).not.toHaveBeenCalled();
  });

  it('errors pass through untouched and run no setters', () => {
    const setters = makeSetters();
    const r = handleMcpWrite({ tasks: [B()], unscheduledTasks: [], users: [] }, setters, {
      method: 'update_task', params: { taskId: 'b1', set: { priority: 2 }, clear: [] },
    });
    expect(r).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(setters.setTasks).not.toHaveBeenCalled();
  });
});

describe('undo descriptors on write responses', () => {
  it('create_task → remove_created; replay carries NO descriptor', () => {
    const state = { tasks: [], unscheduledTasks: [] };
    const r = handleMcpWrite(state, makeSetters(), {
      method: 'create_task', params: { taskId: 'n1', title: 'Buy milk' },
    });
    expect(r.ok).toBe(true);
    expect(r.undo.op).toEqual({ kind: 'remove_created', taskId: 'n1' });
    expect(r.undo.summary).toContain('Buy milk');

    const replay = handleMcpWrite({ tasks: [], unscheduledTasks: [{ id: 'n1', title: 'Buy milk' }] }, makeSetters(), {
      method: 'create_task', params: { taskId: 'n1', title: 'Buy milk' },
    });
    expect(replay.ok).toBe(true);
    expect(replay.data.replayed).toBe(true);
    expect(replay.undo).toBeUndefined();
  });

  it('schedule_task captures the FULL before-task — priority and deadline survive the round trip', () => {
    const inbox = { id: 'u1', title: 'Report', priority: 2, deadline: '2026-08-20', duration: 45 };
    const state = { tasks: [], unscheduledTasks: [inbox] };
    const r = handleMcpWrite(state, makeSetters(), {
      method: 'schedule_task',
      params: { taskId: 'u1', date: '2026-08-11', startTime: '10:00', durationMinutes: 30 },
    });
    expect(r.ok).toBe(true);
    expect(r.undo.op.kind).toBe('restore_unscheduled');
    expect(r.undo.op.beforeTask).toEqual(inbox); // captured pre-mutation, strip-proof
    expect(r.undo.summary).toContain('2026-08-11 10:00');
  });

  it('move_block and resize_block capture exactly the touched before-fields', () => {
    const state = { tasks: [B()], unscheduledTasks: [] };
    const move = handleMcpWrite(state, makeSetters(), {
      method: 'move_block', params: { blockId: 'b1', date: '2026-08-12', startTime: '15:00' },
    });
    expect(move.undo.op).toEqual({
      kind: 'restore_block_fields', blockId: 'b1',
      before: { date: '2026-08-10', startTime: '09:00', isAllDay: false },
    });
    const resize = handleMcpWrite(state, makeSetters(), {
      method: 'resize_block', params: { blockId: 'b1', durationMinutes: 90 },
    });
    expect(resize.undo.op).toEqual({
      kind: 'restore_block_fields', blockId: 'b1', before: { duration: 60 },
    });
  });

  it('set_completion captures prior completed/completedAt; recurring instances capture membership', () => {
    const state = {
      tasks: [B({ completed: false })],
      unscheduledTasks: [],
      recurringTasks: [{ id: 'r1', title: 'Standup', completedDates: [], recurrence: { type: 'daily', startDate: '2026-01-01' } }],
    };
    const flat = handleMcpWrite(state, makeSetters(), {
      method: 'set_completion', params: { taskId: 'b1', completed: true, todayStr: '2026-08-10' },
    });
    expect(flat.undo.op).toEqual({
      kind: 'restore_completion', taskId: 'b1', before: { completed: false, completedAt: null },
    });
    const rec = handleMcpWrite(state, makeSetters(), {
      method: 'set_completion', params: { taskId: 'recurring-r1-2026-08-10', completed: true, todayStr: '2026-08-10' },
    });
    expect(rec.undo.op).toEqual({
      kind: 'restore_recurring_completion', templateId: 'r1', dateStr: '2026-08-10', wasCompleted: false,
    });
    // Setter-idempotent replay (already complete) → no descriptor
    const replay = handleMcpWrite({ ...state, tasks: [B({ completed: true })] }, makeSetters(), {
      method: 'set_completion', params: { taskId: 'b1', completed: true, todayStr: '2026-08-10' },
    });
    expect(replay.data.replayed).toBe(true);
    expect(replay.undo).toBeUndefined();
  });

  it('failed writes return the typed error and no descriptor', () => {
    const r = handleMcpWrite({ tasks: [], unscheduledTasks: [] }, makeSetters(), {
      method: 'move_block', params: { blockId: 'nope', date: '2026-08-12', startTime: '15:00' },
    });
    expect(r.ok).toBe(false);
    expect(r.undo).toBeUndefined();
  });
});

describe('undo_mcp_writes', () => {
  it('applies reversal ops through ALL four setters in one commit and reports counts', () => {
    const setters = makeSetters();
    const state = {
      tasks: [B({ id: 'c1', title: 'Agent task', date: '2026-08-12', startTime: '15:00' })],
      unscheduledTasks: [],
      recurringTasks: [],
      recycleBin: [],
    };
    const r = handleMcpWrite(state, setters, {
      method: 'undo_mcp_writes',
      params: {
        ops: [
          { kind: 'restore_block_fields', blockId: 'c1', before: { date: '2026-08-10', startTime: '09:00', isAllDay: false } },
          { kind: 'restore_unscheduled', taskId: 'c1', beforeTask: { id: 'c1', title: 'Agent task', priority: 0 } },
          { kind: 'remove_created', taskId: 'c1' },
        ],
      },
    });
    expect(r).toEqual({ ok: true, data: { undone: 3, skipped: 0 } });
    expect(setters.setTasks).toHaveBeenCalledWith([]);
    expect(setters.setUnscheduledTasks).toHaveBeenCalledWith([]);
    expect(setters.setRecurringTasks).toHaveBeenCalledWith([]);
    // The undone create lands in the recycle bin (cross-list sync fingerprint,
    // and recoverable), never a bare vanish.
    const [bin] = setters.setRecycleBin.mock.calls[0];
    expect(bin).toHaveLength(1);
    expect(bin[0]).toMatchObject({ id: 'c1', _deletedFrom: 'inbox' });
  });

  it('FIELD-UPDATE ops carry a fresh lastModified so LWW sync propagates them (remove_created is a bin move instead, tested in taskMutations)', () => {
    const setters = makeSetters();
    handleMcpWrite(
      { tasks: [B()], unscheduledTasks: [], recurringTasks: [] },
      setters,
      { method: 'undo_mcp_writes', params: { ops: [{ kind: 'restore_block_fields', blockId: 'b1', before: { duration: 30 } }] } },
    );
    const [next] = setters.setTasks.mock.calls[0];
    expect(next[0].duration).toBe(30);
    expect(next[0].lastModified).toMatch(NOW_RE);
  });
});

describe('create_task — the extended scheduled shape', () => {
  it('schedule param → block response, setTasks only, undo summary names the slot', () => {
    const setters = makeSetters();
    const r = handleMcpWrite({ tasks: [], unscheduledTasks: [] }, setters, {
      method: 'create_task',
      params: { taskId: 's1', title: 'Standup', schedule: { date: '2026-08-14', startTime: '09:30', durationMinutes: 45, allDay: false } },
    });
    expect(r.ok).toBe(true);
    expect(r.data.block).toMatchObject({
      id: 's1', type: 'task', date: '2026-08-14', start_time: '09:30', duration_minutes: 45, all_day: false,
    });
    expect(r.data.task).toBeUndefined();
    expect(setters.setTasks).toHaveBeenCalledTimes(1);
    expect(setters.setUnscheduledTasks).not.toHaveBeenCalled();
    // Same undo kind as any create — remove_created reverses it to the bin.
    expect(r.undo.op).toEqual({ kind: 'remove_created', taskId: 's1' });
    expect(r.undo.summary).toBe('Created “Standup” at 2026-08-14 09:30');
  });

  it('all-day create → block with null start_time, summary names the date only', () => {
    const r = handleMcpWrite({ tasks: [], unscheduledTasks: [] }, makeSetters(), {
      method: 'create_task',
      params: { taskId: 's2', title: 'Conference', schedule: { date: '2026-08-15', startTime: '00:00', durationMinutes: 30, allDay: true } },
    });
    expect(r.data.block).toMatchObject({ all_day: true, start_time: null, date: '2026-08-15' });
    expect(r.undo.summary).toBe('Created “Conference” at 2026-08-15');
  });

  it('assignee round-trips into the response as assignee_id', () => {
    const users = [{ id: 'id-ana', syncId: 'sync-ana', name: 'Ana' }];
    const r = handleMcpWrite({ tasks: [], unscheduledTasks: [], users }, makeSetters(), {
      method: 'create_task', params: { taskId: 'a1', title: 'T', assigneeSyncId: 'sync-ana' },
    });
    expect(r.ok).toBe(true);
    expect(r.data.assignee_id).toBe('sync-ana');
  });

  it('a created-and-scheduled task reverses to the RECYCLE BIN like any MCP create (PR #1364 shape)', () => {
    // Create scheduled…
    const createSetters = makeSetters();
    const created = handleMcpWrite({ tasks: [], unscheduledTasks: [] }, createSetters, {
      method: 'create_task',
      params: { taskId: 'cs1', title: 'Agent block', schedule: { date: '2026-08-14', startTime: '11:00', durationMinutes: 30, allDay: false } },
    });
    const [tasksAfter] = createSetters.setTasks.mock.calls[0];
    // …then undo with the descriptor the create returned.
    const undoSetters = makeSetters();
    const undone = handleMcpWrite(
      { tasks: tasksAfter, unscheduledTasks: [], recurringTasks: [], recycleBin: [] },
      undoSetters,
      { method: 'undo_mcp_writes', params: { ops: [created.undo.op] } },
    );
    expect(undone).toEqual({ ok: true, data: { undone: 1, skipped: 0 } });
    expect(undoSetters.setTasks.mock.calls[0][0]).toEqual([]);
    const [bin] = undoSetters.setRecycleBin.mock.calls[0];
    expect(bin[0]).toMatchObject({ id: 'cs1', _deletedFrom: 'calendar' });
    expect(bin[0].deletedAt).toBe(bin[0].lastModified);
  });
});

describe('schedule_task — dropped_fields reporting', () => {
  it('an inbox task carrying priority and deadline → both named, with a note', () => {
    const state = { tasks: [], unscheduledTasks: [{ id: 'u1', title: 'Report', priority: 2, deadline: '2026-08-20' }] };
    const r = handleMcpWrite(state, makeSetters(), {
      method: 'schedule_task', params: { taskId: 'u1', date: '2026-08-14', startTime: '10:00' },
    });
    expect(r.ok).toBe(true);
    expect(r.data.dropped_fields).toEqual(['priority', 'deadline']);
    expect(r.data.note).toMatch(/by design/);
  });

  it('priority 0 and no deadline → nothing was carried, nothing reported', () => {
    const state = { tasks: [], unscheduledTasks: [{ id: 'u1', title: 'Plain', priority: 0 }] };
    const r = handleMcpWrite(state, makeSetters(), {
      method: 'schedule_task', params: { taskId: 'u1', date: '2026-08-14', startTime: '10:00' },
    });
    expect(r.ok).toBe(true);
    expect(r.data.dropped_fields).toBeUndefined();
    expect(r.data.note).toBeUndefined();
  });

  it('scheduleDroppedFields: each field independently', () => {
    expect(scheduleDroppedFields({ priority: 1 })).toEqual(['priority']);
    expect(scheduleDroppedFields({ deadline: '2026-08-20' })).toEqual(['deadline']);
    expect(scheduleDroppedFields({ priority: 0 })).toEqual([]);
    expect(scheduleDroppedFields(undefined)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Routines are read-only over MCP BY DESIGN (spec §5.2, §7.4).
//
// The read surface reports routine blocks so a model can see the time is
// occupied. A model that can see a block will try to act on it, so every
// write tool has to say WHY it will not, rather than falling through to
// not_found, which would tell the model the block does not exist and invite
// it to recreate the routine as a task.
// ---------------------------------------------------------------------------
describe('routine ids are rejected by every write tool', () => {
  const ROUTINE = { id: 'r1', name: 'Morning pages', startTime: '07:00', duration: 15 };
  const state = () => ({
    tasks: [B()], unscheduledTasks: [{ id: 'u1', title: 'Inbox item' }],
    users: [], routines: [ROUTINE],
  });

  const calls = [
    ['schedule_task', { taskId: 'routine-r1', date: '2026-08-10', startTime: '10:00' }],
    ['move_block', { blockId: 'routine-r1', date: '2026-08-10', startTime: '10:00' }],
    ['resize_block', { blockId: 'routine-r1', durationMinutes: 30 }],
    ['set_completion', { taskId: 'routine-r1', completed: true }],
    ['update_task', { taskId: 'routine-r1', set: { title: 'Renamed' }, clear: [] }],
    ['create_task', { taskId: 'routine-r1', title: 'Impostor' }],
  ];

  for (const [method, params] of calls) {
    it(`${method} returns routine_readonly, not not_found`, () => {
      const setters = makeSetters();
      const r = handleMcpWrite(state(), setters, { method, params });
      expect(r.ok).toBe(false);
      expect(r.error.code).toBe('routine_readonly');
      // The message has to carry the reason, not just the refusal.
      expect(r.error.message).toMatch(/routine/i);
      expect(r.error.message).toMatch(/read-only/i);
      // Nothing was written.
      for (const fn of Object.values(setters)) expect(fn).not.toHaveBeenCalled();
    });
  }

  it('rejects a bare routine id, not only the prefixed block id', () => {
    // A caller working from an export or a log may have stripped the prefix.
    const r = handleMcpWrite(state(), makeSetters(), {
      method: 'set_completion', params: { taskId: 'r1', completed: true },
    });
    expect(r.error.code).toBe('routine_readonly');
  });

  it('still rejects the prefixed id when no routine state is threaded', () => {
    // §3.7: the write path is not guaranteed routine slices, so the prefix
    // check must stand alone.
    const r = handleMcpWrite({ tasks: [], unscheduledTasks: [], users: [] }, makeSetters(), {
      method: 'move_block', params: { blockId: 'routine-r1', date: '2026-08-10', startTime: '10:00' },
    });
    expect(r.error.code).toBe('routine_readonly');
  });

  it('does not misfire on ordinary tasks or on device calendar events', () => {
    const okMove = handleMcpWrite(state(), makeSetters(), {
      method: 'move_block', params: { blockId: 'b1', date: '2026-08-11', startTime: '11:00' },
    });
    expect(okMove.ok).toBe(true);

    const native = handleMcpWrite(
      { tasks: [B({ id: 'n1', _native: true })], unscheduledTasks: [], users: [], routines: [ROUTINE] },
      makeSetters(),
      { method: 'move_block', params: { blockId: 'n1', date: '2026-08-11', startTime: '11:00' } },
    );
    expect(native.error.code).toBe('device_calendar_readonly');
  });

  it('keeps not_found for an id that is genuinely unknown', () => {
    const r = handleMcpWrite(state(), makeSetters(), {
      method: 'move_block', params: { blockId: 'nope', date: '2026-08-11', startTime: '11:00' },
    });
    expect(r.error.code).toBe('not_found');
  });
});

// ---------------------------------------------------------------------------
// Routine COLLISIONS are rejected, not silently adjusted (spec §5.2).
//
// Distinct from routine_readonly above: there the caller targeted the routine
// itself; here it targeted a perfectly ordinary task at a time a routine
// already occupies. The app's drag-and-drop resolver slides past the routine
// in that situation, and mirroring that here would be wrong for an agent: a
// model that asked for 10:00 and got a success reports "scheduled at 10:00",
// and the shift only surfaces when the user looks at the timeline.
// ---------------------------------------------------------------------------
describe('routine collisions are rejected rather than adjusted', () => {
  const DATE = '2026-08-10';
  const ROUTINE = { id: 'r1', name: 'Morning pages', startTime: '09:00', duration: 60, isAllDay: false };

  // buildRoutineBlocks only reports routines for today, so the fixture's
  // notion of "today" has to be the date under test.
  const withRoutine = (over = {}) => ({
    tasks: [], unscheduledTasks: [], users: [],
    routines: [ROUTINE], routinesDate: DATE, routineCompletions: {},
    routinesEnabled: true, todayDate: DATE,
    ...over,
  });

  const expectConflict = (r) => {
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe('routine_conflict');
    // The message has to name what was hit and its span, or the model cannot
    // re-plan without another round trip.
    expect(r.error.message).toContain('Morning pages');
    expect(r.error.message).toContain('09:00-10:00');
  };

  it('schedule_task into a routine is rejected', () => {
    const setters = makeSetters();
    const r = handleMcpWrite(
      withRoutine({ unscheduledTasks: [{ id: 'u1', title: 'Inbox item', duration: 30 }] }),
      setters,
      { method: 'schedule_task', params: { taskId: 'u1', date: DATE, startTime: '09:30' } },
    );
    expectConflict(r);
    for (const fn of Object.values(setters)) expect(fn).not.toHaveBeenCalled();
  });

  it('does not silently shift the task past the routine', () => {
    // The behaviour explicitly rejected: the app's drop resolver would place
    // this at 10:00 and report success. A success carrying a different time
    // than the model asked for is worse than a failure, because nothing
    // surfaces the difference to the user the model then talks to.
    const setters = makeSetters();
    const r = handleMcpWrite(
      withRoutine({ unscheduledTasks: [{ id: 'u1', title: 'Inbox item', duration: 30 }] }),
      setters,
      { method: 'schedule_task', params: { taskId: 'u1', date: DATE, startTime: '09:30' } },
    );
    // No entity comes back, so there is no placement to misreport, and no
    // undo descriptor, so nothing reaches the journal.
    expect(r.ok).toBe(false);
    expect(r.data).toBeUndefined();
    expect(r.undo).toBeUndefined();
    expect(setters.setTasks).not.toHaveBeenCalled();
    expect(setters.setUnscheduledTasks).not.toHaveBeenCalled();
  });

  it('create_task with a scheduled start into a routine is rejected', () => {
    const r = handleMcpWrite(withRoutine(), makeSetters(), {
      method: 'create_task',
      params: { taskId: 'new1', title: 'Deep work', schedule: { date: DATE, startTime: '09:15', durationMinutes: 30 } },
    });
    expectConflict(r);
  });

  it('move_block onto a routine is rejected', () => {
    const r = handleMcpWrite(
      withRoutine({ tasks: [B({ id: 'b1', date: DATE, startTime: '14:00', duration: 30 })] }),
      makeSetters(),
      { method: 'move_block', params: { blockId: 'b1', date: DATE, startTime: '09:30' } },
    );
    expectConflict(r);
  });

  it('resize_block that grows into a routine is rejected', () => {
    // 08:00 + 30 clears the 09:00 routine; 08:00 + 120 does not.
    const state = withRoutine({ tasks: [B({ id: 'b1', date: DATE, startTime: '08:00', duration: 30 })] });
    expect(handleMcpWrite(state, makeSetters(), {
      method: 'resize_block', params: { blockId: 'b1', durationMinutes: 45 },
    }).ok).toBe(true);
    expectConflict(handleMcpWrite(state, makeSetters(), {
      method: 'resize_block', params: { blockId: 'b1', durationMinutes: 120 },
    }));
  });

  it('allows a placement that merely abuts the routine', () => {
    // Half-open intervals: ending exactly at 09:00 is not an overlap, and
    // treating it as one would make back-to-back scheduling impossible.
    const r = handleMcpWrite(
      withRoutine({ unscheduledTasks: [{ id: 'u1', title: 'Inbox item', duration: 30 }] }),
      makeSetters(),
      { method: 'schedule_task', params: { taskId: 'u1', date: DATE, startTime: '08:30' } },
    );
    expect(r.ok).toBe(true);
    const after = handleMcpWrite(
      withRoutine({ unscheduledTasks: [{ id: 'u2', title: 'Later', duration: 30 }] }),
      makeSetters(),
      { method: 'schedule_task', params: { taskId: 'u2', date: DATE, startTime: '10:00' } },
    );
    expect(after.ok).toBe(true);
  });

  it('still allows task-on-task overlap, which users do on purpose', () => {
    const state = withRoutine({
      routinesEnabled: false,
      tasks: [B({ id: 'existing', date: DATE, startTime: '14:00', duration: 60 })],
      unscheduledTasks: [{ id: 'u1', title: 'Overlapping', duration: 30 }],
    });
    const r = handleMcpWrite(state, makeSetters(), {
      method: 'schedule_task', params: { taskId: 'u1', date: DATE, startTime: '14:15' },
    });
    expect(r.ok).toBe(true);
  });

  it('does not reject an all-day placement, which occupies no span', () => {
    const r = handleMcpWrite(withRoutine(), makeSetters(), {
      method: 'create_task',
      params: { taskId: 'n1', title: 'All day', schedule: { date: DATE, startTime: '09:30', durationMinutes: 30, allDay: true } },
    });
    expect(r.ok).toBe(true);
  });

  it('does not reject when routines are disabled', () => {
    const r = handleMcpWrite(
      withRoutine({ routinesEnabled: false, unscheduledTasks: [{ id: 'u1', title: 'x', duration: 30 }] }),
      makeSetters(),
      { method: 'schedule_task', params: { taskId: 'u1', date: DATE, startTime: '09:30' } },
    );
    expect(r.ok).toBe(true);
  });

  it('does not reject on a date the routines do not belong to', () => {
    const r = handleMcpWrite(
      withRoutine({ unscheduledTasks: [{ id: 'u1', title: 'x', duration: 30 }] }),
      makeSetters(),
      { method: 'schedule_task', params: { taskId: 'u1', date: '2026-08-11', startTime: '09:30' } },
    );
    expect(r.ok).toBe(true);
  });

  it('never rejects a REPLAY, even if a routine now covers the time', () => {
    // Idempotency outranks the conflict check: the write already landed, and
    // failing the retry would make a crashed agent believe its own successful
    // write never happened. Each guard sits after its replay branch.
    const already = B({ id: 'b1', date: DATE, startTime: '09:30', duration: 30, transitionId: 'k1' });
    const move = handleMcpWrite(withRoutine({ tasks: [already] }), makeSetters(), {
      method: 'move_block', params: { blockId: 'b1', date: DATE, startTime: '09:30', transitionId: 'k1' },
    });
    expect(move.ok).toBe(true);
    expect(move.data.replayed).toBe(true);

    const resize = handleMcpWrite(withRoutine({ tasks: [already] }), makeSetters(), {
      method: 'resize_block', params: { blockId: 'b1', durationMinutes: 30, transitionId: 'k1' },
    });
    expect(resize.data.replayed).toBe(true);

    const create = handleMcpWrite(
      withRoutine({ tasks: [B({ id: 'dup', date: DATE, startTime: '09:30', duration: 30 })] }),
      makeSetters(),
      { method: 'create_task', params: { taskId: 'dup', title: 'x', schedule: { date: DATE, startTime: '09:30', durationMinutes: 30 } } },
    );
    expect(create.data.replayed).toBe(true);
  });

  it('ignores an unplaced routine, which occupies no time', () => {
    const r = handleMcpWrite(
      withRoutine({
        routines: [{ id: 'r9', name: 'Unplaced', startTime: null, isAllDay: true }],
        unscheduledTasks: [{ id: 'u1', title: 'x', duration: 30 }],
      }),
      makeSetters(),
      { method: 'schedule_task', params: { taskId: 'u1', date: DATE, startTime: '09:30' } },
    );
    expect(r.ok).toBe(true);
  });
});

// The Obsidian placement pass re-keys a project task whose project has a
// linked note (useObsidianSync, PLACEMENT): the UUID create_task returned
// becomes obsidian-dg-<blockId> seconds later, and the commit records the
// move in retiredTaskIds. Every id a write takes resolves through it.
describe('ids retired by an Obsidian re-key resolve to their successor', () => {
  const OLD = '948b4379-0000-4000-8000-000000000000';
  const NEW = 'obsidian-dg-77derxbh';
  const RETIRED = { [OLD]: { retiredAt: '2026-10-02T10:00:00.000Z', successor: NEW } };

  // What the placement commit leaves behind: same task, new id, the
  // wikilink-free title with #obsidian appended, and the retirement record.
  const reKey = (task) => ({ ...task, id: NEW, obsidianBlockId: '77derxbh', importSource: 'obsidian', title: `${task.title} #obsidian` });

  it('create a project task, the vault claims it, update with the id create returned: succeeds on the successor', () => {
    const setters = makeSetters();
    const created = handleMcpWrite(
      { tasks: [], unscheduledTasks: [], projects: [{ id: 'p1', title: 'dayGLANCE' }] },
      setters,
      { method: 'create_task', params: { taskId: OLD, title: 'Ship it', projectId: 'p1' } },
    );
    expect(created.ok).toBe(true);
    expect(created.data.task.id).toBe(OLD);
    const createdTask = setters.setUnscheduledTasks.mock.calls[0][0][0];

    const after = { tasks: [], unscheduledTasks: [reKey(createdTask)], retiredTaskIds: RETIRED };
    const s2 = makeSetters();
    const r = handleMcpWrite(after, s2, { method: 'update_task', params: { taskId: OLD, set: { deadline: '2026-10-09' }, clear: [] } });
    expect(r.ok).toBe(true);
    expect(r.data.task).toMatchObject({ id: NEW, deadline: '2026-10-09', project_id: 'p1' });
    expect(r.data.resolved_from).toBe(OLD);
    expect(s2.setUnscheduledTasks.mock.calls[0][0][0]).toMatchObject({ id: NEW, deadline: '2026-10-09' });
    // The journal's undo names the live id, so a later bulk undo finds it.
    expect(r.undo.op.taskId).toBe(NEW);
  });

  it('every write tool that takes a task or block id resolves it', () => {
    const inbox = { id: NEW, title: 'Inbox', priority: 0, completed: false };
    const block = B({ id: NEW });
    const cases = [
      [{ tasks: [], unscheduledTasks: [inbox] }, { method: 'schedule_task', params: { taskId: OLD, date: '2026-08-10', startTime: '09:00' } }],
      [{ tasks: [], unscheduledTasks: [inbox] }, { method: 'set_completion', params: { taskId: OLD, completed: true, todayStr: '2026-08-10' } }],
      [{ tasks: [block], unscheduledTasks: [] }, { method: 'move_block', params: { blockId: OLD, date: '2026-08-11', startTime: '10:00' } }],
      [{ tasks: [block], unscheduledTasks: [] }, { method: 'resize_block', params: { blockId: OLD, durationMinutes: 45 } }],
      [{ tasks: [], unscheduledTasks: [inbox] }, { method: 'update_task', params: { taskId: OLD, set: { title: 'x' }, clear: [] } }],
    ];
    for (const [state, request] of cases) {
      const r = handleMcpWrite({ ...state, retiredTaskIds: RETIRED }, makeSetters(), request);
      expect(r.ok, request.method).toBe(true);
      expect(r.data.resolved_from, request.method).toBe(OLD);
      expect((r.data.task ?? r.data.block).id, request.method).toBe(NEW);
    }
  });

  it('a create replay on a re-keyed deterministic id returns the claimed task instead of creating a second', () => {
    const setters = makeSetters();
    const claimed = { id: NEW, title: 'Ship it #obsidian', priority: 0, completed: false, transitionId: 'k1' };
    const r = handleMcpWrite(
      { tasks: [], unscheduledTasks: [claimed], retiredTaskIds: RETIRED },
      setters,
      { method: 'create_task', params: { taskId: OLD, title: 'Ship it', transitionId: 'k1' } },
    );
    expect(r.ok).toBe(true);
    expect(r.data.replayed).toBe(true);
    expect(r.data.task.id).toBe(NEW);
    expect(setters.setUnscheduledTasks).not.toHaveBeenCalled();
  });

  it('bulk undo resolves the ids the journal recorded before the re-key', () => {
    const setters = makeSetters();
    const r = handleMcpWrite(
      { tasks: [], unscheduledTasks: [{ id: NEW, title: 'Ship it', completed: false }], recurringTasks: [], recycleBin: [], retiredTaskIds: RETIRED },
      setters,
      { method: 'undo_mcp_writes', params: { ops: [{ kind: 'remove_created', taskId: OLD }] } },
    );
    expect(r.data).toEqual({ undone: 1, skipped: 0 });
    expect(setters.setUnscheduledTasks.mock.calls[0][0]).toEqual([]);
  });

  it('an id that is still live is never redirected, and no resolved_from is reported', () => {
    const state = {
      tasks: [],
      unscheduledTasks: [{ id: OLD, title: 'not yet claimed', priority: 0, completed: false }, { id: NEW, title: 'other', priority: 0, completed: false }],
      retiredTaskIds: RETIRED,
    };
    expect(resolveMcpTaskId(state, OLD)).toBe(OLD);
    const r = handleMcpWrite(state, makeSetters(), { method: 'update_task', params: { taskId: OLD, set: { title: 'y' }, clear: [] } });
    expect(r.data.task.id).toBe(OLD);
    expect('resolved_from' in r.data).toBe(false);
  });

  it('a successor that is not live here keeps the original id: an honest not_found', () => {
    const r = handleMcpWrite(
      { tasks: [], unscheduledTasks: [], retiredTaskIds: RETIRED },
      makeSetters(),
      { method: 'update_task', params: { taskId: OLD, set: { title: 'y' }, clear: [] } },
    );
    expect(r).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(r.error.message).toContain(OLD);
  });

  it('without a record (or for an unknown id) behaviour is unchanged', () => {
    const r = handleMcpWrite({ tasks: [], unscheduledTasks: [] }, makeSetters(), { method: 'update_task', params: { taskId: 'nope', set: { title: 'y' }, clear: [] } });
    expect(r).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});

describe('goals, projects and subtasks over MCP (2026-10-04)', () => {
  const state = () => ({
    tasks: [B({ id: 'b1', projectId: 'p1', subtasks: [{ id: 's1', title: 'Nails', completed: false }] })],
    unscheduledTasks: [{ id: 'u1', title: 'Inbox', completed: false }],
    goals: [{ id: 'g1', title: 'Ship v5', status: 'active', color: 'bg-blue-500' }],
    projects: [{ id: 'p1', title: 'Backend', status: 'active', goalId: 'g1', description: 'API first.' }],
    areas: [{ id: 'a1', name: 'Work', color: 'bg-orange-500' }],
    users: [],
    isVisibleForUser: () => true,
  });

  it('create_goal appends through setGoals, answers with the read shape, and reverses as remove_created_goal', () => {
    const setters = makeSetters();
    const r = handleMcpWrite(state(), setters, { method: 'create_goal', params: { goalId: 'g-new', title: 'Learn piano', areaId: 'a1', targetDate: '2027-01-01' } });
    expect(r.ok).toBe(true);
    expect(r.data.goal).toMatchObject({ id: 'g-new', title: 'Learn piano', status: 'active', area_id: 'a1', area_name: 'Work', target_date: '2027-01-01', progress_percent: 0 });
    expect(setters.setGoals).toHaveBeenCalledTimes(1);
    expect(setters.setGoals.mock.calls[0][0]([{ id: 'g1' }]).map((g) => g.id)).toEqual(['g1', 'g-new']);
    expect(r.undo).toEqual({ summary: 'Created goal “Learn piano”', op: { kind: 'remove_created_goal', goalId: 'g-new' } });
  });
  it('update_goal captures before-fields (absent ones named), quotes one title, replays without a descriptor', () => {
    const setters = makeSetters();
    const r = handleMcpWrite(state(), setters, { method: 'update_goal', params: { goalId: 'g1', set: { title: 'Ship v6', targetDate: '2027-01-01' } } });
    expect(r.data.goal).toMatchObject({ title: 'Ship v6', target_date: '2027-01-01' });
    expect(r.undo).toEqual({
      summary: 'Edited goal “Ship v6” (title, target_date)',
      op: { kind: 'restore_goal_fields', goalId: 'g1', before: { title: 'Ship v5' }, absentBefore: ['targetDate'] },
    });
    const noop = handleMcpWrite(state(), makeSetters(), { method: 'update_goal', params: { goalId: 'g1', set: {}, clear: [] } });
    expect(noop.data.replayed).toBe(true);
    expect(noop.undo).toBeUndefined();
  });
  it('create_project and update_project route through setProjects; archiving is a typed refusal with no setter call', () => {
    const setters = makeSetters();
    const c = handleMcpWrite(state(), setters, { method: 'create_project', params: { projectId: 'p-new', title: 'Mobile', goalId: 'g1' } });
    expect(c.data.project).toMatchObject({ id: 'p-new', goal_id: 'g1', progress_percent: null, tasks_total: 0 });
    expect(c.undo.op).toEqual({ kind: 'remove_created_project', projectId: 'p-new' });
    const u = handleMcpWrite(state(), setters, { method: 'update_project', params: { projectId: 'p1', clear: ['goal'] } });
    expect('goal_id' in u.data.project).toBe(false);
    expect(u.undo.op).toEqual({ kind: 'restore_project_fields', projectId: 'p1', before: { goalId: 'g1' } });
    const a = handleMcpWrite(state(), makeSetters(), { method: 'update_project', params: { projectId: 'p1', set: { status: 'archived' } } });
    expect(a).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
  it('create_project and update_project carry the project target date, and undo names the absent field', () => {
    const setters = makeSetters();
    const c = handleMcpWrite(state(), setters, { method: 'create_project', params: { projectId: 'p-dated', title: 'Roof', targetDate: '2026-12-01' } });
    expect(c.data.project).toMatchObject({ id: 'p-dated', target_date: '2026-12-01' });
    const u = handleMcpWrite(state(), setters, { method: 'update_project', params: { projectId: 'p1', set: { targetDate: '2026-12-01' } } });
    expect(u.data.project.target_date).toBe('2026-12-01');
    expect(u.undo).toEqual({
      summary: 'Edited project “Backend” (target_date)',
      op: { kind: 'restore_project_fields', projectId: 'p1', before: {}, absentBefore: ['targetDate'] },
    });
    const dated = { ...state(), projects: [{ id: 'p1', title: 'Backend', status: 'active', targetDate: '2026-12-01' }] };
    const cleared = handleMcpWrite(dated, makeSetters(), { method: 'update_project', params: { projectId: 'p1', clear: ['target_date'] } });
    expect('target_date' in cleared.data.project).toBe(false);
    expect(cleared.undo.op).toMatchObject({ before: { targetDate: '2026-12-01' } });
  });
  it('add_subtask and update_subtask answer with the host entity plus the subtask, and reverse per subtask', () => {
    const setters = makeSetters();
    const a = handleMcpWrite(state(), setters, { method: 'add_subtask', params: { taskId: 'b1', subtaskId: 's2', title: 'Hang door' } });
    expect(a.data.block.subtasks).toHaveLength(2);
    expect(a.data.subtask).toEqual({ id: 's2', title: 'Hang door', completed: false });
    expect(a.undo).toEqual({ summary: 'Added subtask to “Block”', op: { kind: 'remove_created_subtask', taskId: 'b1', subtaskId: 's2' } });
    expect(setters.setTasks).toHaveBeenCalledTimes(1);
    const u = handleMcpWrite(state(), makeSetters(), { method: 'update_subtask', params: { taskId: 'b1', subtaskId: 's1', set: { completed: true } } });
    expect(u.data.subtask).toEqual({ id: 's1', title: 'Nails', completed: true });
    expect(u.undo).toEqual({ summary: 'Edited a subtask of “Block” (completed)', op: { kind: 'restore_subtask_fields', taskId: 'b1', subtaskId: 's1', before: { completed: false } } });
  });
  it('update_task moves a task into a project and the response carries project_id', () => {
    const s = { ...state(), projects: [...state().projects, { id: 'p2', title: 'Docs', status: 'active' }] };
    const r = handleMcpWrite(s, makeSetters(), { method: 'update_task', params: { taskId: 'u1', set: { projectId: 'p2' }, clear: [] } });
    expect(r.data.task.project_id).toBe('p2');
    expect(r.undo.op).toEqual({ kind: 'restore_task_fields', taskId: 'u1', before: {}, absentBefore: ['projectId'] });
  });
  it('undo_mcp_writes routes goal and project ops to their setters and the hook deletes, task ops as before', () => {
    const setters = makeSetters();
    const s = { ...state(), goals: [...state().goals, { id: 'g-new', title: 'Made', status: 'active' }] };
    const r = handleMcpWrite(s, setters, { method: 'undo_mcp_writes', params: { ops: [
      { kind: 'remove_created_goal', goalId: 'g-new' },
      { kind: 'restore_project_fields', projectId: 'p1', before: { title: 'Back end' } },
      { kind: 'remove_created_subtask', taskId: 'b1', subtaskId: 's1' },
    ] } });
    expect(r).toEqual({ ok: true, data: { undone: 3, skipped: 0 } });
    expect(setters.setGoals.mock.calls[0][0]().map((g) => g.id)).toEqual(['g1']);
    expect(setters.deleteGoal).toHaveBeenCalledWith('g-new');
    expect(setters.setProjects.mock.calls[0][0]()[0].title).toBe('Back end');
    expect(setters.setTasks.mock.calls[0][0][0].subtasks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A create or schedule the call gives no duration (#2367, #2336): the project's
// New task default, else the user's default task duration (state.defaultTaskDuration,
// read per write by useMcpBridge), else 30. The main process invents none
// (electron/mcpCreateArgs.ts), so a scheduled create and a series take it too.
// ---------------------------------------------------------------------------
describe('the duration a create or schedule takes when the call gives none', () => {
  const DATE = '2026-08-10';
  const fitness = { id: 'p-fit', title: 'Fitness', color: 'bg-emerald-500', status: 'active', taskDefaults: { duration: 45 } };
  const plain = { id: 'p-plain', title: 'Plain', color: 'bg-blue-500', status: 'active' };
  const st = (over = {}) => ({ tasks: [], unscheduledTasks: [], recurringTasks: [], users: [], goals: [], projects: [fitness, plain], ...over });
  const at = (startTime) => ({ date: DATE, startTime, allDay: false });
  const create = (state, params) => handleMcpWrite(state, makeSetters(), { method: 'create_task', params });

  it('the project\'s New task default, for an inbox, a scheduled and a repeating create', () => {
    expect(create(st(), { taskId: 'i1', title: 'Run', projectId: 'p-fit' }).data.task.duration_minutes).toBe(45);
    expect(create(st(), { taskId: 's1', title: 'Run', projectId: 'p-fit', schedule: at('07:00') }).data.block.duration_minutes).toBe(45);
    const setters = makeSetters();
    handleMcpWrite(st(), setters, { method: 'create_task', params: {
      taskId: 'r1', title: 'Run', projectId: 'p-fit', schedule: at('07:00'), recurrence: { type: 'daily' },
    } });
    expect(setters.setRecurringTasks.mock.calls[0][0][0].duration).toBe(45);
  });

  it('the project\'s default wins over the user\'s default task duration', () => {
    const r = create(st({ defaultTaskDuration: 60 }), { taskId: 's2', title: 'Run', projectId: 'p-fit', schedule: at('07:00') });
    expect(r.data.block.duration_minutes).toBe(45);
  });

  it('no project, or a project with no default duration: the user\'s default task duration', () => {
    const s = st({ defaultTaskDuration: 60 });
    expect(create(s, { taskId: 'i3', title: 'Call' }).data.task.duration_minutes).toBe(60);
    expect(create(s, { taskId: 's3', title: 'Call', schedule: at('11:00') }).data.block.duration_minutes).toBe(60);
    expect(create(s, { taskId: 's4', title: 'Call', projectId: 'p-plain', schedule: at('11:00') }).data.block.duration_minutes).toBe(60);
  });

  it('30 when there is neither, or the setting is unreadable', () => {
    expect(create(st(), { taskId: 's5', title: 'Call', schedule: at('11:00') }).data.block.duration_minutes).toBe(30);
    expect(create(st({ defaultTaskDuration: 0 }), { taskId: 's6', title: 'Call', schedule: at('11:00') }).data.block.duration_minutes).toBe(30);
  });

  it('what the call (that is, the user) asks for always wins', () => {
    const s = st({ defaultTaskDuration: 60 });
    expect(create(s, { taskId: 'i7', title: 'Run', projectId: 'p-fit', durationMinutes: 20 }).data.task.duration_minutes).toBe(20);
    expect(create(s, { taskId: 's7', title: 'Run', projectId: 'p-fit', schedule: { ...at('07:00'), durationMinutes: 20 } })
      .data.block.duration_minutes).toBe(20);
  });

  it('the routine check uses the duration the task will have, not 30', () => {
    // A routine 09:00-10:00. Created at 08:30 with no duration: 30 minutes
    // ends at 09:00 and fits; the user's 60 would run into the routine.
    const routine = { routines: [{ id: 'rt', name: 'Morning pages', startTime: '09:00', duration: 60, isAllDay: false }],
      routinesDate: DATE, routineCompletions: {}, routinesEnabled: true, todayDate: DATE };
    expect(create(st(routine), { taskId: 'c1', title: 'Call', schedule: at('08:30') }).ok).toBe(true);
    const r = create(st({ ...routine, defaultTaskDuration: 60 }), { taskId: 'c2', title: 'Call', schedule: at('08:30') });
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe('routine_conflict');
  });

  it('schedule_task: the task\'s own duration, else the user\'s default', () => {
    const s = st({ defaultTaskDuration: 60, unscheduledTasks: [{ id: 'u1', title: 'Own', duration: 20 }, { id: 'u2', title: 'None' }] });
    const own = handleMcpWrite(s, makeSetters(), { method: 'schedule_task', params: { taskId: 'u1', date: DATE, startTime: '13:00' } });
    expect(own.data.block.duration_minutes).toBe(20);
    const none = handleMcpWrite(s, makeSetters(), { method: 'schedule_task', params: { taskId: 'u2', date: DATE, startTime: '13:00' } });
    expect(none.data.block.duration_minutes).toBe(60);
  });
});
