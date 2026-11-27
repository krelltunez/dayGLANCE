// Scenario tests for the referential repair at the sync boundary (#2137).
//
// The unit suites cover the helpers and the boot pass; neither can see the path
// that matters: a deletion is pushed as a tombstone in a payload, and ANOTHER
// device applies it. That is where a task keeps a projectId after its project
// is gone (the Inbox hides "project tasks") and where a project keeps a goalId
// after its goal is gone (it belongs to neither list). CLAUDE.md's
// "Adding a field to a task" asks for exactly this shape of test: walk the
// production code between the modules, not a re-implementation of it.
//
// The harness calls the real useSyncEngineData hook as a plain function (it
// holds no React state of its own — the deps object carries everything) with
// two independent "devices": separate state, separate localStorage.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/nativeCalendar.js', () => ({ hasNativeCalendar: () => false }));

import useSyncEngineData, { SYNC_ENGINE_DATA_DEPS } from '../hooks/useSyncEngineData.js';
import { initialHeadlessState } from '../headless/useHeadlessStore.js';
import { detachDeletedProject } from './deleteCascade.js';

const NOW = '2026-10-19T12:00:00.000Z';
const T = (id, extra = {}) => ({
  id, title: id, notes: '', subtasks: [], lastModified: '2026-10-19T08:00:00.000Z', ...extra,
});
const P = (id, extra = {}) => ({
  id, title: id, status: 'active', updatedAt: '2026-10-01T00:00:00.000Z', ...extra,
});

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
  };
}

/** Run `fn` with the device's localStorage installed, as that app instance would. */
function on(device, fn) {
  const previous = globalThis.localStorage;
  globalThis.localStorage = device.storage;
  try { return fn(); } finally { globalThis.localStorage = previous; }
}

/**
 * One app instance: its state slices, setters that behave like React's
 * functional setters, its localStorage and the real payload/apply pair built
 * over them. `mount()` reads the state at call time, like a render does.
 */
function device(overrides = {}) {
  const state = { ...initialHeadlessState(), ...overrides };
  const refs = {
    tasksLiveRef: { current: state.tasks },
    unscheduledLiveRef: { current: state.unscheduledTasks },
    // Refs the sync deps list, not slices: nothing in these scenarios uses
    // day windows or the JOBO ledger.
    dayWindowsRef: { current: null },
    joboRecordsRef: { current: undefined },
    applyingRemoteDataRef: { current: false },
    suppressClearPendingRef: { current: false },
    suppressCloudUploadRef: { current: false },
    suppressTimestampRef: { current: false },
  };
  const setters = {};
  for (const name of SYNC_ENGINE_DATA_DEPS.setters) {
    const key = name[3].toLowerCase() + name.slice(4);
    setters[name] = (next) => {
      state[key] = typeof next === 'function' ? next(state[key]) : next;
      if (key === 'tasks') refs.tasksLiveRef.current = state.tasks;
      if (key === 'unscheduledTasks') refs.unscheduledLiveRef.current = state.unscheduledTasks;
    };
  }
  const storage = memoryStorage();
  const self = {
    state,
    storage,
    setters,
    mount() {
      const deps = {};
      for (const key of SYNC_ENGINE_DATA_DEPS.values) deps[key] = state[key];
      // Slices whose App value is derived from another hook's state.
      deps.allTodayRoutines = state.todayRoutines;
      deps.dayWindowsRef = refs.dayWindowsRef;
      deps.joboRecordsRef = refs.joboRecordsRef;
      deps.tasksLiveRef = refs.tasksLiveRef;
      deps.unscheduledLiveRef = refs.unscheduledLiveRef;
      Object.assign(deps, setters);
      for (const key of SYNC_ENGINE_DATA_DEPS.refs) deps[key] = refs[key];
      deps.applyRemoteDayWindows = vi.fn();
      deps.applyRemoteJobo = vi.fn();
      deps.stampTaskTimestamps = (list) => list;
      // The hook holds no React state of its own (the deps object carries every
      // value and setter); calling it as a plain factory is what lets the two
      // devices be pointed at separate localStorage stores.
      const build = useSyncEngineData;
      return build(deps);
    },
  };
  return self;
}

