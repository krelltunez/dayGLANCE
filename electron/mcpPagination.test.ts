import { describe, it, expect } from 'vitest';
import {
  paginate,
  encodeCursor,
  decodeCursor,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
} from './mcpPagination.js';

// §5.1 under test: default cap 50, truncation flag, working cursor — and the
// §5.2 direction that bad inputs are validation failures, not silent clamps.

const LIST = Array.from({ length: 120 }, (_, i) => ({ id: `t${i}` }));

describe('paginate — happy path', () => {
  it('defaults to a 50-item page with truncation flag and cursor', () => {
    expect(DEFAULT_LIST_LIMIT).toBe(50);
    const r = paginate(LIST, {});
    if (!r.ok) throw new Error(r.reason);
    expect(r.items).toHaveLength(50);
    expect(r.items[0]).toEqual({ id: 't0' });
    expect(r.truncated).toBe(true);
    expect(r.nextCursor).not.toBeNull();
    expect(r.total).toBe(120);
  });

  it('walks the whole list through cursors without gaps or repeats', () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const r = paginate(LIST, { cursor });
      if (!r.ok) throw new Error(r.reason);
      seen.push(...r.items.map((t) => t.id));
      if (!r.truncated) {
        expect(r.nextCursor).toBeNull();
        break;
      }
      cursor = r.nextCursor!;
    }
    expect(seen).toEqual(LIST.map((t) => t.id));
  });

  it('final page is not truncated and carries no cursor', () => {
    const r = paginate(LIST, { cursor: encodeCursor(100) });
    if (!r.ok) throw new Error(r.reason);
    expect(r.items).toHaveLength(20);
    expect(r.truncated).toBe(false);
    expect(r.nextCursor).toBeNull();
  });

  it('a list at exactly the limit is not truncated', () => {
    const r = paginate(LIST.slice(0, 50), {});
    if (!r.ok) throw new Error(r.reason);
    expect(r.items).toHaveLength(50);
    expect(r.truncated).toBe(false);
    expect(r.nextCursor).toBeNull();
  });

  it('honors an explicit limit', () => {
    const r = paginate(LIST, { limit: 10 });
    if (!r.ok) throw new Error(r.reason);
    expect(r.items).toHaveLength(10);
    expect(r.truncated).toBe(true);
  });

  it('a cursor at or past the end returns an empty final page (list may have shrunk)', () => {
    const r = paginate(LIST, { cursor: encodeCursor(120) });
    if (!r.ok) throw new Error(r.reason);
    expect(r.items).toEqual([]);
    expect(r.truncated).toBe(false);
    expect(r.nextCursor).toBeNull();
    const r2 = paginate(LIST, { cursor: encodeCursor(10_000) });
    if (!r2.ok) throw new Error(r2.reason);
    expect(r2.items).toEqual([]);
  });

  it('an empty list yields an empty, unt runcated page', () => {
    const r = paginate([], {});
    if (!r.ok) throw new Error(r.reason);
    expect(r.items).toEqual([]);
    expect(r.truncated).toBe(false);
    expect(r.nextCursor).toBeNull();
    expect(r.total).toBe(0);
  });
});

describe('paginate — validation failures, never silent clamps', () => {
  it('rejects a limit above the ceiling instead of clamping', () => {
    const r = paginate(LIST, { limit: MAX_LIST_LIMIT + 1 });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected failure');
    expect(r.reason).toContain(String(MAX_LIST_LIMIT));
  });

  it('accepts a limit exactly at the ceiling', () => {
    expect(paginate(LIST, { limit: MAX_LIST_LIMIT }).ok).toBe(true);
  });

  it('rejects zero, negative, fractional, and non-numeric limits', () => {
    for (const limit of [0, -1, 2.5, '50', null, NaN]) {
      const r = paginate(LIST, { limit });
      expect(r.ok, `limit ${String(limit)}`).toBe(false);
    }
  });

  it('rejects cursors it did not mint', () => {
    for (const cursor of ['', 'abc', 'dgc1.!!!', 'dgc2.eyJvIjowfQ', 42, {}]) {
      const r = paginate(LIST, { cursor });
      expect(r.ok, `cursor ${String(cursor)}`).toBe(false);
    }
  });

  it('rejects a hand-tampered cursor whose offset is negative or fractional', () => {
    const forge = (o: unknown) => 'dgc1.' + Buffer.from(JSON.stringify({ o })).toString('base64url');
    for (const o of [-1, 1.5, '3', null]) {
      expect(paginate(LIST, { cursor: forge(o) }).ok, `offset ${String(o)}`).toBe(false);
    }
  });
});

describe('cursor round-trip', () => {
  it('decode(encode(n)) === n', () => {
    for (const n of [0, 1, 50, 119, 10_000]) {
      expect(decodeCursor(encodeCursor(n))).toBe(n);
    }
  });

  it('cursors are opaque-prefixed and versioned', () => {
    expect(encodeCursor(0).startsWith('dgc1.')).toBe(true);
  });
});
