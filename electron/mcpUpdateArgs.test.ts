import { describe, it, expect } from 'vitest';
import { planUpdateTask } from './mcpUpdateArgs.js';

// Argument-shape rules for update_task. The contract under test is the
// tool's whole semantics: absent leaves alone, present sets, clear_fields
// removes, and clearing is only ever the explicit list (never null, never
// empty values). State-dependent rejections live in taskMutations.js and
// are tested there.

const plan = (args: Record<string, unknown>, multiUser = true) => planUpdateTask(args, multiUser);

describe('planUpdateTask — basics', () => {
  it('rejects a missing or empty task_id', () => {
    expect(plan({ title: 'x' })).toMatchObject({ ok: false, code: 'validation' });
    expect(plan({ task_id: '  ', title: 'x' })).toMatchObject({ ok: false });
  });

  it('rejects a call that neither sets nor clears anything', () => {
    const r = plan({ task_id: 't1' });
    expect(r).toMatchObject({ ok: false, code: 'validation' });
    expect((r as { message: string }).message).toMatch(/Nothing to change/);
  });

  it('shapes set fields into renderer params, trimming the title', () => {
    const r = plan({ task_id: 't1', title: '  Renamed  ', notes: 'n', priority: 2, deadline: '2026-09-01', assignee_id: 'u-1' });
    expect(r).toEqual({
      ok: true,
      plan: {
        taskId: 't1',
        set: { title: 'Renamed', notes: 'n', priority: 2, deadline: '2026-09-01', assigneeSyncId: 'u-1' },
        clear: [],
      },
    });
  });

  it('absent fields stay absent from the plan (leave-alone semantics)', () => {
    const r = plan({ task_id: 't1', notes: 'only notes' });
    expect(r).toEqual({ ok: true, plan: { taskId: 't1', set: { notes: 'only notes' }, clear: [] } });
  });
});

describe('planUpdateTask — field validation', () => {
  it('rejects an empty or non-string title', () => {
    expect(plan({ task_id: 't1', title: '' })).toMatchObject({ ok: false });
    expect(plan({ task_id: 't1', title: '   ' })).toMatchObject({ ok: false });
    expect(plan({ task_id: 't1', title: 7 })).toMatchObject({ ok: false });
  });

  it('rejects priority outside 0-3 or non-integer', () => {
    for (const bad of [-1, 4, 1.5, '2']) {
      expect(plan({ task_id: 't1', priority: bad })).toMatchObject({ ok: false, code: 'validation' });
    }
    expect(plan({ task_id: 't1', priority: 0 })).toMatchObject({ ok: true });
    expect(plan({ task_id: 't1', priority: 3 })).toMatchObject({ ok: true });
  });

  it('rejects a malformed deadline, accepts a strict local date', () => {
    for (const bad of ['2026-9-1', '2026-02-30', '2026-09-01T00:00', 'tomorrow']) {
      expect(plan({ task_id: 't1', deadline: bad })).toMatchObject({ ok: false });
    }
    expect(plan({ task_id: 't1', deadline: '2026-09-01' })).toMatchObject({ ok: true });
  });

  it('rejects a non-string notes value', () => {
    expect(plan({ task_id: 't1', notes: null })).toMatchObject({ ok: false });
  });

  it('accepts empty-string notes as a SET (distinct from clearing)', () => {
    expect(plan({ task_id: 't1', notes: '' })).toMatchObject({ ok: true, plan: { set: { notes: '' } } });
  });

  it('rejects an empty assignee_id', () => {
    expect(plan({ task_id: 't1', assignee_id: '' })).toMatchObject({ ok: false });
  });
});

describe('planUpdateTask — clear_fields', () => {
  it('accepts the clearable set and dedupes', () => {
    const r = plan({ task_id: 't1', clear_fields: ['notes', 'deadline', 'assignee', 'notes'] });
    expect(r).toEqual({ ok: true, plan: { taskId: 't1', set: {}, clear: ['notes', 'deadline', 'assignee'] } });
  });

  it('rejects clearing title with wording that names the reason', () => {
    const r = plan({ task_id: 't1', clear_fields: ['title'] });
    expect(r).toMatchObject({ ok: false, code: 'validation' });
    expect((r as { message: string }).message).toMatch(/required on every task/);
  });

  it('rejects fields outside the editable set, naming the clearable ones', () => {
    for (const bad of ['priority', 'project_id', 'completed', 'date', 'id', 42]) {
      const r = plan({ task_id: 't1', clear_fields: [bad] });
      expect(r).toMatchObject({ ok: false, code: 'validation' });
      expect((r as { message: string }).message).toMatch(/notes, deadline, assignee/);
    }
  });

  it('rejects a non-array clear_fields', () => {
    expect(plan({ task_id: 't1', clear_fields: 'notes' })).toMatchObject({ ok: false });
  });

  it('rejects set-and-clear of the same field, all three clearables', () => {
    expect(plan({ task_id: 't1', deadline: '2026-09-01', clear_fields: ['deadline'] })).toMatchObject({ ok: false });
    expect(plan({ task_id: 't1', notes: 'x', clear_fields: ['notes'] })).toMatchObject({ ok: false });
    expect(plan({ task_id: 't1', assignee_id: 'u-1', clear_fields: ['assignee'] })).toMatchObject({ ok: false });
  });

  it('gates assignee clearing on multi-user mode', () => {
    expect(plan({ task_id: 't1', clear_fields: ['assignee'] }, false)).toMatchObject({ ok: false });
    expect(plan({ task_id: 't1', clear_fields: ['assignee'] }, true)).toMatchObject({ ok: true });
  });

  it('a clear-only call is a valid call', () => {
    expect(plan({ task_id: 't1', clear_fields: ['deadline'] })).toMatchObject({ ok: true });
  });
});
