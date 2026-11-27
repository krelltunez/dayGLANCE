import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  SIDE_PANEL_WIDTH, THREE_COLUMN_MIN, TWO_COLUMN_MIN,
  columnsForWidth, windowColumns, desktopPanelLayout, desktopViewState,
} from './desktopColumns.js';
import { DESKTOP_VIEW_MODES, cyclerStates, nextState } from '../constants/views.js';

describe('columnsForWidth', () => {
  it('keeps the old window breakpoints once the open panel is taken off', () => {
    expect(THREE_COLUMN_MIN).toBe(1600 - SIDE_PANEL_WIDTH);
    expect(TWO_COLUMN_MIN).toBe(1200 - SIDE_PANEL_WIDTH);
    expect(columnsForWidth(THREE_COLUMN_MIN)).toBe(3);
    expect(columnsForWidth(THREE_COLUMN_MIN - 1)).toBe(2);
    expect(columnsForWidth(TWO_COLUMN_MIN)).toBe(2);
    expect(columnsForWidth(TWO_COLUMN_MIN - 1)).toBe(1);
  });
});

describe('windowColumns', () => {
  // With the panel open, every window lays out as it did when the
  // breakpoints read the window (1600 / 1200).
  it('matches the old breakpoints with the panel open', () => {
    for (const [w, old] of [[1920, 3], [1600, 3], [1599, 2], [1200, 2], [1199, 1], [800, 1]]) {
      expect(windowColumns(w).open).toBe(old);
    }
  });

  it('gives common laptop windows three columns with the panel hidden', () => {
    // 1280 (1920 at 150%), 1366, 1440, 1470 (MacBook Air), 1512 (14" MacBook Pro), 1536 (1920 at 125%)
    for (const w of [1280, 1366, 1440, 1470, 1512, 1536]) {
      expect(windowColumns(w)).toEqual({ open: 2, full: 3 });
    }
  });
});

describe('desktopPanelLayout', () => {
  const laptop = windowColumns(1512);
  const wide = windowColumns(1920);
  const narrow = windowColumns(1100);

  it('hidden, the calendar has the whole window', () => {
    expect(desktopPanelLayout(laptop, true, 'multi')).toEqual({ columns: 3, panelMode: 'collapsed' });
    expect(desktopPanelLayout(narrow, true, 'week')).toEqual({ columns: 2, panelMode: 'collapsed' });
  });

  it('open on a wide display, it docks as before', () => {
    for (const view of ['multi', 'day', 'week', 'month', 'sched', 'jobo']) {
      expect(desktopPanelLayout(wide, false, view)).toEqual({ columns: 3, panelMode: 'docked' });
    }
  });

  // MUTATION: dock the panel for these and opening it on a laptop drops the
  // user out of DAY / WEEK.
  it('open on a laptop, it floats over a view only the wide layout shows', () => {
    for (const view of ['day', 'week']) {
      expect(desktopPanelLayout(laptop, false, view)).toEqual({ columns: 3, panelMode: 'overlay' });
    }
  });

  // MUTATION: float the panel over MONTH and, with the panel open, a laptop
  // loses the grid's first columns where it used to show the whole month.
  it('open on a laptop, it docks beside a view the narrow layout shows too', () => {
    for (const view of ['multi', 'month', 'sched', 'jobo', null]) {
      expect(desktopPanelLayout(laptop, false, view)).toEqual({ columns: 2, panelMode: 'docked' });
    }
  });

  it('never floats where the whole window does not reach three columns', () => {
    expect(desktopPanelLayout(narrow, false, 'week')).toEqual({ columns: 1, panelMode: 'docked' });
  });
});

