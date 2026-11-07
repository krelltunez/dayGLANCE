// The stored recurrence pattern as MCP reports it (#2066): the inverse of
// electron/mcpRepeatArgs.ts parseRepeat, so what dayglance_get_day shows for a
// series is what dayglance_create_task and dayglance_update_recurring_task
// accept. Defaults the engine fills from the start date (a weekly series with
// no days, a monthly one with no day) are spelled out, so the reader never has
// to know the engine's fallbacks. The series' start date is not part of it:
// `repeat` must be accepted back as written, and the start is the series' own
// fact (reported beside it as start_date).

const WEEKDAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const startOf = (recurrence) => (typeof recurrence?.startDate === 'string' ? recurrence.startDate : null);
const weekdayOf = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** @returns the wire `repeat` object, or null when there is no pattern. */
export function recurrenceToWire(recurrence) {
  if (!recurrence || typeof recurrence !== 'object' || !recurrence.type) return null;
  const start = startOf(recurrence);
  const wire = { frequency: recurrence.type };

  if (recurrence.type === 'weekly' || recurrence.type === 'biweekly') {
    const days = recurrence.daysOfWeek?.length
      ? [...recurrence.daysOfWeek].sort((a, b) => a - b)
      : (start ? [weekdayOf(start)] : []);
    wire.days_of_week = days.map((d) => WEEKDAY_NAMES[d]).filter(Boolean);
  } else if (recurrence.type === 'monthly') {
    if (recurrence.monthWeekday) {
      wire.nth_weekday = { week: recurrence.monthWeekday.week, day: WEEKDAY_NAMES[recurrence.monthWeekday.day] };
    } else {
      const md = recurrence.monthDay || (start ? Number(start.slice(8, 10)) : null);
      if (md) wire.day_of_month = md;
    }
  }

  if (recurrence.endDate) wire.until = recurrence.endDate;
  if (recurrence.maxOccurrences) wire.count = recurrence.maxOccurrences;
  return wire;
}
