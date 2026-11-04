// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { recurrenceToWire } from '../src/repeat.js';

// The round trip through the write side's parseRepeat is tested with it
// (electron/mcpRepeatArgs.test.ts), where the write tools live for now.

describe('recurrenceToWire', () => {
  it('spells out the engine defaults taken from the start date', () => {
    // 2026-10-12 is a Monday.
    expect(recurrenceToWire({ type: 'weekly', startDate: '2026-10-12' }))
      .toEqual({ frequency: 'weekly', days_of_week: ['mon']});
    expect(recurrenceToWire({ type: 'monthly', monthDay: null, monthWeekday: null, startDate: '2026-10-12' }))
      .toEqual({ frequency: 'monthly', day_of_month: 12});
  });

  it('reports the nth weekday, the end and the count', () => {
    expect(recurrenceToWire({
      type: 'monthly', monthDay: null, monthWeekday: { week: 2, day: 1 },
      endDate: '2027-06-30', maxOccurrences: 8, startDate: '2026-10-12',
    })).toEqual({
      frequency: 'monthly', nth_weekday: { week: 2, day: 'mon' }, until: '2027-06-30', count: 8
    });
  });

  it('is null without a pattern', () => {
    expect(recurrenceToWire(undefined)).toBeNull();
    expect(recurrenceToWire({})).toBeNull();
  });
});
