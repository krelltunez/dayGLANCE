import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture what useSaveOnChange passes to useEffect (callback + dependency array)
// without needing a DOM renderer. React re-runs an effect whenever any value in
// its dependency array changes by identity, so proving a data slice is present
// in the deps AND that running the effect calls schedulePush is equivalent to
// proving "editing that slice schedules a vault push".
const captured = { fn: null, deps: null };
vi.mock('react', () => ({
  useEffect: (fn, deps) => { captured.fn = fn; captured.deps = deps; },
}));

const schedulePush = vi.fn();
vi.mock('../sync/dirtyTracker.js', () => ({
  schedulePush: (...args) => schedulePush(...args),
}));

const { default: useSaveOnChange } = await import('./useSaveOnChange.js');

function baseProps(overrides = {}) {
  return {
    saveData: vi.fn(),
    checkConflicts: vi.fn(),
    dataLoaded: true,
    suppressClearPendingRef: { current: false },
    suppressCloudUploadRef: { current: false },
    suppressTimestampRef: { current: false },
    tasks: [], unscheduledTasks: [], recycleBin: [], taskCalendarUrl: '',
    syncUrl: '', syncRetentionDays: 30, completedTaskUids: [], recurringTasks: [],
    routineDefinitions: [], todayRoutines: [], routinesDate: '', removedTodayRoutineIds: [],
    habits: [], habitLogs: {}, habitsEnabled: false, routinesEnabled: false, gtdFrames: [],
    goals: [], projects: [], areas: [], goalsProjectsEnabled: false,
    dailyNotes: {}, users: [], routineCompletions: {}, multiUserEnabled: false,
    ...overrides,
  };
}

describe('useSaveOnChange dependency wiring', () => {
  beforeEach(() => {
    captured.fn = null;
    captured.deps = null;
    schedulePush.mockClear();
  });

  it('includes dailyNotes, users, routineCompletions and multiUserEnabled in the effect deps', () => {
    const dailyNotes = { '2026-07-10': 'note' };
    const users = [{ id: 'u1' }];
    const routineCompletions = { chip1: '2026-07-10' };
    const multiUserEnabled = true;
    useSaveOnChange(baseProps({ dailyNotes, users, routineCompletions, multiUserEnabled }));

    // Each slice must be in the dependency array (by identity) so a change re-runs the effect.
    expect(captured.deps).toContain(dailyNotes);
    expect(captured.deps).toContain(users);
    expect(captured.deps).toContain(routineCompletions);
    expect(captured.deps).toContain(multiUserEnabled);
  });

  it('schedules a vault push when the save effect runs (e.g. after a dailyNotes edit)', () => {
    useSaveOnChange(baseProps());
    expect(captured.fn).toBeTypeOf('function');
    captured.fn();
    expect(schedulePush).toHaveBeenCalledTimes(1);
  });

  it('does not push while remote data is being applied (suppressCloudUpload)', () => {
    useSaveOnChange(baseProps({ suppressCloudUploadRef: { current: true } }));
    captured.fn();
    expect(schedulePush).not.toHaveBeenCalled();
  });
});
