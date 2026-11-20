// Where a timed block ends (#2429): `end_date` and `end_time`, derived from
// its date, start_time and duration_minutes, so a block says its own end
// rather than leaving every reader to add the minutes up.
//
// It is the PLANNED end. A task completed late or early keeps its block as
// planned (the plan is kept on purpose; JOBO records what actually happened),
// and when it was ticked off is `completed_at`, a different thing. The end
// may fall on the next date (#2278), so it carries its own date: a block
// ending exactly at midnight ends at 00:00 on the next date.
//
// Both null when the block has no span: all-day, or no start or no length.

import { shiftDateStr } from '@glance-apps/agenda-core';

const HHMM = /^(\d{1,2}):(\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function blockEnd({ date, start_time: start, duration_minutes: duration, all_day: allDay }) {
  const none = { end_date: null, end_time: null };
  if (allDay || typeof date !== 'string' || !DATE.test(date)) return none;
  const m = HHMM.exec(start ?? '');
  if (!m || typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) return none;
  const total = Number(m[1]) * 60 + Number(m[2]) + Math.round(duration);
  const days = Math.floor(total / 1440);
  const minutes = total % 1440;
  const pad = (n) => String(n).padStart(2, '0');
  return {
    end_date: days === 0 ? date : shiftDateStr(date, days),
    end_time: `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`,
  };
}
