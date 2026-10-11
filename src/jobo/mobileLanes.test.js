import { describe, it, expect } from 'vitest';
import {
  NARROW_LANE_PX, HOUR_GUTTER_PX, DIVIDER_PX,
  planWideByDefault, planIsWide, swapped, laneWidths, balancedWidths, doBar, tappedTaskId,
} from './mobileLanes.js';

// JOBO on the phone (slice 8): one side wide, the other a narrow lane of
// bars; a swap changes the widths, never the order.

const TODAY = '2026-10-04';

describe('which side opens wide', () => {
  // MUTATION: flip the comparison and a past day opens on its plan.
  it('Plan for today and later, Do for past days', () => {
    expect(planWideByDefault(TODAY, TODAY)).toBe(true);
    expect(planWideByDefault('2026-10-05', TODAY)).toBe(true);
    expect(planWideByDefault('2026-10-03', TODAY)).toBe(false);
  });

  it('a swap holds while the date does, and the default stands on any other date', () => {
    const swap = swapped(null, TODAY, TODAY);
    expect(swap).toEqual({ date: TODAY, planWide: false });
    expect(planIsWide(swap, TODAY, TODAY)).toBe(false);
    expect(planIsWide(swap, '2026-10-03', TODAY)).toBe(false); // past default, not the swap
    expect(planIsWide(swap, '2026-10-05', TODAY)).toBe(true);
    // Back on the swapped date after leaving it: the default again, since
    // the swap was replaced by none; a swap on yesterday replaces today's.
    const yesterday = swapped(swap, '2026-10-03', TODAY);
    expect(yesterday).toEqual({ date: '2026-10-03', planWide: true });
    expect(planIsWide(yesterday, TODAY, TODAY)).toBe(true);
  });

  it('swapping twice comes back', () => {
    expect(swapped(swapped(null, TODAY, TODAY), TODAY, TODAY).planWide).toBe(true);
  });
});

describe('balancedWidths', () => {
  it('half each of what the gutter and the divider leave, the odd pixel to Do', () => {
    expect(balancedWidths(390)).toEqual({ plan: 170, do: 170 });
    expect(balancedWidths(391)).toEqual({ plan: 170, do: 171 });
    const { plan, do: doWidth } = balancedWidths(320);
    expect(HOUR_GUTTER_PX + plan + DIVIDER_PX + doWidth).toBe(320);
  });

  it('never negative on a tiny screen', () => {
    expect(balancedWidths(10)).toEqual({ plan: 0, do: 0 });
  });

  it("takes the caller's gutter: the upright tablet's 64px", () => {
    const { plan, do: doWidth } = balancedWidths(390, 64);
    expect({ plan, do: doWidth }).toEqual({ plan: 162, do: 162 });
    expect(64 + plan + DIVIDER_PX + doWidth).toBe(390);
  });
});

describe('laneWidths', () => {
  it('the wide side takes all but the gutter, the divider and the narrow lane', () => {
    expect(laneWidths(390, true)).toEqual({ wide: 390 - HOUR_GUTTER_PX - DIVIDER_PX - NARROW_LANE_PX, plan: 296, do: NARROW_LANE_PX });
    expect(laneWidths(390, false)).toEqual({ wide: 296, plan: NARROW_LANE_PX, do: 296 });
  });
  it('never goes negative before the view is measured', () => {
    expect(laneWidths(0, true).wide).toBe(0);
  });
  it("takes the caller's gutter: the upright tablet's 64px", () => {
    const { wide, plan, do: doWidth } = laneWidths(390, true, 64);
    expect(wide).toBe(390 - 64 - DIVIDER_PX - NARROW_LANE_PX);
    expect(64 + plan + DIVIDER_PX + doWidth).toBe(390);
  });
});

describe('doBar', () => {
  const item = (over) => ({ startMinute: 600, endMinute: 630, leftPct: 0, widthPct: 100, sourceTask: { id: 7, color: 'bg-green-500' }, ...over });
  it('the interval at the hour height, in its overlap column and its task\'s colour', () => {
    expect(doBar(item(), 161)).toEqual({ top: 1610, height: 79.5, leftPct: 0, widthPct: 100, color: 'bg-green-500', taskId: 7 });
    expect(doBar(item({ leftPct: 50, widthPct: 50 }), 161)).toMatchObject({ leftPct: 50, widthPct: 50 });
  });
  it('a moment still shows, and unlinked work is grey with no task', () => {
    expect(doBar(item({ endMinute: 600, sourceTask: null }), 161)).toMatchObject({ height: 3, color: 'bg-gray-500', taskId: null });
  });
  it('prefers the resolved task\'s colour', () => {
    expect(doBar(item({ task: { color: 'bg-rose-500' } }), 161).color).toBe('bg-rose-500');
  });
});

describe('tappedTaskId', () => {
  const target = (id) => ({ closest: (sel) => (sel === '[data-jobo-bar-task]' && id !== undefined ? { getAttribute: () => id } : null) });
  it('the bar under the tap, or none on the lane itself', () => {
    expect(tappedTaskId(target('call'))).toBe('call');
    expect(tappedTaskId(target(undefined))).toBeNull();
    expect(tappedTaskId(target(''))).toBeNull();
    expect(tappedTaskId(null)).toBeNull();
  });
});
