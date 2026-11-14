import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Same shape as useSaveOnChange.test.js: capture what the hook hands to
// useEffect rather than rendering it, then drive the captured callbacks to
// simulate React re-running an effect whose dependency changed.
const effects = [];
vi.mock('react', () => ({
  useEffect: (fn, deps) => { effects.push({ fn, deps }); },
  // A fresh ref per call is correct here: each useRef call site in one render
  // gets its own object, and re-running a captured callback closes over the
  // same one — which is exactly what the mount-skip relies on.
  useRef: (init) => ({ current: init }),
}));

const { default: useLocalStoragePersist } = await import('./useLocalStoragePersist.js');

// Distinct object identities so "which effects depend on this value" is
// unambiguous — booleans would collide with the other boolean preferences.
const CLOCK = { sentinel: 'use24HourClock' };
const VIEW_PREF = { sentinel: 'hideCompletedInbox' };

function baseProps(overrides = {}) {
  return {
    minimizedSections: {},
    use24HourClock: CLOCK,
    inboxPriorityFilter: 'all',
    hideCompletedInbox: VIEW_PREF,
    hideProjectTasksInbox: false,
    hideStandaloneTasksInbox: false,
    inboxTagFilter: [],
    inboxProjectFilter: null,
    inboxSort: 'priority',
    priorityPromptDismissed: false,
    sectionInfoDismissed: {},
    skipOnboardingPersist: { current: true },
    dailyNotes: {},
    suppressCloudUploadRef: { current: false },
    cloudSyncConfig: null,
    cloudSyncInitialDoneRef: { current: false },
    dailyNoteTemplate: '',
    calendarUrlAuth: {},
    autoBackupConfig: {},
    calendarFilter: [],
    ...overrides,
  };
}

const notifyDataChanged = vi.fn();

// Run every captured effect once — the mount pass.
const mount = () => effects.forEach(e => e.fn());
// Re-run only the effects that depend on `value` — one dependency changed.
const change = (value) => effects.filter(e => e.deps?.includes(value)).forEach(e => e.fn());

// #2394: the Inbox sort is kept on the device, under the key readInboxFilterPrefs reads.
describe('useLocalStoragePersist: the Inbox sort', () => {
  beforeEach(() => {
    effects.length = 0;
    notifyDataChanged.mockClear();
    globalThis.localStorage = { setItem: vi.fn(), getItem: vi.fn(() => null), removeItem: vi.fn() };
    globalThis.window = { electronAPI: { notifyDataChanged } };
  });
  afterEach(() => {
    delete globalThis.window;
    delete globalThis.localStorage;
  });

  it('writes the sort as chosen, and again when it changes, without nudging the tray', () => {
    useLocalStoragePersist(baseProps({ inboxSort: 'deadline' }));
    mount();
    expect(globalThis.localStorage.setItem).toHaveBeenCalledWith('day-planner-inbox-sort', 'deadline');
    notifyDataChanged.mockClear();
    globalThis.localStorage.setItem.mockClear();
    change('deadline');
    expect(globalThis.localStorage.setItem.mock.calls).toEqual([['day-planner-inbox-sort', 'deadline']]);
    expect(notifyDataChanged).not.toHaveBeenCalled();
  });
});

describe('useLocalStoragePersist tray invalidation', () => {
  beforeEach(() => {
    effects.length = 0;
    notifyDataChanged.mockClear();
    globalThis.localStorage = { setItem: vi.fn(), getItem: vi.fn(() => null), removeItem: vi.fn() };
    globalThis.window = { electronAPI: { notifyDataChanged } };
  });

  afterEach(() => {
    delete globalThis.window;
    delete globalThis.localStorage;
  });

  it('does not nudge the tray on the mount pass', () => {
    useLocalStoragePersist(baseProps());
    mount();
    // Every persist effect fires on mount with the value it just read back out
    // of localStorage. Emitting there would reload the tray popup on every
    // main-window load, for no change.
    expect(notifyDataChanged).not.toHaveBeenCalled();
  });

  it('nudges the tray exactly once when use24HourClock changes', () => {
    useLocalStoragePersist(baseProps());
    mount();
    notifyDataChanged.mockClear();

    change(CLOCK);

    // The tray renders its agenda through formatTime, so a 12h/24h switch has
    // to invalidate its snapshot -- and exactly once, not once per effect that
    // happens to share the dependency.
    expect(notifyDataChanged).toHaveBeenCalledTimes(1);
  });

  it('does not nudge the tray for a view-preference-only key', () => {
    useLocalStoragePersist(baseProps());
    mount();
    notifyDataChanged.mockClear();

    change(VIEW_PREF);

    // hideCompletedInbox is main-window inbox chrome the tray never renders;
    // reloading the popup for it would be pure waste.
    expect(notifyDataChanged).not.toHaveBeenCalled();
  });

  it('still persists the view preference it declined to nudge for', () => {
    useLocalStoragePersist(baseProps());
    mount();
    // Guards the negative case above against passing for the wrong reason (a
    // dropped effect rather than a deliberately absent nudge).
    expect(globalThis.localStorage.setItem)
      .toHaveBeenCalledWith('hideCompletedInbox', VIEW_PREF.toString());
  });
});

// isTrayMode is derived once at module load from window.location.search, so the
// tray needs its own module instance — set the URL, then import.
async function loadHookAs(mode) {
  vi.resetModules();
  effects.length = 0;
  globalThis.window = { location: { search: mode === 'tray' ? '?tray=1' : '' } };
  const mod = await import('./useLocalStoragePersist.js');
  return mod.default;
}

