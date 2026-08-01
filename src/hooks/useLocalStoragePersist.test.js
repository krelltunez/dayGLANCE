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
