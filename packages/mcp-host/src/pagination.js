// Pagination for MCP list tools (dayGLANCE MCP spec §5.1: cap the default,
// return a truncation flag plus cursor), as pure functions so the paging
// decisions can be unit-tested without the SDK.
//
// There are NO sessions on this transport (§3.7), so the cursor must be fully
// self-contained: an opaque base64url token carrying the offset AND the
// canonical filter key the walk was started under. Opaque so clients cannot
// construct or increment one themselves and then depend on the encoding;
// self-contained so any request, from any client instance, can resume the
// walk. The list can mutate between pages — offset resume is the documented,
// bounded inaccuracy (a shifted item may repeat or be skipped), which costs no
// server state.
//
// FILTER BINDING: an offset alone is ambiguous once filtering exists (offset
// 200 means different rows under different filters), so the cursor carries
// the filter key and every paginated call compares the request's resolved
// key against it. A difference is a validation error naming both sides —
// never silently honored, because a mid-pagination filter change produces a
// result window that corresponds to no coherent query. Cursors without a
// filter key are rejected as malformed rather than treated as an implicit
// 'all'.
//
// CURSOR PREFIX: a version tag the host chooses (dayGLANCE's is 'dgc1.'), so
// one app's cursors never decode as another's. It is part of the wire format:
// changing it invalidates every cursor a client holds.

/** §5.1 suggested default cap: an unbounded dump wastes the client's context. */
export const DEFAULT_LIST_LIMIT = 50;
/** Upper bound on caller-supplied limits; a model asking for 10_000 gets an error, not a dump. */
export const MAX_LIST_LIMIT = 200;
/** The cursor prefix when the host names none: MCP host cursor, version 1. */
export const DEFAULT_CURSOR_PREFIX = 'mhc1.';

/**
 * @param {number} offset
 * @param {string} filterKey
 * @param {string} [prefix]
 * @returns {string}
 */
export function encodeCursor(offset, filterKey, prefix = DEFAULT_CURSOR_PREFIX) {
  return prefix + Buffer.from(JSON.stringify({ o: offset, f: filterKey }), 'utf8').toString('base64url');
}

/**
 * Returns {offset, filterKey}, or null for anything not produced by
 * encodeCursor under the same prefix.
 *
 * @param {string} cursor
 * @param {string} [prefix]
 * @returns {{ offset: number, filterKey: string } | null}
 */
export function decodeCursor(cursor, prefix = DEFAULT_CURSOR_PREFIX) {
  if (!cursor.startsWith(prefix)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor.slice(prefix.length), 'base64url').toString('utf8'));
    const offset = parsed.o;
    if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) return null;
    if (typeof parsed.f !== 'string') return null;
    return { offset, filterKey: parsed.f };
  } catch {
    return null;
  }
}

/**
 * Slice one page. Invalid limit/cursor inputs are validation failures the tool
 * layer maps to a typed error (§5.2) — never silently clamped to something the
 * caller did not ask for: a limit above MAX_LIST_LIMIT is an error rather than
 * a clamp, so the model learns the real ceiling.
 *
 * On success: `truncated` is the §5.1 truncation flag (items remain past this
 * page), `nextCursor` is present exactly when truncated, and `total` is the
 * full list's length so the model can report "50 of 312".
 *
 * @template T
 * @param {T[]} items
 * @param {{ limit?: unknown, cursor?: unknown, filterKey: string, cursorPrefix?: string }} opts
 */
export function paginate(items, opts) {
  const prefix = opts.cursorPrefix ?? DEFAULT_CURSOR_PREFIX;
  let limit = DEFAULT_LIST_LIMIT;
  if (opts.limit !== undefined) {
    if (typeof opts.limit !== 'number' || !Number.isInteger(opts.limit) || opts.limit < 1) {
      return { ok: false, reason: `limit must be an integer >= 1, got ${JSON.stringify(opts.limit)}` };
    }
    if (opts.limit > MAX_LIST_LIMIT) {
      return { ok: false, reason: `limit must be <= ${MAX_LIST_LIMIT}, got ${opts.limit}` };
    }
    limit = opts.limit;
  }

  let offset = 0;
  if (opts.cursor !== undefined) {
    if (typeof opts.cursor !== 'string') {
      return { ok: false, reason: 'cursor must be a string from a previous response' };
    }
    const decoded = decodeCursor(opts.cursor, prefix);
    if (decoded === null) {
      return { ok: false, reason: 'cursor is not valid; use the next_cursor from a previous response' };
    }
    if (decoded.filterKey !== opts.filterKey) {
      return {
        ok: false,
        reason:
          `cursor was issued under a different filter (cursor: ${decoded.filterKey}; this call: ${opts.filterKey}). ` +
          'Changing filters mid-pagination is not supported; restart with a fresh call and no cursor.',
      };
    }
    offset = decoded.offset;
  }

  // An offset at or past the end returns an empty final page rather than an
  // error: the list may legitimately have shrunk since the cursor was issued.
  const page = items.slice(offset, offset + limit);
  const truncated = offset + limit < items.length;
  return {
    ok: true,
    items: page,
    truncated,
    nextCursor: truncated ? encodeCursor(offset + limit, opts.filterKey, prefix) : null,
    total: items.length,
  };
}
