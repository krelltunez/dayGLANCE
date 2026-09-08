import { describe, it, expect, beforeEach } from 'vitest';
import { markInitialPullComplete, initialPullCompleted, INITIAL_PULL_SETTLE_MS, _resetInitialPullForTests } from './initialPull.js';

describe('initialPull', () => {
  beforeEach(() => _resetInitialPullForTests());

  it('is not complete before any cycle has committed', () => {
    expect(initialPullCompleted(10_000)).toBe(false);
  });

  it('reports complete only once the commit has had time to reach React state', () => {
    markInitialPullComplete(10_000);
    expect(initialPullCompleted(10_000)).toBe(false);                             // the same beat as the cycle's return
    expect(initialPullCompleted(10_000 + INITIAL_PULL_SETTLE_MS - 1)).toBe(false);
    expect(initialPullCompleted(10_000 + INITIAL_PULL_SETTLE_MS)).toBe(true);
  });

  it('keeps the first mark; later cycles do not move it', () => {
    markInitialPullComplete(10_000);
    markInitialPullComplete(50_000);
    expect(initialPullCompleted(10_000 + INITIAL_PULL_SETTLE_MS)).toBe(true);
  });
});
