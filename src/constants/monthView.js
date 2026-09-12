// Month view day-cell geometry — plain data, deliberately free of component
// code. The layout engine (utils/monthCellLayout.js) reads these, and the
// native Android home-screen widget will draw the same cells from the same
// numbers, so a change here is a change on every surface at once.
//
// A day cell is a miniature vertical timeline: vertical position encodes
// time of day within a FIXED hour window, identical for every cell in the
// grid. The window is never fitted to one day's contents — if it were, two
// cells side by side would read the same pixel as different hours and the
// grid would stop being comparable across days.

export const MONTH_CELL_LAYOUT = Object.freeze({
  /** The hours a cell maps to its full height. Items outside clamp to the edges. */
  window: Object.freeze({ startHour: 7, endHour: 21 }),

  /**
   * A band never draws thinner than this, so a 15-minute item stays a visible
   * mark. At a typical phone cell (~90px for a 14-hour window, ~6px per hour)
   * a quarter hour is 1.6px; 4px reads as a line without stealing the room
   * an hour-long band needs to read as a band.
   */
  minBandHeight: 4,

  /**
   * Lanes stop splitting the cell at three. A phone month grid gives each of
   * the seven columns roughly 48px of usable width; three lanes with 1px gaps
   * are still ~15px each and read as distinct bands, whereas four drop to
   * ~11px and start reading as a stripe pattern. Three also matches the day
   * grid's own drop rule (useTaskDerived's wouldExceedMaxColumns), so the
   * month never shows more overlap than the day view lets a user create.
   * Anything past the cap is reported as overflow instead of drawn thinner.
   */
  maxLanes: 3,

  /** Horizontal gap between side-by-side lanes, in px. */
  laneGap: 1,

  /**
   * Vertical gap kept between consecutive bands that share horizontal space,
   * in px. Back-to-back items (and items pushed together by the minimum
   * height) stay two marks instead of merging into one longer band.
   */
  bandGap: 1,

  /**
   * The strip above the timeline that holds the date number (and, in a cell
   * with no gutter, the all-day markers). The timeline gets the rest of the
   * cell's height, so the hour window maps onto cellHeight - headerHeight.
   */
  headerHeight: 18,

  /** Point-marker half-diagonal, in px: the diamond spans twice this. */
  pointSize: 3,

  /** All-day marker edge and the gap between stacked markers, in px. */
  gutterMarkerSize: 6,
  gutterMarkerGap: 2,

  /**
   * Grid rules. A cell gets the all-day gutter once it is at least
   * gutterMinCellWidth wide: with the 14px gutter that leaves 82px of usable
   * width, so three lanes are still ~26px each. A 390px phone gives 53px
   * cells (no gutter); a 768px tablet gives ~106px (gutter).
   */
  gutterWidth: 14,
  gutterMinCellWidth: 96,

  /**
   * The timeline encoding assumes cells taller than they are wide, so on a
   * wide display cells stop stretching at maxCellAspect × their height and
   * the grid centres, leaving the spare width free (the day sheet can dock
   * there on desktop). Rows never shrink below minCellHeight; a six-row
   * month on a short viewport scrolls instead.
   */
  maxCellAspect: 1.25,
  minCellHeight: 64,
});

export const MONTH_CELL_HOUR_WINDOW = MONTH_CELL_LAYOUT.window;
export const MONTH_CELL_MIN_BAND_HEIGHT = MONTH_CELL_LAYOUT.minBandHeight;
export const MONTH_CELL_MAX_LANES = MONTH_CELL_LAYOUT.maxLanes;
export const MONTH_CELL_LANE_GAP = MONTH_CELL_LAYOUT.laneGap;
export const MONTH_CELL_BAND_GAP = MONTH_CELL_LAYOUT.bandGap;
export const MONTH_CELL_HEADER_HEIGHT = MONTH_CELL_LAYOUT.headerHeight;
