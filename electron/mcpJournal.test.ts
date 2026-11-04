import { describe, it, expect } from 'vitest';
import { summaryTitle } from '@glance-apps/mcp-host';
import {
  journalSnapshot,
  undoGroupKey,
  journalGroups,
  mcpIndicator,
  composeTrayTitle,
  type JournalEntry,
  type UndoOp,
} from './mcpJournal.js';

// §4.3 write journal + §6.5 indicator, dayGLANCE's half. Load-bearing: the
// per-task partition of dayGLANCE's undo ops, the snapshot never leaks
// before-state copies to the display surface, and the MCP glyph is distinct
// from and never displaced by the base tray states. The generic journal
// (append, summary titles, undo plan order) is tested with
// @glance-apps/mcp-host (packages/mcp-host/test/journal.test.js).

const op = (taskId: string): UndoOp => ({ kind: 'remove_created', taskId });

const entry = (over: Partial<JournalEntry> = {}): JournalEntry => ({
  seq: 1, at: '2026-08-12T10:00:00.000Z', tool: 'dayglance_create_task',
  summary: 'Created "x"', op: op('t1'), ...over,
});

describe('journalSnapshot', () => {
  const entries = Array.from({ length: 60 }, (_, i) => entry({ seq: i + 1, summary: `write ${i + 1}` }));

  it('newest first, display-trimmed, but total stays the full session count', () => {
    const snap = journalSnapshot(entries);
    expect(snap.total).toBe(60);
    expect(snap.entries).toHaveLength(50);
    expect(snap.entries[0].summary).toBe('write 60');
    expect(snap.entries[49].summary).toBe('write 11');
  });

  it('never exposes the undo op (before-state user data) to the display surface', () => {
    const snap = journalSnapshot([entry()]);
    expect(snap.entries[0]).not.toHaveProperty('op');
  });

  it('each display row carries its per-task group key', () => {
    const snap = journalSnapshot([
      entry({ seq: 1, op: { kind: 'remove_created', taskId: 'a' } }),
      entry({ seq: 2, op: { kind: 'restore_block_fields', blockId: 'b', before: {} } }),
    ]);
    expect(snap.entries.map((e) => e.groupKey)).toEqual(['b', 'a']);
  });

  it('group counts come from the FULL journal, not the last-50 display trim', () => {
    // 60 writes to one task: the display shows 50 rows, but the group must
    // report all 60 — a count from the trimmed list would undercount.
    const snap = journalSnapshot(entries);
    expect(snap.entries).toHaveLength(50);
    expect(snap.groups).toHaveLength(1);
    expect(snap.groups[0]).toMatchObject({ key: 't1', count: 60 });
  });
});

