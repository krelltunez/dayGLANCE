// Timed tasks that cross midnight (#2278, phase 1).
//
// A task is one row with one `date`, a `startTime` and a `duration` (capped at
// 24 hours for the user's own tasks). When start + duration runs past 24:00,
// the part after midnight lands on the NEXT date. Nothing is stored for that
// part: it is derived here, from the previous date's rows, every time a
// surface needs it. One rule, so the timelines, the Day Dial, occupancy, the
// overdue list and the MCP read model cannot disagree about it.
//
// WHO OWNS IT. The start date owns the task: its counts, its task list, the
// widgets and MCP's main list. The next date only shows the after-midnight
// piece (a "continuation") on its timelines and counts that time as busy. A
// continuation is a VIEW of the task, never a second task: it carries the task
// itself (`task`), so every action on it acts on the real row.
//
// THE CARRY RULE (the Day Dial's, which predates this module and now uses it):
//
//   - only a timed block carries: not all-day, a start time, a positive
//     duration;
//   - the piece is [00:00, start + duration - 24:00) on the next date, so a
//     block ending exactly at 24:00 carries nothing;
//   - the piece never runs past the next date's own midnight. A user task is
//     capped at 24 hours so it cannot; an imported event longer than that is
//     clipped at the end of the next date (how a block spans more than two
//     dates is phase 2).
//
// Completed tasks still carry (shown as completed): this is the day's shape,
// not a todo list. Deleted tasks never do, because they are not in any date's
// rows; that is the caller's list, not a rule here.

import { shiftDateStr } from './agenda.js';

export const DAY_MINUTES = 24 * 60;

