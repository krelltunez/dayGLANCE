import { describe, it, expect } from 'vitest';
import { mergeObsidianTasks } from './mergeObsidianTasks.js';

// The App uses this to carry app-only fields the markdown can't reproduce.
const preserve = (old) => ({
  ...(old.archived !== undefined ? { archived: old.archived } : {}),
  ...(old.completedAt !== undefined ? { completedAt: old.completedAt } : {}),
});

const obs = (id, extra = {}) => ({ id, title: id, importSource: 'obsidian', ...extra });
const plain = (id) => ({ id, title: id }); // non-obsidian

describe('mergeObsidianTasks', () => {
  it('retains a prior Obsidian task the scan did NOT produce (another device vault)', () => {
    const prev = [obs('a'), obs('b')];
    const scanned = [obs('a')];
    const scannedIds = new Set(['a']); // b is not on this device's vault
    const out = mergeObsidianTasks(prev, scanned, scannedIds, preserve);
    expect(out.map(t => t.id).sort()).toEqual(['a', 'b']); // b kept, not deleted
  });

  it('does NOT retain a task that merely moved to the OTHER list (in scannedIds)', () => {
    // Task 'm' was scheduled; the scan now yields it as inbox. For the scheduled
    // list, scannedIds (both lists) contains 'm', so it is dropped here — the inbox
    // list adds it. No cross-list duplicate.
    const prevScheduled = [obs('m')];
    const scannedScheduled = []; // not scheduled anymore
    const scannedIds = new Set(['m']); // present in the inbox scan
    const out = mergeObsidianTasks(prevScheduled, scannedScheduled, scannedIds, preserve);
    expect(out).toEqual([]);
  });

  it('carries app-only fields forward onto the freshly scanned copy', () => {
    const prev = [obs('a', { archived: true, completedAt: '2026-06-01' })];
    const scanned = [obs('a')]; // markdown re-parse has neither field
    const out = mergeObsidianTasks(prev, scanned, new Set(['a']), preserve);
    expect(out[0].archived).toBe(true);
    expect(out[0].completedAt).toBe('2026-06-01');
  });

  it('passes non-Obsidian tasks through untouched and never retains them', () => {
    const prev = [plain('p1'), obs('a'), plain('p2')];
    const out = mergeObsidianTasks(prev, [], new Set(), preserve);
    // p1/p2 pass through; obsidian 'a' is retained (not in scan) — non-obsidian
    // are always kept, obsidian only when unscanned.
    expect(out.map(t => t.id).sort()).toEqual(['a', 'p1', 'p2']);
  });

  it('adds a brand-new scanned Obsidian task with no prior copy', () => {
    const out = mergeObsidianTasks([], [obs('new')], new Set(['new']), preserve);
    expect(out).toEqual([obs('new')]);
  });

  it('does not duplicate a scanned task that also exists in prev', () => {
    const prev = [obs('a', { archived: true })];
    const out = mergeObsidianTasks(prev, [obs('a')], new Set(['a']), preserve);
    expect(out.filter(t => t.id === 'a')).toHaveLength(1);
    expect(out[0].archived).toBe(true);
  });
});
