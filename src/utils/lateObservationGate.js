// The late-observation gate for daily notes (owner ruling, 2026-09-09,
// buildout spec 2.7: "newest mtime wins for text").
//
// A daily note's observations reach the app two ways: this device's own scan
// of the file, and the plugin's reports over the bridge stream. Either can
// arrive late: a stream row applied after a newer one, a second desktop's
// plugin reporting its lagging Obsidian Sync copy, or this device's own copy
// lagging behind an observation it already applied. The 2026-09-08 incident
// was a lagging copy; the same day's console showed a note's stamp move
// backwards at startup from a late row.
//
// The rule extends the existing one that a note's mtime is the vault's
// statement time (revival, §3.10 ruling 6) to the note's TEXT: an observation
// whose real mtime is strictly older than the mtime of the last observation
// this device applied for that date is stale evidence and is dropped, text
// and mtime both. Equal or newer applies as before. Memory is device-local
// (never synced): a storage purge resets it and the next observation applies.
// An observation with no real mtime carries no evidence either way and always
// applies, exactly as it always did.
//
// Known edge, accepted in the ruling: a note put back to an older version by
// a tool that preserves the old mtime is not seen until its next edit.
// Obsidian's own writes and restores set a fresh mtime.
//
// SCOPED NOTES AND PARSED TASKS (2026-09-17, after #1692's assessment). The
// gate judged daily notes only, and only their text: the tasks parsed from
// a stale report still merged, and a scoped note (a linked project note, a
// note in the vault task scope) was never judged at all. A second plugin
// copy reporting its lagging Obsidian Sync copy of a project note could
// then revert a dayGLANCE retitle for a round, or for good if that copy's
// last report was the stale one. Now every observed note is judged, keyed
// by date (daily) or path (scoped), and the tasks parsed from a skipped
// note are dropped with its text. The signal is the file's own mtime as the
// plugin reports it: Obsidian Sync carries a file's mtime with it, so a
// lagging copy reports the OLD version's mtime, not the time it arrived;
// the one exception the plugin makes (a note that arrived at a path by
// create or move reports its arrival time) is deliberate revival evidence.
// Path keys never parse as dates, so their memory entries are pruned by the
// age of the stored mtime instead.
//
// A DAMAGED REPORT DOES NOT ADVANCE THE MEMORY (2026-11-27 device test). A
// note whose report carries a damaged task line (a stray `^dg-` token inside
// a title: two lines run together by a merge, src/obsidian.js
// carriesStrayBlockToken) is still applied, but its mtime is not remembered
// as the note's newest. That report is not the vault's settled statement: the
// clean version can come back under an OLDER mtime (a copy restored with its
// own mtime), and remembering the damaged one would drop every clean report
// until the note was saved again. The damaged report's own mtime still counts
// as evidence for this batch; it is only the memory that it does not move.

export const LAST_APPLIED_MTIME_KEY = 'dayglance-obsidian-last-applied-mtime';
// Daily-note dates older than this fall out of the memory map.
export const LAST_APPLIED_RETAIN_DAYS = 400;

const DAY_MS = 24 * 60 * 60 * 1000;

const defaultStorage = () => (typeof localStorage !== 'undefined' ? localStorage : null);

