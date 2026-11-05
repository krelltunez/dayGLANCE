import { describe, it, expect } from 'vitest';
import { expandRecurringTasks } from './expandRecurringTasks.js';
import { computeRecurringExpansionRange } from './recurringExpansionRange.js';

// #2278: an occurrence that starts yesterday and runs past midnight is still
// today's business, so the expansion keeps it (uncompleted) for today, the
// way it keeps today's own. Every other past uncompleted timed occurrence is
// still dropped.
const TODAY = '2026-11-04';
const YESTERDAY = '2026-11-03';
const series = (patch = {}) => ({
  id: 's1', title: 'Night shift', startTime: '23:00', duration: 120, isAllDay: false,
  recurrence: { type: 'daily', startDate: '2026-11-01' }, ...patch,
});
const expand = (templates) => expandRecurringTasks(templates, { rangeStart: '2026-11-02', rangeEnd: TODAY, today: TODAY })
  .map((t) => t.id);

describe('expandRecurringTasks: overnight occurrences', () => {
  it('keeps yesterday\'s uncompleted occurrence that crosses midnight', () => {
    expect(expand([series()])).toEqual([`recurring-s1-${YESTERDAY}`, `recurring-s1-${TODAY}`]);
  });

  it('drops it when it ends at or before midnight, as before', () => {
    expect(expand([series({ duration: 60 })])).toEqual([`recurring-s1-${TODAY}`]);
  });

  it('follows that date\'s exception: an occurrence moved to end before midnight is dropped', () => {
    expect(expand([series({ exceptions: { [YESTERDAY]: { startTime: '20:00' } } })])).toEqual([`recurring-s1-${TODAY}`]);
  });

  it('follows that date\'s exception: an occurrence lengthened past midnight is kept', () => {
    expect(expand([series({ duration: 60, exceptions: { [YESTERDAY]: { duration: 90 } } })]))
      .toEqual([`recurring-s1-${YESTERDAY}`, `recurring-s1-${TODAY}`]);
  });

  it('never keeps an older one', () => {
    expect(expand([series()]).includes('recurring-s1-2026-11-02')).toBe(false);
  });
});

describe('computeRecurringExpansionRange opens the day before the earliest date', () => {
  it('so the first day shown gets the previous night\'s continuation', () => {
    const at = (s) => new Date(`${s}T12:00:00`);
    const r = computeRecurringExpansionRange({
      visibleDates: [at('2026-10-20')], selectedDate: at('2026-10-20'), schedDaysShown: 1, today: at(TODAY),
    });
    expect(r.rangeStart).toBe('2026-10-19');
  });
});