describe('desktopViewState: what a laptop offers with the panel open', () => {
  // A 14" MacBook Pro window: three columns only with the panel hidden.
  const laptop = windowColumns(1512);
  const at = (viewMode, panelCollapsed = false, hiddenDesktopViews = [], cols = laptop) => desktopViewState({
    windowCols: cols, panelCollapsed, viewMode, hiddenDesktopViews, isTablet: false, isMobile: false, isLandscape: true,
  });

  // The cycler as the user drives it: ViewCycler and the C key both step
  // cyclerStates(allDesktopViews, ...) from the view on screen.
  const walk = (start, panelCollapsed = false, hidden = []) => {
    const seen = [];
    let viewMode = start;
    for (let i = 0; i < DESKTOP_VIEW_MODES.length; i++) {
      const state = at(viewMode, panelCollapsed, hidden);
      seen.push({ view: state.effectiveViewMode, panel: state.sidePanelMode, columns: state.columns });
      viewMode = nextState(cyclerStates(state.allDesktopViews, false, hidden), state.effectiveViewMode);
    }
    return seen;
  };

  // MUTATION: offer cyclerStates(canShowViewCycler) again and, from MONTH with
  // the panel open, DAY and WEEK never come round: the bug this fixes.
  it('cycling from MONTH with the panel open reaches every view, the panel floating only over DAY and WEEK', () => {
    expect(walk('month')).toEqual([
      { view: 'month', panel: 'docked', columns: 2 },
      { view: 'sched', panel: 'docked', columns: 2 },
      { view: 'jobo', panel: 'docked', columns: 2 },
      { view: 'multi', panel: 'docked', columns: 2 },
      { view: 'day', panel: 'overlay', columns: 3 },
      { view: 'week', panel: 'overlay', columns: 3 },
    ]);
  });

  it('cycling from JOBO with the panel open reaches DAY and WEEK too', () => {
    const views = walk('jobo').map((s) => s.view);
    expect(views).toEqual(['jobo', 'multi', 'day', 'week', 'month', 'sched']);
  });

  it('with the panel hidden, every view is wide and nothing floats', () => {
    for (const step of walk('multi', true)) expect(step).toMatchObject({ panel: 'collapsed', columns: 3 });
  });

  it('the number keys reach DAY and WEEK from a docked view', () => {
    const state = at('month');
    expect(state.canShowViewCycler).toBe(false);
    expect(state.allDesktopViews).toBe(true);
    expect(cyclerStates(state.allDesktopViews, false, [])).toEqual(expect.arrayContaining(['day', 'week']));
  });

  it('a view turned off on this device stays off, and its stand-in never floats the panel', () => {
    expect(walk('month', false, ['week']).map((s) => s.view)).not.toContain('week');
    expect(at('week', false, ['week'])).toMatchObject({ sidePanelMode: 'docked', effectiveViewMode: 'multi' });
  });

  it('a window too narrow even with the panel hidden offers the narrow views only', () => {
    const state = at('week', false, [], windowColumns(1100));
    expect(state).toMatchObject({ allDesktopViews: false, canShowViewCycler: false, schedOnlyCycler: true, effectiveViewMode: 'multi' });
  });

  it('a wide display is as before: everything docked and wide', () => {
    for (const view of DESKTOP_VIEW_MODES) {
      expect(at(view, false, [], windowColumns(1920))).toMatchObject({ sidePanelMode: 'docked', columns: 3, canShowViewCycler: true, allDesktopViews: true, effectiveViewMode: view });
    }
  });

  it('tablets and phones keep their own rules', () => {
    const base = { windowCols: windowColumns(1366), panelCollapsed: false, viewMode: 'week', hiddenDesktopViews: [] };
    expect(desktopViewState({ ...base, isTablet: true, isMobile: false, isLandscape: true }))
      .toMatchObject({ visibleDays: 2, canShowViewCycler: false, allDesktopViews: false, schedOnlyCycler: true });
    expect(desktopViewState({ ...base, isTablet: false, isMobile: true, isLandscape: false }))
      .toMatchObject({ visibleDays: 1, allDesktopViews: false, schedOnlyCycler: false, effectiveViewMode: 'multi' });
  });
});

describe('App wiring', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');

  it('derives the layout and the views on offer in one place, and the header from the window', () => {
    expect(app).toMatch(/desktopViewState\(\{\s*windowCols, panelCollapsed: sidePanelCollapsed, viewMode, hiddenDesktopViews: hiddenViews\.desktop,/);
    expect(app).toContain('const headerDays = windowCols.open;');
  });

  // MUTATION: drop allDesktopViews from any of these and that switcher hides
  // DAY and WEEK on a laptop with the panel docked.
  it('every switcher offers views by allDesktopViews, not by the current layout', () => {
    const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
    expect(read('../components/ViewCycler.jsx')).toContain('cyclerStates(allDesktopViews, !!showDayDial');
    expect(read('../components/ShortcutHelpModal.jsx')).toContain('cyclerStates(allDesktopViews, false');
    expect(read('../hooks/useKeyboardShortcuts.js').match(/cyclerStates\(allDesktopViews, showDayDial, hiddenViews\)/g)).toHaveLength(2);
    expect(read('../components/settings/topics/useAppearanceTopic.jsx').match(/allDesktopViews \? DESKTOP_VIEW_MODES/g)).toHaveLength(2);
    expect(app).toContain('setViewMode, canShowViewCycler, allDesktopViews, schedOnlyCycler, effectiveViewMode, hiddenViews: hiddenViews.desktop,');
  });
});
