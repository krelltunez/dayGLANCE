import { describe, expect, it } from 'vitest';
import { rangeBetween, rangeOverlapsFrame } from './timelineRange.js';

const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

describe('rangeBetween (#2366)', () => {
  it('dragging down runs from the pressed slot to the end of the slot under the pointer', () => {
    expect(rangeBetween(9 * 60 + 5, 10 * 60 + 20)).toEqual({ start: 540, end: 630 }); // 09:00–10:30
  });

  it('dragging up runs from the slot under the pointer to the end of the pressed slot', () => {
    expect(rangeBetween(10 * 60 + 20, 9 * 60 + 5)).toEqual({ start: 540, end: 630 });
  });

  it('a range always holds the pressed slot: never shorter than 15 minutes', () => {
    expect(rangeBetween(540 + 7, 540 + 8)).toEqual({ start: 540, end: 555 });
    expect(rangeBetween(540 + 14, 540)).toEqual({ start: 540, end: 555 });
  });

  it('stays inside the column it started in', () => {
    // A DAY column from 08:00 to 16:00.
    expect(rangeBetween(15 * 60, 20 * 60, { min: 480, max: 960 })).toEqual({ start: 900, end: 960 });
    expect(rangeBetween(9 * 60, 2 * 60, { min: 480, max: 960 })).toEqual({ start: 480, end: 555 });
    // A whole day ends at midnight, not past it.
    expect(rangeBetween(23 * 60 + 50, 26 * 60)).toEqual({ start: 1425, end: 1440 });
  });

  it('a press in the column\'s last slot keeps a full slot', () => {
    expect(rangeBetween(959, 959, { min: 480, max: 960 })).toEqual({ start: 945, end: 960 });
  });
});

describe('rangeOverlapsFrame', () => {
  const frames = [{ start: '09:00', end: '11:00' }];
  it('a range that runs into a frame overlaps it; one that only touches it does not', () => {
    expect(rangeOverlapsFrame({ start: 600, end: 720 }, frames, toMin)).toBe(true);
    expect(rangeOverlapsFrame({ start: 480, end: 540 }, frames, toMin)).toBe(false);
    expect(rangeOverlapsFrame({ start: 660, end: 720 }, frames, toMin)).toBe(false);
    expect(rangeOverlapsFrame({ start: 600, end: 630 }, [], toMin)).toBe(false);
  });
});
