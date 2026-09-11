import { describe, it, expect } from 'vitest';
import { assignLanes, maxLaneCount } from './intervalLanes.js';

const iv = (startMin, endMin, id = `${startMin}`) => ({ id, startMin, endMin });

describe('assignLanes', () => {
  it('keeps non-overlapping and back-to-back intervals on one lane', () => {
    const laid = assignLanes([iv(540, 600), iv(600, 660), iv(700, 760)]);
    expect(laid.map((b) => [b.lane, b.laneCount])).toEqual([[0, 1], [0, 1], [0, 1]]);
  });

  it('opens a second lane for a genuine overlap and reuses it once freed', () => {
    const laid = assignLanes([iv(600, 660, 'a'), iv(630, 720, 'b'), iv(675, 720, 'c')]);
    expect(laid.map((b) => b.lane)).toEqual([0, 1, 0]);
    expect(laid.map((b) => b.laneCount)).toEqual([2, 2, 2]);
  });

  it('chains transitively: a bridging block joins its neighbours into one cluster', () => {
    // a and c never overlap each other, but both overlap b.
    const laid = assignLanes([iv(540, 600, 'a'), iv(570, 660, 'b'), iv(630, 700, 'c')]);
    expect(laid.map((b) => [b.id, b.lane, b.laneCount])).toEqual([
      ['a', 0, 2], ['b', 1, 2], ['c', 0, 2],
    ]);
  });

  it('scopes the lane count to each cluster', () => {
    const laid = assignLanes([
      iv(480, 540, 'morning'),
      iv(600, 700, 'x'), iv(620, 720, 'y'), iv(640, 700, 'z'),
      iv(800, 860, 'evening'),
    ]);
    expect(laid.map((b) => [b.id, b.lane, b.laneCount])).toEqual([
      ['morning', 0, 1],
      ['x', 0, 3], ['y', 1, 3], ['z', 2, 3],
      ['evening', 0, 1],
    ]);
    expect(maxLaneCount(laid)).toBe(3);
  });

  it('preserves input order and does not mutate the input', () => {
    const input = [iv(540, 600, 'a'), iv(540, 570, 'b')];
    const laid = assignLanes(input);
    expect(laid.map((b) => b.id)).toEqual(['a', 'b']);
    expect(input[0]).toEqual({ id: 'a', startMin: 540, endMin: 600 });
  });

  it('handles empty and missing input', () => {
    expect(assignLanes([])).toEqual([]);
    expect(assignLanes(null)).toEqual([]);
    expect(maxLaneCount([])).toBe(0);
  });
});
