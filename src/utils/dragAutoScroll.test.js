import { describe, it, expect } from 'vitest';
import {
  dragAutoScrollStep, DRAG_SCROLL_ZONE_PX, DRAG_SCROLL_MIN_STEP, DRAG_SCROLL_MAX_STEP,
} from './dragAutoScroll.js';

// #2346: the edge bands ramp with depth, so a drag need not reach the very
// top (where the all-day row starts) to scroll.
const at = (cursorY, over = {}) => dragAutoScrollStep({ cursorY, top: 100, bottom: 900, scrollTop: 400, maxScroll: 1000, ...over });

describe('dragAutoScrollStep', () => {
  it('scrolls up in the top band, faster the closer to the edge', () => {
    const inner = at(100 + DRAG_SCROLL_ZONE_PX - 1);
    const middle = at(100 + DRAG_SCROLL_ZONE_PX / 2);
    const edge = at(101);
    expect(inner).toBeLessThan(0);
    expect(-inner).toBeGreaterThanOrEqual(DRAG_SCROLL_MIN_STEP);
    expect(-middle).toBeGreaterThan(-inner);
    expect(-edge).toBeGreaterThan(-middle);
    expect(-edge).toBeLessThanOrEqual(DRAG_SCROLL_MAX_STEP);
  });

  it('scrolls down in the bottom band the same way', () => {
    expect(at(900 - DRAG_SCROLL_ZONE_PX / 2)).toBe(-at(100 + DRAG_SCROLL_ZONE_PX / 2));
    expect(at(899)).toBeGreaterThan(at(900 - DRAG_SCROLL_ZONE_PX + 1));
  });

  it('does nothing between the bands, over the sticky header, or past either end', () => {
    expect(at(500)).toBe(0);
    expect(at(90)).toBe(0); // above `top`: the date header or the all-day row
    expect(at(120, { scrollTop: 0 })).toBe(0);
    expect(at(880, { scrollTop: 1000 })).toBe(0);
  });
});
