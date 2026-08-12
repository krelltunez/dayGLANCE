import { describe, it, expect } from 'vitest';
import {
  appendEntry,
  journalSnapshot,
  buildUndoPlan,
  undoGroupKey,
  summaryTitle,
  journalGroups,
  mcpIndicator,
  composeTrayTitle,
  type JournalEntry,
  type UndoOp,
} from './mcpJournal.js';

// §4.3 write journal + §6.5 indicator. Load-bearing: the undo plan reverses
// chronological order (compound histories must unwind), the snapshot never
// leaks before-state copies to the display surface, and the MCP glyph is
// distinct from and never displaced by the base tray states.

const op = (taskId: string): UndoOp => ({ kind: 'remove_created', taskId });

const entry = (over: Partial<JournalEntry> = {}): JournalEntry => ({
  seq: 1, at: '2026-08-12T10:00:00.000Z', tool: 'dayglance_create_task',
  summary: 'Created "x"', op: op('t1'), ...over,
});

describe('appendEntry', () => {
  it('appends immutably with monotonically increasing seq', () => {
    const first = appendEntry([], { tool: 'dayglance_create_task', summary: 'Created "a"', op: op('a') }, '2026-08-12T10:00:00.000Z');
    const second = appendEntry(first, { tool: 'dayglance_move_block', summary: 'Moved "a"', op: op('a'), idempotencyKey: 'k1' }, '2026-08-12T10:01:00.000Z');
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(2);
    expect(second[0].seq).toBe(1);
    expect(second[1]).toMatchObject({ seq: 2, at: '2026-08-12T10:01:00.000Z', idempotencyKey: 'k1' });
    expect(second[1].tool).toBe('dayglance_move_block');
  });

  it('records tool, time, and what changed (exit criterion 3 fields)', () => {
    const [e] = appendEntry([], { tool: 'dayglance_resize_block', summary: 'Resized "Standup" to 30 min', op: op('r') }, '2026-08-12T11:00:00.000Z');
    expect(e.tool).toBe('dayglance_resize_block');
    expect(e.at).toBe('2026-08-12T11:00:00.000Z');
    expect(e.summary).toContain('Resized');
  });
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

  it('recurring completions group per INSTANCE (template::date), never per template', () => {
    const tue = undoGroupKey({ kind: 'restore_recurring_completion', templateId: 42, dateStr: '2026-08-11', wasCompleted: false });
    const wed = undoGroupKey({ kind: 'restore_recurring_completion', templateId: 42, dateStr: '2026-08-12', wasCompleted: false });
    expect(tue).toBe('42::2026-08-11');
    expect(wed).toBe('42::2026-08-12');
    expect(tue).not.toBe(wed);
  });

  it('THROWS on an unknown op kind — a future multi-task op must fail visibly, not group wrong', () => {
    expect(() => undoGroupKey({ kind: 'bulk_reschedule' } as unknown as UndoOp)).toThrow(/unknown undo op kind "bulk_reschedule"/);
    expect(() => undoGroupKey(undefined as unknown as UndoOp)).toThrow(/unknown undo op kind/);
  });
});

describe('summaryTitle — titles live only inside summaries, quoted “ ”', () => {
  it('extracts the title from every summary shape the write model produces', () => {
    expect(summaryTitle('Created “Buy milk”')).toBe('Buy milk');
    expect(summaryTitle('Scheduled “Buy milk” at 2026-08-12 10:00')).toBe('Buy milk');
    expect(summaryTitle('Moved “Buy milk” from 2026-08-12 10:00 to 2026-08-13 09:00')).toBe('Buy milk');
    expect(summaryTitle('Resized “Buy milk” from 30 to 45 min')).toBe('Buy milk');
    expect(summaryTitle('Marked “Buy milk” complete')).toBe('Buy milk');
    expect(summaryTitle('Marked “Standup” (2026-08-12) incomplete')).toBe('Standup');
  });

  it('titles with embedded closing quotes survive (first “ to LAST ”)', () => {
    expect(summaryTitle('Moved “say ”hi”” from 2026-08-12 10:00 to 2026-08-12 11:00')).toBe('say ”hi”');
  });

  it('no quoted span → null', () => {
    expect(summaryTitle('write 12')).toBeNull();
    expect(summaryTitle('')).toBeNull();
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

describe('buildUndoPlan', () => {
  it('reverses chronological order so compound histories unwind', () => {
    const entries = [
      entry({ seq: 1, op: { kind: 'remove_created', taskId: 'a' } }),
      entry({ seq: 2, op: { kind: 'restore_unscheduled', taskId: 'a', beforeTask: { id: 'a' } } }),
      entry({ seq: 3, op: { kind: 'restore_block_fields', blockId: 'a', before: { date: '2026-08-12' } } }),
    ];
    const plan = buildUndoPlan(entries);
    expect(plan.count).toBe(3);
    expect(plan.ops.map((o) => o.kind)).toEqual(['restore_block_fields', 'restore_unscheduled', 'remove_created']);
  });

  it('empty journal → empty plan', () => {
    expect(buildUndoPlan([])).toEqual({ count: 0, ops: [] });
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
