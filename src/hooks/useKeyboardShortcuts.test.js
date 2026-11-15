import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Same shape as useLocalStoragePersist.test.js: capture the effect the hook
// hands to useEffect and run it against a stand-in document, then feed the
// registered keydown listener synthetic events.
const effects = [];
vi.mock('react', () => ({
  useEffect: (fn, deps) => { effects.push({ fn, deps }); },
}));
vi.mock('../components/month/MonthDaySheet.jsx', () => ({ isMonthDaySheetOpen: () => false }));

const { default: useKeyboardShortcuts, isCalendarOnlyShortcut, isTextEntryTarget, isSidePanelToggleKey } = await import('./useKeyboardShortcuts.js');

const listeners = [];
const fakeDocument = {
  addEventListener: (type, fn) => { if (type === 'keydown') listeners.push(fn); },
  removeEventListener: () => {},
};

const press = (key, extra = {}) => {
  const e = { key, target: { tagName: 'DIV' }, preventDefault: vi.fn(), ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra };
  listeners.forEach((fn) => fn(e));
  return e;
};

function useMounted(overrides = {}) {
  effects.length = 0;
  listeners.length = 0;
  const props = {
    performUndo: vi.fn(), performRedo: vi.fn(),
    setShowSpotlight: vi.fn(), setSpotlightQuery: vi.fn(), setSpotlightSelectedIndex: vi.fn(), playUISound: vi.fn(),
    setShowShortcutHelp: vi.fn(),
    showAddTask: false, showFocusMode: false, showRoutinesDashboard: false, showShortcutHelp: false, showSpotlight: false,
    showSettings: false, showRemindersSettings: false, showWeeklyReview: false, showVoiceInput: false,
    showHabitModal: false, showFramesModal: false, frameAdjustModal: null, showRescheduleModal: false, showGoalsDashboard: false,
    showDayDial: false, setShowDayDial: vi.fn(),
    showBucketList: false, setShowBucketList: vi.fn(),
    selectedDate: new Date(2026, 8, 22), hoverPreviewTime: null, hoverPreviewDate: null,
    setNewTask: vi.fn(), setShowAddTask: vi.fn(), setHoverPreviewTime: vi.fn(), setHoverPreviewDate: vi.fn(),
    routinesEnabled: true, setRoutinesEnabled: vi.fn(), openRoutinesDashboardRef: { current: vi.fn() },
    focusModeAvailableRef: { current: true }, enterFocusModeRef: { current: vi.fn() },
    setDarkMode: vi.fn(),
    showMonthView: false, goToToday: vi.fn(), setViewedMonth: vi.fn(),
    setShowMonthView: vi.fn(),
    monthViewActive: false, openMonthDaySheetRef: { current: vi.fn() },
    setShowMobileTagFilter: vi.fn(),
    setShowBackupMenu: vi.fn(),
    isMobile: false, tabletActiveTab: 'glance', setTabletActiveTab: vi.fn(),
    aiConfig: null, setShowVoiceInput: vi.fn(),
    habitsEnabled: true, setHabitsEnabled: vi.fn(), setShowHabitModal: vi.fn(),
    goalsProjectsEnabled: true, toggleDesktopSpace: vi.fn(),
    goalsSpaceKeysRef: { current: null },
    gtdFrames: [], setShowRescheduleModal: vi.fn(), setRescheduleResults: vi.fn(), setRescheduleError: vi.fn(),
    setMobileActiveTab: vi.fn(), setMobileSettingsView: vi.fn(), setShowSettings: vi.fn(),
    changeDate: vi.fn(), setSelectedDate: vi.fn(),
    setViewMode: vi.fn(), canShowViewCycler: true, schedOnlyCycler: false, effectiveViewMode: 'multi', hiddenViews: [],
    ...overrides,
  };
  useKeyboardShortcuts(props);
  expect(effects).toHaveLength(1);
  effects[0].fn();
  expect(listeners).toHaveLength(1);
  return props;
}

