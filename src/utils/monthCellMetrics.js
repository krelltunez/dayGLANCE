// Resolves the month cell's proportional rules (constants/monthView.js) for
// one cell size. Pure; the cell and the grid both read it so they agree on
// where the gutter is and how big the marks are.

import { MONTH_CELL_LAYOUT } from '../constants/monthView.js';

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const scale = (rule, base) => clamp(Math.round(base * rule.ratio), rule.min, rule.max);

/**
 * @param {number} width   cell width, px
 * @param {number} height  cell height, px
 * @param {{ gutter?: 'auto' | number }} [opts]  'auto' follows the width rule;
 *   a number forces that gutter width (0 for none)
 */
export function monthCellMetrics(width, height, { gutter = 'auto' } = {}) {
  const C = MONTH_CELL_LAYOUT.cell;
  const headerHeight = scale(C.header, height);
  const inset = scale(C.inset, width);
  const padY = scale(C.padY, height);
  const gutterWidth = gutter === 'auto' ? (width >= C.gutterMinWidth ? scale(C.gutter, width) : 0) : Math.max(0, gutter);
  const hasGutter = gutterWidth > 0;
  const markerSize = hasGutter ? scale(C.marker, gutterWidth) : scale(C.headerMarker, headerHeight);
  return {
    headerHeight,
    dateSize: headerHeight - 2,
    dateFont: clamp(Math.round(headerHeight * 0.6), 11, 15),
    inset,
    padY,
    gutterWidth,
    hasGutter,
    markerSize,
    markerGap: Math.max(2, Math.round(markerSize / 3)),
    pointSize: scale(C.point, width),
    radius: clamp(width * C.radius.ratio, C.radius.min, C.radius.max),
    capWidth: clamp(width * C.cap.ratio, C.cap.min, C.cap.max),
    timelineTop: headerHeight + padY,
    timelineHeight: Math.max(0, height - headerHeight - 2 * padY),
    timelineLeft: inset,
    timelineWidth: Math.max(0, width - gutterWidth - 2 * inset),
  };
}