// `HH:MM` (seconds tolerated) → minutes since midnight, or null.
const startMinutesOf = (startTime) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(startTime ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Whether a row is a timed block with a span (the carry rule's first line). */
export function isTimedBlock(task) {
  return !!task && !task.isAllDay && !!task.startTime && (Number(task.duration) || 0) > 0
    && startMinutesOf(task.startTime) !== null;
}

/**
 * Minutes of `task` that fall after its own date's midnight, capped at one
 * whole day. 0 for a row that does not cross midnight (including one that ends
 * exactly at 24:00) or is not a timed block.
 */
export function overnightSpillMinutes(task) {
  if (!isTimedBlock(task)) return 0;
  const end = startMinutesOf(task.startTime) + Number(task.duration);
  return Math.max(0, Math.min(DAY_MINUTES, end - DAY_MINUTES));
}

/**
 * The after-midnight pieces the PREVIOUS date's rows leave on this date.
 *
 * @param prevDayTasks The previous date's rows, as that date lists them (tasks
 *                     and expanded recurring occurrences, with each date's
 *                     exception already applied).
 * @returns {Array<{ task, fromDate: string|null, startMinutes: 0,
 *                   endMinutes: number, minutes: number }>}
 *   `task` is the row itself (same object, same id): open, complete, move and
 *   resize it, not a copy. `fromDate` is the date it started on.
 */
export function continuationsFromPreviousDay(prevDayTasks) {
  const out = [];
  for (const task of prevDayTasks || []) {
    const minutes = overnightSpillMinutes(task);
    if (minutes > 0) {
      out.push({ task, fromDate: task.date ?? null, startMinutes: 0, endMinutes: minutes, minutes });
    }
  }
  return out;
}

/**
 * Where a row really ends: `{ date, minutes }`, minutes since that date's
 * midnight. A timed row that ends exactly at 24:00 ends at 00:00 of the next
 * date. An all-day row (or one with no date, or a start time that is not a
 * time) has no timed end: null.
 *
 * A missing start time reads as midnight and `defaultDuration` stands in for a
 * missing duration, as the overdue list has always assumed.
 */
export function taskEnd(task, { defaultDuration = 30 } = {}) {
  if (!task?.date || task.isAllDay) return null;
  const start = task.startTime ? startMinutesOf(task.startTime) : 0;
  if (start === null) return null;
  const duration = Number(task.duration) || defaultDuration;
  const total = start + duration;
  const days = Math.floor(total / DAY_MINUTES);
  return { date: days ? shiftDateStr(task.date, days) : task.date, minutes: total - days * DAY_MINUTES };
}

/**
 * Has a timed row ended by `todayStr` at `nowMinutes`? Judged by its REAL end,
 * so a 23:00-01:00 row has not ended at 00:30 the next day, and has at 01:00.
 * A row with no timed end (all-day, or an unreadable start): ended once its
 * date is past.
 */
export function hasTaskEnded(task, { todayStr, nowMinutes, defaultDuration = 30 }) {
  if (!task?.date) return false;
  const end = taskEnd(task, { defaultDuration });
  // No timed end: over once its date is past.
  if (!end) return task.date < todayStr;
  if (end.date !== todayStr) return end.date < todayStr;
  return end.minutes <= nowMinutes;
}

// ── What is running now, and what is next, across midnight ────────────────
//
// The surfaces that say what is happening NOW (the GLANCE agenda, the desktop
// tray's NOW bar, the Stream Deck, the widgets' Up Next) used to look at the
// date's own rows only, so a task still running from last night was not
// running anywhere at 00:08. They judge it here, one rule: a date's timed
// blocks are its own rows at [start, start + duration) and the previous
// date's continuations at [00:00, spill), all on this date's clock.

const hhmm = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * A date's timed blocks on its own clock, across midnight: the previous
 * date's after-midnight pieces from 00:00 (continuationsFromPreviousDay), and
 * the date's own timed rows. In start order; a piece comes before a row of the
 * date's own that starts at 00:00 too (it began the day before).
 *
 * @param dayTasks     The date's own rows, already filtered by the caller
 *                     (all-day rows and rows without a readable start are
 *                     left out here).
 * @param prevDayTasks The previous date's rows, filtered the same way; only
 *                     their after-midnight pieces count.
 * @param opts.defaultDuration Stands in for a missing duration on the date's
 *                     own rows (0: a point in time). A piece always has one.
 * @returns {Array<{ task, startMinutes: number, endMinutes: number,
 *                   startTime: string, duration: number, continuation }>}
 *   `task` is the row itself: act on it. `startTime` and `duration` are the
 *   block on THIS date's clock, for a reader that takes start + duration as
 *   today's span ('00:00' and the piece's minutes for a continuation, the
 *   row's own otherwise; an own row's end may lie past 24:00). `continuation`
 *   is the continuationsFromPreviousDay entry, or null.
 */
export function dayTimedBlocks(dayTasks, prevDayTasks, { defaultDuration = 0 } = {}) {
  const pieces = continuationsFromPreviousDay(prevDayTasks).map((c) => ({
    task: c.task, startMinutes: 0, endMinutes: c.endMinutes,
    startTime: hhmm(0), duration: c.minutes, continuation: c,
  }));
  const own = [];
  for (const task of dayTasks || []) {
    if (!task || task.isAllDay || !task.startTime) continue;
    const start = startMinutesOf(task.startTime);
    if (start === null) continue;
    const duration = Number(task.duration) || defaultDuration;
    own.push({ task, startMinutes: start, endMinutes: start + duration, startTime: task.startTime, duration, continuation: null });
  }
  // Stable: pieces first, then the date's own rows in their own order.
  return [...pieces, ...own].sort((a, b) => a.startMinutes - b.startMinutes);
}

/**
 * What is running at `nowMinutes` on a date and what comes next, across
 * midnight (dayTimedBlocks).
 *
 * @returns {{ blocks, current, next, ahead }}
 *   `current`: the first block (start order) running now, start <= now < end;
 *   `next`: the first block that starts after now;
 *   `ahead`: every block not over yet, running or to come, in start order (a
 *   zero-length block counts until its start has passed).
 *   Each is a dayTimedBlocks block, or null.
 */
export function nowAndNext(dayTasks, prevDayTasks, nowMinutes, { defaultDuration = 0 } = {}) {
  const blocks = dayTimedBlocks(dayTasks, prevDayTasks, { defaultDuration });
  const current = blocks.find((b) => b.startMinutes <= nowMinutes && nowMinutes < b.endMinutes) || null;
  const next = blocks.find((b) => b.startMinutes > nowMinutes) || null;
  const ahead = blocks.filter((b) => b.endMinutes > nowMinutes || (b.endMinutes === b.startMinutes && b.startMinutes >= nowMinutes));
  return { blocks, current, next, ahead };
}
