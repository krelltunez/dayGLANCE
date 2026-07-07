import { describe, it, expect } from 'vitest';
import { partitionExpiredSingleDayFrames } from './expiredFrames.js';

const cutoff = '2026-07-01';

describe('partitionExpiredSingleDayFrames', () => {
  it('removes single-day frames older than the cutoff', () => {
    const frames = [
      { id: 'a', singleDate: '2026-06-20' }, // expired
      { id: 'b', singleDate: '2026-07-05' }, // in-window
    ];
    const { kept, removed } = partitionExpiredSingleDayFrames(frames, cutoff);
    expect(kept.map(f => f.id)).toEqual(['b']);
    expect(removed.map(f => f.id)).toEqual(['a']);
  });

  it('never removes recurring frames (no singleDate), even old-looking ones', () => {
    const frames = [{ id: 'r', days: [1, 2, 3] }, { id: 'r2', days: [] }];
    const { kept, removed } = partitionExpiredSingleDayFrames(frames, cutoff);
    expect(removed).toEqual([]);
    expect(kept.map(f => f.id)).toEqual(['r', 'r2']);
  });

  it('keeps a single-day frame exactly on the cutoff (>= is in-window)', () => {
    const { removed } = partitionExpiredSingleDayFrames([{ id: 'x', singleDate: cutoff }], cutoff);
    expect(removed).toEqual([]);
  });

  it('returns empty removed when nothing is expired (effect will no-op)', () => {
    const { removed } = partitionExpiredSingleDayFrames([{ id: 'x', singleDate: '2026-07-09' }], cutoff);
    expect(removed).toEqual([]);
  });

  it('tolerates empty/null input', () => {
    expect(partitionExpiredSingleDayFrames(null, cutoff)).toEqual({ kept: [], removed: [] });
    expect(partitionExpiredSingleDayFrames([], cutoff)).toEqual({ kept: [], removed: [] });
  });
});
