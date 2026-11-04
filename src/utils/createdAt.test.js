import { describe, it, expect } from 'vitest';
import {
  stampCreatedAt, applyCreatedAt, earlierCreatedAt, isExternalTask, carryCreatedAt, createdTimestamp,
} from './createdAt.js';

const NOW = '2026-10-22T09:30:00-05:00';
const known = (...ids) => new Set(ids);

describe('stampCreatedAt', () => {
  it('stamps a task whose id this device has never stored', () => {
    const [out] = stampCreatedAt([{ id: 'n1', title: 'New' }], known(), { now: NOW });
    expect(out.createdAt).toBe(NOW);
  });

  it('leaves a known id alone, whatever list it is in now', () => {
    const rows = [{ id: 'k1', title: 'Moved' }];
    expect(stampCreatedAt(rows, known('k1'), { now: NOW })).toBe(rows);
  });

  it('matches ids across the string/number boundary', () => {
    const rows = [{ id: 42, title: 'Numeric' }];
    expect(stampCreatedAt(rows, known('42'), { now: NOW })).toBe(rows);
  });

  it('never replaces a createdAt, and treats null as "not known" rather than missing', () => {
    const rows = [{ id: 'a', createdAt: '2025-01-01T00:00:00Z' }, { id: 'b', createdAt: null }];
    expect(stampCreatedAt(rows, known(), { now: NOW })).toBe(rows);
  });

  it('skips tasks this device did not create', () => {
    const rows = [
      { id: 'i', imported: true },
      { id: 'n', _native: true },
      { id: 'o', importSource: 'obsidian' },
      { id: 't', importSource: 'todoist', imported: false, todoist: { id: '1' } },
    ];
    expect(stampCreatedAt(rows, known(), { now: NOW })).toBe(rows);
  });

  it('returns the same array when nothing was stamped, a new one when something was', () => {
    const rows = [{ id: 'k' }];
    expect(stampCreatedAt(rows, known('k'), { now: NOW })).toBe(rows);
    expect(stampCreatedAt([{ id: 'n' }], known(), { now: NOW })).not.toBe(rows);
  });
});

describe('isExternalTask', () => {
  it('is false for an ordinary task, a launcher write and an intent from another app', () => {
    expect(isExternalTask({ id: 1 })).toBe(false);
    expect(isExternalTask({ id: 2, clientId: 'c' })).toBe(false);
    expect(isExternalTask({ id: 3, source_app: 'lifeglance' })).toBe(false);
  });
});

describe('applyCreatedAt', () => {
  it('enriches matching rows in place and keeps rows the pass filtered out', () => {
    const all = [{ id: 'a' }, { id: 'n', _native: true }];
    const out = applyCreatedAt(all, [{ id: 'a', createdAt: NOW }]);
    expect(out).toEqual([{ id: 'a', createdAt: NOW }, { id: 'n', _native: true }]);
  });

  it('never overwrites, and returns the same array when there is nothing to copy', () => {
    const all = [{ id: 'a', createdAt: '2025-01-01T00:00:00Z' }];
    expect(applyCreatedAt(all, [{ id: 'a', createdAt: NOW }])).toBe(all);
  });
});

describe('earlierCreatedAt', () => {
  const a = '2026-10-01T09:00:00-05:00';
  const b = '2026-10-01T15:00:00Z'; // 10:00 in -05:00, so later than a

  it('keeps the earlier instant, comparing instants rather than strings', () => {
    expect(earlierCreatedAt(a, b)).toBe(a);
    expect(earlierCreatedAt(b, a)).toBe(a);
  });

  it('is order-independent and idempotent, as both tiers require', () => {
    expect(earlierCreatedAt(earlierCreatedAt(a, b), b)).toBe(earlierCreatedAt(b, earlierCreatedAt(a, b)));
    expect(earlierCreatedAt(a, a)).toBe(a);
  });

  it('takes whichever side has one, and treats null as none', () => {
    expect(earlierCreatedAt(undefined, a)).toBe(a);
    expect(earlierCreatedAt(a, null)).toBe(a);
    expect(earlierCreatedAt(null, undefined)).toBeUndefined();
  });

  it('picks one deterministically when the same instant is written two ways', () => {
    const local = '2026-10-01T09:00:00-05:00';
    const utc = '2026-10-01T14:00:00.000Z';
    expect(earlierCreatedAt(local, utc)).toBe(earlierCreatedAt(utc, local));
  });
});

describe('carryCreatedAt and createdTimestamp', () => {
  it('inherits the source, or says "not known"', () => {
    expect(carryCreatedAt({ createdAt: NOW })).toEqual({ createdAt: NOW });
    expect(carryCreatedAt({})).toEqual({ createdAt: null });
    expect(carryCreatedAt(undefined)).toEqual({ createdAt: null });
  });

  it('writes the local-offset form completedAt uses', () => {
    expect(createdTimestamp(new Date(2026, 9, 22, 9, 5, 7))).toMatch(/^2026-10-22T09:05:07[+-]\d{2}:\d{2}$/);
  });
});

