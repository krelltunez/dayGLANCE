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
