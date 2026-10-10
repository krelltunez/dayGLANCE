import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// hasNativeCalendar() reaches for the native/Electron bridges, which don't
// exist under vitest's node environment. Pin it off so loadData takes the
// plain-web path; the subscription-import filter it gates is not under test.
vi.mock('../utils/nativeCalendar.js', () => ({ hasNativeCalendar: () => false }));

// isTrayMode is derived once at module load from window.location.search, so each
// mode needs its own module instance — set the URL, then import.
async function loadHookAs(mode) {
  vi.resetModules();
  globalThis.window = { location: { search: mode === 'tray' ? '?tray=1' : '' } };
  const mod = await import('./useDataPersistence.js');
  return mod.default;
}

// A task missing `notes`/`subtasks` — exactly what the normalization pass fills
// in, so the write-back has something real to persist.
const STORED_TASKS = JSON.stringify([{ id: 't1', title: 'Task', date: '2026-08-01' }]);
const STORED_UNSCHEDULED = JSON.stringify([{ id: 'u1', title: 'Inbox item' }]);
// A habit missing `scheduledDays`, the habits-branch normalization.
const STORED_HABITS = JSON.stringify([{ id: 'h1', name: 'Water', target: 8 }]);

function makeProps() {
  const setters = {};
  const noop = (name) => { setters[name] = vi.fn(); return setters[name]; };
  return {
    props: {
      setTasks: noop('setTasks'),
      setUnscheduledTasks: noop('setUnscheduledTasks'),
      setRecycleBin: noop('setRecycleBin'),
      setRecurringTasks: noop('setRecurringTasks'),
      setDarkMode: noop('setDarkMode'),
      setSyncUrl: noop('setSyncUrl'),
      setTaskCalendarUrl: noop('setTaskCalendarUrl'),
      setCompletedTaskUids: noop('setCompletedTaskUids'),
      setDailyNotes: noop('setDailyNotes'),
      setRoutineDefinitions: noop('setRoutineDefinitions'),
      setTodayRoutines: noop('setTodayRoutines'),
      setRoutinesDate: noop('setRoutinesDate'),
      setRemovedTodayRoutineIds: noop('setRemovedTodayRoutineIds'),
      setHabits: noop('setHabits'),
      setHabitLogs: noop('setHabitLogs'),
      setHabitsEnabled: noop('setHabitsEnabled'),
      setRoutinesEnabled: noop('setRoutinesEnabled'),
      setGoals: noop('setGoals'),
      setProjects: noop('setProjects'),
      setAreas: noop('setAreas'),
      setGoalsProjectsEnabled: noop('setGoalsProjectsEnabled'),
      setDataLoaded: noop('setDataLoaded'),
      setUnscheduledOrderTimestamp: noop('setUnscheduledOrderTimestamp'),
      setUndoToast: noop('setUndoToast'),
      suppressTimestampRef: { current: false },
      cloudSyncInitialDoneRef: { current: false },
      cloudSyncConfig: null,
    },
    setters,
  };
}

// Only the keys loadData reads; everything else returns null.
const STORE = {
  'day-planner-tasks': STORED_TASKS,
  'day-planner-unscheduled': STORED_UNSCHEDULED,
  'day-planner-habits': STORED_HABITS,
};

