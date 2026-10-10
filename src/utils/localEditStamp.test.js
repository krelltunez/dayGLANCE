import { describe, it, expect, afterEach } from 'vitest';
import { markBookkeepingChange, inBookkeepingWindow, BOOKKEEPING_WINDOW_MS, _resetBookkeepingForTests } from './localEditStamp.js';

describe('the bookkeeping window (the midnight rollover is not an edit made here)', () => {
  afterEach(() => _resetBookkeepingForTests());

  it('is closed until marked, open for the window, then closed again', () => {
    const T = 1_800_000_000_000;
    expect(inBookkeepingWindow(() => T)).toBe(false);
    markBookkeepingChange(() => T);
    expect(inBookkeepingWindow(() => T)).toBe(true);
    expect(inBookkeepingWindow(() => T + BOOKKEEPING_WINDOW_MS - 1)).toBe(true);
    expect(inBookkeepingWindow(() => T + BOOKKEEPING_WINDOW_MS)).toBe(false);
  });
});
