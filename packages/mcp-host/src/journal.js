// The write journal and its undo plan (dayGLANCE MCP spec §4.3), as pure
// functions. The journal is SESSION-SCOPED BY DESIGN: the host keeps it in a
// module-scope variable (never on the McpServer instance, §3.7, and never on
// disk) — it covers the runaway-agent case, not audit history, so a restart
// wiping it is correct behavior, not a limitation.
//
// The kit is generic over the undo op: what an op holds and how it is applied
// are the app's business. Each entry carries exactly the before-state its
// reversal needs, because the journal alone cannot reverse a write that
// destroyed or overwrote what it replaced.
//
// Grouping is the app's too: `journalGroups` and `journalSnapshot` take a
// `groupKey(op)` naming the single entity an op reverses. That function should
// THROW on an op kind it does not know, so a future multi-entity op fails at
// the grouping seam instead of silently grouping wrong.
//
// READING IT BACK (#2321): `journalPage` is the journal as a read tool shows
// it to an MCP client. The op is the undo descriptor, before-state copies of
// user data kept as host metadata: it never reaches tool output, and neither
// does the caller's idempotency key. The public row is BUILT from named
// fields, never derived by removing fields from an entry, so a field added to
// entries later stays private until a host names it.

import { paginate } from './pagination.js';

/**
 * Append one write to the journal. Immutable (returns a new array) so the
 * host's store is a plain reassigned variable, and seq is monotonically
 * increasing within the session regardless of any future trimming.
 *
 * @param {Array<{ seq: number }>} entries
 * @param {{ tool: string, summary: string, idempotencyKey?: string, op: unknown }} record
 * @param {string} nowIso ISO timestamp of the write (host clock)
 */
export function appendEntry(entries, record, nowIso) {
  const seq = entries.length > 0 ? entries[entries.length - 1].seq + 1 : 1;
  const entry = {
    seq,
    at: nowIso,
    tool: record.tool,
    summary: record.summary,
    ...(record.idempotencyKey !== undefined ? { idempotencyKey: record.idempotencyKey } : {}),
    op: record.op,
  };
  return [...entries, entry];
}

/**
 * The entity title inside a journal summary. Titles live only in summaries —
 * the op payloads mostly lack them — always wrapped in “ ” by the summary
 * builder. First “ to LAST ” is exactly the title in every summary shape
 * (nothing after the closing quote contains ”: dates, times, and fixed words
 * only), so titles with embedded quotes survive intact.
 *
 * @param {string} summary
 * @returns {string | null}
 */
export function summaryTitle(summary) {
  const start = summary.indexOf('“');
  const end = summary.lastIndexOf('”');
  return start !== -1 && end > start ? summary.slice(start + 1, end) : null;
}

/**
 * The default group label: the quoted title from the entry's summary, or the
 * raw summary when it quotes none.
 *
 * @param {{ summary: string }} entry
 * @returns {string}
 */
export function defaultGroupLabel(entry) {
  return summaryTitle(entry.summary) ?? entry.summary;
}

/**
 * Per-entity groups computed over the FULL journal — never a display trim,
 * whose window would undercount a busy entity — ordered by newest activity
 * first. The label comes from the group's LATEST entry, BY DESIGN: a write can
 * rename an entity mid-session, and the group represents the entity as it now
 * exists, so the newest entry's label must win. Older entries keep the
 * historical title in their own summaries, which is correct per-entry history.
 *
 * @param {Array<{ seq: number, summary: string, op: unknown }>} entries
 * @param {{ groupKey: (op: unknown) => string, groupLabel?: (entry: object) => string }} grouping
 * @returns {Array<{ key: string, label: string, count: number, latestSeq: number }>}
 */
export function journalGroups(entries, grouping) {
  const groupKey = grouping.groupKey;
  const groupLabel = grouping.groupLabel ?? defaultGroupLabel;
  const groups = new Map();
  for (const e of entries) {
    const key = groupKey(e.op);
    const label = groupLabel(e);
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.latestSeq = e.seq;
      existing.label = label;
    } else {
      groups.set(key, { key, label, count: 1, latestSeq: e.seq });
    }
  }
  return [...groups.values()].sort((a, b) => b.latestSeq - a.latestSeq);
}

/**
 * The display snapshot for a journal surface: newest first, bounded so a long
 * agent session cannot flood the display — the TOTAL always reports the full
 * session count, so "Undo all (N)" stays honest even when the list is trimmed
 * for display. Each display row carries its groupKey, and `groups` (counts,
 * labels) is computed over the FULL journal so per-entity counts stay honest
 * past the trim too.
 *
 * @param {Array<{ seq: number, summary: string, op: unknown }>} entries
 * @param {{ groupKey: (op: unknown) => string, groupLabel?: (entry: object) => string }} grouping
 * @param {number} [displayLimit]
 */
export function journalSnapshot(entries, grouping, displayLimit = 50) {
  return {
    total: entries.length,
    groups: journalGroups(entries, grouping),
    entries: entries
      .slice(-displayLimit)
      .reverse()
      // The op carries before-state copies of user data; the display surface
      // has no use for them and no business holding them.
      .map(({ op, ...display }) => ({ ...display, groupKey: grouping.groupKey(op) })),
  };
}