describe('loadData normalization write-back', () => {
  let setItem;
  let removeItem;

  beforeEach(() => {
    setItem = vi.fn();
    removeItem = vi.fn();
    globalThis.localStorage = {
      getItem: vi.fn((k) => STORE[k] ?? null),
      setItem,
      removeItem,
    };
  });

  afterEach(() => {
    delete globalThis.localStorage;
    delete globalThis.window;
  });

  it('persists the normalized values in the main window', async () => {
    const useDataPersistence = await loadHookAs('main');
    const { props } = makeProps();

    useDataPersistence(props).loadData();

    // All four write sites fire. Without this the normalization is lost and
    // stampTaskTimestamps re-stamps lastModified on every task at next load.
    const written = Object.fromEntries(setItem.mock.calls);
    expect(JSON.parse(written['day-planner-tasks'])[0])
      .toMatchObject({ id: 't1', notes: '', subtasks: [] });
    expect(JSON.parse(written['day-planner-unscheduled'])[0])
      .toMatchObject({ id: 'u1', notes: '', subtasks: [] });
    expect(JSON.parse(written['day-planner-habits'])[0])
      .toMatchObject({ id: 'h1', scheduledDays: [0, 1, 2, 3, 4, 5, 6] });
    // The removal receipts are rolled, not wiped: with nothing stored, the
    // rolled map is empty and is persisted as such (never removeItem).
    expect(removeItem).not.toHaveBeenCalled();
    expect(written['day-planner-removed-today-routine-ids']).toBe('{}');
  });

  it('on a new day keeps the removal receipts and stamps one at midnight per cleared chip', async () => {
    const useDataPersistence = await loadHookAs('main');
    const { props, setters } = makeProps();
    const store = {
      ...STORE,
      'day-planner-routines-date': '2000-01-01',
      'day-planner-today-routines': JSON.stringify([{ id: 'chip-a' }, { id: 7 }]),
      'day-planner-removed-today-routine-ids': JSON.stringify({ 'mid-day': '2000-01-01T15:00:00.000Z' }),
    };
    globalThis.localStorage.getItem = vi.fn((k) => store[k] ?? null);

    useDataPersistence(props).loadData();

    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const expected = {
      'mid-day': '2000-01-01T15:00:00.000Z',
      'chip-a': midnight.toISOString(),
      '7': midnight.toISOString(),
    };
    expect(setters.setTodayRoutines).toHaveBeenCalledWith([]);
    expect(setters.setRemovedTodayRoutineIds).toHaveBeenCalledWith(expected);
    const written = Object.fromEntries(setItem.mock.calls);
    expect(JSON.parse(written['day-planner-removed-today-routine-ids'])).toEqual(expected);
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('writes nothing to localStorage in tray mode', async () => {
    const useDataPersistence = await loadHookAs('tray');
    const { props } = makeProps();

    useDataPersistence(props).loadData();

    // The tray holds a snapshot as of its last reload; persisting from it would
    // overwrite fresher main-window data (useSaveOnChange.js:5).
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('still reads and normalizes in tray mode, only skipping persistence', async () => {
    const useDataPersistence = await loadHookAs('tray');
    const { props, setters } = makeProps();

    useDataPersistence(props).loadData();

    // setTasks takes an updater; run it to see the value the tray would render.
    const tasksUpdater = setters.setTasks.mock.calls[0][0];
    expect(tasksUpdater([])[0]).toMatchObject({ id: 't1', notes: '', subtasks: [] });

    expect(setters.setUnscheduledTasks).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'u1', notes: '', subtasks: [] }),
    ]);
    expect(setters.setHabits).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'h1', scheduledDays: [0, 1, 2, 3, 4, 5, 6] }),
    ]);
    // The routine-id reset still updates React state; only the removeItem is skipped.
    expect(setters.setRemovedTodayRoutineIds).toHaveBeenCalledWith({});
    expect(setters.setDataLoaded).toHaveBeenCalledWith(true);
  });
});

