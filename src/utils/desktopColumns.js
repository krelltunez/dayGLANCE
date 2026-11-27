// How many day columns the desktop calendar gets, and where the side panel
// sits, from the room the calendar actually has rather than the window's
// width. The side panel (GLANCE / Inbox) is 340px; hiding it gives that room
// back, so a laptop window with the panel hidden reaches the same layout a
// 1600px display reaches with the panel open.
//
// The thresholds are the old window breakpoints (1600 for three columns, 1200
// for two) less the panel's width, so a window with the panel open lays out
// exactly as it did when the breakpoints read the window.

import { DESKTOP_VIEW_MODES, NARROW_DESKTOP_VIEW_MODES, homeView } from '../constants/views.js';

export const SIDE_PANEL_WIDTH = 340;
export const THREE_COLUMN_MIN = 1600 - SIDE_PANEL_WIDTH; // 1260
export const TWO_COLUMN_MIN = 1200 - SIDE_PANEL_WIDTH; //  860

// The views the narrow layout cannot show at all: DAY and WEEK need the
// three-column width. On a window wide enough for them only while the panel
// is hidden, opening the panel lays it over the calendar instead of beside
// it, so the view on screen stays where it is.
//
// MONTH is not one of them: it has a whole layout beside the panel (the full
// grid, the selected day in a bottom sheet), which is what a laptop showed
// before. Floating the panel would cover the grid's first columns to keep only
// the docked day panel, so MONTH docks the panel and takes the sheet; hiding
// the panel brings the docked day panel back (MonthView hands an open sheet's
// day over to it).
export const SIDE_PANEL_OVERLAY_VIEWS = Object.freeze(['day', 'week']);

export function columnsForWidth(width) {
  if (width >= THREE_COLUMN_MIN) return 3;
  if (width >= TWO_COLUMN_MIN) return 2;
  return 1;
}

/**
 * The column counts a window allows: `open` with the panel beside the
 * calendar, `full` with the calendar across the whole window.
 */
export function windowColumns(innerWidth) {
  return { open: columnsForWidth(innerWidth - SIDE_PANEL_WIDTH), full: columnsForWidth(innerWidth) };
}

/**
 * The calendar's column count and the panel's placement.
 *
 *   collapsed  the panel is hidden; the calendar has the whole window.
 *   docked     the panel sits beside the calendar, which has what is left.
 *   overlay    the panel floats over the calendar's left edge; the calendar
 *              keeps the whole window's layout. Only when the chosen view is
 *              one the narrower layout would replace, and only where the whole
 *              window reaches three columns but the remainder does not.
 *
 * @param {{ open: number, full: number }} columns  from windowColumns
 * @param {boolean} panelCollapsed
 * @param {string|null} viewMode  the chosen desktop view, or null when it is
 *   turned off on this device (the stand-in view never needs the overlay)
 */
export function desktopPanelLayout({ open, full }, panelCollapsed, viewMode) {
  if (panelCollapsed) return { columns: full, panelMode: 'collapsed' };
  if (open < 3 && full === 3 && SIDE_PANEL_OVERLAY_VIEWS.includes(viewMode)) {
    return { columns: 3, panelMode: 'overlay' };
  }
  return { columns: open, panelMode: 'docked' };
}

/**
 * Everything App derives from the window, the side panel and the chosen view:
 * the calendar's layout (columns, the panel's placement, the view on screen)
 * and the views the switchers offer, which are not the same thing.
 *
 *   canShowViewCycler  the calendar is laid out wide right now (MONTH docks
 *                      its day panel, JOBO opens its notes sidebar, a chosen
 *                      DAY / WEEK is honoured)
 *   allDesktopViews    the cycler, the number keys, the shortcut sheet and the
 *                      settings offer every view: wherever the whole window
 *                      reaches three columns. On a laptop with the panel
 *                      docked the layout is narrow, but picking DAY or WEEK
 *                      floats the panel and the view fits, so they stay on
 *                      offer instead of vanishing until the panel is closed.
 *   schedOnlyCycler    the narrow cycler (narrow desktop, landscape tablet)
 *   effectiveViewMode  the view on screen: the chosen one where the layout
 *                      allows it and it is on, else the layout's first view on
 *
 * @param {object} o
 * @param {{ open: number, full: number }} o.windowCols  from windowColumns
 * @param {boolean} o.panelCollapsed
 * @param {string} o.viewMode             the stored desktop view
 * @param {string[]} o.hiddenDesktopViews views turned off on this device
 * @param {boolean} o.isTablet
 * @param {boolean} o.isMobile
 * @param {boolean} o.isLandscape
 */
export function desktopViewState({ windowCols, panelCollapsed, viewMode, hiddenDesktopViews = [], isTablet, isMobile, isLandscape }) {
  const desktop = !isTablet && !isMobile;
  const viewOn = !hiddenDesktopViews.includes(viewMode);
  const { columns, panelMode } = desktopPanelLayout(windowCols, panelCollapsed, viewOn ? viewMode : null);
  // Tablet uses orientation (its panel is always present), the phone one column.
  const visibleDays = isTablet ? (isLandscape ? 2 : 1) : isMobile ? 1 : columns;
  const canShowViewCycler = desktop && columns === 3;
  const allDesktopViews = desktop && windowCols.full === 3;
  // Narrow desktop (1-2 columns) and tablet landscape: the cycler shows the
  // narrow views. Elsewhere it is hidden and the app behaves as MULTI.
  const schedOnlyCycler = (desktop && columns < 3) || (!!isTablet && !!isLandscape);
  const effectiveViewMode = canShowViewCycler ? (viewOn ? viewMode : homeView(DESKTOP_VIEW_MODES, hiddenDesktopViews))
    : schedOnlyCycler ? (NARROW_DESKTOP_VIEW_MODES.includes(viewMode) && viewOn ? viewMode : homeView(NARROW_DESKTOP_VIEW_MODES, hiddenDesktopViews))
    : 'multi';
  return {
    columns, sidePanelMode: panelMode, visibleDays,
    canShowViewCycler, allDesktopViews, schedOnlyCycler, effectiveViewMode,
  };
}
