import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  getOccurrencesInRange,
  getNextOccurrence,
  getSelectedWeekdays,
  toggleRecurrenceDay,
  setRecurrenceFrequency,
  weekdayOrder,
} from './recurrenceEngine.js';

// The clock is frozen for the whole file. getNextOccurrence reads "today", and
// a suite that drifts with the calendar ages into failure — which is exactly
// how the sync-wiring tests went red on a Tuesday morning.
const NOW = new Date('2026-08-18T12:00:00');

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => vi.useRealTimers());

const template = (recurrence, extra = {}) => ({ id: 't', recurrence, exceptions: {}, ...extra });

describe('getOccurrencesInRange', () => {
  it('walks a daily series across the whole window', () => {
    const t = template({ type: 'daily', startDate: '2026-08-01' });
    expect(getOccurrencesInRange(t, '2026-08-10', '2026-08-13'))
      .toEqual(['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13']);
  });

  it('hits every selected weekday of a multi-day weekly series', () => {
    // Mon/Wed/Fri. This is the shape the picker in #1404 will produce.
    const t = template({ type: 'weekly', daysOfWeek: [1, 3, 5], startDate: '2026-08-03' });
    expect(getOccurrencesInRange(t, '2026-08-03', '2026-08-09'))
      .toEqual(['2026-08-03', '2026-08-05', '2026-08-07']);
  });

  it('skips alternate weeks for biweekly', () => {
    const t = template({ type: 'biweekly', daysOfWeek: [1], startDate: '2026-08-03' });
    expect(getOccurrencesInRange(t, '2026-08-03', '2026-09-01'))
      .toEqual(['2026-08-03', '2026-08-17', '2026-08-31']);
  });

  it('clamps a monthly day-of-month to short months', () => {
    const t = template({ type: 'monthly', monthDay: 31, startDate: '2026-01-31' });
    expect(getOccurrencesInRange(t, '2026-02-01', '2026-02-28')).toEqual(['2026-02-28']);
  });

  it('honours endDate and maxOccurrences', () => {
    const ends = template({ type: 'daily', startDate: '2026-08-10', endDate: '2026-08-12' });
    expect(getOccurrencesInRange(ends, '2026-08-10', '2026-08-20'))
      .toEqual(['2026-08-10', '2026-08-11', '2026-08-12']);

    const capped = template({ type: 'daily', startDate: '2026-08-10', maxOccurrences: 2 });
    expect(getOccurrencesInRange(capped, '2026-08-10', '2026-08-20'))
      .toEqual(['2026-08-10', '2026-08-11']);
  });

  it('omits dates the template marks deleted or skipped, without shifting the rest', () => {
    const t = template(
      { type: 'daily', startDate: '2026-08-10' },
      { exceptions: { '2026-08-11': { deleted: true }, '2026-08-12': { skipped: true } } },
    );
    expect(getOccurrencesInRange(t, '2026-08-10', '2026-08-13'))
      .toEqual(['2026-08-10', '2026-08-13']);
  });

  it('returns nothing for a template with no recurrence', () => {
    expect(getOccurrencesInRange({ id: 'x' }, '2026-08-10', '2026-08-20')).toEqual([]);
  });
});

describe('maxResults', () => {
  // The guarantee the early exit rests on: stopping early must not change WHICH
  // occurrence comes first, only how much work was done to find it.
  const cases = [
    ['daily', { type: 'daily', startDate: '2026-01-01' }],
    ['weekly, one day', { type: 'weekly', daysOfWeek: [3], startDate: '2026-01-01' }],
    ['weekly, three days', { type: 'weekly', daysOfWeek: [1, 3, 5], startDate: '2026-01-01' }],
    ['biweekly', { type: 'biweekly', daysOfWeek: [2], startDate: '2026-01-01' }],
    ['monthly by date', { type: 'monthly', monthDay: 15, startDate: '2026-01-15' }],
    ['monthly by weekday', { type: 'monthly', monthWeekday: { week: 2, day: 1 }, startDate: '2026-01-01' }],
    ['yearly', { type: 'yearly', startDate: '2026-03-01' }],
  ];

  it.each(cases)('%s: capped result is the prefix of the uncapped one', (_name, rec) => {
    const t = template(rec);
    const all = getOccurrencesInRange(t, '2026-08-18', '2028-08-18');
    expect(getOccurrencesInRange(t, '2026-08-18', '2028-08-18', 1)).toEqual(all.slice(0, 1));
    expect(getOccurrencesInRange(t, '2026-08-18', '2028-08-18', 3)).toEqual(all.slice(0, 3));
  });

  it('returns everything available when the cap exceeds the series', () => {
    const t = template({ type: 'daily', startDate: '2026-08-10', endDate: '2026-08-12' });
    expect(getOccurrencesInRange(t, '2026-08-10', '2026-08-20', 99))
      .toEqual(['2026-08-10', '2026-08-11', '2026-08-12']);
  });

  it('defaults to unbounded, so existing three-argument callers are unchanged', () => {
    const t = template({ type: 'daily', startDate: '2026-08-10' });
    expect(getOccurrencesInRange(t, '2026-08-10', '2026-08-20')).toHaveLength(11);
  });
});