// ── The original-plan baseline (utils/originalPlan.js) ──────────────────────
// Recorded in the persist pass because only there are both the new state and the
// stored copy it replaces visible at once, which is what tells a task being
// scheduled apart from one being rescheduled.
describe('saveData records the original plan', () => {
  let setItem;

  const saveProps = (over = {}) => ({
    ...makeProps().props,
    tasks: [], unscheduledTasks: [], recycleBin: [], recurringTasks: [], todayRoutines: [],
    darkMode: false, syncUrl: '', taskCalendarUrl: '', syncRetentionDays: 0,
    completedTaskUids: new Set(), routineDefinitions: [], routinesDate: '',
    removedTodayRoutineIds: {}, habits: [], habitLogs: {}, habitsEnabled: false,
    routinesEnabled: false, gtdFrames: {}, goals: [], projects: [], areas: [],
    goalsProjectsEnabled: false, unscheduledOrderTimestamp: null,
    ...over,
  });

  const written = (key) => JSON.parse(Object.fromEntries(setItem.mock.calls)[key]);

  beforeEach(() => {
    setItem = vi.fn();
    globalThis.localStorage = { getItem: vi.fn(() => null), setItem, removeItem: vi.fn() };
  });

  afterEach(() => {
    delete globalThis.localStorage;
    delete globalThis.window;
  });

  it('stamps a task that is newly scheduled', async () => {
    const useDataPersistence = await loadHookAs('main');
    const tasks = [{ id: 't1', title: 'Report', date: '2026-09-17', startTime: '09:00', duration: 60 }];

    useDataPersistence(saveProps({ tasks })).saveData();

    expect(written('day-planner-tasks')[0].originalPlan)
      .toEqual({ date: '2026-09-17', startTime: '09:00', duration: 60 });
  });

  it('does not stamp a task that storage already had scheduled', async () => {
    const useDataPersistence = await loadHookAs('main');
    const stored = [{ id: 't1', title: 'Report', date: '2026-09-10', startTime: '14:00', lastModified: '2026-09-10T00:00:00Z' }];
    globalThis.localStorage.getItem = vi.fn((k) =>
      k === 'day-planner-tasks' ? JSON.stringify(stored) : null);
    const tasks = [{ ...stored[0], date: '2026-09-17', startTime: '09:00' }];

    useDataPersistence(saveProps({ tasks })).saveData();

    expect(written('day-planner-tasks')[0].originalPlan).toBeUndefined();
  });

  it('leaves the other four task stores alone', async () => {
    // Only the scheduled-task store opts in. The fixtures below are deliberately
    // given a full date and time, which real routines and recurring templates do
    // not have, so this fails if the flag is ever added to another store rather
    // than passing because the fixture happened to look unscheduled.
    const useDataPersistence = await loadHookAs('main');
    const timed = (id) => ({ id, title: id, date: '2026-09-17', startTime: '09:00' });

    useDataPersistence(saveProps({
      unscheduledTasks: [timed('u1')],
      recycleBin: [timed('r1')],
      recurringTasks: [timed('rec1')],
      todayRoutines: [timed('rt1')],
    })).saveData();

    for (const key of ['day-planner-unscheduled', 'day-planner-recycle-bin',
      'day-planner-recurring-tasks', 'day-planner-today-routines']) {
      expect(written(key)[0].originalPlan).toBeUndefined();
    }
  });

  it('records nothing while remote data is being applied', async () => {
    // suppressTimestampRef is set during an apply pass. This device did not
    // witness the scheduling, so claiming a baseline from whatever arrived would
    // invent one from a schedule that may already have been changed elsewhere.
    const useDataPersistence = await loadHookAs('main');
    const tasks = [{ id: 't1', title: 'Report', date: '2026-09-17', startTime: '09:00' }];

    useDataPersistence(saveProps({ tasks, suppressTimestampRef: { current: true } })).saveData();

    expect(written('day-planner-tasks')[0].originalPlan).toBeUndefined();
  });

  it('stamps when this device last edited its own data, and not on an apply from a transport', async () => {
    // The snapshot file tiers write at once for a change made here and wait
    // for the folder to catch up with one that arrived by another road
    // (sync/snapshotFileSync.js). The apply re-persists too, so the stamp is
    // gated on isRemoteApply, the same gate the intent emitters use.
    const useDataPersistence = await loadHookAs('main');
    const keys = () => setItem.mock.calls.map(([k]) => k);

    useDataPersistence(saveProps({ isRemoteApply: () => false })).saveData();
    expect(keys()).toContain('day-planner-cloud-sync-local-modified');
    expect(keys()).toContain('day-planner-local-edit-at');

    setItem.mockClear();
    useDataPersistence(saveProps({ isRemoteApply: () => true })).saveData();
    expect(keys()).toContain('day-planner-cloud-sync-local-modified');
    expect(keys()).not.toContain('day-planner-local-edit-at');
  });

  it('guard (2026-10-10): does not stamp a persist that follows clock-driven bookkeeping (the day rollover), which every device does at once', async () => {
    const useDataPersistence = await loadHookAs('main');
    const { markBookkeepingChange, _resetBookkeepingForTests } = await import('../utils/localEditStamp.js');
    const keys = () => setItem.mock.calls.map(([k]) => k);
    try {
      markBookkeepingChange();
      useDataPersistence(saveProps({ isRemoteApply: () => false })).saveData();
      expect(keys()).toContain('day-planner-cloud-sync-local-modified');
      expect(keys()).not.toContain('day-planner-local-edit-at');
    } finally { _resetBookkeepingForTests(); }
    setItem.mockClear();
    useDataPersistence(saveProps({ isRemoteApply: () => false })).saveData();
    expect(keys()).toContain('day-planner-local-edit-at');
  });
});

