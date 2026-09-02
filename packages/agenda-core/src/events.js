// Calendar-event semantics for the agenda (companion spec 4.2). Pure.
//
// An imported calendar event is not something you complete; it happens.
// The sidebar therefore keeps events out of the "open" count and shows an
// event as done once it has ended (owner ruling 2026-09-02: strikethrough
// and a checked box, the same treatment as a completed task). Task-calendar
// to-dos are imported too but ARE completable, so they stay tasks.

/** True for an agenda item that is a calendar event (imported, not a task-calendar to-do). */
export const isCalendarEvent = (item) => !!item?.imported && !item.isTaskCalendar;

const minutesOf = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * Has this event ended as of `now`? A past day has; a future day has not;
 * on today an all-day event has not (it lasts the whole day), and a timed
 * event has once start + duration (or start alone, with no duration) is at
 * or before the current minute.
 *
 * @param {{ date: string, startTime?: string|null, duration?: number|null, isAllDay?: boolean }} item
 * @param {{ today: string, nowMinutes: number }} clock  local date and minutes since local midnight
 */
export function eventHasEnded(item, { today, nowMinutes }) {
  if (!item?.date) return false;
  if (item.date < today) return true;
  if (item.date > today) return false;
  if (item.isAllDay || !item.startTime) return false;
  const start = minutesOf(item.startTime);
  if (start === null) return false;
  const end = start + (item.duration > 0 ? item.duration : 0);
  return end <= nowMinutes;
}

/** The clock eventHasEnded wants, from a Date. */
export function agendaClock(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return { today: `${y}-${m}-${d}`, nowMinutes: now.getHours() * 60 + now.getMinutes() };
}