describe('getNextOccurrence', () => {
  it('returns today when the series occurs today', () => {
    expect(getNextOccurrence(template({ type: 'daily', startDate: '2026-01-01' })))
      .toBe('2026-08-18');
  });

  it('skips past a date the template deleted', () => {
    const t = template(
      { type: 'daily', startDate: '2026-01-01' },
      { exceptions: { '2026-08-18': { deleted: true } } },
    );
    expect(getNextOccurrence(t)).toBe('2026-08-19');
  });

  it('is null once the series has ended', () => {
    expect(getNextOccurrence(template({ type: 'daily', startDate: '2026-01-01', endDate: '2026-08-01' })))
      .toBeNull();
    expect(getNextOccurrence(template({ type: 'daily', startDate: '2026-01-01', maxOccurrences: 5 })))
      .toBeNull();
  });

  // The project views treat null as "ended" and hide the series, so a start
  // date beyond the old two-year horizon silently vanished from its project.
  it('finds a series that starts more than two years out', () => {
    expect(getNextOccurrence(template({ type: 'weekly', daysOfWeek: [1], startDate: '2029-06-01' })))
      .toBe('2029-06-04');
  });
});

// 2026-08-19 is a Wednesday (day 3) — the date the picker is editing in these.
const WED = '2026-08-19';

describe('getSelectedWeekdays', () => {
  it('reads an explicit day set, sorted', () => {
    expect(getSelectedWeekdays({ type: 'weekly', daysOfWeek: [5, 1, 3] }, WED)).toEqual([1, 3, 5]);
  });

  it('falls back to the anchor weekday when the set is absent, matching the engine', () => {
    expect(getSelectedWeekdays({ type: 'weekly', startDate: WED }, null)).toEqual([3]);
    expect(getSelectedWeekdays({ type: 'biweekly' }, WED)).toEqual([3]);
  });

  it('is empty for recurrences with no weekday axis', () => {
    for (const rec of [null, { type: 'daily' }, { type: 'monthly', monthDay: 5 }, { type: 'yearly' }]) {
      expect(getSelectedWeekdays(rec, WED)).toEqual([]);
    }
  });

  it('does not mutate the recurrence it reads', () => {
    const rec = { type: 'weekly', daysOfWeek: [5, 1, 3] };
    getSelectedWeekdays(rec, WED);
    expect(rec.daysOfWeek).toEqual([5, 1, 3]);
  });
});

describe('toggleRecurrenceDay', () => {
  it('adds a day, keeping the set sorted', () => {
    expect(toggleRecurrenceDay({ type: 'weekly', daysOfWeek: [1] }, 5, WED))
      .toMatchObject({ type: 'weekly', daysOfWeek: [1, 5] });
  });

  it('removes a day', () => {
    expect(toggleRecurrenceDay({ type: 'weekly', daysOfWeek: [1, 3, 5] }, 3, WED).daysOfWeek)
      .toEqual([1, 5]);
  });

  it('refuses to remove the last day', () => {
    const rec = { type: 'weekly', daysOfWeek: [3] };
    expect(toggleRecurrenceDay(rec, 3, WED)).toBe(rec);
  });

  it('converts a non-weekly recurrence to weekly on that day', () => {
    expect(toggleRecurrenceDay(null, 1, WED)).toMatchObject({ type: 'weekly', daysOfWeek: [1] });
    expect(toggleRecurrenceDay({ type: 'daily' }, 1, WED)).toMatchObject({ type: 'weekly', daysOfWeek: [1] });
  });

  it('stays biweekly when it already was', () => {
    expect(toggleRecurrenceDay({ type: 'biweekly', daysOfWeek: [1] }, 4, WED))
      .toMatchObject({ type: 'biweekly', daysOfWeek: [1, 4] });
  });

  it('keeps end conditions and drops monthly-only fields', () => {
    const out = toggleRecurrenceDay(
      { type: 'monthly', monthDay: 19, monthWeekday: null, endDate: '2027-01-01', maxOccurrences: 12 }, 1, WED);
    expect(out).toMatchObject({ type: 'weekly', daysOfWeek: [1], endDate: '2027-01-01', maxOccurrences: 12 });
    expect(out).not.toHaveProperty('monthDay');
    expect(out).not.toHaveProperty('monthWeekday');
  });

  it('never mutates its input', () => {
    const rec = { type: 'weekly', daysOfWeek: [1] };
    toggleRecurrenceDay(rec, 5, WED);
    expect(rec.daysOfWeek).toEqual([1]);
  });
});

describe('setRecurrenceFrequency', () => {
  it('switches cadence and keeps the days', () => {
    expect(setRecurrenceFrequency({ type: 'weekly', daysOfWeek: [1, 4] }, 'biweekly', WED))
      .toMatchObject({ type: 'biweekly', daysOfWeek: [1, 4] });
  });

  it('seeds from the edited date when there are no days yet', () => {
    expect(setRecurrenceFrequency(null, 'weekly', WED)).toMatchObject({ type: 'weekly', daysOfWeek: [3] });
  });
});

describe('weekdayOrder', () => {
  it('rotates to the user first day of week', () => {
    expect(weekdayOrder(0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(weekdayOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });
});

// The point of the whole feature: what the picker builds must actually fire on
// the days it shows.
describe('a multi-day set the picker can now build', () => {
  it('fires on exactly the chosen days', () => {
    let rec = null;
    for (const dow of [1, 3, 5]) rec = toggleRecurrenceDay(rec, dow, WED);
    const t = template({ ...rec, startDate: '2026-08-17' }); // Monday
    expect(getOccurrencesInRange(t, '2026-08-17', '2026-08-23'))
      .toEqual(['2026-08-17', '2026-08-19', '2026-08-21']);
  });

  it('halves them at biweekly cadence', () => {
    let rec = toggleRecurrenceDay(null, 1, WED);
    rec = toggleRecurrenceDay(rec, 3, WED);
    rec = setRecurrenceFrequency(rec, 'biweekly', WED);
    const t = template({ ...rec, startDate: '2026-08-17' });
    // Mon 17th and Wed 19th fire; the following week is skipped entirely.
    expect(getOccurrencesInRange(t, '2026-08-17', '2026-08-30'))
      .toEqual(['2026-08-17', '2026-08-19']);
  });
});
