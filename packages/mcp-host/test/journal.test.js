import { describe, it, expect } from 'vitest';
import {
  appendEntry,
  journalSnapshot,
  journalGroups,
  buildUndoPlan,
  summaryTitle,
  defaultGroupLabel,
} from '../src/journal.js';

// §4.3 write journal. Load-bearing: the undo plan reverses chronological
// order (compound histories must unwind), the snapshot never leaks
// before-state copies to the display surface, and group counts come from the
// full journal, not the display trim. The op vocabulary and its grouping are
// the app's; these tests use a minimal one (dayGLANCE's is pinned in
// electron/mcpJournal.test.ts).

const op = (taskId) => ({ kind: 'remove_created', taskId });

/** A minimal grouping: one entity per op, unknown kinds throw (as the kit asks). */
const GROUPING = {
  groupKey(o) {
    if (o?.kind === 'remove_created' || o?.kind === 'restore_fields') return String(o.taskId);
    throw new Error(`unknown undo op kind ${JSON.stringify(o?.kind)}`);
  },
};

const entry = (over = {}) => ({
  seq: 1, at: '2026-08-12T10:00:00.000Z', tool: 'app_create_task',
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

  it('omits idempotencyKey when the caller sent none', () => {
    const [e] = appendEntry([], { tool: 't', summary: 's', op: op('a') }, '2026-08-12T11:00:00.000Z');
    expect(e).not.toHaveProperty('idempotencyKey');
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

  it('the default group label is the quoted title, else the raw summary', () => {
    expect(defaultGroupLabel({ summary: 'Created “Alpha”' })).toBe('Alpha');
    expect(defaultGroupLabel({ summary: 'write 1' })).toBe('write 1');
  });
});

describe('journalSnapshot', () => {
  const entries = Array.from({ length: 60 }, (_, i) => entry({ seq: i + 1, summary: `write ${i + 1}` }));

  it('newest first, display-trimmed, but total stays the full session count', () => {
    const snap = journalSnapshot(entries, GROUPING);
    expect(snap.total).toBe(60);
    expect(snap.entries).toHaveLength(50);
    expect(snap.entries[0].summary).toBe('write 60');
    expect(snap.entries[49].summary).toBe('write 11');
  });

  it('honors an explicit display limit', () => {
    const snap = journalSnapshot(entries, GROUPING, 5);
    expect(snap.entries.map((e) => e.seq)).toEqual([60, 59, 58, 57, 56]);
    expect(snap.total).toBe(60);
  });

  it('never exposes the undo op (before-state user data) to the display surface', () => {
    const snap = journalSnapshot([entry()], GROUPING);
    expect(snap.entries[0]).not.toHaveProperty('op');
  });

  it('each display row carries its group key, from the host grouping', () => {
    const snap = journalSnapshot([
      entry({ seq: 1, op: { kind: 'remove_created', taskId: 'a' } }),
      entry({ seq: 2, op: { kind: 'restore_fields', taskId: 'b' } }),
    ], GROUPING);
    expect(snap.entries.map((e) => e.groupKey)).toEqual(['b', 'a']);
  });

  it('group counts come from the FULL journal, not the display trim', () => {
    const snap = journalSnapshot(entries, GROUPING);
    expect(snap.entries).toHaveLength(50);
    expect(snap.groups).toHaveLength(1);
    expect(snap.groups[0]).toMatchObject({ key: 't1', count: 60 });
  });
});

describe('journalGroups — per-entity groups over the full journal', () => {
  const history = [
    entry({ seq: 1, summary: 'Created “Alpha”', op: { kind: 'remove_created', taskId: 'a' } }),
    entry({ seq: 2, summary: 'Created “Beta”', op: { kind: 'remove_created', taskId: 'b' } }),
    entry({ seq: 3, summary: 'Edited “Alpha”', op: { kind: 'restore_fields', taskId: 'a' } }),
    entry({ seq: 4, summary: 'Moved “Alpha”', op: { kind: 'restore_fields', taskId: 'a' } }),
  ];

  it('counts every entry for the entity and orders groups by newest activity first', () => {
    const groups = journalGroups(history, GROUPING);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ key: 'a', label: 'Alpha', count: 3, latestSeq: 4 });
    expect(groups[1]).toMatchObject({ key: 'b', label: 'Beta', count: 1, latestSeq: 2 });
  });

  it('the latest entry names the group (a rename relabels it)', () => {
    const groups = journalGroups([...history, entry({ seq: 5, summary: 'Edited “Alpha v2”', op: { kind: 'restore_fields', taskId: 'a' } })], GROUPING);
    expect(groups[0]).toMatchObject({ key: 'a', label: 'Alpha v2', count: 4, latestSeq: 5 });
  });

  it('a host label function replaces the default', () => {
    const groups = journalGroups(history, { ...GROUPING, groupLabel: (e) => `#${e.seq}` });
    expect(groups.map((g) => g.label)).toEqual(['#4', '#2']);
  });

  it('falls back to the raw summary when no quoted title exists', () => {
    expect(journalGroups([entry({ seq: 1, summary: 'write 1' })], GROUPING)[0].label).toBe('write 1');
  });

  it('an op the host grouping does not know fails loudly at the grouping seam', () => {
    expect(() => journalGroups([entry({ op: { kind: 'bulk_reschedule' } })], GROUPING)).toThrow(/unknown undo op kind "bulk_reschedule"/);
    expect(() => journalSnapshot([entry({ op: { kind: 'bulk_reschedule' } })], GROUPING)).toThrow(/unknown undo op kind/);
  });

  it('empty journal → no groups', () => {
    expect(journalGroups([], GROUPING)).toEqual([]);
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

  it('does not reorder the journal it was given', () => {
    const entries = [entry({ seq: 1 }), entry({ seq: 2 })];
    buildUndoPlan(entries);
    expect(entries.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('empty journal → empty plan', () => {
    expect(buildUndoPlan([])).toEqual({ count: 0, ops: [] });
  });
});
