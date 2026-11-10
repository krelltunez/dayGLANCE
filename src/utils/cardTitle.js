// How a timeline card shows a long title (#2368). Pure, so the fit is tested
// without a layout engine, like the subtask fit beside it (cardSubtasks.js).
//
// A card is one line of title by default, cut with an ellipsis. A tall card
// has room for more, so its title wraps onto as many lines as fit above the
// rows that always follow it (tags/project, the time). A card that shows its
// subtasks keeps the one line: the room below the title is theirs, and a
// title that grew would push them out of sight.
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

/** Whether the card would list `task`'s subtasks (the setting is on and it has some with a title). */
export const cardShowsSubtasks = (task, showCardSubtasks) => showCardSubtasks !== false
  && Array.isArray(task?.subtasks)
  && task.subtasks.some((st) => st && typeof st.title === 'string' && st.title.trim());

/**
 * How many lines the title may take: 1 unless at least two fit.
 *
 * @param {{ height: number, linePx: number, belowPx?: number, showsSubtasks?: boolean, maxLines?: number }} a
 *   `belowPx` is what the rows under the title take; `maxLines` caps the result
 */
export function cardTitleLines({ height, linePx, belowPx = 0, showsSubtasks = false, maxLines = Infinity }) {
  if (showsSubtasks) return 1;
  const fit = Math.floor((Number(height) - CARD_PADDING_PX - belowPx) / linePx);
  if (!(fit >= 2)) return 1;
  return Math.max(1, Math.min(fit, maxLines));
}

/** The desktop card (TimelineTaskCardContent): the tags/project row, and the time row from 55px on a wide card. */
export const desktopCardTitleLines = ({ height, hasMetaRow, hasTimeRow, showsSubtasks, maxLines }) => cardTitleLines({
  height,
  linePx: DESKTOP_TITLE_LINE_PX,
  belowPx: (hasMetaRow ? 18 : 0) + (hasTimeRow ? 18 : 0),
  showsSubtasks,
  maxLines,
});

/** The phone's card (MobileTimeGrid): the project row (which carries the time from 55px), or the time row alone from 55px. */
export const mobileCardTitleLines = ({ height, hasProjectRow, showsSubtasks }) => cardTitleLines({
  height,
  linePx: MOBILE_TITLE_LINE_PX,
  belowPx: hasProjectRow ? 20 : (height >= 55 ? 18 : 0),
  showsSubtasks,
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
