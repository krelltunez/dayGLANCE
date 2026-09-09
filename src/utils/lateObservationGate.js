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
 * @param {{now?: number}} [opts]
 */
export function gateLateObservations(dailyNotes, noteMtimes, lastApplied, { now = Date.now() } = {}) {
  const fresh = {};
  const evidence = {};
  const skipped = [];
  const next = {};
  const cutoff = now - LAST_APPLIED_RETAIN_DAYS * DAY_MS;
  for (const [date, iso] of Object.entries(lastApplied || {})) {
    const day = Date.parse(date);
    if (Number.isNaN(day) || day >= cutoff) next[date] = iso;
  }
  for (const [date, note] of Object.entries(dailyNotes || {})) {
    const mtime = noteMtimes?.[date];
    const t = typeof mtime === 'string' ? Date.parse(mtime) : NaN;
    if (Number.isNaN(t)) {
      fresh[date] = note; // no real mtime: no evidence either way
      continue;
    }
    const last = next[date] ? Date.parse(next[date]) : NaN;
    if (!Number.isNaN(last) && t < last) {
      skipped.push({ date, mtime, lastApplied: next[date] });
      continue;
    }
    fresh[date] = note;
    evidence[date] = mtime;
    next[date] = mtime;
  }
  // Evidence for notes the gate did not judge (scoped notes keyed by path,
  // dates not in this observation) passes through untouched.
  for (const [key, iso] of Object.entries(noteMtimes || {})) {
    if (!(key in (dailyNotes || {}))) evidence[key] = iso;
  }
  return { fresh, evidence, skipped, next };
}

/**
 * The gate as the sync hook uses it: read the memory, judge, persist, log.
 * @returns {{dailyNotes: object, noteMtimes: object, skipped: Array}}
 */
export function applyLateObservationGate(dailyNotes, noteMtimes, storage = defaultStorage()) {
  const { fresh, evidence, skipped, next } = gateLateObservations(dailyNotes, noteMtimes, readLastAppliedMtimes(storage));
  writeLastAppliedMtimes(next, storage);
  if (skipped.length) {
    console.info('[Obsidian] late observation skipped (older than the last applied mtime, spec 2.7):',
      skipped.map((s) => `${s.date} ${s.mtime} < ${s.lastApplied}`).join('; '));
  }
  return { dailyNotes: fresh, noteMtimes: evidence, skipped };
}
