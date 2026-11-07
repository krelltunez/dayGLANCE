// Where a time of day sits on the timeline grid, read from the grid's own hour
// rows rather than from a fixed height, so sub-pixel borders on high-DPI
// screens and the timeline zoom never drift (hooks/useDragDrop.js,
// minutesToPosition).
//
// 24:00 IS THE BOTTOM OF THE LAST ROW. A frame can end at 24:00 (a resize
// clamps there), and a day's last minute ends there too. The row index for
// 24:00 is 24, which has no row: before #2306 that fell through to the
// fixed-height fallback (161px an hour), which is right only at the default
// row height. With the timeline zoomed it put the end hundreds of pixels
// below the grid, and the block was drawn far too long. Anything at or past
// the end of the rows is the bottom of the last row: a day has no time after
// it.

/** Pixels per hour when there is no grid to read (160px of row plus its 1px border). */
export const FALLBACK_HOUR_PX = 161;

/**
 * @param {number} minutes  minutes from the start of the day (0..1440)
 * @param {ArrayLike<{offsetTop: number, offsetHeight: number}>|null} children
 *   the grid's children; the first 24 are its hour rows, anything after is
 *   an overlay and is not read
 * @returns {number} pixels from the top of the grid
 */
export function timelinePosition(minutes, children) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const numRows = children ? Math.min(24, children.length) : 0;
  if (numRows > 0) {
    if (hours >= numRows) {
      const last = children[numRows - 1];
      return last.offsetTop + last.offsetHeight;
    }
    const rowTop = children[hours].offsetTop;
    if (mins === 0) return rowTop;
    const rowHeight = hours + 1 < numRows
      ? children[hours + 1].offsetTop - rowTop
      : children[hours].offsetHeight;
    return rowTop + mins * rowHeight / 60;
  }
  // No grid to read (not mounted yet).
  return hours * FALLBACK_HOUR_PX + mins * (FALLBACK_HOUR_PX - 1) / 60;
}