// ── Regression: the baseline has to reach React STATE, not just storage ──────
// First shipped, the persist pass wrote originalPlan to localStorage and stopped
// there. State never carried it, so everything that reads state — buildSyncPayload
// and the preserveStickyFields source in applyEngineData — could not see it. On a
// vault-synced install the next apply wrote state back over storage and the
// baseline was gone seconds after it was written, which is why a fresh install
// reported 0 of 626 tasks with a baseline.
describe('saveData feeds the baseline back into state', () => {
  let setItem;
  const saveProps = (over = {}) => ({
    ...makeProps().props,
    tasks: [], unscheduledTasks: [], recycleBin: [], recurringTasks: [], todayRoutines: [],
    darkMode: false, syncUrl: '', taskCalendarUrl: '', syncRetentionDays: 0,
    completedTaskUids: new Set(), routineDefinitions: [], routinesDate: '',
    removedTodayRoutineIds: {}, habits: [], habitLogs: {}, habitsEnabled: false,
    routinesEnabled: false, gtdFrames: {}, goals: [], projects: [], areas: [],
    goalsProjectsEnabled: false, unscheduledOrderTimestamp: null,
    ...over,
  });

  beforeEach(() => {
    setItem = vi.fn();
    globalThis.localStorage = { getItem: vi.fn(() => null), setItem, removeItem: vi.fn() };
  });
  afterEach(() => { delete globalThis.localStorage; delete globalThis.window; });

  const task = { id: 't1', title: 'Report', date: '2026-09-17', startTime: '09:00', duration: 60 };

  it('calls setTasks with the baseline applied when it stamps one', async () => {
    const useDataPersistence = await loadHookAs('main');
    const { props } = makeProps();
    const setTasks = props.setTasks;

    useDataPersistence(saveProps({ tasks: [task], setTasks })).saveData();

    expect(setTasks).toHaveBeenCalledTimes(1);
    const updated = setTasks.mock.calls[0][0]([task]); // functional update
    expect(updated[0].originalPlan).toEqual({ date: '2026-09-17', startTime: '09:00', duration: 60 });
  });

  it('does NOT touch state when there is no new baseline to add', async () => {
    // Termination: the write-back re-runs the save effect, and that second pass
    // must be a no-op or the two bounce forever.
    const useDataPersistence = await loadHookAs('main');
    const { props } = makeProps();
    const already = { ...task, originalPlan: { date: '2026-09-17', startTime: '09:00', duration: 60 } };

    useDataPersistence(saveProps({ tasks: [already], setTasks: props.setTasks })).saveData();

    expect(props.setTasks).not.toHaveBeenCalled();
  });

  it('the write-back never drops tasks the persist pass filters out', async () => {
    // saveData persists a FILTERED array (no _native rows). Writing that back
    // wholesale would delete those rows from state, so the update has to enrich
    // in place rather than replace.
    const useDataPersistence = await loadHookAs('main');
    const { props } = makeProps();
    const native = { id: 'n1', title: 'Calendar event', _native: true, date: '2026-09-17', startTime: '10:00' };

    useDataPersistence(saveProps({ tasks: [task, native], setTasks: props.setTasks })).saveData();

    const updated = props.setTasks.mock.calls[0][0]([task, native]);
    expect(updated).toHaveLength(2);
    expect(updated.find((t) => t.id === 'n1')).toBeDefined();
  });
});

