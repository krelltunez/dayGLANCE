import { describe, it, expect } from 'vitest';
import {
  recordRetirements,
  mergeRetiredTaskIds,
  pruneRetiredTaskIds,
  resolveRetirement,
  applyTaskRetirements,
  applyRetirementsToTaskLists,
} from './retiredTaskIds.js';

const T1 = '2026-07-08T10:00:00.000Z';
const T2 = '2026-07-08T11:00:00.000Z';
const T3 = '2026-07-08T12:00:00.000Z';
const entry = (retiredAt, successor) => ({ retiredAt, successor });
const task = (id, lastModified, extra = {}) => ({
  id, title: `task ${id}`, completed: false, notes: '', subtasks: [], lastModified, ...extra,
});

describe('recordRetirements', () => {
  it('adds entries for every retired id against one successor', () => {
    const rec = recordRetirements({}, ['L', 'M'], 'N', T1);
    expect(rec).toEqual({ L: entry(T1, 'N'), M: entry(T1, 'N') });
  });
  it('a newer retirement overwrites; an older one does not', () => {
    const rec = recordRetirements({ L: entry(T2, 'B') }, ['L'], 'C', T1);
    expect(rec.L).toEqual(entry(T2, 'B')); // T1 < T2 → kept
    const rec2 = recordRetirements({ L: entry(T1, 'B') }, ['L'], 'C', T2);
    expect(rec2.L).toEqual(entry(T2, 'C'));
  });
});

describe('mergeRetiredTaskIds — divergent successors (the (a) case)', () => {
  it('per-key LWW on retiredAt: the newer retirement wins', () => {
    const a = { L: entry(T1, 'obsidian-dg-aaa') };
    const b = { L: entry(T2, 'obsidian-dg-bbb') };
    expect(mergeRetiredTaskIds(a, b).L).toEqual(entry(T2, 'obsidian-dg-bbb'));
    expect(mergeRetiredTaskIds(b, a).L).toEqual(entry(T2, 'obsidian-dg-bbb')); // symmetric
  });
  it('exact-tie breaks deterministically on the successor string, both merge orders', () => {
    const a = { L: entry(T1, 'obsidian-dg-aaa') };
    const b = { L: entry(T1, 'obsidian-dg-bbb') };
    expect(mergeRetiredTaskIds(a, b).L.successor).toBe('obsidian-dg-bbb');
    expect(mergeRetiredTaskIds(b, a).L.successor).toBe('obsidian-dg-bbb');
  });
  it('a malformed entry never beats a well-formed one; two malformed entries drop', () => {
    const good = { L: entry(T1, 'S') };
    expect(mergeRetiredTaskIds(good, { L: { bogus: true } }).L).toEqual(entry(T1, 'S'));
    expect(mergeRetiredTaskIds({ L: 'junk' }, good).L).toEqual(entry(T1, 'S'));
    expect(mergeRetiredTaskIds({ L: 'junk' }, { L: null })).toEqual({});
  });
  it('union: disjoint keys both survive', () => {
    const m = mergeRetiredTaskIds({ L: entry(T1, 'S1') }, { M: entry(T2, 'S2') });
    expect(Object.keys(m).sort()).toEqual(['L', 'M']);
  });
});

describe('pruneRetiredTaskIds — the (c) retention rule', () => {
  const cutoff = new Date(T2);
  it('drops entries strictly older than the cutoff, keeps the rest', () => {
    const pruned = pruneRetiredTaskIds({ old: entry(T1, 'S'), fresh: entry(T3, 'S') }, cutoff);
    expect(pruned).toEqual({ fresh: entry(T3, 'S') });
  });
  it('drops unparseable entries (a retirement we cannot date cannot be honored predictably)', () => {
    const pruned = pruneRetiredTaskIds({ bad: entry('not-a-date', 'S'), junk: 'x', ok: entry(T3, 'S') }, cutoff);
    expect(pruned).toEqual({ ok: entry(T3, 'S') });
  });
  it('returns the SAME map when nothing changed (no spurious diff churn)', () => {
    const rec = { ok: entry(T3, 'S') };
    expect(pruneRetiredTaskIds(rec, cutoff)).toBe(rec);
  });
});

describe('resolveRetirement — the (b) chain semantics', () => {
  it('resolves a direct entry', () => {
    expect(resolveRetirement({ L: entry(T1, 'N') }, 'L')).toBe('N');
  });
  it('collapses a stale L→M hop through M→N', () => {
    const rec = { L: entry(T1, 'M'), M: entry(T2, 'N') };
    expect(resolveRetirement(rec, 'L')).toBe('N');
    expect(resolveRetirement(rec, 'M')).toBe('N');
  });
  it('null for an unretired id; cycle-guarded (stops at the last sound step)', () => {
    expect(resolveRetirement({ L: entry(T1, 'N') }, 'X')).toBeNull();
    const cyclic = { A: entry(T1, 'B'), B: entry(T1, 'A') };
    expect(resolveRetirement(cyclic, 'A')).toBe('B');
  });
});

describe('applyTaskRetirements — the (d) supersede-regardless-of-timestamps rule', () => {
  const REC = { L: entry(T2, 'S') };

  it('drops a retired row OLDER than its live successor (plain supersede)', () => {
    const list = [task('S', T2), task('L', T1)];
    const out = applyTaskRetirements(list, REC, new Set(['S', 'L']));
    expect(out.map((t) => t.id)).toEqual(['S']);
    expect(out[0].lastModified).toBe(T2); // successor untouched
  });

  it('redirects a retired row NEWER than its successor: content moves onto the successor, identity stays', () => {
    const succ = task('S', T1, { obsidianBlockId: 'k3x9q2mf', obsidianRawTitle: 'Buy milk', importSource: 'obsidian' });
    const retired = task('L', T3, { title: 'edited offline #obsidian', completed: true, importSource: 'obsidian', obsidianRawTitle: 'stale raw' });
    const out = applyTaskRetirements([succ, retired], REC, new Set(['S', 'L']));
    expect(out).toHaveLength(1);
    const s = out[0];
    expect(s.id).toBe('S');                        // identity: successor's
    expect(s.obsidianBlockId).toBe('k3x9q2mf');    // identity: successor's
    expect(s.obsidianRawTitle).toBe('Buy milk');   // "what the vault line says" stays the successor's
    expect(s.title).toBe('edited offline #obsidian'); // content: the newer retired copy's
    expect(s.completed).toBe(true);
    expect(s.lastModified).toBe(T3);               // the edit keeps its recency for LWW onward
  });

  it('keeps a retired row whose successor is NOT live anywhere (conservative fallback)', () => {
    const list = [task('L', T3)];
    const out = applyTaskRetirements(list, REC, new Set(['L']));
    expect(out.map((t) => t.id)).toEqual(['L']);
  });

  it('cross-list: a retired row is dropped when its successor lives in the OTHER list', () => {
    const { tasks, unscheduledTasks } = applyRetirementsToTaskLists(
      { tasks: [task('S', T2)], unscheduledTasks: [task('L', T1)] }, REC,
    );
    expect(tasks.map((t) => t.id)).toEqual(['S']);
    expect(unscheduledTasks).toEqual([]);
  });

  it('returns the same array when the record touches nothing', () => {
    const list = [task('X', T1)];
    expect(applyTaskRetirements(list, REC, new Set(['X']))).toBe(list);
  });
});
