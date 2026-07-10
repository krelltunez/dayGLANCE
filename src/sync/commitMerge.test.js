import { describe, it, expect } from 'vitest';
import { mergeMidCycleEdits, shredHashes, hashMapsEqual, hashEntity } from './commitMerge.js';

// Unit tests for the merge-aware commit (Bug: commitData used to clobber any
// local write made during the async pull/push window). These drive the pure
// helper directly; the end-to-end path through the real engine is covered in
// dbEngineWiring.test.js ("mid-cycle writes survive").

const task = (id, lastModified, extra = {}) => ({
  id, title: `task ${id}`, duration: 30, completed: false, lastModified, ...extra,
});
const clone = (x) => JSON.parse(JSON.stringify(x));

const BASE = {
  tasks: [task(1, '2026-07-01T10:00:00.000Z')],
  unscheduledTasks: [],
  recycleBin: [],
  dailyNotes: { '2026-07-01': { text: 'note', lastModified: '2026-07-01T08:00:00.000Z' } },
  completedTaskUids: ['a'],
  deletedTaskIds: {},
  use24HourClock: false,
};

// Convenience: run the merge for a given (mirror, live) pair against BASE.
function run(mutateMirror, mutateLive, base = BASE) {
  const mirror = clone(base);
  const live = clone(base);
  mutateMirror?.(mirror);
  mutateLive?.(live);
  const baseHashes = shredHashes(base);
  const res = mergeMidCycleEdits(mirror, baseHashes, live);
  return { mirror, live, ...res };
}

