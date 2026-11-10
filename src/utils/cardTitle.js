// How a timeline card shows a long title (#2368). Pure, so the fit is tested
// without a layout engine, like the subtask fit beside it (cardSubtasks.js).
//
// A card is one line of title by default, cut with an ellipsis. A tall card
// has room for more, so its title wraps onto the lines that fit above the
// rows that always follow it (tags/project, the time), up to four: past that
// a title is a wall of text, and the tooltip and the week popover show it
// whole. A card that lists subtasks gives its title a second line only when
// every subtask still fits under it: the subtasks come first, and a title
// that grew must never push one out of sight. A card too narrow to wrap words
// whole (side-by-side overlapping cards) keeps the one line: there, a wrapped
// title breaks mid-word down a column of fragments, and the ellipsis reads
// better.
//
// Wherever a pointer can hover, the full title is also the card's tooltip,
// with the card's double-click hint, where it has one, on a second line.

import { stripWikilinks } from './taskUtils.js';
import { cardSubtaskLayout, desktopCardReservedPx, mobileCardReservedPx } from './cardSubtasks.js';

// One line of title: text-sm with leading-tight on desktop (14px × 1.25), the
// plain text-sm line (1.25rem) on the phone.
export const DESKTOP_TITLE_LINE_PX = 17.5;
export const MOBILE_TITLE_LINE_PX = 20;
// The title row the subtask fit already counts (cardSubtasks.js): the row of
// action buttons beside a one-line title.
const TITLE_ROW_PX = 22;
// The card's own vertical padding (py-1).
const CARD_PADDING_PX = 8;
// The narrowest card (layout px, as at 100% zoom) whose title may wrap: about
// 100px of text beside the checkbox and icons (desktop's also has a star and
// the overflow menu's room).
export const DESKTOP_MIN_WRAP_WIDTH_PX = 180;
export const MOBILE_MIN_WRAP_WIDTH_PX = 140;
// The most lines a timeline card's title takes, and a card with subtasks'.
export const TIMELINE_MAX_TITLE_LINES = 4;
export const SUBTASKS_MAX_TITLE_LINES = 2;

/** Whether the card would list `task`'s subtasks (the setting is on and it has some with a title). */
export const cardShowsSubtasks = (task, showCardSubtasks) => showCardSubtasks !== false
  && Array.isArray(task?.subtasks)
  && task.subtasks.some((st) => st && typeof st.title === 'string' && st.title.trim());

const titledSubtasks = (subtasks) => (Array.isArray(subtasks) ? subtasks : [])
  .filter((st) => st && typeof st.title === 'string' && st.title.trim());

/** What a title of `lines` lines adds to the title row the subtask fit counts. */
const extraTitlePx = (lines, linePx) => (lines > 1 ? Math.max(0, lines * linePx - TITLE_ROW_PX) : 0);
export const desktopTitleExtraPx = (lines) => extraTitlePx(lines, DESKTOP_TITLE_LINE_PX);
export const mobileTitleExtraPx = (lines) => extraTitlePx(lines, MOBILE_TITLE_LINE_PX);

/**
 * How many lines the title may take by height and width alone: 1 unless at
 * least two fit.
 *
 * @param {{ height: number, linePx: number, belowPx?: number,
 *   width?: number, minWidth?: number, maxLines?: number }} a
 *   `belowPx` is what the rows under the title take; `width` the card's
 *   (unknown: no limit), which must reach `minWidth`; `maxLines` caps the result
 */
export function cardTitleLines({ height, linePx, belowPx = 0, width, minWidth = 0, maxLines = Infinity }) {
  if (width !== undefined && !(width >= minWidth)) return 1;
  const fit = Math.floor((Number(height) - CARD_PADDING_PX - belowPx) / linePx);
  if (!(fit >= 2)) return 1;
  return Math.max(1, Math.min(fit, maxLines));
}

/**
 * With subtasks listed: two lines when they fit by height and every subtask
 * still fits under a two-line title (`reservedPx` is the subtask fit's own,
 * for a one-line title), else one.
 */
function withSubtasks(lines, { height, reservedPx, subtasks, extraPx }) {
  const list = titledSubtasks(subtasks);
  if (!list.length) return lines;
  if (lines < 2) return 1;
  const { shown, more } = cardSubtaskLayout({ height, reservedPx: reservedPx + extraPx, subtasks: list });
  return more === 0 && shown.length === list.length ? SUBTASKS_MAX_TITLE_LINES : 1;
}

/**
 * The desktop card (TimelineTaskCardContent): the tags/project row, the time
 * row from 55px on a wide card, and `extraBelowPx` for anything else under
 * the title (the week popover's action row). `subtasks` are the ones the card
 * lists, or none.
 */
export function desktopCardTitleLines({
  height, width, hasMetaRow, hasTimeRow, subtasks = null, extraBelowPx = 0, maxLines = TIMELINE_MAX_TITLE_LINES,
}) {
  const lines = cardTitleLines({
    height,
    linePx: DESKTOP_TITLE_LINE_PX,
    belowPx: (hasMetaRow ? 18 : 0) + (hasTimeRow ? 18 : 0) + extraBelowPx,
    width,
    minWidth: DESKTOP_MIN_WRAP_WIDTH_PX,
    maxLines,
  });
  return withSubtasks(lines, {
    height,
    reservedPx: desktopCardReservedPx({ height, hasMetaRow }) + extraBelowPx,
    subtasks,
    extraPx: desktopTitleExtraPx(SUBTASKS_MAX_TITLE_LINES),
  });
}

/**
 * The phone's card (MobileTimeGrid): the project row (which carries the time
 * from 55px), or the time row alone from 55px. `subtasks` are the ones the
 * card lists, or none.
 */
export function mobileCardTitleLines({ height, width, hasProjectRow, subtasks = null }) {
  const lines = cardTitleLines({
    height,
    linePx: MOBILE_TITLE_LINE_PX,
    belowPx: hasProjectRow ? 20 : (height >= 55 ? 18 : 0),
    width,
    minWidth: MOBILE_MIN_WRAP_WIDTH_PX,
    maxLines: TIMELINE_MAX_TITLE_LINES,
  });
  return withSubtasks(lines, {
    height,
    reservedPx: mobileCardReservedPx({ height, hasProjectRow }),
    subtasks,
    extraPx: mobileTitleExtraPx(SUBTASKS_MAX_TITLE_LINES),
  });
}

/**
 * The title element's class and style for `lines`: the one-line ellipsis, a
 * clamp at that many lines, or (Infinity) no clamp, each breaking a long word
 * rather than overflow.
 */
export function cardTitleClamp(lines) {
  if (!(lines > 1)) return { className: 'truncate', style: undefined };
  // Not clamped at all (the week popover): it only wraps.
  if (lines === Infinity) return { className: '', style: { overflowWrap: 'anywhere' } };
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
