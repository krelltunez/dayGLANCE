import { describe, expect, it } from 'vitest';
import { FALLBACK_HOUR_PX, timelinePosition } from './timelinePosition.js';

// A grid of 24 hour rows `rowPx` tall (a 1px border folded in), plus the
// overlay divs that follow the rows in the real grid.
const grid = (rowPx, overlays = 1) => [
  ...Array.from({ length: 24 }, (_, i) => ({ offsetTop: i * rowPx, offsetHeight: rowPx })),
  ...Array.from({ length: overlays }, () => ({ offsetTop: 0, offsetHeight: 99999 })),
];

describe('timelinePosition', () => {
  it('reads the rows: an hour is its row top, a minute is a share of that row', () => {
    const rows = grid(100);
    expect(timelinePosition(0, rows)).toBe(0);
    expect(timelinePosition(9 * 60, rows)).toBe(900);
    expect(timelinePosition(9 * 60 + 30, rows)).toBe(950);
    expect(timelinePosition(23 * 60 + 45, rows)).toBe(2375);
  });

  it('24:00 is the bottom of the last row, at any row height (#2306)', () => {
    // The default height, and the timeline zoomed out and in: the fixed
    // fallback (24 x 161 = 3864) is right only for the first.
    for (const rowPx of [161, 60, 100, 240]) {
      expect(timelinePosition(24 * 60, grid(rowPx))).toBe(24 * rowPx);
    }
    // A frame ending at 24:00 from 23:00 is one row tall, not hundreds of pixels.
    const rows = grid(60);
    expect(timelinePosition(24 * 60, rows) - timelinePosition(23 * 60, rows)).toBe(60);
  });

  it('nothing lands past the bottom of the day', () => {
    expect(timelinePosition(25 * 60, grid(60))).toBe(24 * 60);
  });

  it('the overlays after the 24 rows are never read', () => {
    expect(timelinePosition(24 * 60, grid(60, 3))).toBe(24 * 60);
  });

  it('with no grid mounted, the fixed fallback, as before', () => {
    expect(timelinePosition(2 * 60 + 30, null)).toBe(2 * FALLBACK_HOUR_PX + 30 * (FALLBACK_HOUR_PX - 1) / 60);
    expect(timelinePosition(60, [])).toBe(FALLBACK_HOUR_PX);
  });
});
