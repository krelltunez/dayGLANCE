// The `repeat` argument (#2066): the wire shape an agent writes, validated and
// turned into the recurrence object the app stores. Pure, in the
// mcpCreateArgs.ts style, so every accept/reject decision is unit-tested.
//
// THE WIRE SHAPE MIRRORS WHAT THE APP CAN REPEAT, nothing more. The engine
// (packages/agenda-core/src/recurrence.js) and the editor's presets offer:
//
//   daily
//   weekly    on chosen weekdays            (days_of_week; default: start's)
//   biweekly  every 2 weeks on chosen days  (days_of_week; default: start's)
//   monthly   on a day of the month         (day_of_month 1-31, clamped to
//                                            the month's last day; default:
//                                            start's day)
//             or on the nth weekday         (nth_weekday { week 1-5, day };
//                                            a 5th that a month lacks is
//                                            skipped)
//   yearly    on the start's month and day
//
// plus an optional end: `until` (inclusive local date) and/or `count` (total
// occurrences). There is no general "every N periods": `interval` is a typed
// by-design rejection, never silently approximated, so a model reports the
// design instead of creating a series the user did not ask for.

import { isValidLocalDate } from '@glance-apps/mcp-host';

export const REPEAT_FREQUENCIES = ['daily', 'weekly', 'biweekly', 'monthly', 'yearly'] as const;
export type RepeatFrequency = typeof REPEAT_FREQUENCIES[number];

export const WEEKDAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

const REPEAT_KEYS = ['frequency', 'days_of_week', 'day_of_month', 'nth_weekday', 'until', 'count'];
export const MAX_REPEAT_COUNT = 1000;

/** The recurrence object as the app stores it, minus startDate (the caller owns that). */
export interface RecurrencePattern {
  type: RepeatFrequency;
  daysOfWeek?: number[];
  monthDay?: number | null;
  monthWeekday?: { week: number; day: number } | null;
  endDate?: string;
  maxOccurrences?: number;
}

export type RepeatResult =
  | { ok: true; recurrence: RecurrencePattern }
  | { ok: false; code: 'validation'; message: string };

const reject = (message: string): RepeatResult => ({ ok: false, code: 'validation', message });

const weekdayOf = (date: string): number => new Date(`${date}T12:00:00Z`).getUTCDay();
const dayOfMonthOf = (date: string): number => Number(date.slice(8, 10));

const SUPPORTED =
  'dayGLANCE repeats daily, weekly on chosen days, every 2 weeks (biweekly) on chosen days, monthly on a day ' +
  'of the month or on the nth weekday, or yearly.';

/**
 * Validate `repeat` and build the stored recurrence pattern.
 *
 * @param repeat  The wire argument.
 * @param anchor  The series' first date for a create, or the edited
 *                occurrence's date for a series edit: defaults (weekday, day
 *                of month) come from it, and `until` may not precede it.
 */
