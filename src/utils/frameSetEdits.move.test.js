import { describe, it, expect } from 'vitest';
import { moveFrameToSet } from './frameSetEdits.js';

// Moving a frame between sets by dragging (#2335): the row the editor's save
// would write, and nothing else touched.

const NOW = '2026-11-08T10:00:00.000Z';
const frames = () => [
  { id: 'free', label: 'Free', lastModified: 'old' },
  { id: 'desk', label: 'Desk', setId: 'work', lastModified: 'old' },
];

describe('moveFrameToSet', () => {
  it('puts a frame in a set, stamped, leaving the others as they were', () => {
    const before = frames();
    const after = moveFrameToSet(before, 'free', 'hol', NOW);
    expect(after[0]).toEqual({ id: 'free', label: 'Free', setId: 'hol', lastModified: NOW });
    expect(after[1]).toBe(before[1]);
  });

  it('into no set leaves no setId at all, the shape a frame from before sets has', () => {
    const after = moveFrameToSet(frames(), 'desk', null, NOW);
    expect(after[1]).toEqual({ id: 'desk', label: 'Desk', lastModified: NOW });
    expect(after[1]).not.toHaveProperty('setId');
    expect(moveFrameToSet(frames(), 'desk', '', NOW)[1]).not.toHaveProperty('setId');
  });

  it('returns the list itself when nothing moves: same set, unknown frame, or no list', () => {
    const before = frames();
    expect(moveFrameToSet(before, 'desk', 'work', NOW)).toBe(before);
    expect(moveFrameToSet(before, 'free', null, NOW)).toBe(before);
    expect(moveFrameToSet(before, 'gone', 'work', NOW)).toBe(before);
    expect(moveFrameToSet(undefined, 'free', 'work', NOW)).toBeUndefined();
  });

  it('matches ids as strings', () => {
    expect(moveFrameToSet([{ id: 7 }], '7', 'work', NOW)[0].setId).toBe('work');
  });
});
