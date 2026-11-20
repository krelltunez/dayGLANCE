import { describe, expect, it } from 'vitest';
import { blockEdges, snapStart } from './magneticSnap.js';

const h = (hh, mm = 0) => hh * 60 + mm;

describe('blockEdges', () => {
  it("lists each timed block's start and end, skipping the dragged one and all-day ones", () => {
    const tasks = [
      { id: 'a', startTime: '09:00', duration: 67 },
      { id: 'drag', startTime: '11:00', duration: 30 },
      { id: 'b', startTime: '12:00', duration: 30, isAllDay: true },
      { id: 'c', startTime: null, duration: 30 },
      { id: 'd', startTime: '23:30', duration: 60 },
    ];
    expect(blockEdges(tasks, 'drag')).toEqual([h(9), h(10, 7), h(23, 30), h(24, 30)]);
  });
});

describe('snapStart', () => {
  const edges = [h(9), h(10, 7)]; // a block 09:00-10:07

  it('puts the start on the end of the block before when close', () => {
    expect(snapStart(h(10, 4), 30, edges)).toBe(h(10, 7));
    expect(snapStart(h(10, 11), 30, edges)).toBe(h(10, 7));
  });

  it('puts the end on the start of the block after when close', () => {
    // A 30-minute block dragged to end near 09:00 ends exactly there.
    expect(snapStart(h(8, 33), 30, edges)).toBe(h(8, 30));
    expect(snapStart(h(8, 27, ), 30, [h(9, 2)])).toBe(h(8, 32));
  });

  it('keeps the 15-minute grid away from any edge', () => {
    expect(snapStart(h(10, 20), 30, edges)).toBe(h(10, 15));
    expect(snapStart(h(13, 8), 30, edges)).toBe(h(13, 15));
    expect(snapStart(h(13, 8), 30, [])).toBe(h(13, 15));
  });

  it('still reaches the grid points beside an off-grid edge', () => {
    expect(snapStart(h(9, 55), 30, edges)).toBe(h(10));
    expect(snapStart(h(10, 15), 30, edges)).toBe(h(10, 15));
  });

  it('takes the nearest edge when two are in reach', () => {
    expect(snapStart(h(10, 5), 30, [h(10, 7), h(10, 2)])).toBe(h(10, 7));
    expect(snapStart(h(10, 4), 30, [h(10, 7), h(10, 2)])).toBe(h(10, 2));
  });

  it('snaps only the start for a block with no length', () => {
    expect(snapStart(h(8, 33), 0, edges)).toBe(h(8, 30));
    expect(snapStart(h(10, 5), 0, edges)).toBe(h(10, 7));
  });
});
