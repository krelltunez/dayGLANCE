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
   * Cell proportions. Everything the renderer draws scales with the cell it
   * is in (a 53px phone cell and a 200px desktop cell must both read), so
   * each rule is a share of the cell's width or height, clamped to a
   * pixel range. utils/monthCellMetrics.js resolves them for a given size.
   *
   *   maxAspect      cells never grow wider than they are tall: the timeline
   *                  encoding assumes a portrait cell, so on a wide display
   *                  the grid stops stretching and centres instead
   *   maxWidth       and never past this, since a 200px cell already gives
   *                  three lanes ~55px each and extra width adds nothing
   *   minHeight      rows never shrink below this; a six-row month on a
   *                  short viewport scrolls instead
   *   gutterMinWidth the cell width at which the all-day gutter appears
   *                  (below it the marks sit beside the date number)
   */
  cell: Object.freeze({
    maxAspect: 1.0,
    maxWidth: 200,
    minHeight: 64,
    gutterMinWidth: 96,
    header:       Object.freeze({ of: 'height', ratio: 0.14, min: 18, max: 26 }),
    inset:        Object.freeze({ of: 'width', ratio: 0.045, min: 3, max: 8 }),
    padY:         Object.freeze({ of: 'height', ratio: 0.02, min: 2, max: 5 }),
    gutter:       Object.freeze({ of: 'width', ratio: 0.13, min: 12, max: 26 }),
    marker:       Object.freeze({ of: 'gutter', ratio: 0.55, min: 6, max: 13 }),
    headerMarker: Object.freeze({ of: 'header', ratio: 0.4, min: 6, max: 10 }),
    point:        Object.freeze({ of: 'width', ratio: 0.03, min: 3, max: 5 }),
    radius:       Object.freeze({ of: 'width', ratio: 0.015, min: 2, max: 3.5 }),
    cap:          Object.freeze({ of: 'width', ratio: 0.018, min: 2, max: 3.5 }),
  }),
});

export const MONTH_CELL_HOUR_WINDOW = MONTH_CELL_LAYOUT.window;
export const MONTH_CELL_MIN_BAND_HEIGHT = MONTH_CELL_LAYOUT.minBandHeight;
export const MONTH_CELL_MAX_LANES = MONTH_CELL_LAYOUT.maxLanes;
export const MONTH_CELL_LANE_GAP = MONTH_CELL_LAYOUT.laneGap;
export const MONTH_CELL_BAND_GAP = MONTH_CELL_LAYOUT.bandGap;