describe('calendarFilter persistence — tray guard', () => {
  const FILTER = ['work-cal'];
  let setItem;

  beforeEach(() => {
    setItem = vi.fn();
    globalThis.localStorage = { setItem, getItem: vi.fn(() => null), removeItem: vi.fn() };
  });

  afterEach(() => {
    delete globalThis.localStorage;
    delete globalThis.window;
  });

  it('the main window persists the calendar filter', () => {
    // The negative test below is only meaningful if this one holds — otherwise
    // "tray does not write" could pass because nobody writes.
    return loadHookAs('main').then((hook) => {
      hook(baseProps({ calendarFilter: FILTER }));
      mount();
      expect(setItem).toHaveBeenCalledWith('day-planner-calendar-filter', JSON.stringify(FILTER));
    });
  });

  it('the tray does not persist the calendar filter', async () => {
    const hook = await loadHookAs('tray');
    hook(baseProps({ calendarFilter: FILTER }));
    mount();

    // The tray holds a snapshot as of its last reload and must never write to
    // localStorage (same invariant as loadData/saveData). This key is the one
    // the tray can actively CHANGE, via applyEvents → setCalendarFilter when a
    // fetched event names a calendar getCalendars() did not report.
    const keys = setItem.mock.calls.map(([k]) => k);
    expect(keys).not.toContain('day-planner-calendar-filter');
  });

  it('the tray still stops writing it when the value changes, not just on mount', async () => {
    const hook = await loadHookAs('tray');
    hook(baseProps({ calendarFilter: FILTER }));
    mount();
    setItem.mockClear();

    // Simulate applyEvents discovering a calendar and extending the filter.
    change(FILTER);

    expect(setItem).not.toHaveBeenCalledWith(
      'day-planner-calendar-filter', expect.anything(),
    );
  });
});

// #2138: App's initializer reads the notes before anything else runs, and this
// effect fires on mount. An unreadable notes value used to come back as {} and
// be written straight over the stored copy.
describe('useLocalStoragePersist leaves unreadable daily notes alone', () => {
  let store;
  beforeEach(async () => {
    effects.length = 0;
    store = { 'day-planner-daily-notes': '{"2026-10-18": {"content": "half' };
    globalThis.localStorage = {
      setItem: vi.fn((k, v) => { store[k] = v; }),
      getItem: vi.fn((k) => store[k] ?? null),
      removeItem: vi.fn(),
    };
    globalThis.window = {};
  });
  afterEach(() => { delete globalThis.localStorage; delete globalThis.window; });

  it('does not write {} over notes that failed to load, and resumes once they are replaced', async () => {
    // Fresh instances of both, so the hook and the test share one registry.
    vi.resetModules();
    const { default: persist } = await import('./useLocalStoragePersist.js');
    const { loadDailyNotes } = await import('../utils/dailyNotesStore.js');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // No IndexedDB under node: the notes stay in localStorage, where the load
    // records the unreadable value as a failure (utils/loadFailures.js).
    await loadDailyNotes();
    const dailyNotes = {};
    persist(baseProps({ dailyNotes }));
    mount();
    expect(store['day-planner-daily-notes']).toBe('{"2026-10-18": {"content": "half');

    // A sync apply writes valid notes; the effect may persist again.
    store['day-planner-daily-notes'] = '{}';
    change(dailyNotes);
    expect(globalThis.localStorage.setItem).toHaveBeenCalledWith('day-planner-daily-notes', '{}');
  });
});

// #2139: a quota error thrown from an effect reached the app-wide
// ErrorBoundary and replaced the whole app with the crash screen.
describe('useLocalStoragePersist at quota', () => {
  beforeEach(() => {
    effects.length = 0;
    globalThis.localStorage = {
      setItem: vi.fn(() => { throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); }),
      getItem: vi.fn(() => null),
      removeItem: vi.fn(),
    };
    globalThis.window = {};
  });
  afterEach(() => { delete globalThis.localStorage; delete globalThis.window; vi.restoreAllMocks(); });

  it('no persist effect throws, and the full store is recorded for the banner', async () => {
    vi.resetModules();
    const { default: persist } = await import('./useLocalStoragePersist.js');
    const { getWriteFailures } = await import('../utils/storageWrites.js');
    const { loadDailyNotes } = await import('../utils/dailyNotesStore.js');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await loadDailyNotes();
    persist(baseProps());
    expect(mount).not.toThrow();
    expect(getWriteFailures()).toContain('day-planner-daily-notes');
  });
});

// #2141: the notes load asynchronously, and the map in state before that is
// not the user's. Nothing is written, or stamped, until they have loaded.
describe('useLocalStoragePersist before the notes have loaded', () => {
  beforeEach(() => {
    effects.length = 0;
    globalThis.localStorage = { setItem: vi.fn(), getItem: vi.fn(() => null), removeItem: vi.fn() };
    globalThis.window = {};
  });
  afterEach(() => { delete globalThis.localStorage; delete globalThis.window; });

  it('writes and stamps nothing for the notes', async () => {
    vi.resetModules();
    const { default: persist } = await import('./useLocalStoragePersist.js');
    persist(baseProps({ dailyNotes: {} }));
    mount();
    const keys = globalThis.localStorage.setItem.mock.calls.map(([k]) => k);
    expect(keys).not.toContain('day-planner-daily-notes');
    expect(keys).not.toContain('day-planner-local-edit-at');
  });
});
