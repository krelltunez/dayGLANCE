import { describe, it, expect } from 'vitest';
import {
  appendEntry,
  journalSnapshot,
  buildUndoPlan,
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

describe('composeTrayTitle', () => {
  it('appends the MCP glyph to focus title and reminder dot instead of replacing them', () => {
    expect(composeTrayTitle({ focusTitle: '12:34', reminderOn: false, mcpGlyph: '⌁' })).toBe('12:34 ⌁');
    expect(composeTrayTitle({ focusTitle: '', reminderOn: true, mcpGlyph: '⚡' })).toBe('● ⚡');
  });

  it('glyph alone when there is no other state; base states unchanged when unbound', () => {
    expect(composeTrayTitle({ focusTitle: '', reminderOn: false, mcpGlyph: '⌁' })).toBe('⌁');
    expect(composeTrayTitle({ focusTitle: '', reminderOn: false, mcpGlyph: '' })).toBe('');
    expect(composeTrayTitle({ focusTitle: '12:34', reminderOn: false, mcpGlyph: '' })).toBe('12:34');
    expect(composeTrayTitle({ focusTitle: '', reminderOn: true, mcpGlyph: '' })).toBe('●');
  });
});
