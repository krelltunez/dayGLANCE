import { describe, it, expect } from 'vitest';
import { quotes, getDailyQuote } from './quotes.js';

describe('getDailyQuote', () => {
  it('is deterministic: the same date always yields the same quote', () => {
    const a = getDailyQuote(new Date(2026, 6, 10));
    const b = getDailyQuote(new Date(2026, 6, 10));
    expect(a).toEqual(b);
  });

  it('returns a well-formed quote with text and author', () => {
    const q = getDailyQuote(new Date(2026, 0, 1));
    expect(typeof q.text).toBe('string');
    expect(q.text.length).toBeGreaterThan(0);
    expect(typeof q.author).toBe('string');
    expect(q.author.length).toBeGreaterThan(0);
  });

  it('rotates day to day (consecutive days differ within the list)', () => {
    const day1 = getDailyQuote(new Date(2026, 2, 1));
    const day2 = getDailyQuote(new Date(2026, 2, 2));
    // With 60+ quotes, adjacent days pick adjacent list entries.
    expect(day1).not.toEqual(day2);
  });

  it('wraps around the list length', () => {
    // Day-of-year well past the list length still resolves to a valid entry.
    const q = getDailyQuote(new Date(2026, 11, 31));
    expect(quotes).toContainEqual(q);
  });
});
