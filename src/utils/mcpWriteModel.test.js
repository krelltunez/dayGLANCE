import { describe, it, expect, vi } from 'vitest';
import { handleMcpWrite, isWriteMethod } from './mcpWriteModel.js';

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
});

const B = (over = {}) => ({
  id: 'b1', title: 'Block', date: '2026-08-10', startTime: '09:00',
  duration: 60, completed: false, isAllDay: false, ...over,
});

describe('isWriteMethod', () => {
  it('routes the five write tools plus undo_mcp_writes', () => {
    for (const m of ['create_task', 'schedule_task', 'move_block', 'resize_block', 'set_completion', 'undo_mcp_writes']) {
      expect(isWriteMethod(m)).toBe(true);
    }
    expect(isWriteMethod('get_day')).toBe(false);
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
