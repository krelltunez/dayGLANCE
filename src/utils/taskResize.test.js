import { describe, it, expect } from 'vitest';
import {
  pixelsToSnappedMinutes, resizeBlock, resizeBlockByPixels,
  RESIZE_SNAP_MINUTES, MIN_BLOCK_MINUTES,
} from './taskResize.js';

// MULTI's hour row: 160px of content plus a 1px border (useDragDrop's
// getHourHeight fallback, and what it measures at 100% zoom).
const ROW = 161;

describe('pixelsToSnappedMinutes', () => {
  it('converts at the hour height it is given', () => {
    expect(pixelsToSnappedMinutes(ROW, ROW)).toBe(60);
    expect(pixelsToSnappedMinutes(-ROW, ROW)).toBe(-60);
    expect(pixelsToSnappedMinutes(ROW / 2, ROW)).toBe(30);
    expect(pixelsToSnappedMinutes(100, 100)).toBe(60);
    expect(pixelsToSnappedMinutes(200, 100)).toBe(120);
  });

  // #2273: the handlers used a fixed 80px per hour, so on MULTI's 161px rows
  // an edge moved two hours for every hour the pointer did.
  it('one rendered hour of pointer travel is one hour, not two (the 80px bug)', () => {
    expect(pixelsToSnappedMinutes(ROW, ROW)).not.toBe(120);
    expect(pixelsToSnappedMinutes(80, ROW)).toBe(30);
    // Zoomed rows (2x) and a DAY column (~100px) each convert at their own height.
    expect(pixelsToSnappedMinutes(321, 321)).toBe(60);
    expect(pixelsToSnappedMinutes(100, 100)).toBe(60);
  });

  it('snaps the drag to 15-minute steps, rounding to the nearest', () => {
    // 15 minutes on a 161px row is ~40px.
    expect(pixelsToSnappedMinutes(19, ROW)).toBe(0);
    expect(pixelsToSnappedMinutes(21, ROW)).toBe(15);
    expect(pixelsToSnappedMinutes(-21, ROW)).toBe(-15);
    expect(pixelsToSnappedMinutes(60, ROW)).toBe(15);
    expect(pixelsToSnappedMinutes(61, ROW)).toBe(30);
    for (const px of [-500, -77, -3, 0, 5, 33, 99, 400]) {
      expect(Math.abs(pixelsToSnappedMinutes(px, ROW)) % RESIZE_SNAP_MINUTES).toBe(0);
    }
  });

  it('a small upward drag is 0, not -0', () => {
    expect(Object.is(pixelsToSnappedMinutes(-3, ROW), 0)).toBe(true);
  });

  it('an unusable hour height or delta moves nothing', () => {
    expect(pixelsToSnappedMinutes(100, 0)).toBe(0);
    expect(pixelsToSnappedMinutes(100, undefined)).toBe(0);
    expect(pixelsToSnappedMinutes(100, NaN)).toBe(0);
    expect(pixelsToSnappedMinutes(NaN, ROW)).toBe(0);
  });
});

describe('resizeBlock: bottom edge', () => {
  const nine = 9 * 60;

  // #2278: the end may lie past midnight (the next date draws it), so the only
  // limit is the editor's whole-day cap.
  it('runs past midnight, up to a whole day and no further', () => {
    expect(resizeBlock({ startMinutes: 23 * 60, duration: 60, edge: 'bottom', deltaMinutes: 60 }))
      .toEqual({ startMinutes: 23 * 60, duration: 120 });
    expect(resizeBlock({ startMinutes: 8 * 60, duration: 23 * 60, edge: 'bottom', deltaMinutes: 120 }))
      .toEqual({ startMinutes: 8 * 60, duration: 24 * 60 });
  });

  it('an imported block already longer than a day can shrink but not grow', () => {
    expect(resizeBlock({ startMinutes: nine, duration: 3000, edge: 'bottom', deltaMinutes: 60 }))
      .toEqual({ startMinutes: nine, duration: 3000 });
    expect(resizeBlock({ startMinutes: nine, duration: 3000, edge: 'bottom', deltaMinutes: -60 }))
      .toEqual({ startMinutes: nine, duration: 2940 });
  });

  it('moves the end and keeps the start', () => {
    expect(resizeBlock({ startMinutes: nine, duration: 60, edge: 'bottom', deltaMinutes: 30 }))
      .toEqual({ startMinutes: nine, duration: 90 });
    expect(resizeBlock({ startMinutes: nine, duration: 60, edge: 'bottom', deltaMinutes: -30 }))
      .toEqual({ startMinutes: nine, duration: 30 });
  });

  it('never drops below the minimum duration', () => {
    expect(resizeBlock({ startMinutes: nine, duration: 60, edge: 'bottom', deltaMinutes: -600 }))
      .toEqual({ startMinutes: nine, duration: MIN_BLOCK_MINUTES });
  });

  it('a block already under the minimum stays put until it grows', () => {
    expect(resizeBlock({ startMinutes: nine, duration: 5, edge: 'bottom', deltaMinutes: 0 }))
      .toEqual({ startMinutes: nine, duration: 5 });
    expect(resizeBlock({ startMinutes: nine, duration: 5, edge: 'bottom', deltaMinutes: -15 }))
      .toEqual({ startMinutes: nine, duration: 5 });
    expect(resizeBlock({ startMinutes: nine, duration: 5, edge: 'bottom', deltaMinutes: 15 }))
      .toEqual({ startMinutes: nine, duration: 20 });
  });

  it('is the default edge', () => {
    expect(resizeBlock({ startMinutes: nine, duration: 60, deltaMinutes: 15 }))
      .toEqual({ startMinutes: nine, duration: 75 });
  });
});

