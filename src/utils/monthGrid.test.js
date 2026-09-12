import { describe, it, expect } from 'vitest';
import { daysInMonth, shiftMonth, monthOf, monthGridDates, monthCellSize } from './monthGrid.js';
import { MONTH_CELL_LAYOUT } from '../constants/monthView.js';

const ids = (g) => g.cells.map((c) => c.dateStr);

describe('daysInMonth and leap years', () => {
  it('knows the month lengths', () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 2)).toBe(28);
  });
  it('handles leap years, including the century rules', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
  });
});

describe('shiftMonth and monthOf', () => {
  it('crosses year boundaries in both directions', () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth(2026, 9, 0)).toEqual({ year: 2026, month: 9 });
    expect(shiftMonth(2026, 9, 15)).toEqual({ year: 2027, month: 12 });
  });
  it('reads a month from a string or a Date', () => {
    expect(monthOf('2026-09-16')).toEqual({ year: 2026, month: 9 });
    expect(monthOf(new Date(2026, 0, 31))).toEqual({ year: 2026, month: 1 });
  });
});

describe('monthGridDates', () => {
  it('lays out September 2026 (starts Tuesday) as five rows with two leading and three trailing days', () => {
    const g = monthGridDates(2026, 9, 0);
    expect(g.rows).toBe(5);
    expect(g.leading).toBe(2);
    expect(g.trailing).toBe(3);
    expect(g.cells).toHaveLength(35);
    expect(ids(g).slice(0, 3)).toEqual(['2026-08-30', '2026-08-31', '2026-09-01']);
    expect(ids(g).slice(-4)).toEqual(['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']);
    expect(g.cells.filter((c) => c.inMonth)).toHaveLength(30);
    expect(g.cells[0]).toEqual({ dateStr: '2026-08-30', inMonth: false, weekday: 0, day: 30 });
    expect(g.cells[2]).toEqual({ dateStr: '2026-09-01', inMonth: true, weekday: 2, day: 1 });
  });

  it('gives a 28-day month that starts on the week-start day exactly four rows', () => {
    const g = monthGridDates(2026, 2, 0); // Feb 2026 starts on a Sunday
    expect(g.rows).toBe(4);
    expect(g.leading).toBe(0);
    expect(g.trailing).toBe(0);
    expect(ids(g)[0]).toBe('2026-02-01');
    expect(ids(g)[27]).toBe('2026-02-28');
  });

  it('gives a 31-day month starting late in the week six rows', () => {
    const g = monthGridDates(2026, 8, 0); // Aug 2026 starts on a Saturday
    expect(g.rows).toBe(6);
    expect(g.leading).toBe(6);
    expect(g.trailing).toBe(5);
    expect(g.cells).toHaveLength(42);
  });

  it('follows the week-start setting', () => {
    const sunday = monthGridDates(2026, 8, 0);
    const monday = monthGridDates(2026, 8, 1);
    const saturday = monthGridDates(2026, 8, 6);
    expect(sunday.weekdays).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(monday.weekdays).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(saturday.weekdays).toEqual([6, 0, 1, 2, 3, 4, 5]);
    // Aug 1 2026 is a Saturday: no leading days for a Saturday-start week.
    expect(saturday.leading).toBe(0);
    expect(saturday.rows).toBe(5);
    expect(monday.leading).toBe(5);
    expect(monday.rows).toBe(6);
    expect(ids(monday)[0]).toBe('2026-07-27');
    for (const g of [sunday, monday, saturday]) {
      expect(g.cells.every((c, i) => c.weekday === g.weekdays[i % 7])).toBe(true);
    }
  });

  it('handles a leap-year February', () => {
    const g = monthGridDates(2024, 2, 0); // starts Thursday, 29 days
    expect(g.rows).toBe(5);
    expect(g.leading).toBe(4);
    expect(g.cells.filter((c) => c.inMonth)).toHaveLength(29);
    expect(ids(g)).toContain('2024-02-29');
    expect(ids(g)[g.leading + 29]).toBe('2024-03-01');
  });

  it('pulls leading days from the previous year and trailing days from the next', () => {
    const jan = monthGridDates(2026, 1, 0); // starts Thursday
    expect(ids(jan).slice(0, 4)).toEqual(['2025-12-28', '2025-12-29', '2025-12-30', '2025-12-31']);
    const dec = monthGridDates(2026, 12, 0); // starts Tuesday, 31 days: 2 + 31 = 33 -> 5 rows, 2 trailing
    expect(dec.rows).toBe(5);
    expect(ids(dec).slice(-2)).toEqual(['2027-01-01', '2027-01-02']);
  });

  it('always yields whole weeks and contiguous dates', () => {
    for (let month = 1; month <= 12; month++) {
      for (const ws of [0, 1, 6]) {
        const g = monthGridDates(2026, month, ws);
        expect(g.cells.length % 7).toBe(0);
        expect(g.cells.length).toBe(g.rows * 7);
        expect(g.leading + g.cells.filter((c) => c.inMonth).length + g.trailing).toBe(g.cells.length);
        for (let i = 1; i < g.cells.length; i++) {
          const prev = new Date(`${g.cells[i - 1].dateStr}T12:00:00`);
          const cur = new Date(`${g.cells[i].dateStr}T12:00:00`);
          expect(Math.round((cur - prev) / 86400000)).toBe(1);
        }
      }
    }
  });
});

describe('monthCellSize', () => {
  const C = MONTH_CELL_LAYOUT;
  it('divides the area into seven columns and the month rows, never wider than tall', () => {
    expect(monthCellSize(1120, 700, 5, C)).toEqual({ width: 140, height: 140, scrolls: false });
    expect(monthCellSize(371, 480, 5, C)).toEqual({ width: 53, height: 96, scrolls: false });
  });
  it('caps cell width on a wide display instead of stretching', () => {
    // 2560px wide, 250px rows: the old 1.25 aspect allowed 312px; now the
    // absolute cap wins and the grid centres at 7 × 200.
    expect(monthCellSize(2560, 1250, 5, C)).toEqual({ width: C.cell.maxWidth, height: 250, scrolls: false });
    expect(monthCellSize(2560, 700, 5, C).width).toBe(140);
  });
  it('keeps six-row months usable by holding a minimum height and scrolling', () => {
    const s = monthCellSize(1120, 300, 6, C);
    expect(s.height).toBe(C.cell.minHeight);
    expect(s.scrolls).toBe(true);
    expect(monthCellSize(1120, 900, 6, C).scrolls).toBe(false);
  });
});