/** Write a device's state to its storage the way the save pass would. */
function persist(device) {
  const { state, storage } = device;
  storage.setItem('day-planner-tasks', JSON.stringify(state.tasks));
  storage.setItem('day-planner-unscheduled', JSON.stringify(state.unscheduledTasks));
  storage.setItem('day-planner-recycle-bin', JSON.stringify(state.recycleBin));
  storage.setItem('day-planner-recurring-tasks', JSON.stringify(state.recurringTasks));
  storage.setItem('day-planner-projects', JSON.stringify(state.projects));
  storage.setItem('day-planner-goals', JSON.stringify(state.goals));
}

const stored = (device, key) => JSON.parse(device.storage.getItem(key) || 'null');

describe('referential integrity across a sync cycle (#2137)', () => {
  beforeEach(() => {
    // initialHeadlessState() reads its non-synced slices through localStorage.
    globalThis.localStorage = memoryStorage();
  });
  afterEach(() => {
    delete globalThis.localStorage;
    vi.restoreAllMocks();
  });

  it('delete on device A → push → apply on device B detaches every row for the deleted project', () => {
    // ── Device A: delete project p1 through the same cascade deleteProject uses.
    const A = device({ tasks: [T('t1', { projectId: 'p1' })], projects: [P('p1')] });
    persist(A);
    A.storage.setItem('day-planner-deleted-project-ids', '{}');
    detachDeletedProject('p1', {
      setTasks: A.setters.setTasks,
      setUnscheduledTasks: A.setters.setUnscheduledTasks,
      setRecurringTasks: A.setters.setRecurringTasks,
      setRecycleBin: A.setters.setRecycleBin,
    });
    // What useGoalsProjects.deleteProject then does: drop the row, write the tombstone.
    A.setters.setProjects([]);
    A.storage.setItem('day-planner-deleted-project-ids', JSON.stringify({ p1: NOW }));

    const pushed = on(A, () => A.mount().buildSyncPayload()).data;
    // The delete itself is complete on A: task detached, project gone, tombstone carried.
    expect(pushed.tasks[0]).not.toHaveProperty('projectId');
    expect(pushed.projects).toEqual([]);
    expect(pushed.deletedProjectIds).toHaveProperty('p1');

    // ── Device B: still holds p1 and two of its tasks; the merge it applies is
    // A's payload plus B's own rows (the file tier unions both sides).
    const B = device({
      tasks: [T('t1', { projectId: 'p1' }), T('t2', { projectId: 'p1' })],
      unscheduledTasks: [T('u1', { projectId: 'p1' })],
      projects: [P('p1')],
    });
    persist(B);
    B.storage.setItem('day-planner-deleted-project-ids', '{}');
    const merged = {
      ...pushed,
      // B's newer local copy of t2, and its inbox item, as the merge returns them.
      tasks: [T('t1', { projectId: 'p1' }), T('t2', { projectId: 'p1' })],
      unscheduledTasks: [T('u1', { projectId: 'p1' })],
      // The tombstone wins over B's stale project row in the merge.
      projects: [],
    };

    on(B, () => B.mount().applyEngineData(merged));

    expect(B.state.tasks.map(task => task.projectId)).toEqual([undefined, undefined]);
    expect(B.state.unscheduledTasks[0]).not.toHaveProperty('projectId');
    expect(stored(B, 'day-planner-tasks').map(task => task.projectId)).toEqual([undefined, undefined]);
    expect(stored(B, 'day-planner-unscheduled')[0]).not.toHaveProperty('projectId');
    expect(B.state.projects).toEqual([]);
    // The apply carried the tombstone forward, so B's own later payload keeps the delete.
    expect(stored(B, 'day-planner-deleted-project-ids')).toHaveProperty('p1');
  });

  it('delete goal on A → push → apply on B makes B\'s stale project copy standalone', () => {
    const A = device({ projects: [P('p1', { goalId: 'g1' })], goals: [{ id: 'g1', title: 'G' }] });
    persist(A);
    A.storage.setItem('day-planner-deleted-goal-ids', '{}');
    // deleteGoal's cascade (useGoalsProjects writes the tombstone after it).
    A.setters.setProjects((projects) => projects.map(({ goalId, ...rest }) => rest));
    A.setters.setGoals([]);
    A.storage.setItem('day-planner-deleted-goal-ids', JSON.stringify({ g1: NOW }));

    const pushed = on(A, () => A.mount().buildSyncPayload()).data;
    expect(pushed.projects[0]).not.toHaveProperty('goalId');
    expect(pushed.deletedGoalIds).toHaveProperty('g1');

    const B = device({
      projects: [P('p1', { goalId: 'g1' })],
      goals: [{ id: 'g1', title: 'G' }],
    });
    persist(B);
    B.storage.setItem('day-planner-deleted-goal-ids', '{}');
    // The merge keeps B's stale project row (both sides carry it), but unions A's tombstone.
    const merged = { ...pushed, projects: [P('p1', { goalId: 'g1' })], goals: [] };

    on(B, () => B.mount().applyEngineData(merged));

    expect(B.state.projects[0]).not.toHaveProperty('goalId');
    expect(stored(B, 'day-planner-projects')[0]).not.toHaveProperty('goalId');
    // Unstamped: the repair is the same on every device, so a tie converges.
    expect(B.state.projects[0].updatedAt).toBe('2026-10-01T00:00:00.000Z');
  });

  it('restore-after-delete keeps the restored project\'s tasks attached', () => {
    // The backup was taken BEFORE the deletion: p1 exists there, no tombstone.
    const A = device({ tasks: [T('t1', { projectId: 'p1' })], projects: [P('p1')] });
    persist(A);
    A.storage.setItem('day-planner-deleted-project-ids', '{}');
    const backup = on(A, () => A.mount().buildSyncPayload()).data;
    expect(backup.deletedProjectIds).toEqual({});

    // B deleted p1 and still holds its tombstone; restore replaces the tombstone
    // maps with the backup's, so the restore must not apply B's local map to the
    // restored rows (that would bring the project back with its tasks detached).
    const B = device({ tasks: [T('t1')], projects: [] });
    persist(B);
    B.storage.setItem('day-planner-deleted-project-ids', JSON.stringify({ p1: NOW }));

    on(B, () => B.mount().applyEngineData(backup));

    expect(B.state.projects.map(project => project.id)).toEqual(['p1']);
    expect(B.state.tasks[0].projectId).toBe('p1');
    expect(stored(B, 'day-planner-tasks')[0].projectId).toBe('p1');
    expect(stored(B, 'day-planner-deleted-project-ids')).toEqual({});
  });
});

