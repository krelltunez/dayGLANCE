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
// The cursor carries the canonical filter key of the walk it belongs to;
// every paginated call must present the same key or get a validation error,
// and pre-filter cursors (offset only, no key) are malformed.

const LIST = Array.from({ length: 120 }, (_, i) => ({ id: `t${i}` }));
const F = 'scope=all;completed=1';
const page = <T>(items: T[], opts: { limit?: unknown; cursor?: unknown; filterKey?: string }) =>
  paginate(items, { filterKey: F, ...opts });

describe('paginate — happy path', () => {
  it('defaults to a 50-item page with truncation flag and cursor', () => {
    expect(DEFAULT_LIST_LIMIT).toBe(50);
    const r = page(LIST, {});
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
      const r = page(LIST, { cursor });
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

  it('walks cleanly at limit 1, at the ceiling, and when size is an exact multiple of limit', () => {
    for (const [items, limit] of [
      [LIST.slice(0, 7), 1],
      [LIST, MAX_LIST_LIMIT],
      [LIST.slice(0, 40), 10], // exact multiple: final page full, then done
    ] as const) {
      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      for (let guard = 0; guard < 200; guard++) {
        const r = page(items, { limit, cursor });
        if (!r.ok) throw new Error(r.reason);
        expect(r.total).toBe(items.length);
        pages += 1;
        seen.push(...r.items.map((t) => t.id));
        if (!r.truncated) {
          // No empty trailing page: an exact-multiple walk ends on a FULL page.
          if (items.length > 0) expect(r.items.length).toBeGreaterThan(0);
          break;
        }
        expect(r.items).toHaveLength(limit); // no short intermediate pages
        cursor = r.nextCursor!;
      }
      expect(seen).toEqual(items.map((t) => t.id));
      expect(pages).toBe(Math.max(1, Math.ceil(items.length / limit)));
    }
  });

  it('final page is not truncated and carries no cursor', () => {
    const r = page(LIST, { cursor: encodeCursor(100, F) });
    if (!r.ok) throw new Error(r.reason);
    expect(r.items).toHaveLength(20);
    expect(r.truncated).toBe(false);
    expect(r.nextCursor).toBeNull();
  });

  it('a list at exactly the limit is not truncated', () => {
    const r = page(LIST.slice(0, 50), {});
    if (!r.ok) throw new Error(r.reason);
    expect(r.items).toHaveLength(50);
    expect(r.truncated).toBe(false);
    expect(r.nextCursor).toBeNull();
  });

  it('honors an explicit limit', () => {
    const r = page(LIST, { limit: 10 });
    if (!r.ok) throw new Error(r.reason);
    expect(r.items).toHaveLength(10);
    expect(r.truncated).toBe(true);
  });

  it('a cursor at or past the end returns an empty final page (list may have shrunk)', () => {
    const r = page(LIST, { cursor: encodeCursor(120, F) });
    if (!r.ok) throw new Error(r.reason);
    expect(r.items).toEqual([]);
    expect(r.truncated).toBe(false);
    expect(r.nextCursor).toBeNull();
    const r2 = page(LIST, { cursor: encodeCursor(10_000, F) });
    if (!r2.ok) throw new Error(r2.reason);
    expect(r2.items).toEqual([]);
  });

  it('an empty list yields an empty, untruncated page', () => {
    const r = page([], {});
    if (!r.ok) throw new Error(r.reason);
    expect(r.items).toEqual([]);
    expect(r.truncated).toBe(false);
    expect(r.nextCursor).toBeNull();
    expect(r.total).toBe(0);
  });
});

describe('paginate — filter binding', () => {
  it('a cursor from filter A replayed under filter B is a validation error naming both', () => {
    const first = page(LIST, { filterKey: 'scope=standalone;completed=0' });
    if (!first.ok) throw new Error(first.reason);
    const r = page(LIST, { cursor: first.nextCursor!, filterKey: 'scope=all;completed=1' });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected failure');
    expect(r.reason).toContain('scope=standalone;completed=0');
    expect(r.reason).toContain('scope=all;completed=1');
    expect(r.reason).toContain('restart');
  });

  it('the same filter key across pages walks cleanly', () => {
    const key = 'scope=standalone;completed=0';
    const first = page(LIST, { limit: 50, filterKey: key });
    if (!first.ok) throw new Error(first.reason);
    const second = page(LIST, { cursor: first.nextCursor!, limit: 50, filterKey: key });
    expect(second.ok).toBe(true);
  });

  it('pre-filter cursors (offset only, no filter key) are malformed, never an implicit all', () => {
    const legacy = 'dgc1.' + Buffer.from(JSON.stringify({ o: 50 })).toString('base64url');
    const r = page(LIST, { cursor: legacy });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected failure');
    expect(r.reason).toContain('not valid');
  });
});

describe('paginate — validation failures, never silent clamps', () => {
  it('rejects a limit above the ceiling instead of clamping', () => {
    const r = page(LIST, { limit: MAX_LIST_LIMIT + 1 });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected failure');
    expect(r.reason).toContain(String(MAX_LIST_LIMIT));
  });

  it('accepts a limit exactly at the ceiling', () => {
    expect(page(LIST, { limit: MAX_LIST_LIMIT }).ok).toBe(true);
  });

  it('rejects zero, negative, fractional, and non-numeric limits', () => {
    for (const limit of [0, -1, 2.5, '50', null, NaN]) {
      const r = page(LIST, { limit });
      expect(r.ok, `limit ${String(limit)}`).toBe(false);
    }
  });

  it('rejects cursors it did not mint', () => {
    for (const cursor of ['', 'abc', 'dgc1.!!!', 'dgc2.eyJvIjowfQ', 42, {}]) {
      const r = page(LIST, { cursor });
      expect(r.ok, `cursor ${String(cursor)}`).toBe(false);
    }
  });

  it('rejects a hand-tampered cursor whose offset is negative or fractional, or whose filter key is not a string', () => {
    const forge = (o: unknown, f: unknown = F) => 'dgc1.' + Buffer.from(JSON.stringify({ o, f })).toString('base64url');
    for (const o of [-1, 1.5, '3', null]) {
      expect(page(LIST, { cursor: forge(o) }).ok, `offset ${String(o)}`).toBe(false);
    }
    expect(page(LIST, { cursor: forge(0, 42) }).ok).toBe(false);
  });
});

describe('filtered totals — the field never lies', () => {
  it('total reflects the (pre-filtered) input set, not any larger population it came from', () => {
    // The tool layer filters in the read model BEFORE paginate ever sees the
    // array, so paginate's total is definitionally the filtered count. This
    // pins the composed behavior: a filtered subset paginated to completion
    // reports the subset's size on every page and walks exactly that many rows.
    const population = Array.from({ length: 347 }, (_, i) => ({ id: `t${i}`, open: i % 5 === 0 }));
    const filtered = population.filter((t) => t.open); // 70 rows, standing in for the read-model filter
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 100; guard++) {
      const r = page(filtered, { limit: 7, cursor, filterKey: 'scope=standalone;completed=0' });
      if (!r.ok) throw new Error(r.reason);
      expect(r.total).toBe(filtered.length);
      expect(r.total).not.toBe(population.length);
      seen.push(...r.items.map((t) => t.id));
      if (!r.truncated) break;
      cursor = r.nextCursor!;
    }
    expect(seen).toEqual(filtered.map((t) => t.id));
  });
});

describe('cursor round-trip', () => {
  it('decode(encode(n, f)) round-trips offset and filter key', () => {
    for (const n of [0, 1, 50, 119, 10_000]) {
      expect(decodeCursor(encodeCursor(n, F))).toEqual({ offset: n, filterKey: F });
    }
  });

  it('cursors are opaque-prefixed and versioned', () => {
    expect(encodeCursor(0, F).startsWith('dgc1.')).toBe(true);
  });
});
