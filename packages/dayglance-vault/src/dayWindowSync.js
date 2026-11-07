// Day-window sync primitives — the ONE definition of the day-window map's
// shape, migration, resolution, and merge, shared by every consumer:
//
//   - useDayWindows (storage + React state + the strip/markers' resolution)
//   - mergeSync.js (file-tier WebDAV/iCloud merge wrapper)
//   - dbAdapter.js (GLANCEvault singleton-bundle merge)
//
// One function everywhere means the tiers can never disagree about a merge.
//
// SHAPE (v2, synced): a flat map keyed by 'YYYY-MM-DD' plus the reserved key
// 'defaults', each entry { start: 'HH:MM'|null, stop: 'HH:MM'|null,
// lastModified: ISO }. 'defaults' is deliberately just another entry — it
// merges LWW like any date, so sticky-forward defaults travel across devices
// with no special casing. An entry with both bounds null is an EXPLICIT OFF
// (that day opted out of the inherited default); clearing writes one rather
// than deleting, which is why this slice needs no tombstones.
//
// v1 (phase A, device-local) was { defaults: {start,stop}|null,
// byDate: {date → {start,stop}} } with no timestamps. Migration flattens it and
// stamps entries with the EPOCH, so any real synced edit beats legacy local
// data; two never-edited devices keep their own copies until the first real
// edit (ties keep local), which then wins everywhere.

export const DAY_WINDOWS_STORAGE_KEY = 'day-planner-day-windows';
export const DEFAULTS_KEY = 'defaults';

const EPOCH = '1970-01-01T00:00:00.000Z';

const ts = (v) => {
  if (v == null) return 0;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
};

const isEntry = (e) => e && typeof e === 'object';

/**
 * Normalize whatever is in storage to the v2 flat map. Accepts v2 (returned
 * as-is-shaped), v1 ({defaults, byDate} — flattened, epoch-stamped), or
 * garbage (→ {}).
 */
export function migrateDayWindows(raw) {
  if (!raw || typeof raw !== 'object') return {};

  // v1 marker: the byDate wrapper (v2 keys are dates + 'defaults' directly).
  if ('byDate' in raw || ('defaults' in raw && !isEntry(raw.defaults?.start) && raw.byDate !== undefined)) {
    const out = {};
    if (isEntry(raw.defaults)) {
      out[DEFAULTS_KEY] = { start: raw.defaults.start ?? null, stop: raw.defaults.stop ?? null, lastModified: EPOCH };
    }
    for (const [date, e] of Object.entries(raw.byDate || {})) {
      if (isEntry(e)) out[date] = { start: e.start ?? null, stop: e.stop ?? null, lastModified: EPOCH };
    }
    return out;
  }

  // v2: keep well-formed entries, stamp any missing lastModified with epoch.
  const out = {};
  for (const [key, e] of Object.entries(raw)) {
    if (!isEntry(e)) continue;
    out[key] = { start: e.start ?? null, stop: e.stop ?? null, lastModified: e.lastModified ?? EPOCH };
  }
  return out;
}

/**
 * Per-key last-writer-wins merge. Local wins ties (mirrors the file tier's
 * mergeCalendarConfigByUser convention). Returns the LOCAL REFERENCE untouched
 * when nothing remote is newer, so callers can use identity as a cheap
 * did-anything-change check.
 */
export function mergeDayWindowMaps(local, remote) {
  const l = local || {};
  const r = remote || {};
  let out = null; // lazily cloned only when a remote entry wins
  for (const [key, entry] of Object.entries(r)) {
    if (!isEntry(entry)) continue;
    const mine = l[key];
    if (!mine || ts(entry.lastModified) > ts(mine.lastModified)) {
      if (!out) out = { ...l };
      out[key] = { start: entry.start ?? null, stop: entry.stop ?? null, lastModified: entry.lastModified ?? EPOCH };
    }
  }
  return out ?? l;
}

/** True when the two maps agree entry-for-entry (used to decide a re-push). */
export function dayWindowMapsEqual(a, b) {
  const ka = Object.keys(a || {});
  const kb = Object.keys(b || {});
  if (ka.length !== kb.length) return false;
  return ka.every((k) => {
    const x = (a || {})[k];
    const y = (b || {})[k];
    return isEntry(y) && x.start === (y.start ?? null) && x.stop === (y.stop ?? null)
      && ts(x.lastModified) === ts(y.lastModified);
  });
}

/**
 * Resolve a date's window: explicit entry (including explicit off) → defaults
 * → none. Returns {start, stop} with 'HH:MM'|null fields, or null when no
 * window applies.
 */
export function resolveDayWindow(map, dateStr) {
  const m = map || {};
  const entry = m[dateStr] !== undefined ? m[dateStr] : m[DEFAULTS_KEY];
  if (!isEntry(entry) || (!entry.start && !entry.stop)) return null;
  return { start: entry.start ?? null, stop: entry.stop ?? null };
}