beforeEach(() => { vi.stubGlobal('document', fakeDocument); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('useKeyboardShortcuts — the g key', () => {
  it('toggles the desktop space from the Calendar space', () => {
    const p = useMounted();
    const e = press('g');
    expect(p.toggleDesktopSpace).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('toggles back while IN the Goals space (D2), which the old modal guard blocked', () => {
    const p = useMounted({ showGoalsDashboard: true });
    press('g');
    expect(p.toggleDesktopSpace).toHaveBeenCalledTimes(1);
  });

  it('does nothing while Goals & Projects is off in Settings', () => {
    const p = useMounted({ goalsProjectsEnabled: false });
    press('g');
    expect(p.toggleDesktopSpace).not.toHaveBeenCalled();
    expect(p.setMobileActiveTab).not.toHaveBeenCalled();
    const m = useMounted({ goalsProjectsEnabled: false, isMobile: true });
    press('g');
    expect(m.setMobileActiveTab).not.toHaveBeenCalled();
  });

  it('opens the phone Goals tab rather than touching the desktop space', () => {
    const p = useMounted({ isMobile: true });
    press('g');
    expect(p.setMobileActiveTab).toHaveBeenCalledWith('goals');
    expect(p.toggleDesktopSpace).not.toHaveBeenCalled();
  });
});

describe('useKeyboardShortcuts — inside the Goals space', () => {
  it('lets the app-level shortcuts through: new task, settings, dark mode, help', () => {
    const p = useMounted({ showGoalsDashboard: true });
    press('n');
    expect(p.setShowAddTask).toHaveBeenCalledWith(true);
    press('s');
    expect(p.setShowSettings).toHaveBeenCalledWith(true);
    press('d');
    expect(p.setDarkMode).toHaveBeenCalled();
    press('?');
    expect(p.setShowShortcutHelp).toHaveBeenCalled();
    press('k', { metaKey: true });
    expect(p.setShowSpotlight).toHaveBeenCalled();
  });

  it('stands the calendar-only shortcuts down: dates, views, today, month, side panel', () => {
    const p = useMounted({ showGoalsDashboard: true });
    press('ArrowLeft');
    press('ArrowRight');
    expect(p.changeDate).not.toHaveBeenCalled();
    press('t');
    expect(p.goToToday).not.toHaveBeenCalled();
    press('m');
    expect(p.setShowMonthView).not.toHaveBeenCalled();
    press('2');
    press('c');
    expect(p.setViewMode).not.toHaveBeenCalled();
    press(',');
    press('.');
    expect(p.setTabletActiveTab).not.toHaveBeenCalled();
    press('f');
    expect(p.enterFocusModeRef.current).not.toHaveBeenCalled();
  });

  it('drives the space sidebar with the keys the calendar uses for dates and its panel', () => {
    const keys = { moveSelection: vi.fn(), setTab: vi.fn(), newItem: vi.fn(), focusFilter: vi.fn() };
    const p = useMounted({ showGoalsDashboard: true, goalsSpaceKeysRef: { current: keys } });
    // 'n' makes a goal or project there, not a scheduled task; '/' focuses the project filter
    press('n');
    expect(keys.newItem).toHaveBeenCalledTimes(1);
    expect(p.setShowAddTask).not.toHaveBeenCalled();
    press('/');
    expect(keys.focusFilter).toHaveBeenCalledTimes(1);
    expect(p.setShowMobileTagFilter).not.toHaveBeenCalled();
    expect(press('ArrowDown').preventDefault).toHaveBeenCalled();
    press('ArrowUp');
    expect(keys.moveSelection.mock.calls).toEqual([[1], [-1]]);
    press(',');
    press('.');
    expect(keys.setTab.mock.calls).toEqual([['goals'], ['projects']]);
    expect(p.changeDate).not.toHaveBeenCalled();
    expect(p.setTabletActiveTab).not.toHaveBeenCalled();
    // with nothing registered (space mounted but inactive) the keys simply stand down
    const q = useMounted({ showGoalsDashboard: true, goalsSpaceKeysRef: { current: null } });
    press('ArrowDown');
    press(',');
    press('n');
    expect(q.changeDate).not.toHaveBeenCalled();
    expect(q.setTabletActiveTab).not.toHaveBeenCalled();
    // …except 'n', which then falls through to the app-level new task
    expect(q.setShowAddTask).toHaveBeenCalledWith(true);
  });

  it('keeps the calendar shortcuts working in the Calendar space', () => {
    const p = useMounted({ showGoalsDashboard: false });
    press('ArrowLeft');
    expect(p.changeDate).toHaveBeenCalledWith(-1);
    press('t');
    expect(p.goToToday).toHaveBeenCalled();
    press('2');
    expect(p.setViewMode).toHaveBeenCalledWith('day');
  });

  it('still blocks everything behind a real modal', () => {
    const p = useMounted({ showGoalsDashboard: true, showSettings: true });
    press('g');
    press('n');
    expect(p.toggleDesktopSpace).not.toHaveBeenCalled();
    expect(p.setShowAddTask).not.toHaveBeenCalled();
  });
});

describe('isCalendarOnlyShortcut', () => {
  const ev = (key, extra = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, ...extra });
  it('names the calendar keys and nothing else', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Enter', 't', 'm', 'f', '/', ',', '.', 'c', 'C', '1', '2', '3', '4', '5', '6']) {
      expect(isCalendarOnlyShortcut(ev(key)), key).toBe(true);
    }
    for (const key of ['g', 'n', 'i', 's', 'd', 'b', 'v', 'o', 'u', 'h', 'r', 'e', '?', 'Escape']) {
      expect(isCalendarOnlyShortcut(ev(key)), key).toBe(false);
    }
  });
  it('never claims a modifier combo', () => {
    expect(isCalendarOnlyShortcut(ev('ArrowLeft', { metaKey: true }))).toBe(false);
    expect(isCalendarOnlyShortcut(ev('1', { ctrlKey: true }))).toBe(false);
  });
});

// The Project Planner takes its own keys (arrows move its selection, Enter
// opens the selected task). Its keys used to reach this handler too, so an
// arrow moved the project list behind it, or the calendar's date.
describe('useKeyboardShortcuts — an open Project Planner', () => {
  const spaceKeys = () => ({ setTab: vi.fn(), newItem: vi.fn(), focusFilter: vi.fn(), moveSelection: vi.fn(), openSelected: vi.fn(() => true) });

  // MUTATION: drop plannerProjectId from the modal guard and these fail.
  it('moves nothing behind it, in either space', () => {
    const keys = spaceKeys();
    useMounted({ showGoalsDashboard: true, goalsSpaceKeysRef: { current: keys }, plannerProjectId: 'p1' });
    press('ArrowDown'); press('Enter');
    expect(keys.moveSelection).not.toHaveBeenCalled();
    expect(keys.openSelected).not.toHaveBeenCalled();
    const p = useMounted({ plannerProjectId: 'p1' });
    press('ArrowRight');
    expect(p.changeDate).not.toHaveBeenCalled();
  });

  it('Enter on the project list opens the selected project\'s planner', () => {
    const keys = spaceKeys();
    useMounted({ showGoalsDashboard: true, goalsSpaceKeysRef: { current: keys } });
    const e = press('Enter');
    expect(keys.openSelected).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalled();
  });
});

describe('useKeyboardShortcuts — Cmd+Z', () => {
  it('undoes and redoes app state from the page', () => {
    const p = useMounted();
    const undo = press('z', { metaKey: true });
    expect(p.performUndo).toHaveBeenCalledTimes(1);
    expect(undo.preventDefault).toHaveBeenCalled();
    press('z', { metaKey: true, shiftKey: true });
    press('y', { ctrlKey: true });
    expect(p.performRedo).toHaveBeenCalledTimes(2);
  });

  it('leaves the keys to a text field, so they undo the typing', () => {
    const p = useMounted();
    for (const target of [
      { tagName: 'INPUT', type: 'text' },
      { tagName: 'INPUT' },
      { tagName: 'INPUT', type: 'search' },
      { tagName: 'TEXTAREA' },
      { tagName: 'DIV', isContentEditable: true },
    ]) {
      const undo = press('z', { metaKey: true, target });
      const redo = press('z', { metaKey: true, shiftKey: true, target });
      expect(undo.preventDefault).not.toHaveBeenCalled();
      expect(redo.preventDefault).not.toHaveBeenCalled();
    }
    expect(p.performUndo).not.toHaveBeenCalled();
    expect(p.performRedo).not.toHaveBeenCalled();
  });

  it('still undoes from a control that has no text to undo', () => {
    const p = useMounted();
    press('z', { ctrlKey: true, target: { tagName: 'INPUT', type: 'checkbox' } });
    press('z', { ctrlKey: true, target: { tagName: 'BUTTON' } });
    expect(p.performUndo).toHaveBeenCalledTimes(2);
  });
});

describe('isTextEntryTarget', () => {
  it('names the fields that type text and nothing else', () => {
    expect(isTextEntryTarget({ tagName: 'INPUT', type: 'email' })).toBe(true);
    expect(isTextEntryTarget({ tagName: 'INPUT', type: 'range' })).toBe(false);
    expect(isTextEntryTarget({ tagName: 'SELECT' })).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });
});

// The Tag manager was found only at the foot of the tag filter (a user wrote
// in, 2026-10-27); '#' opens it from anywhere. 't' stays "today".
describe('useKeyboardShortcuts — the # key', () => {
  it('opens the Tag manager and closes the tag filter it would sit under', () => {
    const p = useMounted({ setShowTagManager: vi.fn() });
    const e = press('#');
    expect(p.setShowTagManager).toHaveBeenCalledWith(true);
    expect(p.setShowMobileTagFilter).toHaveBeenCalledWith(false);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('works in the Goals space too: tags are not a calendar thing', () => {
    expect(isCalendarOnlyShortcut({ key: '#', ctrlKey: false, metaKey: false, altKey: false })).toBe(false);
    const p = useMounted({ setShowTagManager: vi.fn(), showGoalsDashboard: true });
    press('#');
    expect(p.setShowTagManager).toHaveBeenCalledWith(true);
  });

  it('takes Option on a Mac layout that types # with it, never Ctrl or Cmd', () => {
    const p = useMounted({ setShowTagManager: vi.fn() });
    press('#', { altKey: true });
    expect(p.setShowTagManager).toHaveBeenCalledTimes(1);
    press('#', { ctrlKey: true });
    press('#', { metaKey: true });
    expect(p.setShowTagManager).toHaveBeenCalledTimes(1);
  });

  it('leaves a # typed in a field, or behind a modal, alone; t is still today', () => {
    const p = useMounted({ setShowTagManager: vi.fn() });
    press('#', { target: { tagName: 'INPUT' } });
    expect(p.setShowTagManager).not.toHaveBeenCalled();
    press('t');
    expect(p.goToToday).toHaveBeenCalledTimes(1);
    expect(p.setShowTagManager).not.toHaveBeenCalled();
    const behind = useMounted({ setShowTagManager: vi.fn(), showSettings: true });
    press('#');
    expect(behind.setShowTagManager).not.toHaveBeenCalled();
  });
});

// #2407: Cmd/Ctrl+B shows or hides the desktop side panel.
describe('useKeyboardShortcuts — the side panel', () => {
  const useMountedPanel = (overrides = {}) => useMounted({ sidePanelCollapsible: true, toggleSidePanel: vi.fn(), ...overrides });

  it('toggles on Ctrl+B and on Cmd+B, and takes the key', () => {
    const p = useMountedPanel();
    const ctrl = press('b', { ctrlKey: true });
    const cmd = press('b', { metaKey: true });
    expect(p.toggleSidePanel).toHaveBeenCalledTimes(2);
    expect(ctrl.preventDefault).toHaveBeenCalled();
    expect(cmd.preventDefault).toHaveBeenCalled();
    // The plain key is still the backup menu, and only that.
    expect(p.setShowBackupMenu).not.toHaveBeenCalled();
  });

  it('leaves plain b to the backup menu', () => {
    const p = useMountedPanel();
    press('b');
    expect(p.toggleSidePanel).not.toHaveBeenCalled();
    expect(p.setShowBackupMenu).toHaveBeenCalledTimes(1);
  });

  it('works in the Goals space too', () => {
    const p = useMountedPanel({ showGoalsDashboard: true });
    press('b', { ctrlKey: true });
    expect(p.toggleSidePanel).toHaveBeenCalledTimes(1);
  });

  it('works from a text field, where the cursor usually is', () => {
    const p = useMountedPanel();
    press('b', { ctrlKey: true, target: { tagName: 'INPUT' } });
    press('b', { metaKey: true, target: { tagName: 'TEXTAREA' } });
    expect(p.toggleSidePanel).toHaveBeenCalledTimes(2);
  });

  it('leaves the keys to rich text, where they mean bold', () => {
    const p = useMountedPanel();
    const e = press('b', { ctrlKey: true, target: { tagName: 'DIV', isContentEditable: true } });
    expect(p.toggleSidePanel).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it.each(['showSettings', 'showAddTask', 'showFocusMode', 'showSpotlight', 'plannerProjectId'])('does nothing behind a modal (%s)', (modal) => {
    const p = useMountedPanel({ [modal]: true });
    const e = press('b', { ctrlKey: true });
    expect(p.toggleSidePanel).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('is not there on a tablet or a phone, and does not take the key from the browser', () => {
    const p = useMountedPanel({ sidePanelCollapsible: false });
    const e = press('b', { ctrlKey: true });
    expect(p.toggleSidePanel).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('is Cmd or Ctrl with B and nothing else held', () => {
    const key = (extra) => ({ key: 'b', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra });
    expect(isSidePanelToggleKey(key({ ctrlKey: true }))).toBe(true);
    expect(isSidePanelToggleKey(key({ metaKey: true }))).toBe(true);
    expect(isSidePanelToggleKey(key({ ctrlKey: true, key: 'B' }))).toBe(true);
    expect(isSidePanelToggleKey(key({}))).toBe(false);
    expect(isSidePanelToggleKey(key({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isSidePanelToggleKey(key({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(isSidePanelToggleKey(key({ ctrlKey: true, key: 'k' }))).toBe(false);
    expect(isSidePanelToggleKey({ ctrlKey: true })).toBe(false);
  });

  it('still lets a modal block the other shortcuts, and a text field block them too', () => {
    const p = useMountedPanel({ showSettings: true });
    press('g');
    expect(p.toggleDesktopSpace).not.toHaveBeenCalled();
    const q = useMountedPanel();
    press('g', { target: { tagName: 'INPUT' } });
    expect(q.toggleDesktopSpace).not.toHaveBeenCalled();
  });
});