describe('undoGroupKey — the per-task partition', () => {
  it('create, schedule, and completion group by taskId; move/resize by blockId — the same id for the same task', () => {
    expect(undoGroupKey({ kind: 'remove_created', taskId: 't1' })).toBe('t1');
    expect(undoGroupKey({ kind: 'restore_unscheduled', taskId: 't1', beforeTask: { id: 't1' } })).toBe('t1');
    expect(undoGroupKey({ kind: 'restore_completion', taskId: 't1', before: { completed: false } })).toBe('t1');
    // A task's id is stable across scheduling, so a create → schedule → move
    // history all lands in one group.
    expect(undoGroupKey({ kind: 'restore_block_fields', blockId: 't1', before: { duration: 30 } })).toBe('t1');
  });

  it('update_task edits group by taskId too: the id survives renames, so the partition holds', () => {
    expect(undoGroupKey({ kind: 'restore_task_fields', taskId: 't1', before: { title: 'Old' } })).toBe('t1');
    expect(undoGroupKey({ kind: 'restore_task_fields', taskId: 't1', before: {}, absentBefore: ['deadline'] })).toBe('t1');
  });

  it('subtask ops group with their host task; goal and project ops group per entity under a prefix (2026-10-04)', () => {
    expect(undoGroupKey({ kind: 'remove_created_subtask', taskId: 't1', subtaskId: 's1' })).toBe('t1');
    expect(undoGroupKey({ kind: 'restore_subtask_fields', taskId: 't1', subtaskId: 's1', before: { title: 'x' } })).toBe('t1');
    expect(undoGroupKey({ kind: 'remove_created_goal', goalId: 'g1' })).toBe('goal:g1');
    expect(undoGroupKey({ kind: 'restore_goal_fields', goalId: 'g1', before: { title: 'x' } })).toBe('goal:g1');
    expect(undoGroupKey({ kind: 'remove_created_project', projectId: 'p1' })).toBe('project:p1');
    expect(undoGroupKey({ kind: 'restore_project_fields', projectId: 'p1', before: {} })).toBe('project:p1');
    // A goal and a task sharing an id never share a group.
    expect(undoGroupKey({ kind: 'remove_created_goal', goalId: 't1' })).not.toBe(undoGroupKey({ kind: 'remove_created', taskId: 't1' }));
    // A description written into a linked note groups with its entity.
    expect(undoGroupKey({ kind: 'restore_note_description', entityKind: 'goal', entityId: 'g1', path: 'Goals/Home.md', before: '' })).toBe('goal:g1');
    expect(undoGroupKey({ kind: 'restore_note_description', entityKind: 'project', entityId: 'p1', path: 'P.md', before: 'x', afterBase: 'h' })).toBe('project:p1');
  });

  it('recurring completions group per INSTANCE (template::date), never per template', () => {
    const tue = undoGroupKey({ kind: 'restore_recurring_completion', templateId: 42, dateStr: '2026-08-11', wasCompleted: false });
    const wed = undoGroupKey({ kind: 'restore_recurring_completion', templateId: 42, dateStr: '2026-08-12', wasCompleted: false });
    expect(tue).toBe('42::2026-08-11');
    expect(wed).toBe('42::2026-08-12');
    expect(tue).not.toBe(wed);
  });

  it('a series create and its edits group per SERIES, apart from its per-date completions (#2066)', () => {
    const created = undoGroupKey({ kind: 'remove_created_series', templateId: 42 });
    const edited = undoGroupKey({ kind: 'restore_series_fields', templateId: 42, before: {}, exceptionsBefore: { '2026-08-11': null } });
    expect(created).toBe('series:42');
    expect(edited).toBe(created);
    expect(created).not.toBe(undoGroupKey({ kind: 'restore_recurring_completion', templateId: 42, dateStr: '2026-08-11', wasCompleted: false }));
    expect(created).not.toBe(undoGroupKey({ kind: 'remove_created', taskId: '42' }));
    expect(summaryTitle('Edited repeating “Standup” (2026-08-11: start_time)')).toBe('Standup');
    expect(summaryTitle('Created repeating “Standup” from 2026-08-10')).toBe('Standup');
  });

  it('THROWS on an unknown op kind — a future multi-task op must fail visibly, not group wrong', () => {
    expect(() => undoGroupKey({ kind: 'bulk_reschedule' } as unknown as UndoOp)).toThrow(/unknown undo op kind "bulk_reschedule"/);
    expect(() => undoGroupKey(undefined as unknown as UndoOp)).toThrow(/unknown undo op kind/);
  });
});

