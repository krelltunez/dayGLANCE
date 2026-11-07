import { describe, expect, it } from 'vitest';
import { formatTimeRange, timeRange, NEXT_DAY_MARK } from './timeRange.js';

// A card's start–end range (#2278): the end as a real clock time, with the
// next-day mark when it falls on the next date. Before, a 23:00 task of two
// hours read "23:00–25:00" on the phone's LIST card.

// The app's formatTime (App.jsx), both settings.
const clock24 = (time) => time;
const clock12 = (time) => {
  const [h, m] = time.split(':').map(Number);
  return `${h === 0 ? 12 : h > 12 ? h - 12 : h}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
const NB = ' ';

describe('formatTimeRange', () => {
  it('an end past midnight is a real clock time, marked +1', () => {
    expect(formatTimeRange('23:00', 120, clock24)).toBe(`23:00–01:00${NB}+1`);
    expect(formatTimeRange('23:00', 120, clock12)).toBe(`11:00${NB}PM–1:00${NB}AM${NB}+1`);
  });

  it('an ordinary range is unchanged', () => {
    expect(formatTimeRange('09:00', 60, clock24)).toBe('09:00–10:00');
    expect(formatTimeRange('09:00', 60, clock12)).toBe(`9:00${NB}AM–10:00${NB}AM`);
    expect(formatTimeRange('13:30', 45, clock24)).toBe('13:30–14:15');
  });

  it('an end exactly at midnight is 00:00 of the next day, not 24:00', () => {
    expect(formatTimeRange('23:00', 60, clock24)).toBe(`23:00–00:00${NB}+1`);
    expect(formatTimeRange('23:00', 60, clock12)).toBe(`11:00${NB}PM–12:00${NB}AM${NB}+1`);
  });

  it('takes a separator, and falls back to the start without a readable one', () => {
    expect(formatTimeRange('22:30', 120, clock24, { separator: ' - ' })).toBe(`22:30 - 00:30${NB}+1`);
    expect(formatTimeRange('', 30, clock24)).toBe('');
    expect(formatTimeRange('later', 30, clock24)).toBe('later');
  });
});

describe('timeRange', () => {
  it('gives the clock times and whether the end is on the next date', () => {
    expect(timeRange('23:00', 120)).toEqual({ startTime: '23:00', endTime: '01:00', nextDay: true });
    expect(timeRange('08:00', 30)).toEqual({ startTime: '08:00', endTime: '08:30', nextDay: false });
    expect(timeRange(null, 30)).toBeNull();
    expect(NEXT_DAY_MARK).toBe('+1');
  });
});
