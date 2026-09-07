import { describe, it, expect } from 'vitest';
import { detectObsidianDeletions, isObsidianTombstoned, addObsidianTombstones, obsidianKeyDate, dropTombstonedObsidianTasks, dropTombstonedObsidianNotes, mergeObsidianTombstones, commitObsidianTombstones, OBSIDIAN_TOMBSTONES_STORAGE_KEY } from './obsidianDeletions.js';

describe('detectObsidianDeletions (conservative)', () => {
  it('reports a key this device previously scanned and no longer sees', () => {
    const r = detectObsidianDeletions(['a', 'b', 'c'], ['a', 'c']);
    expect(r).toEqual({ deletions: ['b'], skipped: false, reason: null });
  });

  it('reports nothing on the first scan (no prior baseline)', () => {
    expect(detectObsidianDeletions([], ['a', 'b'])).toEqual({ deletions: [], skipped: false, reason: null });
  });

  it('SKIPS an empty scan that follows a non-empty one (failed/partial scan)', () => {
    const r = detectObsidianDeletions(['a', 'b', 'c'], []);
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('empty-scan');
    expect(r.deletions).toEqual([]);
  });

  it('SKIPS when the drop exceeds the conservative margin (incomplete scan)', () => {
    // 10 known, 9 vanish at once → not 9 real deletions, an incomplete scan.
    const last = Array.from({ length: 10 }, (_, i) => `k${i}`);
    const r = detectObsidianDeletions(last, ['k0']);
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('drop-too-large');
  });

  it('allows a small drop (within margin) to be reported', () => {
    const last = Array.from({ length: 10 }, (_, i) => `k${i}`);
    const r = detectObsidianDeletions(last, last.slice(0, 8)); // 2 dropped, within max(5, 25%*10=3)
    expect(r.skipped).toBe(false);
    expect(r.deletions.sort()).toEqual(['k8', 'k9']);
  });

  it('reports nothing when nothing disappeared', () => {
    expect(detectObsidianDeletions(['a', 'b'], ['a', 'b', 'c'])).toEqual({ deletions: [], skipped: false, reason: null });
  });

  it('does NOT tombstone a note that aged out of the retention window', () => {
    // 2026-04-06 fell below the cutoff — it left the scan because the window slid,
    // not because it was deleted. Must not be reported.
    const r = detectObsidianDeletions(['2026-04-06', '2026-07-01'], ['2026-07-01'], '2026-06-07');
    expect(r.deletions).toEqual([]);
    expect(r.skipped).toBe(false);
  });

  it('DOES tombstone an in-window note that vanished (real deletion)', () => {
    const r = detectObsidianDeletions(['2026-06-22', '2026-07-01'], ['2026-07-01'], '2026-06-07');
    expect(r.deletions).toEqual(['2026-06-22']);
  });

  it('applies the window cutoff to task ids too (date embedded in the id)', () => {
    const last = ['obsidian-2026-04-06-abc', 'obsidian-2026-06-22-xyz'];
    const r = detectObsidianDeletions(last, [], '2026-06-07'); // both missing…
    // …but the April one aged out (excluded); the June one is a real deletion.
    // Empty current with a non-empty last is normally 'empty-scan'; assert the
    // date filter still governs which count as candidates by using a partial scan:
    const r2 = detectObsidianDeletions(last, ['obsidian-2026-07-05-new'], '2026-06-07');
    expect(r2.deletions).toEqual(['obsidian-2026-06-22-xyz']);
    expect(r.skipped).toBe(true); // empty scan guard still fires first
  });
});

describe('obsidianKeyDate', () => {
  it('reads a daily-note date key', () => expect(obsidianKeyDate('2026-06-22')).toBe('2026-06-22'));
  it('reads the date from a task id', () => expect(obsidianKeyDate('obsidian-2026-06-22-a9f')).toBe('2026-06-22'));
  it('returns null for an undatable key', () => expect(obsidianKeyDate('weird-key')).toBeNull());
});

