import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { getOccurrencesInRange, getNextOccurrence } from './recurrenceEngine.js';

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
