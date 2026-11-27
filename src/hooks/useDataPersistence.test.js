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

    await useDataPersistence(props).loadData();

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

    await useDataPersistence(props).loadData();

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

    await useDataPersistence(props).loadData();

    // The tray holds a snapshot as of its last reload; persisting from it would
    // overwrite fresher main-window data (useSaveOnChange.js:5).
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('still reads and normalizes in tray mode, only skipping persistence', async () => {
    const useDataPersistence = await loadHookAs('tray');
    const { props, setters } = makeProps();

    await useDataPersistence(props).loadData();

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

    // A task new to this device also gets its createdAt written back, so the
    // functional updates are applied in turn, as React would.
    const updated = setTasks.mock.calls.reduce((list, [update]) => update(list), [task]);
    expect(updated[0].originalPlan).toEqual({ date: '2026-09-17', startTime: '09:00', duration: 60 });
  });

  it('does NOT touch state when there is no new baseline to add', async () => {
    // Termination: the write-back re-runs the save effect, and that second pass
    // must be a no-op or the two bounce forever.
    const useDataPersistence = await loadHookAs('main');
    const { props } = makeProps();
    // It carries its createdAt too, which a stored task on its second pass has.
    const already = { ...task, createdAt: '2026-09-16T08:00:00-05:00', originalPlan: { date: '2026-09-17', startTime: '09:00', duration: 60 } };

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

// ── #2138: an unreadable bucket is not an empty one ─────────────────────────
// A throw anywhere in loadData used to be read as "no data": state stayed
// empty, dataLoaded went true, and the next save wrote the empty state over
// every bucket the load had not reached. Each bucket now loads on its own, and
// one that cannot be read is protected from the save pass until it is
// repaired or discarded (utils/loadFailures.js).
describe('loadData isolates an unreadable bucket (#2138)', () => {
  let store;
  let setItem;
  const saveProps = (over = {}) => ({
    ...makeProps().props,
    tasks: [], unscheduledTasks: [], recycleBin: [], recurringTasks: [], todayRoutines: [],
    darkMode: false, syncUrl: '', taskCalendarUrl: '', syncRetentionDays: 0,
    completedTaskUids: new Set(), routineDefinitions: {}, routinesDate: '',
    removedTodayRoutineIds: {}, habits: [], habitLogs: {}, habitsEnabled: false,
    routinesEnabled: false, gtdFrames: [], goals: [], projects: [], areas: [],
    goalsProjectsEnabled: false, unscheduledOrderTimestamp: null,
    ...over,
  });
  const writtenKeys = () => setItem.mock.calls.map(([key]) => key);
  const quota = () => Object.assign(new Error('quota'), { name: 'QuotaExceededError' });

  beforeEach(() => {
    store = {
      ...STORE,
      'day-planner-habit-logs': JSON.stringify({ h1: { '2026-10-18': 3 } }),
      'day-planner-goals': JSON.stringify([{ id: 'g1', title: 'Goal' }]),
      'day-planner-daily-notes': JSON.stringify({ '2026-10-18': { content: 'note' } }),
    };
    setItem = vi.fn((key, value) => { store[key] = value; });
    globalThis.localStorage = {
      getItem: vi.fn((k) => store[k] ?? null),
      setItem,
      removeItem: vi.fn(),
    };
  });
  afterEach(() => { delete globalThis.localStorage; delete globalThis.window; });

  const load = async () => {
    // Not named use*: this calls the hook as a plain function, like the tests above.
    const persistence = await loadHookAs('main');
    const failures = await import('../utils/loadFailures.js');
    const { props, setters } = makeProps();
    await persistence(props).loadData();
    return { persistence, failures, setters };
  };

  it('a quota error on the normalization write-back no longer aborts the load', async () => {
    setItem.mockImplementation((key) => { if (key === 'day-planner-tasks') throw quota(); });
    const { failures, setters } = await load();

    expect(setters.setTasks.mock.calls[0][0]([])).toMatchObject([{ id: 't1' }]);
    expect(setters.setUnscheduledTasks).toHaveBeenCalledWith([expect.objectContaining({ id: 'u1' })]);
    expect(setters.setHabits).toHaveBeenCalled();
    expect(setters.setGoals).toHaveBeenCalledWith([{ id: 'g1', title: 'Goal' }]);
    expect(setters.setDailyNotes).toHaveBeenCalled();
    expect(setters.setDataLoaded).toHaveBeenCalledWith(true);
    // The data was readable; nothing is protected.
    expect(failures.getLoadFailures()).toEqual([]);
  });

  it('a corrupt bucket does not stop the ones after it, and is not saved over', async () => {
    store['day-planner-habits'] = '{not json';
    const { persistence, failures, setters } = await load();

    expect(setters.setTasks).toHaveBeenCalled();
    expect(setters.setHabits).not.toHaveBeenCalled();
    expect(setters.setHabitLogs).toHaveBeenCalled();
    expect(setters.setGoals).toHaveBeenCalled();
    expect(failures.getLoadFailures().map(f => f.key)).toEqual(['day-planner-habits']);

    setItem.mockClear();
    persistence(saveProps()).saveData();
    expect(writtenKeys()).not.toContain('day-planner-habits');
    expect(writtenKeys()).toContain('day-planner-tasks');
    expect(store['day-planner-habits']).toBe('{not json');
  });

  it('corrupt tasks leave task state alone and the stored copy untouched', async () => {
    store['day-planner-tasks'] = '[{"id":"t1",';
    const { persistence, setters } = await load();

    expect(setters.setTasks).not.toHaveBeenCalled();
    expect(setters.setUnscheduledTasks).toHaveBeenCalled();
    expect(setters.setDataLoaded).toHaveBeenCalledWith(true);

    persistence(saveProps()).saveData();
    expect(store['day-planner-tasks']).toBe('[{"id":"t1",');
  });

  it('the protection lifts once valid data replaces the unreadable value', async () => {
    store['day-planner-tasks'] = '[{"id":"t1",';
    const { persistence, failures } = await load();

    // A sync apply or a restore writes storage and state together.
    store['day-planner-tasks'] = JSON.stringify([{ id: 't9', lastModified: '2026-10-18T00:00:00Z' }]);
    persistence(saveProps({ tasks: [{ id: 't9', lastModified: '2026-10-18T00:00:00Z' }] })).saveData();

    expect(failures.getLoadFailures()).toEqual([]);
    expect(JSON.parse(store['day-planner-tasks'])).toMatchObject([{ id: 't9' }]);
  });

  it('discarding releases the bucket to the save pass', async () => {
    store['day-planner-habits'] = '{not json';
    const { persistence, failures } = await load();

    failures.discardLoadFailures();
    persistence(saveProps()).saveData();
    expect(store['day-planner-habits']).toBe('[]');
  });

  it('an absent key is no data, not a failure', async () => {
    delete store['day-planner-goals'];
    const { failures, setters } = await load();
    expect(setters.setGoals).not.toHaveBeenCalled();
    expect(failures.getLoadFailures()).toEqual([]);
  });
});

// ── #2139: a full store is recorded, not just toasted once ──────────────────
describe('saveData at quota', () => {
  afterEach(() => { delete globalThis.localStorage; delete globalThis.window; vi.restoreAllMocks(); });

  it('records the rejected key for the persistent banner and still writes the rest', async () => {
    const written = {};
    globalThis.localStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn((k, v) => {
        if (k === 'day-planner-habit-logs') throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
        written[k] = v;
      }),
      removeItem: vi.fn(),
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const persistence = await loadHookAs('main');
    const { getWriteFailures } = await import('../utils/storageWrites.js');
    const { props } = makeProps();
    const save = persistence({
      ...props,
      tasks: [], unscheduledTasks: [], recycleBin: [], recurringTasks: [], todayRoutines: [],
      darkMode: false, syncUrl: '', taskCalendarUrl: '', syncRetentionDays: 0,
      completedTaskUids: new Set(), routineDefinitions: {}, routinesDate: '',
      removedTodayRoutineIds: {}, habits: [], habitLogs: {}, habitsEnabled: false,
      routinesEnabled: false, gtdFrames: [], goals: [], projects: [], areas: [],
      goalsProjectsEnabled: false, unscheduledOrderTimestamp: null,
      t: (k) => k,
    }).saveData;

    expect(save).not.toThrow();
    expect(getWriteFailures()).toEqual(['day-planner-habit-logs']);
    expect(props.setUndoToast).toHaveBeenCalledTimes(1);
    expect(written).toHaveProperty('day-planner-goals');
  });
});

// ── #2140: one edit writes the buckets it changed, not all of them ──────────
describe('saveData writes only the buckets that changed', () => {
  let store;
  let setItem;
  const base = () => ({
    ...makeProps().props,
    tasks: [{ id: 't1', title: 'Task', date: '2026-10-19', lastModified: '2026-10-18T00:00:00.000Z' }],
    unscheduledTasks: [], recycleBin: [], recurringTasks: [], todayRoutines: [],
    darkMode: false, syncUrl: '', taskCalendarUrl: '', syncRetentionDays: 0,
    completedTaskUids: new Set(), routineDefinitions: {}, routinesDate: '2026-10-19',
    removedTodayRoutineIds: {}, habits: [], habitLogs: {}, habitsEnabled: false,
    routinesEnabled: false, gtdFrames: [], goals: [], projects: [], areas: [],
    goalsProjectsEnabled: false, unscheduledOrderTimestamp: null,
    t: (k) => k,
  });
  const BOOKKEEPING = ['day-planner-cloud-sync-local-modified', 'day-planner-local-edit-at'];
  const dataWrites = () => setItem.mock.calls.map(([k]) => k).filter(k => !BOOKKEEPING.includes(k));

  beforeEach(() => {
    store = {};
    setItem = vi.fn((k, v) => { store[k] = v; });
    globalThis.localStorage = { getItem: vi.fn((k) => store[k] ?? null), setItem, removeItem: vi.fn() };
  });
  afterEach(() => { delete globalThis.localStorage; delete globalThis.window; vi.restoreAllMocks(); });

  it('a pass with nothing changed writes no data bucket', async () => {
    const persistence = await loadHookAs('main');
    const props = base();
    persistence(props).saveData();
    expect(dataWrites().length).toBeGreaterThan(20);

    setItem.mockClear();
    persistence(props).saveData();
    expect(dataWrites()).toEqual([]);
  });

  it('changing one slice writes that bucket alone', async () => {
    const persistence = await loadHookAs('main');
    const props = base();
    persistence(props).saveData();

    setItem.mockClear();
    persistence({ ...props, habits: [{ id: 'h1', name: 'Water' }] }).saveData();
    expect(dataWrites()).toEqual(['day-planner-habits']);
  });

  it('a completed task rewrites tasks, stamped, and nothing else', async () => {
    const persistence = await loadHookAs('main');
    const props = base();
    persistence(props).saveData();

    setItem.mockClear();
    persistence({ ...props, tasks: [{ ...props.tasks[0], completed: true }] }).saveData();
    expect(dataWrites()).toEqual(['day-planner-tasks']);
    expect(JSON.parse(store['day-planner-tasks'])[0].lastModified).not.toBe('2026-10-18T00:00:00.000Z');
  });

  it('a key changed behind the pass is rewritten from state, as before', async () => {
    const persistence = await loadHookAs('main');
    const props = base();
    persistence(props).saveData();

    store['day-planner-goals'] = JSON.stringify([{ id: 'stray' }]);
    setItem.mockClear();
    persistence(props).saveData();
    expect(dataWrites()).toEqual(['day-planner-goals']);
    expect(store['day-planner-goals']).toBe('[]');
  });

  it('a write that failed is tried again on the next pass', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const persistence = await loadHookAs('main');
    const props = base();
    let full = true;
    setItem.mockImplementation((k, v) => {
      if (full && k === 'day-planner-habit-logs') throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
      store[k] = v;
    });
    persistence(props).saveData();
    expect(store).not.toHaveProperty('day-planner-habit-logs');

    full = false;
    setItem.mockClear();
    persistence(props).saveData();
    expect(dataWrites()).toEqual(['day-planner-habit-logs']);
  });
});

// ── Referential self-heal at boot (#2137) ───────────────────────────────────
// A row that outlives its target is invisible state: the Inbox hides "project
// tasks" whose project is gone, and a project whose goal is gone belongs to
// neither the goal's list nor the standalone one. The boot pass repairs data
// written before the delete-time cascades existed. Only a TOMBSTONE may make a
// reference dangling — never an id missing from a list this device happens to
// hold (a new device, a vault pull that carried tasks but not projects, a
// payload from a client with Goals & Projects off).
describe('loadData drops references to deleted projects and goals (#2137)', () => {
  const goneProjectStore = () => ({
    'day-planner-tasks': JSON.stringify([{ id: 't1', projectId: 'gone' }, { id: 't2', projectId: 'live' }]),
    'day-planner-unscheduled': JSON.stringify([{ id: 'u1', projectId: 'gone' }]),
    'day-planner-recycle-bin': JSON.stringify([{ id: 'b1', projectId: 'gone', deletedAt: 'x' }]),
    'day-planner-recurring-tasks': JSON.stringify([{ id: 'r1', projectId: 'gone' }]),
    'day-planner-projects': JSON.stringify([
      { id: 'live', goalId: 'gone-goal', updatedAt: 'old' },
      { id: 'p2', goalId: 'live-goal', updatedAt: 'old' },
    ]),
    'day-planner-goals': JSON.stringify([{ id: 'live-goal' }]),
    'day-planner-deleted-project-ids': JSON.stringify({ gone: '2026-10-18T13:30:15.460Z' }),
    'day-planner-deleted-goal-ids': JSON.stringify({ 'gone-goal': '2026-10-18T21:30:15.460Z' }),
  });
  let store;
  let setItem;

  beforeEach(() => {
    store = goneProjectStore();
    setItem = vi.fn((key, value) => { store[key] = value; });
    globalThis.localStorage = {
      getItem: vi.fn((k) => store[k] ?? null),
      setItem,
      removeItem: vi.fn(),
    };
  });
  afterEach(() => {
    delete globalThis.localStorage;
    delete globalThis.window;
  });

  const load = async () => {
    // The hook has no React state of its own; call it as the plain function the
    // tests above do (aliased so the hooks lint rule knows it is not rendered).
    const loadHook = await loadHookAs('main');
    const { props, setters } = makeProps();
    await loadHook(props).loadData();
    return { setters };
  };

  it('detaches tasks, templates and bin entries from a tombstoned project', async () => {
    const { setters } = await load();

    const tasks = setters.setTasks.mock.calls[0][0]([]);
    expect(tasks.find(t => t.id === 't1')).not.toHaveProperty('projectId');
    expect(tasks.find(t => t.id === 't2').projectId).toBe('live');
    expect(setters.setUnscheduledTasks.mock.calls[0][0][0]).not.toHaveProperty('projectId');
    expect(setters.setRecycleBin.mock.calls[0][0][0]).not.toHaveProperty('projectId');
    expect(setters.setRecurringTasks.mock.calls[0][0][0]).not.toHaveProperty('projectId');
  });

  it('makes the tombstoned goal\'s projects standalone without re-stamping them', async () => {
    const { setters } = await load();

    const projects = setters.setProjects.mock.calls[0][0];
    expect(projects.find(p => p.id === 'live')).not.toHaveProperty('goalId');
    expect(projects.find(p => p.id === 'live').updatedAt).toBe('old');
    expect(projects.find(p => p.id === 'p2').goalId).toBe('live-goal');
  });

  it('persists the repaired copies before state is set, so the save pass sees no edit', async () => {
    await load();

    const written = Object.fromEntries(setItem.mock.calls);
    expect(JSON.parse(written['day-planner-tasks']).find(t => t.id === 't1')).not.toHaveProperty('projectId');
    expect(JSON.parse(written['day-planner-recurring-tasks'])[0]).not.toHaveProperty('projectId');
    expect(JSON.parse(written['day-planner-recycle-bin'])[0]).not.toHaveProperty('projectId');
    expect(JSON.parse(written['day-planner-projects'])[0]).not.toHaveProperty('goalId');
  });

  it('does not detach an id that is merely absent from the local project list', async () => {
    // A partial snapshot: tasks arrived, projects did not. No tombstone says the
    // project is deleted, so the reference must survive.
    store = {
      'day-planner-tasks': JSON.stringify([{ id: 't1', projectId: 'not-pulled-yet' }]),
      'day-planner-unscheduled': JSON.stringify([{ id: 'u1', projectId: 'not-pulled-yet' }]),
    };
    const { setters } = await load();
    const tasks = setters.setTasks.mock.calls[0][0]([]);
    expect(tasks[0].projectId).toBe('not-pulled-yet');
    expect(setters.setUnscheduledTasks.mock.calls[0][0][0].projectId).toBe('not-pulled-yet');
    expect(setters.setProjects).not.toHaveBeenCalled();
  });

  it('does not reparent projects when the goal list is absent', async () => {
    store = {
      'day-planner-projects': JSON.stringify([{ id: 'p1', goalId: 'not-pulled-yet', updatedAt: 'old' }]),
    };
    const { setters } = await load();
    expect(setters.setProjects).toHaveBeenCalledWith([{ id: 'p1', goalId: 'not-pulled-yet', updatedAt: 'old' }]);
  });

  it('a corrupt tombstone map means no information, not "everything is deleted"', async () => {
    store['day-planner-deleted-project-ids'] = '{not json';
    const { setters } = await load();
    const tasks = setters.setTasks.mock.calls[0][0]([]);
    expect(tasks.find(t => t.id === 't1').projectId).toBe('gone');
    expect(setters.setDataLoaded).toHaveBeenCalledWith(true);
  });
});

// An open task is never archived (utils/referentialIntegrity.js,
// unarchiveOpenTasks): the boot pass repairs a leftover flag from a reopen,
// unstamped, and writes the repair back before state so the save pass sees
// no edit.
describe('loadData repairs open tasks left archived', () => {
  let store;
  let setItem;
  beforeEach(() => {
    store = {
      'day-planner-tasks': JSON.stringify([{ id: 't1', completed: false, archived: true, lastModified: 'old' }]),
      'day-planner-unscheduled': JSON.stringify([
        { id: 'u1', completed: false, archived: true, lastModified: 'old' },
        { id: 'u2', completed: true, archived: true, lastModified: 'old' },
      ]),
      'day-planner-recycle-bin': JSON.stringify([{ id: 'b1', completed: false, archived: true, deletedAt: 'x' }]),
    };
    setItem = vi.fn((key, value) => { store[key] = value; });
    globalThis.localStorage = { getItem: vi.fn((k) => store[k] ?? null), setItem, removeItem: vi.fn() };
  });
  afterEach(() => {
    delete globalThis.localStorage;
    delete globalThis.window;
  });

  it('clears archived on open rows only, keeps their stamps, and persists the repair', async () => {
    const loadHook = await loadHookAs('main');
    const { props, setters } = makeProps();
    await loadHook(props).loadData();

    const tasks = setters.setTasks.mock.calls[0][0]([]);
    expect(tasks[0]).toMatchObject({ archived: false, lastModified: 'old' });
    const inbox = setters.setUnscheduledTasks.mock.calls[0][0];
    expect(inbox.find(t => t.id === 'u1')).toMatchObject({ archived: false, lastModified: 'old' });
    expect(inbox.find(t => t.id === 'u2').archived).toBe(true);
    expect(setters.setRecycleBin.mock.calls[0][0][0].archived).toBe(false);

    const written = Object.fromEntries(setItem.mock.calls);
    expect(JSON.parse(written['day-planner-unscheduled']).find(t => t.id === 'u1').archived).toBe(false);
    expect(JSON.parse(written['day-planner-recycle-bin'])[0].archived).toBe(false);
  });
});

// #2135: the persist pass stamps `createdAt` on a task this device created,
// and on nothing else (utils/createdAt.js has the rules).
describe('saveData stamps createdAt on tasks created on this device', () => {
  let store;
  const memoryStorage = () => {
    store = new Map();
    return {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    };
  };
  const stored = (key) => JSON.parse(store.get(key) || '[]');
  const saveProps = (setters, over = {}) => ({
    ...setters,
    tasks: [], unscheduledTasks: [], recycleBin: [], recurringTasks: [], todayRoutines: [],
    darkMode: false, syncUrl: '', taskCalendarUrl: '', syncRetentionDays: 0,
    completedTaskUids: new Set(), routineDefinitions: [], routinesDate: '',
    removedTodayRoutineIds: {}, habits: [], habitLogs: {}, habitsEnabled: false,
    routinesEnabled: false, gtdFrames: {}, goals: [], projects: [], areas: [],
    goalsProjectsEnabled: false, unscheduledOrderTimestamp: null,
    ...over,
  });
  // Every functional update a setter received, applied in turn, as React would.
  const settled = (setter, list) => setter.mock.calls.reduce((acc, [update]) => update(acc), list);
  const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;

  beforeEach(() => { globalThis.localStorage = memoryStorage(); });
  afterEach(() => { delete globalThis.localStorage; delete globalThis.window; });

  it('stamps a new inbox task in storage AND in state', async () => {
    const useDataPersistence = await loadHookAs('main');
    const { props } = makeProps();
    const fresh = { id: 'n1', title: 'New idea' };
    useDataPersistence(saveProps(props, { unscheduledTasks: [fresh] })).saveData();

    expect(stored('day-planner-unscheduled')[0].createdAt).toMatch(STAMP);
    // State is what the sync payload reads; a stamp only in storage never syncs.
    const inState = settled(props.setUnscheduledTasks, [fresh]);
    expect(inState[0].createdAt).toBe(stored('day-planner-unscheduled')[0].createdAt);
  });

  it('stamps a new scheduled task and a new recurring series, but nothing in the bin', async () => {
    const useDataPersistence = await loadHookAs('main');
    const { props } = makeProps();
    useDataPersistence(saveProps(props, {
      tasks: [{ id: 's1', title: 'Call', date: '2026-10-22', startTime: '09:00' }],
      recurringTasks: [{ id: 'r1', title: 'Gym', recurrence: { type: 'daily', startDate: '2026-10-22' } }],
      recycleBin: [{ id: 'b1', title: 'Gone' }],
    })).saveData();

    expect(stored('day-planner-tasks')[0].createdAt).toMatch(STAMP);
    expect(stored('day-planner-recurring-tasks')[0].createdAt).toMatch(STAMP);
    expect(stored('day-planner-recycle-bin')[0]).not.toHaveProperty('createdAt');
  });

  it('never backfills a task that was already stored', async () => {
    store.set('day-planner-unscheduled', JSON.stringify([{ id: 'old', title: 'Legacy', lastModified: '2026-01-01T00:00:00.000Z' }]));
    const useDataPersistence = await loadHookAs('main');
    const { props } = makeProps();
    useDataPersistence(saveProps(props, { unscheduledTasks: [{ id: 'old', title: 'Legacy', lastModified: '2026-01-01T00:00:00.000Z' }] })).saveData();

    expect(stored('day-planner-unscheduled')[0]).not.toHaveProperty('createdAt');
    expect(props.setUnscheduledTasks).not.toHaveBeenCalled();
  });

  it('does not stamp a task that only moved between lists (inbox → scheduled, bin → inbox)', async () => {
    store.set('day-planner-unscheduled', JSON.stringify([{ id: 'm1', title: 'Was in the inbox' }]));
    store.set('day-planner-recycle-bin', JSON.stringify([{ id: 'm2', title: 'Was in the bin' }]));
    const useDataPersistence = await loadHookAs('main');
    const { props } = makeProps();
    useDataPersistence(saveProps(props, {
      tasks: [{ id: 'm1', title: 'Was in the inbox', date: '2026-10-22', startTime: '10:00' }],
      unscheduledTasks: [{ id: 'm2', title: 'Was in the bin' }],
    })).saveData();

    expect(stored('day-planner-tasks')[0]).not.toHaveProperty('createdAt');
    expect(stored('day-planner-unscheduled')[0]).not.toHaveProperty('createdAt');
  });

  it('does not stamp what arrives during a remote apply, and never stamps it later either', async () => {
    const useDataPersistence = await loadHookAs('main');
    const { props } = makeProps();
    const suppressTimestampRef = { current: true };
    const synced = { id: 'x1', title: 'Made on the phone', lastModified: '2026-10-20T00:00:00.000Z' };
    useDataPersistence(saveProps(props, { unscheduledTasks: [synced], suppressTimestampRef })).saveData();
    expect(stored('day-planner-unscheduled')[0]).not.toHaveProperty('createdAt');

    // The next ordinary pass finds it stored: known, so still not stamped.
    suppressTimestampRef.current = false;
    useDataPersistence(saveProps(props, { unscheduledTasks: [{ ...synced }], suppressTimestampRef })).saveData();
    expect(stored('day-planner-unscheduled')[0]).not.toHaveProperty('createdAt');
  });

  it('does not stamp calendar, Todoist or Obsidian rows, or a row that says "not known"', async () => {
    const useDataPersistence = await loadHookAs('main');
    const { props } = makeProps();
    useDataPersistence(saveProps(props, {
      tasks: [
        { id: 'c1', title: 'Feed event', imported: true, date: '2026-10-22', startTime: '08:00' },
        { id: 'o1', title: 'From the vault', importSource: 'obsidian', date: '2026-10-22', startTime: '11:00' },
        { id: 'k1', title: 'Old series, moved', createdAt: null, date: '2026-10-22', startTime: '12:00' },
      ],
      unscheduledTasks: [{ id: 'todoist:a:1', title: 'From Todoist', importSource: 'todoist', imported: false, todoist: { accountId: 'a', id: '1' } }],
    })).saveData();

    for (const row of stored('day-planner-tasks')) {
      expect(row.createdAt === undefined || row.createdAt === null).toBe(true);
    }
    expect(stored('day-planner-unscheduled')[0]).not.toHaveProperty('createdAt');
  });

  it('keeps an existing createdAt exactly, and its arrival does not re-stamp lastModified', async () => {
    const was = { id: 'e1', title: 'Old', lastModified: '2026-01-01T00:00:00.000Z' };
    store.set('day-planner-unscheduled', JSON.stringify([was]));
    const useDataPersistence = await loadHookAs('main');
    const { props } = makeProps();
    const arrived = { ...was, createdAt: '2025-12-31T09:00:00-05:00' };
    useDataPersistence(saveProps(props, { unscheduledTasks: [arrived] })).saveData();

    const [row] = stored('day-planner-unscheduled');
    expect(row.createdAt).toBe('2025-12-31T09:00:00-05:00');
    expect(row.lastModified).toBe('2026-01-01T00:00:00.000Z');
  });
});
