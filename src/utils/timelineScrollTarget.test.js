import { describe, expect, it } from 'vitest';
import { timelineScrollTarget } from './timelineScrollTarget.js';
describe('native refocus scroll target', () => {
  it('keeps the original native calendar measurement', () => {
    const calendar = { querySelector: () => null };
    expect(timelineScrollTarget(calendar, { children: [{}, { offsetHeight: 160 }] })).toEqual({ viewport: calendar, hourHeight: 160, ownsInitialScroll: false });
  });
  it('retains the original fallback before the grid mounts', () => {
    expect(timelineScrollTarget(null, null)).toEqual({ viewport: null, hourHeight: 161, ownsInitialScroll: false });
  });
  it('measures the one shared 24-hour axis, not the outer page', () => {
    const compact = { querySelector: () => ({ offsetHeight: 2016 }) };
    const calendar = { querySelector: () => compact };
    expect(timelineScrollTarget(calendar, null)).toEqual({ viewport: compact, hourHeight: 84, ownsInitialScroll: true });
  });
  it.each([0, NaN, undefined])('does not use an unmeasured compact axis (%s)', height => {
    const calendar = { querySelector: () => ({ querySelector: () => ({ offsetHeight: height }) }) };
    expect(timelineScrollTarget(calendar, null).viewport).toBe(calendar);
  });
});