export function parseRepeat(repeat: unknown, anchor: string): RepeatResult {
  if (typeof repeat !== 'object' || repeat === null || Array.isArray(repeat)) {
    return reject(`repeat must be an object such as {"frequency":"weekly","days_of_week":["mon"]}, got ${JSON.stringify(repeat)}`);
  }
  const r = repeat as Record<string, unknown>;

  if ('interval' in r) {
    return reject(
      `repeat has no interval by design: ${SUPPORTED} There is no general "every N" period. Use biweekly for ` +
      'every 2 weeks; any other spacing has to be set up in dayGLANCE itself or created as separate tasks.',
    );
  }
  const unknown = Object.keys(r).filter((k) => !REPEAT_KEYS.includes(k));
  if (unknown.length) {
    return reject(`repeat does not take ${unknown.map((k) => JSON.stringify(k)).join(', ')}. Its fields are ${REPEAT_KEYS.join(', ')}.`);
  }

  const { frequency, days_of_week, day_of_month, nth_weekday, until, count } = r;
  if (typeof frequency !== 'string' || !(REPEAT_FREQUENCIES as readonly string[]).includes(frequency)) {
    return reject(`repeat.frequency must be one of ${REPEAT_FREQUENCIES.join(', ')}, got ${JSON.stringify(frequency)}. ${SUPPORTED}`);
  }
  const type = frequency as RepeatFrequency;
  const weeklyLike = type === 'weekly' || type === 'biweekly';

  if (days_of_week !== undefined && !weeklyLike) {
    return reject(`repeat.days_of_week applies to weekly and biweekly only, not ${type}.`);
  }
  if ((day_of_month !== undefined || nth_weekday !== undefined) && type !== 'monthly') {
    return reject(`repeat.day_of_month and repeat.nth_weekday apply to monthly only, not ${type}.`);
  }
  if (day_of_month !== undefined && nth_weekday !== undefined) {
    return reject('repeat.day_of_month and repeat.nth_weekday contradict each other: a monthly series is on one or the other.');
  }

  const recurrence: RecurrencePattern = { type };

  if (weeklyLike) {
    if (days_of_week === undefined) {
      recurrence.daysOfWeek = [weekdayOf(anchor)];
    } else {
      if (!Array.isArray(days_of_week) || days_of_week.length === 0) {
        return reject(`repeat.days_of_week must be a non-empty array of ${WEEKDAY_NAMES.join(', ')}, got ${JSON.stringify(days_of_week)}`);
      }
      const days: number[] = [];
      for (const name of days_of_week) {
        const dow = typeof name === 'string' ? (WEEKDAY_NAMES as readonly string[]).indexOf(name.toLowerCase()) : -1;
        if (dow < 0) {
          return reject(`repeat.days_of_week takes ${WEEKDAY_NAMES.join(', ')}, got ${JSON.stringify(name)}`);
        }
        if (!days.includes(dow)) days.push(dow);
      }
      recurrence.daysOfWeek = days.sort((a, b) => a - b);
    }
  }

  if (type === 'monthly') {
    if (nth_weekday !== undefined) {
      const nw = nth_weekday as Record<string, unknown> | null;
      const week = nw && typeof nw === 'object' ? nw['week'] : undefined;
      const dayName = nw && typeof nw === 'object' ? nw['day'] : undefined;
      if (typeof week !== 'number' || !Number.isInteger(week) || week < 1 || week > 5) {
        return reject(
          `repeat.nth_weekday.week must be an integer 1-5 (5 = the fifth, skipped in months without one; there is no "last"), got ${JSON.stringify(week)}`,
        );
      }
      const day = typeof dayName === 'string' ? (WEEKDAY_NAMES as readonly string[]).indexOf(dayName.toLowerCase()) : -1;
      if (day < 0) {
        return reject(`repeat.nth_weekday.day takes ${WEEKDAY_NAMES.join(', ')}, got ${JSON.stringify(dayName)}`);
      }
      recurrence.monthDay = null;
      recurrence.monthWeekday = { week, day };
    } else {
      const md = day_of_month === undefined ? dayOfMonthOf(anchor) : day_of_month;
      if (typeof md !== 'number' || !Number.isInteger(md) || md < 1 || md > 31) {
        return reject(`repeat.day_of_month must be an integer 1-31 (clamped to the last day in shorter months), got ${JSON.stringify(md)}`);
      }
      recurrence.monthDay = md;
      recurrence.monthWeekday = null;
    }
  }

  if (until !== undefined) {
    if (!isValidLocalDate(until)) {
      return reject(`repeat.until must be a real local calendar date in strict YYYY-MM-DD form, got ${JSON.stringify(until)}`);
    }
    if ((until as string) < anchor) {
      return reject(`repeat.until (${until as string}) is before ${anchor}, so the series would have no occurrence from there on.`);
    }
    recurrence.endDate = until as string;
  }
  if (count !== undefined) {
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_REPEAT_COUNT) {
      return reject(`repeat.count must be an integer 1-${MAX_REPEAT_COUNT} (total occurrences), got ${JSON.stringify(count)}`);
    }
    recurrence.maxOccurrences = count;
  }

  return { ok: true, recurrence };
}