describe('mergeMidCycleEdits — mid-cycle live changes fold into the commit', () => {
  it('a task CREATED mid-cycle (no mirror copy, no cycle-start copy) survives', () => {
    const { mirror, survivors } = run(
      null,
      (live) => live.tasks.push(task(2, '2026-07-01T11:00:00.000Z')),
    );
    expect(mirror.tasks.map((t) => t.id)).toEqual([1, 2]);
    expect(survivors).toContain('tasks:2');
  });

  it('a mid-cycle EDIT beats an untouched mirror copy (live newer)', () => {
    const { mirror } = run(
      null,
      (live) => { live.tasks[0] = task(1, '2026-07-01T12:00:00.000Z', { title: 'edited mid-cycle' }); },
    );
    expect(mirror.tasks[0].title).toBe('edited mid-cycle');
  });

  it('SAME-entity conflict resolves by LWW: a strictly newer pulled write wins over an older mid-cycle edit', () => {
    const { mirror, survivors } = run(
      (m) => { m.tasks[0] = task(1, '2026-07-01T13:00:00.000Z', { title: 'pulled remote' }); },
      (live) => { live.tasks[0] = task(1, '2026-07-01T12:00:00.000Z', { title: 'edited mid-cycle' }); },
    );
    expect(mirror.tasks[0].title).toBe('pulled remote');
    expect(survivors).not.toContain('tasks:1');
  });

  it('SAME-entity conflict resolves by LWW: a newer mid-cycle edit wins over the pulled write', () => {
    const { mirror } = run(
      (m) => { m.tasks[0] = task(1, '2026-07-01T12:00:00.000Z', { title: 'pulled remote' }); },
      (live) => { live.tasks[0] = task(1, '2026-07-01T13:00:00.000Z', { title: 'edited mid-cycle' }); },
    );
    expect(mirror.tasks[0].title).toBe('edited mid-cycle');
  });

  it('a timestamp TIE prefers the live (in-hand) edit — mirrors the engine local-keeps-on-tie rule', () => {
    const { mirror } = run(
      (m) => { m.tasks[0] = task(1, '2026-07-01T12:00:00.000Z', { title: 'pulled remote' }); },
      (live) => { live.tasks[0] = task(1, '2026-07-01T12:00:00.000Z', { title: 'edited mid-cycle' }); },
    );
    expect(mirror.tasks[0].title).toBe('edited mid-cycle');
  });

  it('an entity with NO lastModified semantics prefers live', () => {
    const base = { ...clone(BASE), tasks: [{ id: 1, title: 'no ts' }] };
    const { mirror } = run(
      (m) => { m.tasks[0] = { id: 1, title: 'pulled, also no ts' }; },
      (live) => { live.tasks[0] = { id: 1, title: 'live, no ts' }; },
      base,
    );
    expect(mirror.tasks[0].title).toBe('live, no ts');
  });

  it('an UNTOUCHED entity keeps the pulled mirror version (remote changes land)', () => {
    const { mirror } = run(
      (m) => { m.tasks[0] = task(1, '2026-07-01T13:00:00.000Z', { title: 'pulled remote' }); },
      null,
    );
    expect(mirror.tasks[0].title).toBe('pulled remote');
  });

  it('a REMOTE DELETE of an untouched entity is honored (mirror stands)', () => {
    const { mirror } = run((m) => { m.tasks = []; }, null);
    expect(mirror.tasks).toEqual([]);
  });

  it('a REMOTE DELETE racing a mid-cycle EDIT keeps the edit (bias toward data)', () => {
    const { mirror, survivors } = run(
      (m) => { m.tasks = []; }, // pull removed it from the mirror
      (live) => { live.tasks[0] = task(1, '2026-07-01T12:00:00.000Z', { title: 'edited mid-cycle' }); },
    );
    expect(mirror.tasks.map((t) => t.id)).toEqual([1]);
    expect(mirror.tasks[0].title).toBe('edited mid-cycle');
    expect(survivors).toContain('tasks:1');
  });

  it('a MID-CYCLE LOCAL DELETE with a tombstone is honored (removed from the commit)', () => {
    const { mirror, honoredDeletes } = run(
      null,
      (live) => {
        live.tasks = [];
        live.deletedTaskIds = { 1: '2026-07-01T12:00:00.000Z' };
      },
    );
    expect(mirror.tasks).toEqual([]);
    expect(honoredDeletes).toEqual(['tasks:1']);
    // the tombstone bundle change itself also landed in the commit
    expect(mirror.deletedTaskIds).toEqual({ 1: '2026-07-01T12:00:00.000Z' });
  });

  it('a MID-CYCLE cross-list move is honored (old-kind copy removed, new-kind copy injected)', () => {
    const { mirror, honoredDeletes, survivors } = run(
      null,
      (live) => {
        live.tasks = [];
        live.unscheduledTasks = [task(1, '2026-07-01T12:00:00.000Z')];
      },
    );
    expect(mirror.tasks).toEqual([]);
    expect(mirror.unscheduledTasks.map((t) => t.id)).toEqual([1]);
    expect(honoredDeletes).toEqual(['tasks:1']);
    expect(survivors).toContain('unscheduledTasks:1');
  });

  it('a BARE mid-cycle vanish (no tombstone, no cross-list copy) is KEPT — glitch-suspect', () => {
    const { mirror, keptVanishes, honoredDeletes } = run(
      null,
      (live) => { live.tasks = []; }, // vanished with no fingerprint
    );
    expect(mirror.tasks.map((t) => t.id)).toEqual([1]);
    expect(keptVanishes).toEqual(['tasks:1']);
    expect(honoredDeletes).toEqual([]);
  });

  it('a NEW remote entity absent from live and cycle-start state is kept (pull lands)', () => {
    const { mirror, honoredDeletes } = run(
      (m) => { m.tasks.push(task(9, '2026-07-01T13:00:00.000Z')); },
      null,
    );
    expect(mirror.tasks.map((t) => t.id)).toEqual([1, 9]);
    expect(honoredDeletes).toEqual([]);
  });

  it('UNION bundles merge live and pulled edits (neither is lost)', () => {
    const { mirror } = run(
      (m) => { m.completedTaskUids = ['a', 'from-remote']; },
      (live) => { live.completedTaskUids = ['a', 'from-live']; },
    );
    expect(new Set(mirror.completedTaskUids)).toEqual(new Set(['a', 'from-remote', 'from-live']));
  });

  it('DEVICE-LOCAL bundles take the live value (the pull merge would keep the stale mirror copy)', () => {
    const { mirror } = run(
      null,
      (live) => { live.use24HourClock = true; },
    );
    expect(mirror.use24HourClock).toBe(true);
  });

  it('dailyNotes resolve per-date: pulled-newer date wins, live-new date is injected', () => {
    const { mirror } = run(
      (m) => { m.dailyNotes['2026-07-01'] = { text: 'remote note', lastModified: '2026-07-01T13:00:00.000Z' }; },
      (live) => {
        live.dailyNotes['2026-07-01'] = { text: 'live note', lastModified: '2026-07-01T09:00:00.000Z' };
        live.dailyNotes['2026-07-02'] = { text: 'new live note', lastModified: '2026-07-01T12:00:00.000Z' };
      },
    );
    expect(mirror.dailyNotes['2026-07-01'].text).toBe('remote note');
    expect(mirror.dailyNotes['2026-07-02'].text).toBe('new live note');
  });
});

describe('shredHashes / hashMapsEqual', () => {
  it('hashes every row and compares maps order-independently', () => {
    const a = shredHashes(BASE);
    expect(a['tasks:1']).toBe(hashEntity({ _kind: 'tasks', value: BASE.tasks[0] }));
    const b = shredHashes(clone(BASE));
    expect(hashMapsEqual(a, b)).toBe(true);
    const c = shredHashes({ ...clone(BASE), tasks: [task(1, '2026-07-02T10:00:00.000Z')] });
    expect(hashMapsEqual(a, c)).toBe(false);
    const d = shredHashes({ ...clone(BASE), tasks: [] });
    expect(hashMapsEqual(a, d)).toBe(false); // key-set difference
  });
});
