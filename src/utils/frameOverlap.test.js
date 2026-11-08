import { describe, it, expect } from 'vitest';
import { findFrameOverlap } from './frameOverlap.js';

// The overlap rule the frame editor's save and a drag into another set share
// (#2305, #2335). Moved out of FrameEditor unchanged; its picker test still
// covers the editor's use of it (FrameSetsList.test.jsx).

const F = (id, over = {}) => ({ id, label: id, enabled: true, days: [1, 2, 3], start: '09:00', end: '12:00', ...over });

describe('findFrameOverlap', () => {
  it('finds a frame sharing a weekday and a time, with the days they share', () => {
    const clash = findFrameOverlap(F('new', { days: [3, 4], start: '11:00', end: '13:00' }), [F('desk')]);
    expect(clash.frame.id).toBe('desk');
    expect(clash.days).toEqual([3]);
  });

  it('none where the days or the times do not meet', () => {
    expect(findFrameOverlap(F('new', { days: [4, 5] }), [F('desk')])).toBeNull();
    // Touching is not overlapping.
    expect(findFrameOverlap(F('new', { start: '12:00', end: '13:00' }), [F('desk')])).toBeNull();
  });

  it('a single date meets a weekly frame on its weekday, and another frame on that date', () => {
    // 2026-11-11 is a Wednesday (3).
    expect(findFrameOverlap(F('new', { days: [], singleDate: '2026-11-11' }), [F('desk')])).toMatchObject({ frame: { id: 'desk' }, days: null });
    expect(findFrameOverlap(F('new', { days: [], singleDate: '2026-11-12' }), [F('desk')])).toBeNull();
    expect(findFrameOverlap(F('new', { days: [], singleDate: '2026-11-12' }), [F('once', { days: [], singleDate: '2026-11-12' })]))
      .toMatchObject({ frame: { id: 'once' } });
  });

  it('frames in two different sets may overlap; a frame in no set meets every other', () => {
    const frames = [F('desk', { setId: 'work' })];
    expect(findFrameOverlap(F('beach', { setId: 'hol' }), frames)).toBeNull();
    expect(findFrameOverlap(F('beach', { setId: 'work' }), frames)).not.toBeNull();
    expect(findFrameOverlap(F('free'), frames)).not.toBeNull();
    expect(findFrameOverlap(F('free', { setId: '' }), frames)).not.toBeNull();
    // And a set frame meets a frame in no set.
    expect(findFrameOverlap(F('beach', { setId: 'hol' }), [F('free')])).not.toBeNull();
  });

  it('skips its own row, and frames that are off', () => {
    expect(findFrameOverlap(F('desk'), [F('desk')])).toBeNull();
    expect(findFrameOverlap(F('new'), [F('desk', { enabled: false })])).toBeNull();
  });

  it('tolerates a frame with no days list', () => {
    expect(findFrameOverlap(F('new'), [{ id: 'odd', enabled: true, start: '09:00', end: '12:00' }])).toBeNull();
  });
});
