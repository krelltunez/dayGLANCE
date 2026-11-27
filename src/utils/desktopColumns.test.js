import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  SIDE_PANEL_WIDTH, THREE_COLUMN_MIN, TWO_COLUMN_MIN,
  columnsForWidth, windowColumns, desktopPanelLayout,
} from './desktopColumns.js';

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
  // user out of DAY / WEEK, and MONTH's day panel back into a sheet.
  it('open on a laptop, it floats over a view only the wide layout shows', () => {
    for (const view of ['day', 'week', 'month']) {
      expect(desktopPanelLayout(laptop, false, view)).toEqual({ columns: 3, panelMode: 'overlay' });
    }
  });

  it('open on a laptop, it docks beside a view the narrow layout shows too', () => {
    for (const view of ['multi', 'sched', 'jobo', null]) {
      expect(desktopPanelLayout(laptop, false, view)).toEqual({ columns: 2, panelMode: 'docked' });
    }
  });

  it('never floats where the whole window does not reach three columns', () => {
    expect(desktopPanelLayout(narrow, false, 'week')).toEqual({ columns: 1, panelMode: 'docked' });
  });
});

describe('App wiring', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');

  it('derives the columns from the panel and the chosen view, and the header from the window', () => {
    expect(app).toMatch(/desktopPanelLayout\(\s*windowCols, sidePanelCollapsed, hiddenViews\.desktop\.includes\(viewMode\) \? null : viewMode,\s*\)/);
    expect(app).toContain('const headerDays = windowCols.open;');
    expect(app).toContain('const canShowViewCycler = !isTablet && !isMobile && _visibleDays === 3;');
  });
});
