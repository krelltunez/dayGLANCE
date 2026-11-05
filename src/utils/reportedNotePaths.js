// THE INDEX OF REPORTED NOTE PATHS (#2291 follow-up: task notes). Pure: the
// structure, how a listing of observation rows updates it, and how a task's
// [[link]] resolves against it. The storage and the listings are
// utils/reportedNoteIndexStore.js and obsidianBridgeInbound.js.
//
// WHY IT EXISTS. The plugin's observation rows are keyed by a hash of the
// note's path (observationEntityId), so a device without the vault folder
// cannot ask GLANCEvault which notes exist: it can only read a path it
// already knows. Without an index a bare [[Name]] was resolved by guessing
// likely homes (taskNoteSources.js taskNoteCandidates), which cannot see a
// note shared by a scope TAG in an unrelated folder, a daily note, or a
// partial path ([[Alpha/Plan]] for Work/Alpha/Plan.md), and which can miss
// one of two same-named notes and show the other instead of "ambiguous".
// Every observation row carries its path inside the envelope, and the
// device decrypts them anyway; the index keeps the PATHS (never the content)
// of the notes the plugin reports, so a name resolves the way Obsidian
// resolves it, among every note the plugin shares.
//
// SHAPE. { v, key, complete, seq, paths: { [path]: [rowSeq, state] } }
//   key       the pairing it was built under (reportedNoteIndexKey): a
//             re-pair, another account or another server starts it afresh,
//             since the old rows are sealed under a key no longer derived
//   complete  a listing from zero succeeded: until then the index knows
//             only part of the stream and the caller keeps guessing
//   seq       every row up to this seq has been applied (the index's OWN
//             cursor, never the cycle's: see the store)
//   paths     the path as the plugin reported it (Obsidian's own spelling,
//             NFC or not), the seq of the row that said so, and its state:
//             'n' a note it reports, 'd' deleted, 'w' withdrawn (left the
//             scope: the note exists, it is no longer shared)
//
// A deleted or withdrawn path stays as a marker rather than vanishing, so
// the panel can still say "deleted" or "not shared" for a name, and so an
// older copy of a row can never bring a path back: a row's state is applied
// only over an older seq of the same path, which makes applying listings
// order-independent and idempotent (the cycle's pull and an on-demand
// listing may land in either order).

export const REPORTED_NOTE_INDEX_VERSION = 1;

const STATE_NOTE = 'n';
const STATE_DELETED = 'd';
const STATE_WITHDRAWN = 'w';

const folded = (p) => String(p ?? '').normalize('NFC').toLowerCase();

/**
 * The pairing an index belongs to: the GLANCEvault server, the account, and
 * the pairing generation and salt from the pairing meta. Null when any is
 * missing (no index can be kept or trusted).
 */
export function reportedNoteIndexKey(cfg, meta) {
  if (!cfg?.vaultUrl || !cfg?.accountId || !meta?.pairingSalt) return null;
  return [String(cfg.vaultUrl).replace(/\/+$/, ''), cfg.accountId, meta.generation ?? '', meta.pairingSalt].join('|');
}

/** A fresh index for a pairing: nothing known, not complete. */
export function emptyReportedNoteIndex(key) {
  return { v: REPORTED_NOTE_INDEX_VERSION, key, complete: false, seq: 0, paths: {} };
}

/**
 * A stored value read back, if it is an index for THIS pairing; otherwise
 * null. Null is "incomplete", never "no notes": an unreadable, foreign or
 * malformed value is no information (not loaded is not empty).
 */
export function readableReportedNoteIndex(stored, key) {
  if (!key || !stored || typeof stored !== 'object') return null;
  if (stored.v !== REPORTED_NOTE_INDEX_VERSION || stored.key !== key) return null;
  if (typeof stored.complete !== 'boolean' || !Number.isFinite(stored.seq)) return null;
  if (!stored.paths || typeof stored.paths !== 'object' || Array.isArray(stored.paths)) return null;
  return stored;
}

