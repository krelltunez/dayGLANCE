// What the timelines need to draw a task's after-midnight piece (#2278). The
// carry rule itself is agenda-core's (overnight.js); App.jsx exposes it per
// date as getContinuationsForDate. These are the view-side pieces every
// timeline shares, so MULTI, DAY (and JOBO's Plan side), WEEK and the phone
// place and label a continuation the same way.

import { DAY_MINUTES, continuationsFromPreviousDay, shiftDateStr } from '@glance-apps/agenda-core';

/**
 * The pieces the previous date leaves on `date` (a Date) after midnight, as
 * App.jsx's getContinuationsForDate hands them to the timelines: carried from
 * the previous date's rows AS THAT DATE IS SHOWN (`readShown`, the past-day
 * display), so a past night's completed task whose block gave way to its Do
 * gives way on the next date too, where the Do's own slice is drawn. A Do item
 * never carries: it is cut at its day's midnight. `asPlanned` reads the plan
 * as it stood (`readPlanned`), for the views that show the plan whatever was
 * done: JOBO's Plan side.
 */
export function continuationsForDate(date, { readShown, readPlanned, applyTagFilter = true, asPlanned = false }) {
  const prev = new Date(date);
  prev.setDate(prev.getDate() - 1);
  return continuationsFromPreviousDay((asPlanned ? readPlanned : readShown)(prev, applyTagFilter));
}

/**
 * A continuation as a row for LAYOUT only: lane packing and overlap
 * (calculateConflictPosition) see it at [00:00, spill) beside the date's own
 * cards. Never hand this to an action: it is a copy with a different start.
 * Every action takes `continuation.task`, the real row.
 */
export function continuationLayoutRow(continuation) {
  return { ...continuation.task, startTime: '00:00', duration: continuation.minutes, isAllDay: false };
}

/**
 * The resize guides (#2273) for the column of `dateStr`: the preview itself on
 * the task's own date, shifted a day earlier on the date its continuation is
 * drawn on (its end lies past that date's midnight), otherwise null.
 */
export function resizePreviewForDate(preview, dateStr) {
  if (!preview || !preview.dateStr) return null;
  if (preview.dateStr === dateStr) return preview;
  if (shiftDateStr(preview.dateStr, 1) !== dateStr || !(preview.endMinutes > DAY_MINUTES)) return null;
  return {
    ...preview,
    startMinutes: preview.startMinutes - DAY_MINUTES,
    endMinutes: preview.endMinutes - DAY_MINUTES,
  };
}

/**
 * Whether the drag preview drawn for `dragPreviewDateStr` runs on into the
 * column of `dateStr`, and by how many minutes: the dropped task would carry
 * past midnight onto it (dragBlockRange's overflowMinutes).
 */
export function dragPreviewSpillFor(block, dragPreviewDateStr, dateStr) {
  if (!block || !dragPreviewDateStr || !(block.overflowMinutes > 0)) return 0;
  return shiftDateStr(dragPreviewDateStr, 1) === dateStr ? Math.min(DAY_MINUTES, block.overflowMinutes) : 0;
}
