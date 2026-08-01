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
    expect(removeItem).toHaveBeenCalledWith('day-planner-removed-today-routine-ids');
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