describe('isObsidianTombstoned', () => {
  it('suppresses when the tombstone is at least as new as the row', () => {
    expect(isObsidianTombstoned({ x: '2026-07-07T00:00:00Z' }, 'x', '2026-07-06T00:00:00Z')).toBe(true);
  });
  it('does NOT suppress a row re-created after the tombstone (newer lastModified wins)', () => {
    expect(isObsidianTombstoned({ x: '2026-07-06T00:00:00Z' }, 'x', '2026-07-07T00:00:00Z')).toBe(false);
  });
  it('is false when there is no tombstone for the key', () => {
    expect(isObsidianTombstoned({}, 'x', '2026-01-01T00:00:00Z')).toBe(false);
  });
});

describe('addObsidianTombstones', () => {
  it('adds keys with the deletion time, keeping the newest per key', () => {
    const out = addObsidianTombstones({ a: '2026-01-01T00:00:00Z' }, ['a', 'b'], '2026-07-07T00:00:00Z');
    expect(out).toEqual({ a: '2026-07-07T00:00:00Z', b: '2026-07-07T00:00:00Z' });
  });
  it('does not move a key backwards to an older time', () => {
    const out = addObsidianTombstones({ a: '2026-07-07T00:00:00Z' }, ['a'], '2026-01-01T00:00:00Z');
    expect(out.a).toBe('2026-07-07T00:00:00Z');
  });
});

// Phase 2: block-id task keys (obsidian-dg-<id>) are deliberately content-free,
// so their in-window proof comes from the keyDates sidecar the sync persists
// alongside lastScanned (the daily-note date each key was last seen in).
describe('detectObsidianDeletions — keyDates sidecar for dateless block-id keys', () => {
  it('tombstones an in-window dg key whose date comes from the sidecar', () => {
    const last = ['obsidian-dg-a1b2c3d4', 'obsidian-2026-06-22-xyz'];
    const cur = ['obsidian-2026-06-22-xyz'];
    const r = detectObsidianDeletions(last, cur, '2026-06-01', {
      keyDates: { 'obsidian-dg-a1b2c3d4': '2026-06-20' },
    });
    expect(r.deletions).toEqual(['obsidian-dg-a1b2c3d4']);
  });

  it('excludes a dg key whose sidecar date aged out of the window (not a deletion)', () => {
    const r = detectObsidianDeletions(
      ['obsidian-dg-a1b2c3d4', 'x'], ['x'], '2026-06-01',
      { keyDates: { 'obsidian-dg-a1b2c3d4': '2026-05-20' } },
    );
    expect(r.deletions).toEqual([]);
    expect(r.skipped).toBe(false);
  });

  it('stays conservative for a dg key with no sidecar entry (first run after upgrade)', () => {
    const r = detectObsidianDeletions(['obsidian-dg-a1b2c3d4', 'x'], ['x'], '2026-06-01');
    expect(r.deletions).toEqual([]);
  });

  it('a self-dating legacy key ignores the sidecar (its own date wins)', () => {
    const r = detectObsidianDeletions(
      ['obsidian-2026-06-22-abc', 'x'], ['x'], '2026-06-01',
      { keyDates: { 'obsidian-2026-06-22-abc': '2026-01-01' } },
    );
    expect(r.deletions).toEqual(['obsidian-2026-06-22-abc']);
  });
});

