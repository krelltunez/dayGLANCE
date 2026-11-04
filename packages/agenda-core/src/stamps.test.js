import { describe, it, expect } from 'vitest';
import { parseStamp } from './stamps.js';

describe('parseStamp', () => {
  it('reads a bare date as that LOCAL day, not UTC midnight', () => {
    const { date, hasTime } = parseStamp('2026-10-19');
    expect(hasTime).toBe(false);
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2026, 9, 19]);
  });

  it('reads local-offset and UTC stamps as instants', () => {
    expect(parseStamp('2026-10-19T09:00:00-05:00').date.getTime()).toBe(Date.parse('2026-10-19T14:00:00Z'));
    expect(parseStamp('2026-10-19T14:00:00.000Z').hasTime).toBe(true);
  });

  it('is null for nothing or nonsense', () => {
    expect(parseStamp(null)).toBeNull();
    expect(parseStamp('')).toBeNull();
    expect(parseStamp('soon')).toBeNull();
  });
});
