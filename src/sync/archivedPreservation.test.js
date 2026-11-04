import { describe, it, expect } from 'vitest';
import { mergeSyncData } from '../mergeSync.js';
import { applyRemoteEntity } from '@glance-apps/dayglance-vault';

// ─────────────────────────────────────────────────────────────────────────────
// Regression: the `archived` flag survives whole-entity last-writer-wins on BOTH
// sync transports.
//
// Root cause (confirmed by reproduction): archiving a task did not bump
// `lastModified`, so an older archived copy loses LWW to a newer copy from a
// device that never archived it. Both the file-tier merge (mergeArrayById, whole
// winner) and the vault merge (upsertCollection, whole replace) then drop
// `archived`, leaving the in-memory task with `archived: undefined` while storage
// keeps `archived: true` — a phantom diff that re-stamps lastModified on every
// cold-open (the DB-sync push churn / SSE self-nudge).
//
// The fix carries `archived: true` forward when the LWW winner OMITS it (undefined)
// but either side had it, while an explicit `archived: false` (a real unarchive)
// still propagates. Complemented by the write side stamping lastModified on
// archive/unarchive (in App.jsx) so future toggles win LWW outright.
// ─────────────────────────────────────────────────────────────────────────────

const item = (extra) => ({
  id: 'x1', title: 'old inbox', completed: true, completedAt: '2026-06-21',
  lastModified: '2026-06-21T10:00:00.000Z', ...extra,
});

describe('file-tier mergeSyncData preserves archived across LWW', () => {
  it('local archived:true vs a NEWER remote without archived → archived kept', () => {
    const local = { unscheduledTasks: [item({ archived: true })] };
    const remote = { unscheduledTasks: [item({ lastModified: '2026-07-01T10:00:00.000Z' })] };
    const { data } = mergeSyncData(local, remote, 90);
    expect(data.unscheduledTasks[0].archived).toBe(true);       // not dropped
    expect(data.unscheduledTasks[0].completedAt).toBe('2026-06-21'); // other fields intact
  });

  it('honors a real unarchive: NEWER remote archived:false wins over local archived:true', () => {
    const local = { unscheduledTasks: [item({ archived: true })] };
    const remote = { unscheduledTasks: [item({ archived: false, lastModified: '2026-07-01T10:00:00.000Z' })] };
    const { data } = mergeSyncData(local, remote, 90);
    expect(data.unscheduledTasks[0].archived).toBe(false); // explicit false is not clobbered
  });

  it('remote archived:true vs a NEWER local without archived → archived kept', () => {
    const local = { unscheduledTasks: [item({ lastModified: '2026-07-01T10:00:00.000Z' })] };
    const remote = { unscheduledTasks: [item({ archived: true })] };
    const { data } = mergeSyncData(local, remote, 90);
    expect(data.unscheduledTasks[0].archived).toBe(true);
  });

  it('a never-archived task stays absent (no archived key injected)', () => {
    const local = { unscheduledTasks: [item()] };
    const remote = { unscheduledTasks: [item({ lastModified: '2026-07-01T10:00:00.000Z' })] };
    const { data } = mergeSyncData(local, remote, 90);
    expect(data.unscheduledTasks[0].archived).toBeUndefined();
  });
});

