// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { inboxItem, toBlock, goalItem, projectItem } from '@glance-apps/dayglance-mcp/model';
import { describeUndoOp } from './mcpJournalRead.js';
import { undoGroupKey, type UndoOp } from './mcpJournal.js';

// dayGLANCE's half of dayglance_list_mcp_writes (#2321): which ids each undo
// op names and which field changes its before-state allows, in the values the
// read tools would show. The generic half (newest first, filter, pagination,
// the op never in a row) is tested in packages/mcp-host/test/journalRead.test.js;
// the tool over the real listener in mcpServer.transport.test.ts.

const TZ = 'UTC';
const describeOp = (op: UndoOp) => describeUndoOp(op, TZ);
const changesOf = (op: UndoOp) => Object.fromEntries((describeOp(op).changes ?? []).map((c) => [c.field, c.before]));

/** One op of every kind dayGLANCE journals (mcpJournal.ts UndoOp). */
const EVERY_KIND: UndoOp[] = [
  { kind: 'remove_created', taskId: 't1' },
  { kind: 'restore_unscheduled', taskId: 't1', beforeTask: { id: 't1', title: 'x' } },
  { kind: 'restore_block_fields', blockId: 't1', before: { duration: 30 } },
  { kind: 'restore_completion', taskId: 't1', before: { completed: false, completedAt: null } },
  { kind: 'restore_recurring_completion', templateId: 's1', dateStr: '2026-10-07', wasCompleted: false },
  { kind: 'remove_created_series', templateId: 's1' },
  { kind: 'restore_series_fields', templateId: 's1', before: { title: 'Standup' } },
  { kind: 'restore_task_fields', taskId: 't1', before: { title: 'x' } },
  { kind: 'remove_created_subtask', taskId: 't1', subtaskId: 'st1' },
  { kind: 'restore_subtask_fields', taskId: 't1', subtaskId: 'st1', before: { title: 'x' } },
  { kind: 'remove_created_goal', goalId: 'g1' },
  { kind: 'restore_goal_fields', goalId: 'g1', before: { title: 'x' } },
  { kind: 'remove_created_project', projectId: 'p1' },
  { kind: 'restore_project_fields', projectId: 'p1', before: { title: 'x' } },
  { kind: 'restore_note_description', entityKind: 'goal', entityId: 'g1', path: 'Goals/Home.md', before: 'old' },
];

describe('describeUndoOp: the ids each op touched', () => {
  it('names at least one entity for every kind the journal records', () => {
    for (const op of EVERY_KIND) {
      // The journal itself only records kinds its grouping knows.
      expect(() => undoGroupKey(op), op.kind).not.toThrow();
      expect(Object.keys(describeOp(op).ids ?? {}), op.kind).not.toHaveLength(0);
    }
  });

  it('uses the read tools\' wire names and ids', () => {
    expect(describeOp({ kind: 'remove_created', taskId: 't1' }).ids).toEqual({ task_id: 't1' });
    // A block is its task: the same id on both surfaces.
    expect(describeOp({ kind: 'restore_block_fields', blockId: 't1', before: { duration: 30 } }).ids).toEqual({ task_id: 't1' });
    expect(describeOp({ kind: 'remove_created_subtask', taskId: 't1', subtaskId: 'st1' }).ids).toEqual({ task_id: 't1', subtask_id: 'st1' });
    expect(describeOp({ kind: 'remove_created_goal', goalId: 'g1' }).ids).toEqual({ goal_id: 'g1' });
    expect(describeOp({ kind: 'remove_created_project', projectId: 'p1' }).ids).toEqual({ project_id: 'p1' });
    expect(describeOp({ kind: 'restore_note_description', entityKind: 'project', entityId: 'p1', path: 'x.md', before: '' }).ids).toEqual({ project_id: 'p1' });
  });

  it('a recurring completion names the occurrence as get_day ids it, and its series', () => {
    // Numeric template ids are numbers in storage; the wire ids are strings.
    expect(describeOp({ kind: 'restore_recurring_completion', templateId: 42, dateStr: '2026-10-07', wasCompleted: true }).ids)
      .toEqual({ task_id: 'recurring-42-2026-10-07', series_id: '42' });
    expect(describeOp({ kind: 'restore_series_fields', templateId: 42, before: {} }).ids).toEqual({ series_id: '42' });
  });

  it('an unknown or malformed op is described as nothing, never a throw', () => {
    expect(describeOp({ kind: 'bulk_reschedule' } as unknown as UndoOp)).toEqual({});
    expect(describeOp(null as unknown as UndoOp)).toEqual({});
  });
});