/**
 * One decrypted observation row → what it says about its path: { path, seq,
 * state }, or null when it says nothing about a note (a project-note LINK
 * row, not an observation, no path). The state reads as fetchReportedNote
 * reads a report: deleted, then withdrawn, then a note with content.
 */
export function observationPathReport(payload, seq) {
  if (!payload || payload.kind !== 'observation' || payload.link) return null;
  if (typeof payload.path !== 'string' || !payload.path) return null;
  let state = STATE_NOTE;
  if (payload.deleted) state = STATE_DELETED;
  else if (payload.withdrawn) state = STATE_WITHDRAWN;
  else if (typeof payload.content !== 'string') state = STATE_DELETED;
  return { path: payload.path, seq: Number(seq) || 0, state };
}

/**
 * Apply one listing of observation rows: { key, since, maxSeq, reports,
 * full }, where `since` is the cursor the listing started from, `full` that
 * it started from zero and read every page, and `reports` its rows as
 * observationPathReport returns them.
 *
 * Returns { index, applied }. A full listing completes the index. Any other
 * listing applies only when it CONTINUES a complete index of the same
 * pairing (it started at or before the index's seq), since a gap between the
 * two would leave notes reported in it unknown while the index claimed to be
 * complete. Not applied, the index is returned as it was.
 */
export function mergeReportedNotePaths(index, { key, since = 0, maxSeq = 0, reports = [], full = false }) {
  const base = index && index.key === key ? index : emptyReportedNoteIndex(key);
  if (!key) return { index: base, applied: false };
  if (!full && !(base.complete && base.seq >= since)) return { index: base, applied: false };
  const paths = { ...base.paths };
  for (const r of reports) {
    if (!r || typeof r.path !== 'string') continue;
    const held = paths[r.path];
    if (held && held[0] > r.seq) continue; // an older copy of the row: the newer stands
    paths[r.path] = [r.seq, r.state];
  }
  return {
    index: { v: REPORTED_NOTE_INDEX_VERSION, key, complete: true, seq: Math.max(base.seq, Number(maxSeq) || 0), paths },
    applied: true,
  };
}

/**
 * A task's link (parseTaskNoteLink's { path, qualified, basename }) against
 * a COMPLETE index, as Obsidian resolves a link, case-insensitively and
 * NFC-folded:
 *
 *   • a link with a folder: that exact path, when it is a reported note;
 *     else the notes whose path ENDS with it on a segment boundary
 *     ([[Alpha/Plan]] finds Work/Alpha/Plan.md, never Work/Xalpha/Plan.md);
 *   • a bare name: the notes of that basename, wherever they are.
 *
 * Answers { path } (exactly one reported note: its path as reported),
 * { ambiguous: true } (two or more), or { none } when no reported note
 * matches: 'withdrawn' (one that matches left the scope: it exists, not
 * shared), 'deleted' (one was reported deleted), or 'unreported' (nothing of
 * that name was ever reported). Spellings of one path that differ only in
 * case or normalization are one note, in the state of its newest row.
 */
export function resolveIndexedTaskNote(link, index) {
  const target = folded(link.path);
  const groups = new Map();
  for (const [path, entry] of Object.entries(index?.paths ?? {})) {
    if (!Array.isArray(entry)) continue;
    const f = folded(path);
    if (f !== target && !f.endsWith(`/${target}`)) continue;
    const [seq, state] = entry;
    const held = groups.get(f);
    if (!held || seq > held.seq) groups.set(f, { path, seq, state, exact: f === target });
  }
  const notes = [...groups.values()].filter((g) => g.state === STATE_NOTE);
  if (link.qualified) {
    const exact = notes.find((g) => g.exact);
    if (exact) return { path: exact.path };
  }
  if (notes.length === 1) return { path: notes[0].path };
  if (notes.length > 1) return { ambiguous: true };
  const states = new Set([...groups.values()].map((g) => g.state));
  if (states.has(STATE_WITHDRAWN)) return { none: 'withdrawn' };
  if (states.has(STATE_DELETED)) return { none: 'deleted' };
  return { none: 'unreported' };
}