describe('vault applyRemoteEntity preserves archived across LWW', () => {
  it('pulling a remote task WITHOUT archived over local archived:true keeps it + re-pushes', () => {
    const data = { unscheduledTasks: [item({ archived: true })] };
    const pulled = { _kind: 'unscheduledTasks', value: item({ lastModified: '2026-07-01T10:00:00.000Z' }) };
    const rePush = applyRemoteEntity(data, pulled);
    expect(data.unscheduledTasks[0].archived).toBe(true);   // carried forward
    expect(rePush).toHaveLength(1);                          // vault converges to the superset
  });

  it('pulling an explicit archived:false (unarchive) is honored, no re-push', () => {
    const data = { unscheduledTasks: [item({ archived: true })] };
    const pulled = { _kind: 'unscheduledTasks', value: item({ archived: false, lastModified: '2026-07-01T10:00:00.000Z' }) };
    const rePush = applyRemoteEntity(data, pulled);
    expect(data.unscheduledTasks[0].archived).toBe(false);
    expect(rePush).toEqual([]);
  });

  it('pulling over a non-archived local leaves it absent, no re-push', () => {
    const data = { unscheduledTasks: [item()] };
    const pulled = { _kind: 'unscheduledTasks', value: item({ lastModified: '2026-07-01T10:00:00.000Z' }) };
    const rePush = applyRemoteEntity(data, pulled);
    expect(data.unscheduledTasks[0].archived).toBeUndefined();
    expect(rePush).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The same hazard, aimed at `originalPlan` (utils/originalPlan.js): the schedule
// a task was first given. It is written only by the device that observed the
// scheduling, so every fleet with a device on an older build — or simply one that
// has not reloaded since — has copies without it, and whole-entity LWW drops the
// baseline the moment one of those wins.
//
// Unlike archived there is no explicit-value case to honor: the field is
// write-once and nothing in the app can clear it, so absent on the winner can
// only ever mean "that device never had it".
// ─────────────────────────────────────────────────────────────────────────────

const PLAN = { date: '2026-09-17', startTime: '09:00', duration: 60 };
const task = (extra) => ({
  id: 'p1', title: 'Report', date: '2026-09-17', startTime: '09:00',
  lastModified: '2026-09-17T09:00:00.000Z', ...extra,
});

describe('file-tier mergeSyncData preserves originalPlan across LWW', () => {
  it('local baseline vs a NEWER remote without one → baseline kept', () => {
    const local = { tasks: [task({ originalPlan: PLAN })] };
    const remote = { tasks: [task({ title: 'Report v2', startTime: '16:00', lastModified: '2026-09-17T12:00:00.000Z' })] };
    const { data } = mergeSyncData(local, remote, 90);
    expect(data.tasks[0].originalPlan).toEqual(PLAN);
    expect(data.tasks[0].startTime).toBe('16:00'); // the reschedule still wins
    expect(data.tasks[0].title).toBe('Report v2');
  });

  it('remote baseline vs a NEWER local without one → baseline kept', () => {
    const local = { tasks: [task({ lastModified: '2026-09-17T12:00:00.000Z' })] };
    const remote = { tasks: [task({ originalPlan: PLAN })] };
    const { data } = mergeSyncData(local, remote, 90);
    expect(data.tasks[0].originalPlan).toEqual(PLAN);
  });

  it('a task with no baseline on either side stays without one', () => {
    const local = { tasks: [task()] };
    const remote = { tasks: [task({ lastModified: '2026-09-17T12:00:00.000Z' })] };
    const { data } = mergeSyncData(local, remote, 90);
    expect(data.tasks[0].originalPlan).toBeUndefined();
  });

  it('survives into the recycle bin, so a restored task keeps its baseline', () => {
    const local = { recycleBin: [task({ originalPlan: PLAN })] };
    const remote = { recycleBin: [task({ lastModified: '2026-09-17T12:00:00.000Z' })] };
    const { data } = mergeSyncData(local, remote, 90);
    expect(data.recycleBin[0].originalPlan).toEqual(PLAN);
  });
});

describe('vault applyRemoteEntity preserves originalPlan across LWW', () => {
  it('pulling a task WITHOUT a baseline over a local one keeps it + re-pushes', () => {
    const data = { tasks: [task({ originalPlan: PLAN })] };
    const pulled = { _kind: 'tasks', value: task({ title: 'Report v2', lastModified: '2026-09-17T12:00:00.000Z' }) };
    const rePush = applyRemoteEntity(data, pulled);
    expect(data.tasks[0].originalPlan).toEqual(PLAN);
    expect(data.tasks[0].title).toBe('Report v2'); // the real edit still applies
    expect(rePush).toHaveLength(1);                // vault converges to the superset
  });

  it('pulling over a local without a baseline leaves it absent, no re-push', () => {
    const data = { tasks: [task()] };
    const pulled = { _kind: 'tasks', value: task({ lastModified: '2026-09-17T12:00:00.000Z' }) };
    const rePush = applyRemoteEntity(data, pulled);
    expect(data.tasks[0].originalPlan).toBeUndefined();
    expect(rePush).toEqual([]);
  });

  it('a pulled baseline is taken when the local copy has none', () => {
    const data = { tasks: [task()] };
    const pulled = { _kind: 'tasks', value: task({ originalPlan: PLAN, lastModified: '2026-09-17T12:00:00.000Z' }) };
    const rePush = applyRemoteEntity(data, pulled);
    expect(data.tasks[0].originalPlan).toEqual(PLAN);
    expect(rePush).toEqual([]);
  });

  it('carries archived and originalPlan independently in one pull', () => {
    const data = { tasks: [task({ archived: true, originalPlan: PLAN })] };
    const pulled = { _kind: 'tasks', value: task({ lastModified: '2026-09-17T12:00:00.000Z' }) };
    applyRemoteEntity(data, pulled);
    expect(data.tasks[0].archived).toBe(true);
    expect(data.tasks[0].originalPlan).toEqual(PLAN);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// And again for `starredDate` (utils/starredTasks.js). This one has BOTH cases:
// like archived it can be explicitly cleared, and like originalPlan a device on
// an older build simply does not carry it. Unstarring writes an explicit null
// precisely so the merge can tell "the user unstarred it" from "that device has
// never heard of stars".
// ─────────────────────────────────────────────────────────────────────────────

const DAY = '2026-09-18';
const starrable = (extra) => ({
  id: 's1', title: 'Write the report', date: DAY, startTime: '09:00',
  lastModified: '2026-09-18T09:00:00.000Z', ...extra,
});

describe('file-tier mergeSyncData preserves starredDate across LWW', () => {
  it('a star survives a NEWER copy from a device without the field', () => {
    const local = { tasks: [starrable({ starredDate: DAY })] };
    const remote = { tasks: [starrable({ title: 'Write the report v2', lastModified: '2026-09-18T12:00:00.000Z' })] };
    const { data } = mergeSyncData(local, remote, 90);
    expect(data.tasks[0].starredDate).toBe(DAY);
    expect(data.tasks[0].title).toBe('Write the report v2'); // the real edit still wins
  });

  it('honours a real unstar: a NEWER explicit null beats a local star', () => {
    const local = { tasks: [starrable({ starredDate: DAY })] };
    const remote = { tasks: [starrable({ starredDate: null, lastModified: '2026-09-18T12:00:00.000Z' })] };
    const { data } = mergeSyncData(local, remote, 90);
    expect(data.tasks[0].starredDate).toBeNull();
  });

  it('a star on the remote side survives a newer local copy without the field', () => {
    const local = { tasks: [starrable({ lastModified: '2026-09-18T12:00:00.000Z' })] };
    const remote = { tasks: [starrable({ starredDate: DAY })] };
    const { data } = mergeSyncData(local, remote, 90);
    expect(data.tasks[0].starredDate).toBe(DAY);
  });

  it('an unstarred task on both sides stays without the key', () => {
    const local = { tasks: [starrable()] };
    const remote = { tasks: [starrable({ lastModified: '2026-09-18T12:00:00.000Z' })] };
    const { data } = mergeSyncData(local, remote, 90);
    expect(data.tasks[0].starredDate).toBeUndefined();
  });
});

describe('vault applyRemoteEntity preserves starredDate across LWW', () => {
  it('pulling a copy WITHOUT the field over a local star keeps it + re-pushes', () => {
    const data = { tasks: [starrable({ starredDate: DAY })] };
    const pulled = { _kind: 'tasks', value: starrable({ title: 'v2', lastModified: '2026-09-18T12:00:00.000Z' }) };
    const rePush = applyRemoteEntity(data, pulled);
    expect(data.tasks[0].starredDate).toBe(DAY);
    expect(rePush).toHaveLength(1);
  });

  it('pulling an explicit null (a real unstar) is honoured, no re-push', () => {
    const data = { tasks: [starrable({ starredDate: DAY })] };
    const pulled = { _kind: 'tasks', value: starrable({ starredDate: null, lastModified: '2026-09-18T12:00:00.000Z' }) };
    const rePush = applyRemoteEntity(data, pulled);
    expect(data.tasks[0].starredDate).toBeNull();
    expect(rePush).toEqual([]);
  });

  it('takes a pulled star when the local copy has none', () => {
    const data = { tasks: [starrable()] };
    const pulled = { _kind: 'tasks', value: starrable({ starredDate: DAY, lastModified: '2026-09-18T12:00:00.000Z' }) };
    applyRemoteEntity(data, pulled);
    expect(data.tasks[0].starredDate).toBe(DAY);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// `deferrals` (utils/deferrals.js) is the first field here whose rule is a MERGE
// rather than a carry. It is a monotonic count, so both transports take the
// higher value: summing would double-count a slip both devices watched, and
// letting a winner without the field through would erase a real count.
// ─────────────────────────────────────────────────────────────────────────────

const slipped = (extra) => ({
  id: 'd1', title: 'Write the report', date: DAY, startTime: '09:00',
  lastModified: '2026-09-18T09:00:00.000Z', ...extra,
});

describe('file-tier mergeSyncData merges deferrals by max', () => {
  it('takes the higher count when the two sides disagree', () => {
    const local = { tasks: [slipped({ deferrals: 5 })] };
    const remote = { tasks: [slipped({ deferrals: 2, lastModified: '2026-09-18T12:00:00.000Z' })] };
    const { data } = mergeSyncData(local, remote, 90);
    expect(data.tasks[0].deferrals).toBe(5);
  });

  it('does not sum, so a slip both devices watched is counted once', () => {
    const local = { tasks: [slipped({ deferrals: 3 })] };
    const remote = { tasks: [slipped({ deferrals: 3, lastModified: '2026-09-18T12:00:00.000Z' })] };
    const { data } = mergeSyncData(local, remote, 90);
    expect(data.tasks[0].deferrals).toBe(3);
  });

  it('survives a NEWER copy from a device that never had the field', () => {
    const local = { tasks: [slipped({ deferrals: 4 })] };
    const remote = { tasks: [slipped({ title: 'v2', lastModified: '2026-09-18T12:00:00.000Z' })] };
    const { data } = mergeSyncData(local, remote, 90);
    expect(data.tasks[0].deferrals).toBe(4);
    expect(data.tasks[0].title).toBe('v2');
  });

  it('stays absent when neither side ever counted one', () => {
    const { data } = mergeSyncData({ tasks: [slipped()] }, { tasks: [slipped()] }, 90);
    expect(data.tasks[0].deferrals).toBeUndefined();
  });
});

describe('vault applyRemoteEntity merges deferrals by max', () => {
  it('keeps the higher local count when the pulled row is behind', () => {
    const data = { tasks: [slipped({ deferrals: 6 })] };
    const pulled = { _kind: 'tasks', value: slipped({ deferrals: 2, lastModified: '2026-09-18T12:00:00.000Z' }) };
    const rePush = applyRemoteEntity(data, pulled);
    expect(data.tasks[0].deferrals).toBe(6);
    expect(rePush).toHaveLength(1); // the vault converges upward
  });

  it('takes a higher pulled count', () => {
    const data = { tasks: [slipped({ deferrals: 1 })] };
    const pulled = { _kind: 'tasks', value: slipped({ deferrals: 9, lastModified: '2026-09-18T12:00:00.000Z' }) };
    applyRemoteEntity(data, pulled);
    expect(data.tasks[0].deferrals).toBe(9);
  });

  it('keeps a local count a pulled row omits entirely', () => {
    const data = { tasks: [slipped({ deferrals: 3 })] };
    const pulled = { _kind: 'tasks', value: slipped({ lastModified: '2026-09-18T12:00:00.000Z' }) };
    applyRemoteEntity(data, pulled);
    expect(data.tasks[0].deferrals).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// `planTrail` (utils/planTrail.js) is the detail behind that count, and takes
// the list-shaped version of the same rule: a UNION. Each device may have
// watched different slips, and whichever copy wins last-writer-wins would
// otherwise drop the other's stops — history nothing can reconstruct.
// ─────────────────────────────────────────────────────────────────────────────

const STOP_A = { at: 1000, date: '2026-09-15', startTime: '09:00' };
const STOP_B = { at: 2000, date: '2026-09-17', startTime: '14:00' };

describe('file-tier mergeSyncData unions the plan trail', () => {
  it('keeps stops only one side saw', () => {
    const local = { tasks: [slipped({ planTrail: [STOP_A] })] };
    const remote = { tasks: [slipped({ planTrail: [STOP_B], lastModified: '2026-09-18T12:00:00.000Z' })] };
    const { data } = mergeSyncData(local, remote, 90);
    expect(data.tasks[0].planTrail).toEqual([STOP_A, STOP_B]);
  });

  it('does not duplicate a stop both devices recorded', () => {
    const local = { tasks: [slipped({ planTrail: [STOP_A] })] };
    const remote = { tasks: [slipped({ planTrail: [STOP_A], lastModified: '2026-09-18T12:00:00.000Z' })] };
    const { data } = mergeSyncData(local, remote, 90);
    expect(data.tasks[0].planTrail).toHaveLength(1);
  });

  it('survives a NEWER copy from a device that never had the field', () => {
    const local = { tasks: [slipped({ planTrail: [STOP_A] })] };
    const remote = { tasks: [slipped({ title: 'v2', lastModified: '2026-09-18T12:00:00.000Z' })] };
    const { data } = mergeSyncData(local, remote, 90);
    expect(data.tasks[0].planTrail).toEqual([STOP_A]);
    expect(data.tasks[0].title).toBe('v2');
  });

  it('stays absent when neither side ever recorded a stop', () => {
    const { data } = mergeSyncData({ tasks: [slipped()] }, { tasks: [slipped()] }, 90);
    expect(data.tasks[0].planTrail).toBeUndefined();
  });
});

describe('vault applyRemoteEntity unions the plan trail', () => {
  it('keeps a local stop the pulled row is missing, and re-pushes', () => {
    const data = { tasks: [slipped({ planTrail: [STOP_A] })] };
    const pulled = { _kind: 'tasks', value: slipped({ planTrail: [STOP_B], lastModified: '2026-09-18T12:00:00.000Z' }) };
    const rePush = applyRemoteEntity(data, pulled);
    expect(data.tasks[0].planTrail).toEqual([STOP_A, STOP_B]);
    expect(rePush).toHaveLength(1); // the vault converges to the superset
  });

  it('keeps a local trail a pulled row omits entirely', () => {
    const data = { tasks: [slipped({ planTrail: [STOP_A] })] };
    const pulled = { _kind: 'tasks', value: slipped({ lastModified: '2026-09-18T12:00:00.000Z' }) };
    applyRemoteEntity(data, pulled);
    expect(data.tasks[0].planTrail).toEqual([STOP_A]);
  });
});
