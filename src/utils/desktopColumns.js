// How many day columns the desktop calendar gets, and where the side panel
// sits, from the room the calendar actually has rather than the window's
// width. The side panel (GLANCE / Inbox) is 340px; hiding it gives that room
// back, so a laptop window with the panel hidden reaches the same layout a
// 1600px display reaches with the panel open.
//
// The thresholds are the old window breakpoints (1600 for three columns, 1200
// for two) less the panel's width, so a window with the panel open lays out
// exactly as it did when the breakpoints read the window.

export const SIDE_PANEL_WIDTH = 340;
export const THREE_COLUMN_MIN = 1600 - SIDE_PANEL_WIDTH; // 1260
export const TWO_COLUMN_MIN = 1200 - SIDE_PANEL_WIDTH; //  860

// The views the narrow layout cannot show as chosen: DAY and WEEK need the
// three-column width, and MONTH's selected day docks beside the grid there
// (a bottom sheet otherwise). On a window wide enough for them only while the
// panel is hidden, opening the panel lays it over the calendar instead of
// beside it, so the view on screen stays where it is.
export const SIDE_PANEL_OVERLAY_VIEWS = Object.freeze(['day', 'week', 'month']);

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