describe('describeUndoOp: field changes, as the read tools would show the values', () => {
  it('update_task: each touched field under its wire name, with the value inboxItem reports', () => {
    const before = { title: 'Old title', notes: 'Old notes', priority: 2, deadline: '2026-10-10', projectId: 'p1', assignedUserSyncIds: ['u1', 'u2'] };
    const changes = changesOf({ kind: 'restore_task_fields', taskId: 't1', before });
    const item = inboxItem({ id: 't1', ...before }) as Record<string, unknown>;
    expect(changes).toEqual({
      title: item.title, notes: item.notes, priority: item.priority, deadline: item.deadline,
      project_id: item.project_id, assignee_id: item.assignee_id,
    });
    expect(changes).toEqual({ title: 'Old title', notes: 'Old notes', priority: 2, deadline: '2026-10-10', project_id: 'p1', assignee_id: 'u1' });
  });

  it('a field the task did not have reads as the read surface shows absence', () => {
    const changes = changesOf({ kind: 'restore_task_fields', taskId: 't1', before: {}, absentBefore: ['deadline', 'projectId', 'priority', 'notes'] });
    expect(changes).toEqual({ deadline: null, project_id: null, priority: 0, notes: null });
  });

  it('never renders a storage key it has no wire name for', () => {
    const d = describeOp({ kind: 'restore_task_fields', taskId: 't1', before: { title: 'x', lastModified: 'L', transitionId: 'T', bucketId: 'B' } });
    expect(d.changes).toEqual([{ field: 'title', before: 'x' }]);
  });

  it('move and resize: the block fields toBlock reports', () => {
    const moved = changesOf({ kind: 'restore_block_fields', blockId: 't1', before: { date: '2026-10-04', startTime: '09:00', isAllDay: false } });
    const block = toBlock({ id: 't1', title: 'x', date: '2026-10-04', startTime: '09:00', isAllDay: false }) as Record<string, unknown>;
    expect(moved).toEqual({ date: block.date, start_time: block.start_time, all_day: block.all_day });
    // An all-day block has no start time on the wire, whatever storage holds.
    expect(changesOf({ kind: 'restore_block_fields', blockId: 't1', before: { date: '2026-10-04', startTime: '00:00', isAllDay: true } }))
      .toEqual({ date: '2026-10-04', start_time: null, all_day: true });
    expect(changesOf({ kind: 'restore_block_fields', blockId: 't1', before: { duration: 45 } })).toEqual({ duration_minutes: 45 });
  });

  it('schedule: it was unscheduled, and the priority and deadline the strip dropped', () => {
    const op: UndoOp = {
      kind: 'restore_unscheduled', taskId: 't1',
      beforeTask: { id: 't1', title: 'Call', priority: 3, deadline: '2026-10-09', duration: 30, lastModified: 'internal', transitionId: 'k' },
    };
    expect(describeOp(op).changes).toEqual([
      { field: 'date', before: null },
      { field: 'start_time', before: null },
      { field: 'priority', before: 3 },
      { field: 'deadline', before: '2026-10-09' },
    ]);
    // Priority 0 is "no priority": nothing was dropped, so nothing is claimed.
    expect(changesOf({ kind: 'restore_unscheduled', taskId: 't1', beforeTask: { priority: 0 } })).toEqual({ date: null, start_time: null });
    expect(JSON.stringify(describeOp(op))).not.toMatch(/internal|transitionId|lastModified/);
  });

  it('completion: completed and completed_at in the wire stamp form', () => {
    expect(changesOf({ kind: 'restore_completion', taskId: 't1', before: { completed: true, completedAt: '2026-10-03T17:45:00.000Z' } }))
      .toEqual({ completed: true, completed_at: { date: '2026-10-03', time: '17:45' } });
    expect(changesOf({ kind: 'restore_completion', taskId: 't1', before: { completed: false, completedAt: null } }))
      .toEqual({ completed: false, completed_at: null });
    expect(changesOf({ kind: 'restore_recurring_completion', templateId: 's1', dateStr: '2026-10-07', wasCompleted: false }))
      .toEqual({ completed: false });
  });

  it('subtask: title and completion', () => {
    expect(changesOf({ kind: 'restore_subtask_fields', taskId: 't1', subtaskId: 'st1', before: { title: 'Buy nails', completed: false } }))
      .toEqual({ title: 'Buy nails', completed: false });
  });

  it('goal and project: the fields goalItem and projectItem report, under their names', () => {
    const goalBefore = { title: 'Home', description: 'Fix it', startDate: '2026-01-01', targetDate: '2026-12-31', areaId: 'a1', status: 'active', assignedUserSyncIds: ['u1'] };
    const goal = goalItem({ id: 'g1', ...goalBefore }, { projects: [], areas: [] }) as Record<string, unknown>;
    expect(changesOf({ kind: 'restore_goal_fields', goalId: 'g1', before: goalBefore })).toEqual({
      title: goal.title, description: goal.description, start_date: goal.start_date, target_date: goal.target_date,
      area_id: goal.area_id, status: goal.status, assignee_ids: goal.assignee_ids,
    });
    const projectBefore = { title: 'Roof', description: '', goalId: 'g1', targetDate: '2026-11-01', status: 'active', assignedUserSyncIds: ['u2'] };
    const project = projectItem({ id: 'p1', ...projectBefore }) as Record<string, unknown>;
    expect(changesOf({ kind: 'restore_project_fields', projectId: 'p1', before: projectBefore })).toEqual({
      title: project.title, description: project.description, goal_id: project.goal_id, target_date: project.target_date,
      status: project.status, assignee_ids: project.assignee_ids,
    });
    expect(changesOf({ kind: 'restore_goal_fields', goalId: 'g1', before: {}, absentBefore: ['targetDate', 'areaId', 'assignedUserSyncIds'] }))
      .toEqual({ target_date: null, area_id: null, assignee_ids: null });
  });

  it('a note description: the section before, the record half beside it, never the path or hash', () => {
    const d = describeOp({
      kind: 'restore_note_description', entityKind: 'goal', entityId: 'g1', path: 'Goals/Home.md', before: 'Old section', afterBase: 'hash123',
      fields: { kind: 'restore_goal_fields', goalId: 'g1', before: { title: 'Home' } },
    });
    expect(d.changes).toEqual([{ field: 'description', before: 'Old section' }, { field: 'title', before: 'Home' }]);
    expect(JSON.stringify(d)).not.toMatch(/Goals\/Home\.md|hash123/);
  });

  it('creates and series edits claim no field changes', () => {
    for (const op of EVERY_KIND.filter((o) => o.kind.startsWith('remove_created') || o.kind === 'restore_series_fields')) {
      expect(describeOp(op).changes ?? [], op.kind).toEqual([]);
    }
  });
});