describe('journalGroups — per-task groups over the full journal', () => {
  const history = [
    entry({ seq: 1, summary: 'Created “Alpha”', op: { kind: 'remove_created', taskId: 'a' } }),
    entry({ seq: 2, summary: 'Created “Beta”', op: { kind: 'remove_created', taskId: 'b' } }),
    entry({ seq: 3, summary: 'Scheduled “Alpha” at 2026-08-12 10:00', op: { kind: 'restore_unscheduled', taskId: 'a', beforeTask: { id: 'a' } } }),
    entry({ seq: 4, summary: 'Moved “Alpha” from 2026-08-12 10:00 to 2026-08-12 11:00', op: { kind: 'restore_block_fields', blockId: 'a', before: { date: '2026-08-12' } } }),
  ];

  it('counts every entry for the task and orders groups by newest activity first', () => {
    const groups = journalGroups(history);
    expect(groups).toHaveLength(2);
    // Alpha's latest write (seq 4) outranks Beta's (seq 2) even though Beta
    // was created after Alpha.
    expect(groups[0]).toMatchObject({ key: 'a', label: 'Alpha', count: 3, latestSeq: 4 });
    expect(groups[1]).toMatchObject({ key: 'b', label: 'Beta', count: 1, latestSeq: 2 });
  });

  it('a rename updates the group label: latest entry wins BY DESIGN, and the update summary quotes only the new title', () => {
    const renamed = [
      ...history,
      entry({
        seq: 5,
        summary: 'Edited “Alpha v2” (title, priority)',
        op: { kind: 'restore_task_fields', taskId: 'a', before: { title: 'Alpha', priority: 1 } },
      }),
    ];
    const groups = journalGroups(renamed);
    expect(groups[0]).toMatchObject({ key: 'a', label: 'Alpha v2', count: 4, latestSeq: 5 });
    // The one-quoted-span rule that makes this work: summaryTitle spans first
    // “ to last ”, so the update summary must never quote the old title too.
    expect(summaryTitle('Edited “Alpha v2” (title, priority)')).toBe('Alpha v2');
  });

  it('recurring groups get the instance date in the label so two dates stay tellable apart', () => {
    const groups = journalGroups([
      entry({ seq: 1, summary: 'Marked “Standup” (2026-08-11) complete', op: { kind: 'restore_recurring_completion', templateId: 42, dateStr: '2026-08-11', wasCompleted: false } }),
      entry({ seq: 2, summary: 'Marked “Standup” (2026-08-12) complete', op: { kind: 'restore_recurring_completion', templateId: 42, dateStr: '2026-08-12', wasCompleted: false } }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['Standup (2026-08-12)', 'Standup (2026-08-11)']);
  });

  it('falls back to the raw summary when no quoted title exists', () => {
    const groups = journalGroups([entry({ seq: 1, summary: 'write 1' })]);
    expect(groups[0].label).toBe('write 1');
  });

  it('empty journal → no groups', () => {
    expect(journalGroups([])).toEqual([]);
  });
});

describe('mcpIndicator — §6.5 tier mapping', () => {
  it('unbound → no glyph', () => {
    expect(mcpIndicator({ bound: false, includeNative: false, includeWrites: false }))
      .toEqual({ glyph: '', label: 'MCP server off' });
  });

  it('reads-only tiers → ⌁, with the tier named', () => {
    expect(mcpIndicator({ bound: true, includeNative: false, includeWrites: false }))
      .toEqual({ glyph: '⌁', label: 'MCP on: reads dayGLANCE data' });
    expect(mcpIndicator({ bound: true, includeNative: true, includeWrites: false }))
      .toEqual({ glyph: '⌁', label: 'MCP on: reads incl. device calendar' });
  });

  it('writes tier → distinct glyph ⚡ and "+ writes" in the label', () => {
    const ind = mcpIndicator({ bound: true, includeNative: false, includeWrites: true });
    expect(ind.glyph).toBe('⚡');
    expect(ind.label).toBe('MCP on: reads dayGLANCE data + writes');
    expect(mcpIndicator({ bound: true, includeNative: true, includeWrites: true }).label)
      .toBe('MCP on: reads incl. device calendar + writes');
  });

  it('the glyphs are distinct from the reminder dot', () => {
    for (const g of ['⌁', '⚡']) expect(g).not.toBe('●');
  });
});

describe('composeTrayTitle — focus and reminder state ONLY, no MCP glyph in any tier state', () => {
  it('focus countdown takes priority, reminder dot fills its slot, else empty', () => {
    expect(composeTrayTitle({ focusTitle: '12:34', reminderOn: false })).toBe('12:34');
    expect(composeTrayTitle({ focusTitle: '12:34', reminderOn: true })).toBe('12:34');
    expect(composeTrayTitle({ focusTitle: '', reminderOn: true })).toBe('●');
    expect(composeTrayTitle({ focusTitle: '', reminderOn: false })).toBe('');
  });
});