// ── The trail of stops between the baseline and the current plan ────────────
// Same pass, same suppression, same state write-back as the baseline and the
// count. The state half is not belt-and-braces: a field that reaches only
// localStorage is invisible to buildSyncPayload and to preserveStickyFields, and
// the next apply writes state back over it. That is not hypothetical here — it
// is what happened to originalPlan on a real vault-synced install.
describe('saveData records where a slipped task landed', () => {
  let setItem;
  const saveProps = (over = {}) => ({
    ...makeProps().props,
    tasks: [], unscheduledTasks: [], recycleBin: [], recurringTasks: [], todayRoutines: [],
    darkMode: false, syncUrl: '', taskCalendarUrl: '', syncRetentionDays: 0,
    completedTaskUids: new Set(), routineDefinitions: [], routinesDate: '',
    removedTodayRoutineIds: {}, habits: [], habitLogs: {}, habitsEnabled: false,
    routinesEnabled: false, gtdFrames: {}, goals: [], projects: [], areas: [],
    goalsProjectsEnabled: false, unscheduledOrderTimestamp: null,
    ...over,
  });
  const written = (key) => JSON.parse(Object.fromEntries(setItem.mock.calls)[key]);

  // Both dates are in the past, so the task had come due before it was moved:
  // a slip, not planning. (utils/deferrals.js draws that line.)
  const before = { id: 't1', title: 'Report', date: '2026-01-05', startTime: '09:00', duration: 60, lastModified: '2026-01-05T00:00:00Z' };
  const after = { ...before, date: '2026-01-07', startTime: '14:00' };

  const withStored = (stored) => {
    globalThis.localStorage.getItem = vi.fn((k) =>
      k === 'day-planner-tasks' ? JSON.stringify(stored) : null);
  };

  beforeEach(() => {
    setItem = vi.fn();
    globalThis.localStorage = { getItem: vi.fn(() => null), setItem, removeItem: vi.fn() };
  });
  afterEach(() => { delete globalThis.localStorage; delete globalThis.window; });

  it('appends the schedule the task moved TO', async () => {
    const useDataPersistence = await loadHookAs('main');
    withStored([before]);

    useDataPersistence(saveProps({ tasks: [after] })).saveData();

    const [stop] = written('day-planner-tasks')[0].planTrail;
    expect(stop).toMatchObject({ date: '2026-01-07', startTime: '14:00' });
    expect(typeof stop.at).toBe('number');
  });

  it('records nothing for a move made before the task came due', async () => {
    const useDataPersistence = await loadHookAs('main');
    const future = { ...before, date: '2099-01-05' };
    withStored([future]);

    useDataPersistence(saveProps({ tasks: [{ ...future, date: '2099-01-09' }] })).saveData();

    expect(written('day-planner-tasks')[0].planTrail).toBeUndefined();
  });

  it('records nothing while remote data is being applied', async () => {
    // A reschedule made on another device is that device's to record. Doing it
    // again here would invent a stop for a move this device never witnessed.
    const useDataPersistence = await loadHookAs('main');
    withStored([before]);

    useDataPersistence(saveProps({ tasks: [after], suppressTimestampRef: { current: true } })).saveData();

    expect(written('day-planner-tasks')[0].planTrail).toBeUndefined();
  });

  it('feeds the stop back into React state, not just localStorage', async () => {
    const useDataPersistence = await loadHookAs('main');
    const { props } = makeProps();
    withStored([before]);

    useDataPersistence(saveProps({ tasks: [after], setTasks: props.setTasks })).saveData();

    const updated = props.setTasks.mock.calls.reduce((list, [fn]) => fn(list), [after]);
    expect(updated[0].planTrail).toHaveLength(1);
    expect(updated[0].deferrals).toBe(1);
  });

  it('does NOT touch state on a pass with no new stop', async () => {
    // Termination: each write-back re-runs the save effect, and the second pass
    // has to be a no-op or the two bounce forever.
    const useDataPersistence = await loadHookAs('main');
    const { props } = makeProps();
    const settled = { ...after, originalPlan: { date: '2026-01-05', startTime: '09:00', duration: 60 } };
    withStored([settled]);

    useDataPersistence(saveProps({ tasks: [settled], setTasks: props.setTasks })).saveData();

    expect(props.setTasks).not.toHaveBeenCalled();
  });
});
