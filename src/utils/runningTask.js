import { dateToString } from './taskUtils.js';

// Which timed task, if any, is running right now — the source of truth behind
// the "NOW: <task>" banner. Three surfaces render that banner (DesktopLayout's
// macOS title bar, CalendarHeader everywhere else on desktop, MobileLayout) and
// each carried its own copy of the predicate.
//
// One definition matters now that DesktopLayout also hides today's summary strip
// while the title bar carries the pills: that decision and the title bar's own
// NOW-bar-or-pills choice must read the same answer. If they ever drifted, the
// strip would hide on a day the NOW bar had taken the bar over, and today's
// numbers would disappear from the window entirely.
//
// Not running: all-day tasks (no start/duration to sit inside of), completed
// tasks, and read-only imported calendar events — those are fixtures rather than
// work in progress, with isTaskCalendar marking the writable ones back in.

const timeToMinutes = (time) => {
  const [hours, minutes] = (time || '0:00').split(':').map(Number);
  return hours * 60 + minutes;
};

/**
 * @param tasks Every task to consider, already flattened — scheduled tasks plus
 *              expanded recurring instances.
 * @param now   Moment to test against; defaults to this instant. Callers render
 *              on a one-minute tick, so passing nothing re-reads the clock each
 *              render rather than pinning it.
 * @returns The first task covering `now`, or undefined when nothing is running.
 */
export const findRunningTask = (tasks, now = new Date()) => {
  const todayStr = dateToString(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return tasks.find((task) => {
    if (task.date !== todayStr || task.isAllDay || task.completed) return false;
    if (task.imported && !task.isTaskCalendar) return false;
    const start = timeToMinutes(task.startTime);
    return nowMin >= start && nowMin < start + (task.duration || 0);
  });
};