// An open task is never archived (utils/referentialIntegrity.js,
// unarchiveOpenTasks). The path that matters is the apply: a peer reopens a
// task whose copy never carried `archived` (an older build, or a copy from
// before the archive), the merge picks it, and preserveStickyFields carries
// this device's `archived: true` onto it. Before the repair the task was
// open and hidden from the Inbox and its project alike.
describe('open archived tasks across a sync cycle', () => {
  beforeEach(() => { globalThis.localStorage = memoryStorage(); });
  afterEach(() => {
    delete globalThis.localStorage;
    vi.restoreAllMocks();
  });

  const LATER = '2026-11-27T18:13:00.000Z';

  it('a reopen made elsewhere, carried onto a local archived copy, lands open and visible, unstamped', async () => {
    const { filterInboxTasks } = await import('./inboxFilter.js');
    const { stampTimestamps } = await import('./stampTimestamps.js');
    const B = device({ unscheduledTasks: [T('u1', { completed: true, completedAt: '2026-11-01', archived: true })] });
    persist(B);
    // The peer's reopened copy: newer, open, and no `archived` key at all.
    const reopened = T('u1', { completed: false, completedAt: null, lastModified: LATER });
    const merged = { ...on(B, () => B.mount().buildSyncPayload()).data, unscheduledTasks: [reopened] };

    on(B, () => B.mount().applyEngineData(merged));

    const [row] = B.state.unscheduledTasks;
    expect(row).toMatchObject({ completed: false, archived: false, lastModified: LATER });
    expect(filterInboxTasks(B.state.unscheduledTasks).map(t => t.id)).toEqual(['u1']);
    // The save pass against what the apply stored: no edit, so no fabricated stamp.
    const [stamped] = stampTimestamps(B.state.unscheduledTasks, stored(B, 'day-planner-unscheduled'), '2026-11-28T00:00:00.000Z');
    expect(stamped.lastModified).toBe(LATER);
  });

  it('an old device\'s archived open copy at the same stamp is repaired on apply and pushed back as explicit false', () => {
    const B = device({ unscheduledTasks: [T('u1')] });
    persist(B);
    const stale = T('u1', { archived: true });
    const merged = { ...on(B, () => B.mount().buildSyncPayload()).data, unscheduledTasks: [stale] };

    on(B, () => B.mount().applyEngineData(merged));
    expect(B.state.unscheduledTasks[0]).toMatchObject({ archived: false, lastModified: stale.lastModified });
    expect(stored(B, 'day-planner-unscheduled')[0].archived).toBe(false);

    // What B pushes next: the explicit false (which both tiers honour) at the
    // ORIGINAL stamp, so an old device keeps its own copy on the tie rather
    // than flipping, and a second apply is a no-op.
    const next = on(B, () => B.mount().buildSyncPayload()).data;
    expect(next.unscheduledTasks[0]).toMatchObject({ archived: false, lastModified: stale.lastModified });
    const before = B.state.unscheduledTasks;
    on(B, () => B.mount().applyEngineData({ ...next }));
    expect(B.state.unscheduledTasks[0]).toEqual(before[0]);
  });
});

