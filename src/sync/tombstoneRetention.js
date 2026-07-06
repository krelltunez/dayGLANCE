// Fixed tombstone-retention policy, decoupled from the user-facing "Keep past
// events" setting (syncRetentionDays / settings.keepPastEvents).
//
// WHY THIS EXISTS: dayGLANCE runs two sync transports over the SAME local state:
//   (a) the file-tier merge (@glance-apps/sync mergeSyncData, WebDAV/iCloud), and
//   (b) the vault DB engine (src/sync/dbEngine.js, per-row).
// The file-tier merge prunes deletion tombstones at `syncRetentionDays` — the
// value behind the "Keep past events" dropdown, which the user may set as low as
// 7 days. The vault merge (dbAdapter mergeBundle) is grow-only and never prunes.
// So a tombstone older than the user's event-retention window is DROPPED by the
// file-tier and immediately RE-ADDED by the grow-only vault union. The two
// transports write conflicting values to the shared tombstone singleton every
// cycle → the DB engine's snapshot-diff flags it dirty → push → account seq
// advance → SSE self-nudge → a continuous "heartbeat" loop.
//
// THE FIX: tombstone garbage-collection is its OWN policy, independent of event
// retention. Both transports prune tombstones at a FIXED window so they always
// agree: entries newer than the window are kept by both; entries older are
// dropped by both. The "Keep past events" toggle keeps governing imported-event
// storage (completedTaskUids) only — it no longer touches tombstones.
//
// WHY 60 DAYS (not user-configurable): a tombstone only needs to outlive the
// longest realistic gap before a stale device next syncs and would otherwise
// resurrect a deleted item. Sixty days comfortably covers a device left offline
// for weeks; keeping them longer only grows the payload with no benefit.

import { floorToUtcDayIso } from '../utils/tombstoneHorizon.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const TOMBSTONE_RETENTION_DAYS = 60;

// Canonical list of the deletion-tombstone singleton bundles ({id → ISO} maps).
// Both the file-tier override (mergeSync.js) and the vault prune (dbEngine.js /
// dbAdapter.js) iterate this exact set so the two transports stay in lockstep.
export const TOMBSTONE_BUNDLE_KEYS = [
  'deletedTaskIds',
  'deletedRoutineChipIds',
  'deletedFrameIds',
  'removedTodayRoutineIds',
  'deletedHabitIds',
  'deletedGoalIds',
  'deletedProjectIds',
  'deletedAreaIds',
];

/**
 * The day-floored cutoff Date: tombstones with a timestamp strictly older than
 * this are eligible for pruning. Flooring to the UTC day keeps the cutoff STABLE
 * across the many sync cycles within a day, so an unchanged cycle produces no
 * snapshot-diff (the same stability trick as tombstoneHorizon).
 *
 * @param {number} [nowMs] current epoch ms (injectable for tests)
 * @returns {Date}
 */
export function tombstoneCutoff(nowMs = Date.now()) {
  const floored = floorToUtcDayIso(new Date(nowMs - TOMBSTONE_RETENTION_DAYS * DAY_MS).toISOString());
  return new Date(floored);
}

/**
 * Drop tombstone entries older than `cutoff`. Absent/unparseable timestamps are
 * kept (fail-safe: never lose a tombstone we can't date). Returns a NEW object.
 *
 * @param {Record<string,string>} map  {id → ISO deletion timestamp}
 * @param {Date|null} cutoff           entries with ts < cutoff are removed
 * @returns {Record<string,string>}
 */
export function pruneTombstoneMap(map, cutoff) {
  if (!map || typeof map !== 'object') return {};
  if (!cutoff) return { ...map };
  const out = {};
  for (const [id, ts] of Object.entries(map)) {
    const t = new Date(ts).getTime();
    if (Number.isNaN(t) || t >= cutoff.getTime()) out[id] = ts;
  }
  return out;
}

/**
 * Union two {id → ISO} tombstone maps, keeping the newer timestamp per id
 * (grow-only set-union — mirrors dbAdapter's MERGE.unionNewerIso). Used to
 * reconstruct the full cross-device tombstone set before pruning.
 */
export function unionNewerIso(a = {}, b = {}) {
  const out = { ...(a || {}) };
  for (const [id, ts] of Object.entries(b || {})) {
    const prev = out[id];
    out[id] = (!prev || new Date(ts) > new Date(prev)) ? ts : prev;
  }
  return out;
}

/**
 * Prune every tombstone bundle present on `data` in place, at the fixed 60-day
 * cutoff. Only mutates keys that already exist (never fabricates an empty
 * bundle). Returns true if any bundle actually lost an entry, so a caller can
 * decide whether the change is worth persisting/pushing.
 *
 * @param {object} data     a sync payload / app-state object
 * @param {Date|null} [cutoff]
 * @returns {boolean} whether anything was pruned
 */
export function pruneAllTombstones(data, cutoff = tombstoneCutoff()) {
  if (!data || typeof data !== 'object' || !cutoff) return false;
  let changed = false;
  for (const key of TOMBSTONE_BUNDLE_KEYS) {
    const map = data[key];
    if (!map || typeof map !== 'object') continue;
    const before = Object.keys(map).length;
    const pruned = pruneTombstoneMap(map, cutoff);
    if (Object.keys(pruned).length !== before) {
      data[key] = pruned;
      changed = true;
    }
  }
  return changed;
}