export function readLastAppliedMtimes(storage = defaultStorage()) {
  try {
    const raw = storage?.getItem(LAST_APPLIED_MTIME_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeLastAppliedMtimes(map, storage = defaultStorage()) {
  try {
    if (!storage) return;
    if (Object.keys(map).length === 0) storage.removeItem(LAST_APPLIED_MTIME_KEY);
    else storage.setItem(LAST_APPLIED_MTIME_KEY, JSON.stringify(map));
  } catch { /* storage unavailable: the gate degrades to "always apply" */ }
}

/**
 * Pure gate. Returns the notes to apply, the evidence map without the skipped
 * dates, the observations skipped, and the memory map to persist.
 *
 * @param {Record<string, object>} dailyNotes   date → observed note
 * @param {Record<string, string>} noteMtimes   date → real mtime ISO (evidence)
 * @param {Record<string, string>} lastApplied  date → mtime ISO of the last applied observation
 * @param {{now?: number, scopedNotes?: object, holdKeys?: Set<string>}} [opts]  holdKeys: notes applied without moving the memory (a damaged report)
 */
export function gateLateObservations(dailyNotes, noteMtimes, lastApplied, { now = Date.now(), scopedNotes = null, holdKeys = null } = {}) {
  const fresh = {};
  const freshScoped = {};
  const evidence = {};
  const skipped = [];
  const next = {};
  const cutoff = now - LAST_APPLIED_RETAIN_DAYS * DAY_MS;
  for (const [key, iso] of Object.entries(lastApplied || {})) {
    const day = Date.parse(key);
    // A date key ages by its date; a path key by the mtime it remembers.
    const age = Number.isNaN(day) ? Date.parse(iso) : day;
    if (Number.isNaN(age) || age >= cutoff) next[key] = iso;
  }
  const judge = (key, note, out) => {
    const mtime = noteMtimes?.[key];
    const t = typeof mtime === 'string' ? Date.parse(mtime) : NaN;
    if (Number.isNaN(t)) {
      out[key] = note; // no real mtime: no evidence either way
      return;
    }
    const last = next[key] ? Date.parse(next[key]) : NaN;
    if (!Number.isNaN(last) && t < last) {
      skipped.push({ key, date: key, mtime, lastApplied: next[key] });
      return;
    }
    out[key] = note;
    evidence[key] = mtime;
    if (!holdKeys || !holdKeys.has(key)) next[key] = mtime;
  };
  for (const [date, note] of Object.entries(dailyNotes || {})) judge(date, note, fresh);
  for (const [path, note] of Object.entries(scopedNotes || {})) judge(path, note, freshScoped);
  // Evidence for notes the gate did not judge (keys not in this observation)
  // passes through untouched.
  for (const [key, iso] of Object.entries(noteMtimes || {})) {
    if (!(key in (dailyNotes || {})) && !(key in (scopedNotes || {}))) evidence[key] = iso;
  }
  return { fresh, freshScoped, evidence, skipped, next };
}

/** The note key a parsed task claims its line from: a scoped note's path, or a daily note's date. */
export function taskNoteKey(task) {
  return task?.obsidianNotePath || task?.obsidianFileDate || null;
}

/**
 * Drop the tasks parsed from skipped notes: stale evidence about the line is
 * stale evidence about the task. Returns the same array when nothing was
 * dropped.
 */
export function dropTasksOfSkippedNotes(tasks, skippedKeys) {
  if (!Array.isArray(tasks) || !skippedKeys || skippedKeys.size === 0) return tasks || [];
  const out = tasks.filter((t) => { const k = taskNoteKey(t); return !(k && skippedKeys.has(k)); });
  return out.length === tasks.length ? tasks : out;
}

/**
 * The gate as the sync hook uses it: read the memory, judge daily notes (by
 * date) and scoped notes (by path), persist, log.
 * @returns {{dailyNotes: object, scopedNotes: object, noteMtimes: object, skipped: Array, skippedKeys: Set<string>}}
 */
export function applyLateObservationGate(dailyNotes, noteMtimes, storage = defaultStorage(), scopedNotes = null, holdKeys = null) {
  const { fresh, freshScoped, evidence, skipped, next } = gateLateObservations(dailyNotes, noteMtimes, readLastAppliedMtimes(storage), { scopedNotes, holdKeys });
  writeLastAppliedMtimes(next, storage);
  if (skipped.length) {
    console.info('[Obsidian] late observation skipped (older than the last applied mtime, spec 2.7):',
      skipped.map((s) => `${s.key} ${s.mtime} < ${s.lastApplied}`).join('; '));
  }
  return { dailyNotes: fresh, scopedNotes: freshScoped, noteMtimes: evidence, skipped, skippedKeys: new Set(skipped.map((s) => s.key)) };
}