describe('resizeBlock: top edge', () => {
  const nine = 9 * 60;
  const endOf = ({ startMinutes, duration }) => startMinutes + duration;

  it('never makes the block longer than a whole day (#2278)', () => {
    // 08:00 for 23h ends at 07:00 the next day; the start can move up to 07:00.
    expect(resizeBlock({ startMinutes: 8 * 60, duration: 23 * 60, edge: 'top', deltaMinutes: -180 }))
      .toEqual({ startMinutes: 7 * 60, duration: 24 * 60 });
  });

  it('moves the start and keeps the end, so the duration changes inversely', () => {
    const up = resizeBlock({ startMinutes: nine, duration: 60, edge: 'top', deltaMinutes: -30 });
    expect(up).toEqual({ startMinutes: nine - 30, duration: 90 });
    expect(endOf(up)).toBe(10 * 60);

    const down = resizeBlock({ startMinutes: nine, duration: 60, edge: 'top', deltaMinutes: 30 });
    expect(down).toEqual({ startMinutes: nine + 30, duration: 30 });
    expect(endOf(down)).toBe(10 * 60);
  });

  it('stops the minimum duration short of the end', () => {
    const r = resizeBlock({ startMinutes: nine, duration: 60, edge: 'top', deltaMinutes: 600 });
    expect(r).toEqual({ startMinutes: 10 * 60 - MIN_BLOCK_MINUTES, duration: MIN_BLOCK_MINUTES });
  });

  it('never starts before 00:00', () => {
    const r = resizeBlock({ startMinutes: 60, duration: 30, edge: 'top', deltaMinutes: -240 });
    expect(r).toEqual({ startMinutes: 0, duration: 90 });
  });

  it('a block already under the minimum can grow upward but not shrink', () => {
    expect(resizeBlock({ startMinutes: nine, duration: 5, edge: 'top', deltaMinutes: 0 }))
      .toEqual({ startMinutes: nine, duration: 5 });
    expect(resizeBlock({ startMinutes: nine, duration: 5, edge: 'top', deltaMinutes: 15 }))
      .toEqual({ startMinutes: nine, duration: 5 });
    expect(resizeBlock({ startMinutes: nine, duration: 5, edge: 'top', deltaMinutes: -15 }))
      .toEqual({ startMinutes: nine - 15, duration: 20 });
  });

  it('keeps an off-grid start\'s offset, moving it in whole steps', () => {
    // An imported 9:10-10:00 event, dragged up one step.
    expect(resizeBlock({ startMinutes: nine + 10, duration: 50, edge: 'top', deltaMinutes: -15 }))
      .toEqual({ startMinutes: nine - 5, duration: 65 });
  });
});

describe('resizeBlockByPixels', () => {
  it('drives both edges at the rendered hour height', () => {
    expect(resizeBlockByPixels({ startMinutes: 540, duration: 60, edge: 'bottom', deltaY: ROW, hourHeight: ROW }))
      .toEqual({ startMinutes: 540, duration: 120 });
    expect(resizeBlockByPixels({ startMinutes: 540, duration: 60, edge: 'top', deltaY: -ROW, hourHeight: ROW }))
      .toEqual({ startMinutes: 480, duration: 120 });
  });

  // The 80px bug, end to end: half a rendered hour of pointer travel used
  // to add a whole hour.
  it('half a 161px row adds half an hour, not an hour', () => {
    expect(resizeBlockByPixels({ startMinutes: 540, duration: 60, edge: 'bottom', deltaY: 80, hourHeight: ROW }).duration).toBe(90);
    expect(resizeBlockByPixels({ startMinutes: 540, duration: 60, edge: 'top', deltaY: -80, hourHeight: ROW }).startMinutes).toBe(510);
  });
});