/**
 * Bulk-undo reconstruction: every session write reversed in REVERSE
 * chronological order, so compound histories unwind correctly — e.g.
 * create → schedule → move unwinds as restore-fields, restore-to-inbox,
 * remove-created, each op finding the state its own write produced.
 *
 * @param {Array<{ op: unknown }>} entries
 * @returns {{ count: number, ops: unknown[] }}
 */
export function buildUndoPlan(entries) {
  const ops = entries.slice().reverse().map((e) => e.op);
  return { count: entries.length, ops };
}

/** The public row's own keys: a host's ids may not take them over. */
const RESERVED_ROW_KEYS = new Set(['at', 'tool', 'summary', 'changes', 'op', 'seq', 'idempotencyKey', 'idempotency_key']);

/**
 * The canonical filter key of a journal read, which its pagination cursor is
 * bound to (pagination.js). Only the filters that are set, sorted by name, so
 * an omitted filter and the next page's omitted filter never mismatch.
 *
 * @param {Record<string, string | undefined>} [match]
 * @returns {string}
 */
export function journalFilterKey(match = {}) {
  const parts = Object.keys(match)
    .filter((k) => match[k] !== undefined)
    .sort()
    .map((k) => `${k}=${JSON.stringify(match[k])}`);
  return `journal:${parts.length ? parts.join('&') : 'all'}`;
}

/**
 * One journal entry as a read tool may show it, and the ids a filter matches
 * against. `describe(op)` is the app's: it names the entity ids the op touched
 * (`ids`, string values under the app's wire names) and, where the op kept
 * them, field-level `changes` ({ field, before } with an optional `after`), in
 * values the app's read tools would show. Nothing else of the op is read.
 * A describe that throws (an op kind it does not know) costs the row its ids
 * and changes, never the read: it is still listed, and matches no id filter.
 *
 * @param {{ at: string, tool: string, summary: string, op: unknown }} entry
 * @param {{ describe: (op: unknown) => ({ ids?: Record<string, unknown>, changes?: unknown[] } | null | undefined), formatAt?: (at: string) => unknown }} opts
 * @returns {{ row: Record<string, unknown>, ids: Record<string, string> }}
 */
export function publicJournalEntry(entry, { describe, formatAt }) {
  let described;
  try {
    described = describe(entry.op) ?? {};
  } catch {
    described = {};
  }
  const ids = {};
  for (const [key, value] of Object.entries(described.ids ?? {})) {
    if (typeof value === 'string' && !RESERVED_ROW_KEYS.has(key)) ids[key] = value;
  }
  const changes = (Array.isArray(described.changes) ? described.changes : [])
    .filter((c) => c && typeof c === 'object' && typeof c.field === 'string')
    .map((c) => ({
      field: c.field,
      before: c.before === undefined ? null : c.before,
      ...(Object.prototype.hasOwnProperty.call(c, 'after') ? { after: c.after === undefined ? null : c.after } : {}),
    }));
  const row = {
    at: formatAt ? formatAt(entry.at) : entry.at,
    tool: entry.tool,
    summary: entry.summary,
    ...ids,
    ...(changes.length ? { changes } : {}),
  };
  return { row, ids };
}

/**
 * The journal as a read tool returns it: newest first, narrowed to the rows
 * whose ids match EVERY filter given in `match`, then paginated with the
 * kit's cursor (bound to the filter, so a filter changed mid-walk is
 * refused). `total` counts the filtered rows. Nothing here bounds or trims
 * the journal: it pages over the host's whole session list, so nothing older
 * is ever dropped from what a client can reach.
 *
 * An invalid limit, cursor or filter value comes back as { ok: false,
 * reason }, for the tool layer to answer with its validation error.
 *
 * @param {Array<{ at: string, tool: string, summary: string, op: unknown }>} entries
 * @param {{
 *   describe: (op: unknown) => ({ ids?: Record<string, unknown>, changes?: unknown[] } | null | undefined),
 *   formatAt?: (at: string) => unknown,
 *   match?: Record<string, unknown>,
 *   limit?: unknown,
 *   cursor?: unknown,
 *   cursorPrefix?: string,
 * }} opts
 */
export function journalPage(entries, opts) {
  const wanted = Object.entries(opts.match ?? {}).filter(([, v]) => v !== undefined);
  for (const [key, value] of wanted) {
    if (typeof value !== 'string') return { ok: false, reason: `${key} must be a string, got ${JSON.stringify(value)}` };
  }
  const rows = [];
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const { row, ids } = publicJournalEntry(entries[i], opts);
    if (wanted.every(([key, value]) => ids[key] === value)) rows.push(row);
  }
  return paginate(rows, {
    limit: opts.limit,
    cursor: opts.cursor,
    filterKey: journalFilterKey(Object.fromEntries(wanted)),
    cursorPrefix: opts.cursorPrefix,
  });
}
