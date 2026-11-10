// How a timeline card shows a long title (#2368). Pure, so the fit is tested
// without a layout engine, like the subtask fit beside it (cardSubtasks.js).
//
// A card is one line of title by default, cut with an ellipsis. A tall card
// has room for more, so its title wraps onto as many lines as fit above the
// rows that always follow it (tags/project, the time). A card that shows its
// subtasks keeps the one line: the room below the title is theirs, and a
// title that grew would push them out of sight. So does a card too narrow to
// wrap words whole (side-by-side overlapping cards): there, a wrapped title
// breaks mid-word down a column of fragments, and the ellipsis reads better.
//
// Wherever a pointer can hover, the full title is also the card's tooltip,
// with the card's double-click hint, where it has one, on a second line.

import { stripWikilinks } from './taskUtils.js';

// One line of title: text-sm with leading-tight on desktop (14px × 1.25), the
// plain text-sm line (1.25rem) on the phone.
export const DESKTOP_TITLE_LINE_PX = 17.5;
export const MOBILE_TITLE_LINE_PX = 20;
// The card's own vertical padding (py-1).
const CARD_PADDING_PX = 8;
// The narrowest card (layout px, as at 100% zoom) whose title may wrap: about
// 100px of text beside the checkbox and icons (desktop's also has a star and
// the overflow menu's room).
export const DESKTOP_MIN_WRAP_WIDTH_PX = 180;
export const MOBILE_MIN_WRAP_WIDTH_PX = 140;

/** Whether the card would list `task`'s subtasks (the setting is on and it has some with a title). */
export const cardShowsSubtasks = (task, showCardSubtasks) => showCardSubtasks !== false
  && Array.isArray(task?.subtasks)
  && task.subtasks.some((st) => st && typeof st.title === 'string' && st.title.trim());

/**
 * How many lines the title may take: 1 unless at least two fit.
 *
 * @param {{ height: number, linePx: number, belowPx?: number, showsSubtasks?: boolean,
 *   width?: number, minWidth?: number, maxLines?: number }} a
 *   `belowPx` is what the rows under the title take; `width` the card's
 *   (unknown: no limit), which must reach `minWidth`; `maxLines` caps the result
 */
export function cardTitleLines({ height, linePx, belowPx = 0, showsSubtasks = false, width, minWidth = 0, maxLines = Infinity }) {
  if (showsSubtasks) return 1;
  if (width !== undefined && !(width >= minWidth)) return 1;
  const fit = Math.floor((Number(height) - CARD_PADDING_PX - belowPx) / linePx);
  if (!(fit >= 2)) return 1;
  return Math.max(1, Math.min(fit, maxLines));
}

/** The desktop card (TimelineTaskCardContent): the tags/project row, and the time row from 55px on a wide card. */
export const desktopCardTitleLines = ({ height, width, hasMetaRow, hasTimeRow, showsSubtasks, maxLines }) => cardTitleLines({
  height,
  linePx: DESKTOP_TITLE_LINE_PX,
  belowPx: (hasMetaRow ? 18 : 0) + (hasTimeRow ? 18 : 0),
  showsSubtasks,
  width,
  minWidth: DESKTOP_MIN_WRAP_WIDTH_PX,
  maxLines,
});

/** The phone's card (MobileTimeGrid): the project row (which carries the time from 55px), or the time row alone from 55px. */
export const mobileCardTitleLines = ({ height, width, hasProjectRow, showsSubtasks }) => cardTitleLines({
  height,
  linePx: MOBILE_TITLE_LINE_PX,
  belowPx: hasProjectRow ? 20 : (height >= 55 ? 18 : 0),
  showsSubtasks,
  width,
  minWidth: MOBILE_MIN_WRAP_WIDTH_PX,
});

/**
 * The title element's class and style for `lines`: the one-line ellipsis, or
 * a clamp at that many lines that breaks a long word rather than overflow.
 */
export function cardTitleClamp(lines) {
  if (!(lines > 1)) return { className: 'truncate', style: undefined };
  return {
    className: '',
    style: {
      display: '-webkit-box',
      WebkitBoxOrient: 'vertical',
      WebkitLineClamp: lines,
      overflow: 'hidden',
      overflowWrap: 'anywhere',
    },
  };
}

/** The full title as a tooltip, with `hint` (e.g. "Double-click to rename") on a second line when given. */
export function cardTitleTooltip(title, hint = null) {
  const full = stripWikilinks(String(title ?? '')).trim();
  return [full, hint].filter(Boolean).join('\n') || undefined;
}
