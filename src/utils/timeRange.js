// A task's start–end range as a card prints it (#2278).
//
// The end is a real clock time: a task from 23:00 for two hours ends at
// "01:00" the next day, never "25:00" (and a 12-hour clock never reads
// "1:00 PM" for it). An end on the next day carries the app's next-day mark,
// "+1", the one the task dialog's end field (TaskTimeFields' EndTimeField)
// and the Day Dial already print. A task ending exactly at midnight ends at
// 00:00 of the next day, marked too: "24:00" is not a time the formatters
// should be asked for. The arithmetic is taskDuration.js's endOf, the
// dialog's own.
//
// Cards that render markup use components/TimeRange.jsx (the mark as a
// superscript, as the dialog draws it); a place that can only hold text uses
// formatTimeRange.

import { endOf } from './taskDuration.js';

/** The next-day mark after an end time on the following date. */
export const NEXT_DAY_MARK = '+1';

/**
 * `{ startTime, endTime, nextDay }` ('HH:MM' clock times) for a start and a
 * duration in minutes, or null without a readable start.
 */
export function timeRange(startTime, duration) {
  const end = endOf(startTime, duration);
  return end ? { startTime, endTime: end.time, nextDay: end.nextDay } : null;
}

/**
 * The range as text through `formatTime` (the app's 12/24-hour formatter):
 * "23:00–01:00 +1", "11:00 PM–1:00 AM +1", "09:00–10:00". Without a
 * readable start, the start alone (or nothing).
 */
export function formatTimeRange(startTime, duration, formatTime, { separator = '–' } = {}) {
  const range = timeRange(startTime, duration);
  if (!range) return startTime ? formatTime(startTime) : '';
  const mark = range.nextDay ? ` ${NEXT_DAY_MARK}` : '';
  return `${formatTime(range.startTime)}${separator}${formatTime(range.endTime)}${mark}`;
}
