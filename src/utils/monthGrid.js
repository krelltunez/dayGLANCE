// Month grid date math. Pure: no React, no locale, no data. The grid
// component (components/month/MonthGrid.jsx) maps these onto cells.
//
// A month is laid out as whole weeks starting on the app's week-start day:
// leading days from the previous month, the month itself, trailing days from
// the next, always a multiple of seven. Four, five or six rows depending on
// the month's length and where its first day falls.

import { localDateStr, shiftDateStr, weekdayOrder } from '@glance-apps/agenda-core';

/** Days in a month; month is 1..12. Leap years fall out of Date's own arithmetic. */
export const daysInMonth = (year, month) => new Date(year, month, 0).getDate();

/** The month before or after: { year, month } with month 1..12. */
export function shiftMonth(year, month, delta) {
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/** { year, month } of a YYYY-MM-DD, or of a Date. */
export function monthOf(dateOrStr) {
  if (typeof dateOrStr === 'string') return { year: Number(dateOrStr.slice(0, 4)), month: Number(dateOrStr.slice(5, 7)) };
  return { year: dateOrStr.getFullYear(), month: dateOrStr.getMonth() + 1 };
}

/**
 * Every cell of the grid for one month.
 *
 * @param {number} year
 * @param {number} month        1..12
 * @param {number} weekStartDay 0 (Sunday) .. 6 (Saturday), the app's setting
 * @returns {{
 *   rows: number,
 *   leading: number, trailing: number,
 *   weekdays: number[],            // the seven column weekdays, in order
 *   cells: Array<{ dateStr: string, inMonth: boolean, weekday: number, day: number }>,
 * }}
 */
export function monthGridDates(year, month, weekStartDay = 0) {
  const first = new Date(year, month - 1, 1);
  const count = daysInMonth(year, month);
  const leading = (first.getDay() - weekStartDay + 7) % 7;
  const rows = Math.ceil((leading + count) / 7);
  const trailing = rows * 7 - leading - count;
  const firstStr = localDateStr(first);
  const startStr = shiftDateStr(firstStr, -leading);
  const cells = [];
  for (let i = 0; i < rows * 7; i++) {
    const dateStr = i === 0 ? startStr : shiftDateStr(startStr, i);
    const inMonth = i >= leading && i < leading + count;
    cells.push({ dateStr, inMonth, weekday: (weekStartDay + i) % 7, day: Number(dateStr.slice(8, 10)) });
  }
  return { rows, leading, trailing, weekdays: weekdayOrder(weekStartDay), cells };
}

/**
 * Cell size for a measured grid area: seven columns across the width, the
 * month's rows down the height. Cells never grow wider than they are tall
 * nor past the absolute cap (the timeline encoding assumes a portrait cell,
 * so on a wide display the grid stops stretching and centres), and rows
 * never shrink below the minimum height (the area scrolls instead).
 */
export function monthCellSize(areaWidth, areaHeight, rows, { cell }) {
  const height = Math.max(cell.minHeight, Math.floor(areaHeight / Math.max(1, rows)));
  const width = Math.max(1, Math.min(Math.floor(areaWidth / 7), Math.floor(height * cell.maxAspect), cell.maxWidth));
  return { width, height, scrolls: height * rows > areaHeight };
}
