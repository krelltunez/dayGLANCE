// How many of a task's subtasks its timeline card has room for, in GRID,
// MULTI, DAY and JOBO. Pure, so the fit is tested without a layout engine.
//
// A card's height is known in pixels (the timeline places it), and its other
// rows are fixed sizes: the caller passes what they take (`reservedPx`), and
// the subtasks get the rest, one SUBTASK_ROW_PX row each. When they do not all
// fit, the last row that fits says how many more there are instead, so the
// card never cuts a row in half and never hides that there is more.

export const SUBTASK_ROW_PX = 18;
// The list's own top margin.
const LIST_GAP_PX = 4;

/**
 * @param {{ height: number, reservedPx: number, subtasks?: object[] }} a
 * @returns {{ shown: object[], more: number, rows: number }}  `rows` is how
 *   many rows the list draws (shown plus the "more" row), 0 for none
 */
export function cardSubtaskLayout({ height, reservedPx, subtasks = [] }) {
  const list = Array.isArray(subtasks) ? subtasks.filter((st) => st && typeof st.title === 'string' && st.title.trim()) : [];
  const fit = Math.floor((Number(height) - reservedPx - LIST_GAP_PX) / SUBTASK_ROW_PX);
  if (!list.length || !(fit >= 1)) return { shown: [], more: 0, rows: 0 };
  if (list.length <= fit) return { shown: list, more: 0, rows: list.length };
  const shown = list.slice(0, fit - 1);
  return { shown, more: list.length - shown.length, rows: fit };
}

/**
 * What the wide desktop card (TimelineTaskCardContent) spends before its
 * subtasks: padding, the title row with its action buttons, the tags/project
 * row when there is one, and the time row from 55px.
 */
export const desktopCardReservedPx = ({ height, hasMetaRow }) =>
  8 + 22 + (hasMetaRow ? 18 : 0) + (height >= 55 ? 18 : 0);

/**
 * The phone's wide card (MobileTimeGrid): padding and the title row, then the
 * project row (which carries the time beside the project from 55px), or the
 * time row alone from 55px.
 */
export const mobileCardReservedPx = ({ height, hasProjectRow }) =>
  8 + 22 + (hasProjectRow ? 20 : (height >= 55 ? 18 : 0));

// The device setting (Settings → Appearance → Task cards): on unless turned
// off. Per device, like the timeline size: a phone and a desktop can differ.
// The `day-planner-` prefix puts it in local backups (utils/deviceSettings.js)
// and keeps it out of sync, which carries only the keys it names.
export const CARD_SUBTASKS_KEY = 'day-planner-show-card-subtasks';

/** The saved setting; anything missing or unreadable is on. */
export function readShowCardSubtasks(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(CARD_SUBTASKS_KEY) !== 'false';
  } catch {
    return true;
  }
}
