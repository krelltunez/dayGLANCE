import { describe, it, expect } from 'vitest';
import { computeRecurringExpansionRange } from './recurringExpansionRange.js';
import { WIDGET_PROJECTION_DAYS } from './widgetDayProjection.js';
import { WIDGET_MONTH_PAYLOAD_DAYS } from './widgetMonthWindow.js';

// Local noon, so day arithmetic never crosses a DST boundary by accident.
const d = (y, m, day) => new Date(y, m - 1, day, 12);
const TODAY = d(2026, 9, 18);
const plus = (date, n) => d(date.getFullYear(), date.getMonth() + 1, date.getDate() + n);

describe('computeRecurringExpansionRange', () => {
  it('always covers today', () => {
    const r = computeRecurringExpansionRange({
      visibleDates: [d(2026, 10, 5)], selectedDate: d(2026, 10, 5), schedDaysShown: 1, today: TODAY,
    });
    expect(r.rangeStart <= '2026-09-18' && '2026-09-18' <= r.rangeEnd).toBe(true);
  });

  // (a) the projection horizon exists when the user is looking at today.
  it('covers today + N when the visible range is today', () => {
    const r = computeRecurringExpansionRange({
      visibleDates: [TODAY], selectedDate: TODAY, schedDaysShown: 1, today: TODAY,
    });
    for (let i = 1; i <= WIDGET_PROJECTION_DAYS; i++) {
      const s = plus(TODAY, i).toISOString().slice(0, 10);
      expect(s <= r.rangeEnd, `today+${i} (${s}) must be inside … ${r.rangeEnd}`).toBe(true);
    }
  });

  // (b) THE trigger condition: the user is parked on last week, the SCHED
  // window is short, nothing they are looking at reaches tomorrow. Without
  // the second anchor this returned rangeEnd = today, and the projected
  // days had no recurring instances.
  it('covers today + N when the visible range is entirely BEHIND today', () => {
    const lastWeek = plus(TODAY, -9);
    const r = computeRecurringExpansionRange({
      visibleDates: [lastWeek, plus(lastWeek, 1), plus(lastWeek, 2)],
      weekViewDates: [],
      selectedDate: lastWeek,
      schedDaysShown: 3,
      today: TODAY,
    });
    // The day before the earliest date, for its overnight spill (#2278):
    // the month grid's first possible cell (26 Aug) is earlier than last week.
    expect(r.rangeStart).toBe('2026-08-25');
    // today + N is inside; the end itself is the widget month window's last
    // payload day (Sun 13 Sep + 48), which reaches further.
    expect('2026-09-21' <= r.rangeEnd).toBe(true);
    expect(r.rangeEnd).toBe('2026-10-31');
  });

  // (c) symmetric: parked far ahead, the range still reaches back to today
  // and the horizon is inside it regardless.
  it('covers today and today + N when the visible range is entirely AHEAD of today', () => {
    const nextMonth = plus(TODAY, 30);
    const r = computeRecurringExpansionRange({
      visibleDates: [nextMonth], selectedDate: nextMonth, schedDaysShown: 1, today: TODAY,
    });
    // Back to the month grid's first possible cell (six days before the
    // 1st), and the day before it.
    expect(r.rangeStart).toBe('2026-08-25');
    expect(r.rangeEnd).toBe('2026-10-31');
  });

  // GLANCElauncher draws today's whole month grid from the snapshot. Late in
  // the month the widget window starts weeks after the 1st; the grid's
  // first cell must still have its recurring occurrences.
  it('reaches back to the first cell of today\'s month grid late in the month', () => {
    const late = d(2026, 11, 28);
    const r = computeRecurringExpansionRange({ visibleDates: [late], selectedDate: late, schedDaysShown: 1, today: late });
    // 1 Nov minus six days is 26 Oct, and the day before it.
    expect(r.rangeStart).toBe('2026-10-25');
  });

  it('keeps the SCHED rolling window and month range as before', () => {
    const r = computeRecurringExpansionRange({
      visibleDates: [TODAY],
      monthViewRange: { from: '2026-08-31', to: '2026-10-04' },
      selectedDate: TODAY,
      schedDaysShown: 14,
      today: TODAY,
    });
    // The month grid's first possible cell (26 Aug) opens it, not the month range.
    expect(r.rangeStart).toBe('2026-08-25');
    // The month range is still covered; the month window runs past it.
    expect('2026-10-04' <= r.rangeEnd).toBe(true);
    expect(r.rangeEnd).toBe('2026-10-31');
  });

  it('honours a different projection horizon', () => {
    // Past the month window's end, so the horizon is what sets rangeEnd.
    const r = computeRecurringExpansionRange({ selectedDate: TODAY, schedDaysShown: 1, today: TODAY, projectionDays: 60 });
    expect(r.rangeEnd).toBe('2026-11-17');
  });

  // The widget month window: the week containing today (by weekStartDay)
  // through the last payload day, whatever the user is looking at.
  describe('widget month window anchor', () => {
    it.each([
      [0, '2026-09-13'], // Sunday weeks: Fri 18 Sep → Sun 13 Sep
      [1, '2026-09-14'], // Monday weeks: → Mon 14 Sep
    ])('weekStartDay %i covers %s … +%s', (weekStartDay, start) => {
      const r = computeRecurringExpansionRange({
        visibleDates: [TODAY], selectedDate: TODAY, schedDaysShown: 1, today: TODAY, weekStartDay,
      });
      const [y, m, dd] = start.split('-').map(Number);
      const end = plus(d(y, m, dd), WIDGET_MONTH_PAYLOAD_DAYS - 1).toISOString().slice(0, 10);
      // The range opens by the day before the window, for its overnight
      // spill (the month grid's first cell reaches further back here).
      expect(r.rangeStart <= plus(d(y, m, dd), -1).toISOString().slice(0, 10)).toBe(true);
      expect(r.rangeEnd).toBe(end);
    });

    it('holds when the user is parked on last month', () => {
      const r = computeRecurringExpansionRange({
        visibleDates: [plus(TODAY, -40)], selectedDate: plus(TODAY, -40), schedDaysShown: 1, today: TODAY, weekStartDay: 1,
      });
      expect(r.rangeEnd).toBe('2026-11-01'); // Mon 14 Sep + 48
    });
  });
});