describe('a reopen in an archived project across a sync cycle', () => {
  beforeEach(() => { globalThis.localStorage = memoryStorage(); });
  afterEach(() => {
    delete globalThis.localStorage;
    vi.restoreAllMocks();
  });

  it('reopen on A → push → apply on B: B shows the task in its Inbox, unlinked, at A\'s stamp', async () => {
    const { applySetCompletion } = await import('./taskMutations.js');
    const { filterInboxTasks, knownProjectIdsOf } = await import('./inboxFilter.js');
    const { stampTimestamps } = await import('./stampTimestamps.js');
    const project = P('p1', { status: 'archived', archiveRecord: { priorStatus: 'active', archivedAt: NOW, archivedTaskIds: ['u1'], detachedTaskIds: [] } });
    const hidden = () => T('u1', { completed: true, completedAt: '2026-10-18T09:00:00-07:00', archived: true, projectId: 'p1' });
    const A = device({ unscheduledTasks: [hidden()], projects: [project] });
    const B = device({ unscheduledTasks: [hidden()], projects: [project] });
    persist(A); persist(B);

    const REOPEN = '2026-10-20T09:00:00.000Z';
    const r = applySetCompletion(A.state, { taskId: 'u1', completed: false, nowIso: REOPEN });
    A.setters.setUnscheduledTasks(r.unscheduledTasks);
    persist(A);
    const pushed = on(A, () => A.mount().buildSyncPayload()).data;
    expect(pushed.unscheduledTasks[0]).not.toHaveProperty('projectId');
    // Newer than B's copy, so it wins last-writer-wins whole on either tier.
    expect(pushed.unscheduledTasks[0].lastModified > B.state.unscheduledTasks[0].lastModified).toBe(true);

    const merged = { ...on(B, () => B.mount().buildSyncPayload()).data, unscheduledTasks: pushed.unscheduledTasks };
    on(B, () => B.mount().applyEngineData(merged));

    const [row] = B.state.unscheduledTasks;
    expect(row).not.toHaveProperty('projectId');
    expect(row).toMatchObject({ completed: false, archived: false, lastModified: REOPEN });
    const known = knownProjectIdsOf(B.state.projects, { goalsProjectsEnabled: true });
    expect(filterInboxTasks(B.state.unscheduledTasks, { goalsProjectsEnabled: true, knownProjectIds: known }).map(t => t.id)).toEqual(['u1']);
    // B's save pass sees no edit of its own: it pushes A's stamp back, not a new one.
    const [stamped] = stampTimestamps(B.state.unscheduledTasks, stored(B, 'day-planner-unscheduled'), '2026-10-21T00:00:00.000Z');
    expect(stamped.lastModified).toBe(REOPEN);
  });
});

describe('a completion stamp across a sync cycle', () => {
  beforeEach(() => { globalThis.localStorage = memoryStorage(); });
  afterEach(() => {
    delete globalThis.localStorage;
    vi.restoreAllMocks();
  });

  it('a newer done copy from a device that recorded no stamp keeps this device\'s stamp, in state and storage, and nothing re-stamps', async () => {
    const { stampTimestamps } = await import('./stampTimestamps.js');
    const STAMP = '2026-11-27T14:57:15-07:00';
    const B = device({ unscheduledTasks: [T('u1', { completed: true, completedAt: STAMP, lastModified: '2026-11-27T21:57:16.000Z' })] });
    persist(B);
    // The older build's copy of the same tick: done, no completedAt, newer.
    const older = T('u1', { completed: true, lastModified: '2026-11-27T21:57:21.154Z' });
    const merged = { ...on(B, () => B.mount().buildSyncPayload()).data, unscheduledTasks: [older] };

    on(B, () => B.mount().applyEngineData(merged));

    expect(B.state.unscheduledTasks[0]).toMatchObject({ completed: true, completedAt: STAMP, lastModified: older.lastModified });
    expect(stored(B, 'day-planner-unscheduled')[0].completedAt).toBe(STAMP);
    const [stamped] = stampTimestamps(B.state.unscheduledTasks, stored(B, 'day-planner-unscheduled'), '2026-11-28T00:00:00.000Z');
    expect(stamped.lastModified).toBe(older.lastModified);
    // What B pushes next carries the stamp.
    expect(on(B, () => B.mount().buildSyncPayload()).data.unscheduledTasks[0].completedAt).toBe(STAMP);
  });
});