describe('dropTombstonedObsidianTasks / dropTombstonedObsidianNotes — the shared apply-boundary gate', () => {
  const T_OLD = '2026-08-12T10:00:00.000Z';
  const T_TOMB = '2026-08-20T10:00:00.000Z';
  const T_NEWER = '2026-08-20T10:00:01.000Z';
  const obsTask = (id, lastModified, extra = {}) => ({ id, importSource: 'obsidian', lastModified, ...extra });

  it('drops an obsidian row whose tombstone is at least as new (LWW), keeps a strictly-newer revive', () => {
    const tombs = { a: T_TOMB, b: T_TOMB, tie: T_TOMB };
    const out = dropTombstonedObsidianTasks(
      [obsTask('a', T_OLD), obsTask('b', T_NEWER), obsTask('tie', T_TOMB)], tombs,
    );
    // 'a' (older) and 'tie' (equal — delete wins ties, matching isObsidianTombstoned) drop; 'b' revives.
    expect(out.map((t) => t.id)).toEqual(['b']);
  });

  it('never touches non-obsidian rows, even on a key collision', () => {
    const tombs = { plain: T_TOMB };
    const rows = [{ id: 'plain', lastModified: T_OLD }];
    expect(dropTombstonedObsidianTasks(rows, tombs)).toBe(rows); // same array — untouched
  });

  it('returns the SAME array/map when nothing changes (no spurious diff churn)', () => {
    const rows = [obsTask('x', T_NEWER)];
    expect(dropTombstonedObsidianTasks(rows, { x: T_TOMB })).toBe(rows);
    expect(dropTombstonedObsidianTasks(rows, {})).toBe(rows);
    const notes = { '2026-08-10': { text: 'n', lastModified: T_NEWER } };
    expect(dropTombstonedObsidianNotes(notes, { '2026-08-10': T_TOMB })).toBe(notes);
  });

  it('drops a tombstoned-and-older note, keeps a re-created one', () => {
    const tombs = { '2026-08-10': T_TOMB, '2026-08-11': T_TOMB };
    const out = dropTombstonedObsidianNotes({
      '2026-08-10': { text: 'zombie', lastModified: T_OLD },
      '2026-08-11': { text: 'recreated', lastModified: T_NEWER },
      '2026-08-12': { text: 'untombstoned', lastModified: T_OLD },
    }, tombs);
    expect(Object.keys(out).sort()).toEqual(['2026-08-11', '2026-08-12']);
  });
});

describe('AUDIT FIX M11 — mergeObsidianTombstones / commitObsidianTombstones re-read the bundle at every write', () => {
  const memStorage = (initial = {}) => {
    const m = new Map(Object.entries(initial));
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
  };

  it('mergeObsidianTombstones is a newest-per-key union, pure', () => {
    const a = { x: '2026-09-01T00:00:00.000Z', y: '2026-09-03T00:00:00.000Z' };
    const b = { x: '2026-09-02T00:00:00.000Z', y: '2026-09-02T00:00:00.000Z', z: '2026-09-04T00:00:00.000Z' };
    expect(mergeObsidianTombstones(a, b)).toEqual({
      x: '2026-09-02T00:00:00.000Z', y: '2026-09-03T00:00:00.000Z', z: '2026-09-04T00:00:00.000Z',
    });
    expect(a).toEqual({ x: '2026-09-01T00:00:00.000Z', y: '2026-09-03T00:00:00.000Z' });
    expect(mergeObsidianTombstones(null, undefined)).toEqual({});
  });

  it('THE CLOBBER PIN: a tombstone that landed in storage after the cycle read its copy survives the cycle\'s write', () => {
    const storage = memStorage({ [OBSIDIAN_TOMBSTONES_STORAGE_KEY]: JSON.stringify({ old: '2026-08-01T00:00:00.000Z' }) });
    // The cycle read {old} at its start...
    const cycleCopy = JSON.parse(storage.getItem(OBSIDIAN_TOMBSTONES_STORAGE_KEY));
    // ...then the engine applied a peer's tombstone mid-await.
    storage.setItem(OBSIDIAN_TOMBSTONES_STORAGE_KEY, JSON.stringify({ ...cycleCopy, peer: '2026-09-05T10:00:00.000Z' }));
    // The cycle commits its own detection: fresh storage ∪ additions.
    const written = commitObsidianTombstones({ mine: '2026-09-05T10:00:30.000Z' }, storage);
    const stored = JSON.parse(storage.getItem(OBSIDIAN_TOMBSTONES_STORAGE_KEY));
    expect(stored).toEqual({ old: '2026-08-01T00:00:00.000Z', peer: '2026-09-05T10:00:00.000Z', mine: '2026-09-05T10:00:30.000Z' });
    expect(written).toEqual(stored);
  });

  it('unreadable storage still commits the additions; a same-key older addition never regresses the stored stamp', () => {
    const storage = memStorage({ [OBSIDIAN_TOMBSTONES_STORAGE_KEY]: 'not json' });
    expect(commitObsidianTombstones({ a: '2026-09-05T00:00:00.000Z' }, storage)).toEqual({ a: '2026-09-05T00:00:00.000Z' });
    const out = commitObsidianTombstones({ a: '2026-09-01T00:00:00.000Z' }, storage);
    expect(out.a).toBe('2026-09-05T00:00:00.000Z');
  });
});
