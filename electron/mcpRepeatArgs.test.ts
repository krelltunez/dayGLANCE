import { describe, it, expect } from 'vitest';
import { parseRepeat, MAX_REPEAT_COUNT } from './mcpRepeatArgs.js';
import { recurrenceToWire } from '@glance-apps/dayglance-mcp';

// The repeat argument (#2066). Every pattern the app can repeat on is
// accepted and stored exactly as the editor's presets store it; everything
// else is a typed validation error that reads as design, never "unsupported".

const TUE = '2026-10-13'; // a Tuesday, the 13th
const ok = (repeat: unknown, anchor = TUE) => {
  const r = parseRepeat(repeat, anchor);
  if (!r.ok) throw new Error(r.message);
  return r.recurrence;
};
const fail = (repeat: unknown, anchor = TUE) => {
  const r = parseRepeat(repeat, anchor);
  expect(r.ok).toBe(false);
  return r.ok ? '' : r.message;
};

describe('parseRepeat — the patterns the app repeats on', () => {
  it('daily and yearly need nothing else', () => {
    expect(ok({ frequency: 'daily' })).toEqual({ type: 'daily' });
    expect(ok({ frequency: 'yearly' })).toEqual({ type: 'yearly' });
  });

  it('weekly and biweekly default to the anchor\'s weekday, as the editor\'s preset does', () => {
    expect(ok({ frequency: 'weekly' })).toEqual({ type: 'weekly', daysOfWeek: [2] });
    expect(ok({ frequency: 'biweekly' })).toEqual({ type: 'biweekly', daysOfWeek: [2] });
  });

  it('days_of_week take weekday names, deduplicated and sorted', () => {
    expect(ok({ frequency: 'weekly', days_of_week: ['fri', 'mon', 'WED', 'mon'] })).toEqual({ type: 'weekly', daysOfWeek: [1, 3, 5] });
  });

  it('monthly defaults to the anchor\'s day of the month', () => {
    expect(ok({ frequency: 'monthly' })).toEqual({ type: 'monthly', monthDay: 13, monthWeekday: null });
    expect(ok({ frequency: 'monthly', day_of_month: 31 })).toEqual({ type: 'monthly', monthDay: 31, monthWeekday: null });
  });

  it('monthly on the nth weekday', () => {
    expect(ok({ frequency: 'monthly', nth_weekday: { week: 2, day: 'tue' } }))
      .toEqual({ type: 'monthly', monthDay: null, monthWeekday: { week: 2, day: 2 } });
  });

  it('until and count end the series', () => {
    expect(ok({ frequency: 'daily', until: '2026-12-31' })).toEqual({ type: 'daily', endDate: '2026-12-31' });
    expect(ok({ frequency: 'daily', count: 10 })).toEqual({ type: 'daily', maxOccurrences: 10 });
    expect(ok({ frequency: 'daily', until: TUE })).toEqual({ type: 'daily', endDate: TUE });
  });
});

describe('parseRepeat — by-design and shape rejections', () => {
  it('interval is rejected by design, naming what the app does repeat on', () => {
    const msg = fail({ frequency: 'monthly', interval: 3 });
    expect(msg).toMatch(/no interval by design/);
    expect(msg).toMatch(/biweekly/);
  });

  it('a non-object or an unknown field is a validation error', () => {
    expect(fail('weekly')).toMatch(/must be an object/);
    expect(fail(null)).toMatch(/must be an object/);
    expect(fail(['weekly'])).toMatch(/must be an object/);
    expect(fail({ frequency: 'daily', every: 2 })).toMatch(/does not take "every"/);
  });

  it('frequency must be one the app supports', () => {
    for (const frequency of [undefined, 'hourly', 'fortnightly', 7]) {
      expect(fail({ frequency })).toMatch(/daily, weekly, biweekly, monthly, yearly/);
    }
  });

  it('fields that belong to another frequency are rejected', () => {
    expect(fail({ frequency: 'daily', days_of_week: ['mon'] })).toMatch(/weekly and biweekly only/);
    expect(fail({ frequency: 'weekly', day_of_month: 3 })).toMatch(/monthly only/);
    expect(fail({ frequency: 'yearly', nth_weekday: { week: 1, day: 'mon' } })).toMatch(/monthly only/);
    expect(fail({ frequency: 'monthly', day_of_month: 3, nth_weekday: { week: 1, day: 'mon' } })).toMatch(/contradict/);
  });

  it('bad days, weeks and month days are rejected with the accepted range', () => {
    expect(fail({ frequency: 'weekly', days_of_week: [] })).toMatch(/non-empty array/);
    expect(fail({ frequency: 'weekly', days_of_week: ['monday'] })).toMatch(/sun, mon, tue/);
    expect(fail({ frequency: 'weekly', days_of_week: [1] })).toMatch(/sun, mon, tue/);
    expect(fail({ frequency: 'monthly', day_of_month: 0 })).toMatch(/1-31/);
    expect(fail({ frequency: 'monthly', day_of_month: 32 })).toMatch(/1-31/);
    expect(fail({ frequency: 'monthly', nth_weekday: { week: 6, day: 'mon' } })).toMatch(/1-5/);
    expect(fail({ frequency: 'monthly', nth_weekday: { week: -1, day: 'mon' } })).toMatch(/no "last"/);
    expect(fail({ frequency: 'monthly', nth_weekday: { week: 1, day: 'x' } })).toMatch(/sun, mon/);
  });

  it('until must be a real date on or after the anchor; count a bounded positive integer', () => {
    expect(fail({ frequency: 'daily', until: '2026-02-30' })).toMatch(/strict YYYY-MM-DD/);
    expect(fail({ frequency: 'daily', until: '2026-10-12' })).toMatch(/before 2026-10-13/);
    for (const count of [0, -1, 1.5, '3', MAX_REPEAT_COUNT + 1]) {
      expect(fail({ frequency: 'daily', count })).toMatch(/count must be an integer/);
    }
  });
});

// recurrenceToWire (@glance-apps/dayglance-mcp) is the read side's inverse of
// parseRepeat: what dayglance_get_day shows for a series is what the write
// tools accept back.
describe('recurrenceToWire round trip', () => {
  // What the read surface reports must be accepted back unchanged by the write
  // surface, and mean the same pattern.
  it.each([
    [{ frequency: 'daily' }],
    [{ frequency: 'weekly', days_of_week: ['mon', 'wed', 'fri'] }],
    [{ frequency: 'biweekly', days_of_week: ['tue'], until: '2027-01-01' }],
    [{ frequency: 'monthly', day_of_month: 31, count: 12 }],
    [{ frequency: 'monthly', nth_weekday: { week: 5, day: 'fri' } }],
    [{ frequency: 'yearly' }],
  ])('round-trips %j through parseRepeat', (repeat) => {
    const anchor = '2026-10-12';
    const parsed = parseRepeat(repeat, anchor);
    expect(parsed.ok).toBe(true);
    const wire = recurrenceToWire({ ...parsed.recurrence, startDate: anchor });
    const again = parseRepeat(wire, anchor);
    expect(again).toEqual(parsed);
  });
});
