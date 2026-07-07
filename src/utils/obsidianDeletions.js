// Obsidian deletion tombstones (Option 1).
//
// The merge-not-replace fix stops the cross-device resurrection loop but, on its
// own, never removes an Obsidian note/task once it's synced — a note/task deleted
// IN the vault lingers forever. This module makes a genuine vault deletion
// propagate, WITHOUT resurrecting rows that are merely out-of-window or not yet
// downloaded on some device.
//
// Detection is per-device and CONSERVATIVE (a false positive deletes the row on
// every device):
//   - Only items THIS device previously scanned can be reported deleted. A note a
//     device never downloaded was never in its `lastScanned`, so that device can
//     never tombstone it — this structurally rules out the lazy-download false
//     positive.
//   - A scan that returns nothing (but last time returned rows), or that drops
//     more than a small margin of its items at once, is treated as an INCOMPLETE
//     scan (mid-index / I/O timeout / partly-synced vault) and reports NO
//     deletions. A real bulk deletion simply waits for a clean scan.
//
// Tombstones are stored in the synced `deletedObsidianKeys` map ({ key → deletedAt
// ISO }, key = daily-note date or Obsidian task id), which merges grow-only by
// newest-per-key and prunes at the 60-day horizon like every other tombstone
// bundle (src/sync/tombstoneRetention.js). A later re-creation in Obsidian wins by
// last-writer-wins: its `lastModified` beats the tombstone and the row resurrects.

const ts = (v) => {
  if (v == null) return 0;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
};

// Every Obsidian key carries a date: a daily-note key IS the date; a task id is
// `obsidian-YYYY-MM-DD-hash`. Returns 'YYYY-MM-DD' or null.
export function obsidianKeyDate(key) {
  const s = String(key);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^obsidian-(\d{4}-\d{2}-\d{2})-/.exec(s);
  return m ? m[1] : null;
}

/**
 * Decide which previously-scanned keys were genuinely deleted from the vault.
 *
 * @param {string[]} lastScanned  keys THIS device's previous scan produced
 * @param {string[]} current      keys THIS device's current scan produced
 * @param {string|null} [cutoffDate]  the scan's retention cutoff 'YYYY-MM-DD'; keys
 *   with an older date left the scan because the window slid forward, NOT because
 *   they were deleted — they are excluded. null = no window (scan is unlimited).
 * @param {object}  [opts]
 * @param {number}  [opts.maxDropAbs=5]     absolute drop above which a scan is deemed incomplete
 * @param {number}  [opts.maxDropRatio=0.25] fractional drop above which a scan is deemed incomplete
 * @returns {{ deletions: string[], skipped: boolean, reason: string|null }}
 *   `deletions` — keys to tombstone (empty when skipped). `skipped` — the scan was
 *   judged incomplete and NO deletions were inferred (caller should also NOT
 *   overwrite its stored `lastScanned`, so a clean scan can still catch up).
 */
export function detectObsidianDeletions(lastScanned, current, cutoffDate = null, opts = {}) {
  const { maxDropAbs = 5, maxDropRatio = 0.25 } = opts;
  const last = new Set(lastScanned || []);
  const cur = new Set(current || []);
  if (last.size === 0) return { deletions: [], skipped: false, reason: null };
  // Empty result but we had rows before → almost certainly a failed/partial scan.
  if (cur.size === 0) return { deletions: [], skipped: true, reason: 'empty-scan' };
  let missing = [...last].filter((k) => !cur.has(k));
  // Exclude keys that aged out of the retention scan window: they disappeared
  // because the cutoff moved forward, not because the note/task was deleted.
  // A key whose date can't be read is excluded too (conservative — never tombstone
  // something we can't prove is in-window).
  if (cutoffDate) {
    missing = missing.filter((k) => {
      const d = obsidianKeyDate(k);
      return d != null && d >= cutoffDate;
    });
  }
  if (missing.length === 0) return { deletions: [], skipped: false, reason: null };
  // A large simultaneous disappearance reads as an incomplete scan, not that many
  // real deletions at once. Conservative: infer nothing this cycle.
  const threshold = Math.max(maxDropAbs, Math.ceil(last.size * maxDropRatio));
  if (missing.length > threshold) return { deletions: [], skipped: true, reason: 'drop-too-large' };
  return { deletions: missing, skipped: false, reason: null };
}

/**
 * True when `key` carries a deletion tombstone at least as new as `lastModified`
 * — i.e. the deletion wins last-writer-wins and the row must stay gone. A row
 * re-created later in Obsidian (newer lastModified) is NOT suppressed.
 *
 * @param {Record<string,string>} tombstones  deletedObsidianKeys map
 * @param {string} key                         daily-note date or task id
 * @param {string} [lastModified]              the row's lastModified ISO
 */
export function isObsidianTombstoned(tombstones, key, lastModified) {
  const at = tombstones && tombstones[key];
  if (!at) return false;
  return ts(at) >= ts(lastModified);
}

/**
 * Add `deletedAt` tombstones for `keys` onto a copy of `tombstones`, keeping the
 * newest per key. Pure — returns a new map.
 */
export function addObsidianTombstones(tombstones, keys, deletedAtIso) {
  const out = { ...(tombstones || {}) };
  for (const k of keys || []) {
    if (!out[k] || ts(deletedAtIso) > ts(out[k])) out[k] = deletedAtIso;
  }
  return out;
}