// ── The whole cycle ──────────────────────────────────────────────────────────
// `originalPlan` had unit tests on every boundary and still shipped in a state
// where it never survived a sync round, because nothing exercised the path
// BETWEEN the modules. These do, once per tier: the stamp, the write-back to
// state, a merge against a NEWER copy from a device that never had the field,
// and the apply back over state.
describe('createdAt survives save → state → push → apply', () => {
  const made = { id: 'c1', title: 'Report', lastModified: '2026-10-22T14:30:00.000Z' };

  const saveAndState = async () => {
    const { stampTimestamps } = await import('./stampTimestamps.js');
    // 1. SAVE: new to this device, so it is stamped.
    const [stamped] = stampCreatedAt([made], known(), { now: NOW });
    // 2. STATE: the write-back enriches the live list.
    const [inState] = applyCreatedAt([made], [stamped]);
    expect(inState.createdAt).toBe(NOW);
    // ...and gaining it is not an edit: a fabricated lastModified would
    // outrank a real completion made on another device.
    const [persisted] = stampTimestamps([inState], [made], 'FABRICATED');
    expect(persisted.lastModified).toBe(made.lastModified);
    return { inState, persisted };
  };

  it('through the file tier', async () => {
    const { mergeSyncData } = await import('../mergeSync.js');
    const { preserveStickyFields } = await import('./preserveStickyFields.js');
    const { inState, persisted } = await saveAndState();

    // 3. PUSH: the other device edited it later and never had the field.
    const remote = { unscheduledTasks: [{ ...made, title: 'Report v2', lastModified: '2026-10-23T00:00:00.000Z' }] };
    const result = mergeSyncData({ unscheduledTasks: [persisted] }, remote, 90);
    expect(result.data.unscheduledTasks[0].title).toBe('Report v2'); // the newer copy won
    expect(result.data.unscheduledTasks[0].createdAt).toBe(NOW);
    expect(result.remoteChanged).toBe(true); // and the remote is told

    // 4. APPLY: over state, where a dropped field is lost for good.
    const [applied] = preserveStickyFields(result.data.unscheduledTasks, [inState]);
    expect(applied.createdAt).toBe(NOW);
  });

  it('through the vault', async () => {
    const { applyRemoteEntity } = await import('@glance-apps/dayglance-vault');
    const { persisted } = await saveAndState();

    // 3. PULL a newer row from a device that never had the field.
    const data = { unscheduledTasks: [persisted] };
    const rePush = applyRemoteEntity(data, {
      _kind: 'unscheduledTasks',
      value: { ...made, title: 'Report v2', lastModified: '2026-10-23T00:00:00.000Z' },
    });
    expect(data.unscheduledTasks[0].title).toBe('Report v2');
    expect(data.unscheduledTasks[0].createdAt).toBe(NOW);
    expect(rePush).toHaveLength(1); // the vault converges to the copy that has it
  });

  it('a recurring series keeps its createdAt through both tiers too', async () => {
    const { mergeSyncData } = await import('../mergeSync.js');
    const { applyRemoteEntity } = await import('@glance-apps/dayglance-vault');
    const series = { id: 'r1', title: 'Gym', recurrence: { type: 'daily' }, createdAt: NOW, lastModified: '2026-10-22T14:30:00.000Z' };
    const newer = { id: 'r1', title: 'Gym (evenings)', recurrence: { type: 'daily' }, lastModified: '2026-10-23T00:00:00.000Z' };

    const { data } = mergeSyncData({ recurringTasks: [series] }, { recurringTasks: [newer] }, 90);
    expect(data.recurringTasks[0].title).toBe('Gym (evenings)');
    expect(data.recurringTasks[0].createdAt).toBe(NOW);

    const vault = { recurringTasks: [series] };
    applyRemoteEntity(vault, { _kind: 'recurringTasks', value: newer });
    expect(vault.recurringTasks[0].createdAt).toBe(NOW);
  });
});

describe('the apply keeps what this device holds', () => {
  it('carries createdAt onto an incoming copy that lacks it, and keeps the earlier of two', async () => {
    const { preserveStickyFields } = await import('./preserveStickyFields.js');
    const live = [{ id: 'a', createdAt: NOW }, { id: 'b', createdAt: '2026-10-01T08:00:00-05:00' }];
    const incoming = [{ id: 'a', title: 'newer' }, { id: 'b', createdAt: '2026-10-05T08:00:00-05:00' }];
    const [a, b] = preserveStickyFields(incoming, live);
    expect(a.createdAt).toBe(NOW);
    expect(b.createdAt).toBe('2026-10-01T08:00:00-05:00');
  });
});

describe('a recurring occurrence', () => {
  it('shows its series\' createdAt, and says "not known" for an older series', async () => {
    const { recurringTaskInstance } = await import('./expandRecurringTasks.js');
    expect(recurringTaskInstance({ id: 'r1', title: 'Gym', createdAt: NOW }, '2026-10-22').createdAt).toBe(NOW);
    // null, not absent: an occurrence spread into its own task (a cross-date
    // drag) must not then be stamped as created on the spot.
    expect(recurringTaskInstance({ id: 'r2', title: 'Old' }, '2026-10-22').createdAt).toBeNull();
  });

  it('turned into its own task under a new id is not stamped as new', async () => {
    const { recurringTaskInstance } = await import('./expandRecurringTasks.js');
    const { id, isRecurring, recurringTemplateId, ...taskData } = recurringTaskInstance({ id: 'r2', title: 'Old' }, '2026-10-22');
    const detached = [{ ...taskData, id: 'fresh-uuid', date: '2026-10-23' }];
    expect(stampCreatedAt(detached, known(), { now: NOW })).toBe(detached);
  });
});
