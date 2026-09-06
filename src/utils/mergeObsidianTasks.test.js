import { describe, it, expect } from 'vitest';
import { mergeObsidianTasks, preserveObsidianAppFields } from './mergeObsidianTasks.js';

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

  it('drops a retained task when a deletion tombstone is newer', () => {
    const prev = [obs('a', { lastModified: '2026-04-06T10:00:00.000Z' })];
    const tombstones = { a: '2026-07-07T00:00:00.000Z' };
    const out = mergeObsidianTasks(prev, [], new Set(), preserve, tombstones);
    expect(out).toEqual([]);
  });

  it('drops a scanned task that is tombstoned', () => {
    const scanned = [obs('a', { lastModified: '2026-04-06T10:00:00.000Z' })];
    const tombstones = { a: '2026-07-07T00:00:00.000Z' };
    const out = mergeObsidianTasks([], scanned, new Set(['a']), preserve, tombstones);
    expect(out).toEqual([]);
  });

  it('keeps a task re-created after the tombstone (newer lastModified wins)', () => {
    const scanned = [obs('a', { lastModified: '2026-07-08T00:00:00.000Z' })];
    const tombstones = { a: '2026-07-07T00:00:00.000Z' };
    const out = mergeObsidianTasks([], scanned, new Set(['a']), preserve, tombstones);
    expect(out.map(t => t.id)).toEqual(['a']);
  });
});

// Phase 2 transition bridge: a scanned task carrying an obsidianLegacyId hint
// (a line freshly tagged with ^dg-) matches the prior copy a device still
// holds under the old content-derived id, and — because the caller includes
// the hint in scannedIdsAllLists — that old copy is not retained as a ghost.
describe('mergeObsidianTasks — legacy-id bridge', () => {
  it('preserves app-only fields from the old copy via the obsidianLegacyId hint', () => {
    const prev = [obs('obsidian-2026-08-22-abc', { archived: true, completedAt: '2026-08-21T10:00:00.000Z' })];
    const scanned = [obs('obsidian-dg-xxxxxxxx', { obsidianLegacyId: 'obsidian-2026-08-22-abc' })];
    const out = mergeObsidianTasks(prev, scanned, new Set(['obsidian-dg-xxxxxxxx', 'obsidian-2026-08-22-abc']), preserve);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('obsidian-dg-xxxxxxxx');
    expect(out[0].archived).toBe(true);
    expect(out[0].completedAt).toBe('2026-08-21T10:00:00.000Z');
  });

  it('does not retain the old legacy copy when its id is accounted for in the scanned set', () => {
    const prev = [obs('obsidian-2026-08-22-abc')];
    const scanned = [obs('obsidian-dg-xxxxxxxx', { obsidianLegacyId: 'obsidian-2026-08-22-abc' })];
    const out = mergeObsidianTasks(prev, scanned, new Set(['obsidian-dg-xxxxxxxx', 'obsidian-2026-08-22-abc']), preserve);
    expect(out.map(t => t.id)).toEqual(['obsidian-dg-xxxxxxxx']);
  });
});

// ── The app's own carry (preserveObsidianAppFields) ─────────────────────────
// The 2026-09-06 field finding: anything the app sets that the re-parse
// cannot reproduce is a phantom edit for stampTimestamps, and the fabricated
// lastModified outranks real edits elsewhere. Two keys were proven on the
// real pipeline: transitionId (every completion mints one) and the priority
// key's presence (scheduling strips it; an untimed line re-parses with 0).
describe('preserveObsidianAppFields', () => {
  it('carries transitionId when the merge leaves the completion state as the app had it', () => {
    const old = obs('a', { completed: true, completedAt: '2026-09-06', transitionId: 'tr-1' });
    const scanned = obs('a', { completed: true }); // the OR kept it completed
    expect(preserveObsidianAppFields(old, scanned).transitionId).toBe('tr-1');
    const uncompletedBoth = preserveObsidianAppFields(obs('b', { completed: false, transitionId: 'tr-2' }), obs('b', { completed: false }));
    expect(uncompletedBoth.transitionId).toBe('tr-2');
  });

  it('does NOT carry a stale transitionId onto a completion the vault just made', () => {
    const old = obs('a', { completed: false, transitionId: 'tr-old' }); // the app's last transition was an un-complete
    const scanned = obs('a', { completed: true, completedAt: '2026-09-06' }); // the line is checked now
    expect('transitionId' in preserveObsidianAppFields(old, scanned)).toBe(false);
  });

  it('carries energy', () => {
    expect(preserveObsidianAppFields(obs('a', { energy: 'deep' }), obs('a')).energy).toBe('deep');
    expect('energy' in preserveObsidianAppFields(obs('a'), obs('a'))).toBe(false);
  });

  it('restores the scheduled copy\'s shape when an untimed re-parse says priority 0', () => {
    const scheduledCopy = obs('a', { startTime: '14:00', date: '2026-09-06' }); // no priority key: scheduling stripped it
    const reparsed = obs('a', { startTime: '14:00', date: '2026-09-06', priority: 0 });
    const merged = { ...reparsed, ...preserveObsidianAppFields(scheduledCopy, reparsed) };
    expect(JSON.parse(JSON.stringify(merged))).not.toHaveProperty('priority');
  });

  it('leaves priority alone on a copy that HAS the key (a vault marker edit is adopted, not undone)', () => {
    const inboxCopy = obs('a', { priority: 0 });
    expect(preserveObsidianAppFields(inboxCopy, obs('a', { priority: 2 }))).not.toHaveProperty('priority');
    expect(preserveObsidianAppFields(obs('a', { priority: 2 }), obs('a', { priority: 0 }))).not.toHaveProperty('priority');
  });

  it('through the merge: a completed task with a transitionId hashes the same after a re-parse', () => {
    const prev = [obs('a', { completed: true, completedAt: '2026-09-06', transitionId: 'tr-1', lastModified: '2026-09-06T19:33:33.547Z' })];
    const scanned = [obs('a', { completed: true, lastModified: '2026-09-06T19:33:33.547Z' })];
    const out = mergeObsidianTasks(prev, scanned, new Set(['a']), preserveObsidianAppFields);
    expect(out[0]).toEqual(prev[0]);
  });
});