describe('an open task in an archived project across a sync cycle (mixed versions)', () => {
  beforeEach(() => { globalThis.localStorage = memoryStorage(); });
  afterEach(() => {
    delete globalThis.localStorage;
    vi.restoreAllMocks();
  });

  const NOTE_PATH = 'Goals/Ship/App Store Connect/App Store Connect.md';
  const archived = P('p360', { status: 'archived', obsidianNotePath: NOTE_PATH,
    archiveRecord: { priorStatus: 'completed', archivedAt: '2026-11-09T00:29:48.371Z', archivedTaskIds: [], detachedTaskIds: [] } });
  // The line as this build imported it: standalone, with the fresh-import stamp.
  const standalone = () => T('obsidian-dg-7azkbpwb', { completed: false, importSource: 'obsidian', obsidianNotePath: NOTE_PATH, lastModified: '1970-01-01T00:00:00.000Z' });

  it('a newer copy an older build attached is detached on apply, at its own stamp, visible in the Inbox, and nothing re-stamps', async () => {
    const { filterInboxTasks, knownProjectIdsOf } = await import('./inboxFilter.js');
    const { stampTimestamps } = await import('./stampTimestamps.js');
    const A = device({ unscheduledTasks: [standalone()], projects: [archived] });
    persist(A);
    // Device B on 5.16.0 read the same note, attached the line it took for
    // a fresh import, and its save pass stamped the change: it wins the pull.
    const attached = { ...standalone(), projectId: 'p360', lastModified: '2026-11-27T21:51:11.764Z' };
    const merged = { ...on(A, () => A.mount().buildSyncPayload()).data, unscheduledTasks: [attached] };

    on(A, () => A.mount().applyEngineData(merged));

    const [row] = A.state.unscheduledTasks;
    expect(row).not.toHaveProperty('projectId');
    expect(row.lastModified).toBe(attached.lastModified);
    expect(stored(A, 'day-planner-unscheduled')[0]).not.toHaveProperty('projectId');
    const known = knownProjectIdsOf(A.state.projects, { goalsProjectsEnabled: true });
    expect(filterInboxTasks(A.state.unscheduledTasks, { goalsProjectsEnabled: true, knownProjectIds: known }).map(t => t.id)).toEqual([row.id]);
    const [stamped] = stampTimestamps(A.state.unscheduledTasks, stored(A, 'day-planner-unscheduled'), '2026-11-28T00:00:00.000Z');
    expect(stamped.lastModified).toBe(attached.lastModified);

    // What A pushes next is the detached row at B's stamp; B keeps its own copy
    // on the tie and does not re-attach (the stamp is no longer the epoch).
    const next = on(A, () => A.mount().buildSyncPayload()).data;
    expect(next.unscheduledTasks[0]).not.toHaveProperty('projectId');
    expect(next.unscheduledTasks[0].lastModified).toBe(attached.lastModified);
    const before = A.state.unscheduledTasks;
    on(A, () => A.mount().applyEngineData({ ...next }));
    expect(A.state.unscheduledTasks[0]).toEqual(before[0]);
  });

  it('a restore made elsewhere arrives with its reattached tasks in one apply, and they stay attached', () => {
    const A = device({ unscheduledTasks: [standalone()], projects: [archived] });
    persist(A);
    const restored = { ...archived, status: 'completed', archiveRecord: null, updatedAt: '2026-11-28T09:00:00.000Z' };
    const reattached = { ...standalone(), projectId: 'p360', lastModified: '2026-11-28T09:00:00.000Z' };
    const merged = { ...on(A, () => A.mount().buildSyncPayload()).data, projects: [restored], unscheduledTasks: [reattached] };

    on(A, () => A.mount().applyEngineData(merged));
    expect(A.state.unscheduledTasks[0].projectId).toBe('p360');
  });
});

