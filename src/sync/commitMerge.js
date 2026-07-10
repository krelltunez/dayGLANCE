// Merge-aware commit for the GLANCEvault DB cycle (src/sync/dbEngine.js).
//
// THE HAZARD THIS CLOSES: dbEngine clones app state into a per-cycle MIRROR at
// cycle start, runs the (async, network-bound) pull/push against the mirror, and
// finally hands the mirror to commitData — where App.jsx's applyEngineData
// REPLACES tasks/notes/etc. wholesale. Any ordinary user write made DURING the
// network window (a new task, an edit) exists only in live state, not in the
// mirror, so the commit silently reverts it; and because the post-cycle snapshot
// used to be taken from that same mirror, the reverted write never showed up as
// a diff again — it was never marked dirty, never pushed, permanently lost.
//
// THE FIX: at commit time, re-read live state and merge every MID-CYCLE live
// change into the mirror before it is committed:
//
//   • An entity whose live hash equals its cycle-start hash was untouched
//     mid-cycle → the pulled/merged mirror copy stands (remote changes land).
//   • An entity that changed mid-cycle and is ALSO present in the mirror is a
//     genuine concurrent-edit conflict (the pull may have updated the same row):
//     resolve by LAST-WRITER-WINS on lastModified. Ties (and entities with no
//     lastModified semantics at all) prefer LIVE state — the user's in-hand edit
//     — mirroring the engine's own pull rule where local wins on a non-older
//     timestamp (@glance-apps/sync dbEngine.js applyRemoteRow).
//   • A live entity with NO mirror copy either (a) never existed at cycle start
//     → it was created mid-cycle and MUST survive, or (b) existed at cycle start
//     but was removed from the mirror by a pulled delete / cross-list reconcile
//     while the user was editing it. A delete row carries no lastModified to LWW
//     against, so (b) biases toward KEEPING the edit (fail-safe toward data; a
//     genuinely tombstoned delete still wins long-term via its tombstone bundle).
//   • Singleton bundles changed mid-cycle are merged through the SAME per-bundle
//     strategy the pull uses (union / per-key LWW via applyRemoteEntity), so
//     neither a pulled peer edit nor the mid-cycle local edit to a different
//     entry is lost. Device-local bundles are the exception: the pull merge
//     deliberately keeps "local" — which at commit time is the STALE mirror copy
//     — so for those the live value is written through directly.
//   • An entity present in the mirror but gone from live either (a) was pulled
//     in from a peer this cycle (absent at cycle start too) → keep it, or (b)
//     was deleted locally mid-cycle → honor the deletion, but ONLY when it bears
//     a real-deletion fingerprint (a tombstone at least as new as the mirror
//     copy being deleted, or a cross-list survivor) per partitionSnapshotDeletes
//     — a bare mid-cycle vanish, or one blessed only by a STALE tombstone left
//     over from before the entity was revived, is a glitch-suspect and the
//     mirror copy is kept (same bias as snapshotDeleteGuard).
//
// WHY SURVIVORS STILL GET PUSHED (the snapshot contract): dbEngine saves the
// post-cycle snapshot from the mirror AS PUSHED/PULLED (i.e. BEFORE this merge),
// which is the vault-consistent state. A surviving mid-cycle edit is therefore
// committed to live state but ABSENT from the snapshot, so the NEXT cycle's
// snapshot-diff marks it dirty and pushes it. Full trace in dbEngine.js at the
// call site.

import {
  shredState,
  getLocalEntity,
  applyRemoteEntity,
  applyRemoteDelete,
  getEntityLastModified,
  entityKind,
  SINGLETON_KIND,
  isDeviceLocalBundle,
} from './dbAdapter.js';
import { partitionSnapshotDeletes } from './snapshotDeleteGuard.js';

// The one hash used for every snapshot/diff comparison in the DB tier. Both the
// persisted post-cycle snapshot (dbEngine) and the mid-cycle-change detection
// here MUST use the same function, or diffs would misfire.
export const hashEntity = (entity) => JSON.stringify(entity);

// entityId → entity-hash for a whole payload — the snapshot/diff currency.
export function shredHashes(data) {
  const map = {};
  for (const row of shredState(data)) map[row.entityId] = hashEntity(row.entity);
  return map;
}

// Key-set + value equality of two hash maps (order-independent).
export function hashMapsEqual(a, b) {
  const ka = Object.keys(a || {});
  const kb = Object.keys(b || {});
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (b[k] !== a[k]) return false;
  return true;
}

const ts = (v) => {
  if (v == null) return 0;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
};

// Write one live entity into the mirror verbatim. Collections/notes go through
// applyRemoteEntity (plain upsert; recurring templates additionally union their
// completedDates with the mirror copy, which only ever ADDS pulled completions).
// Singletons are written directly — applyRemoteEntity would run the pull merge,
// which for device-local bundles keeps the (stale) mirror copy.
function injectLive(mirror, entity) {
  if (entityKind(entity) === SINGLETON_KIND) {
    mirror[entity._key] = entity.value;
    if (entity._extra) Object.assign(mirror, entity._extra);
    return;
  }
  applyRemoteEntity(mirror, entity);
}

/**
 * Merge mid-cycle live edits into the per-cycle mirror before it is committed.
 * Mutates `mirror` in place (it is a per-cycle clone).
 *
 * @param {object} mirror      the pulled/merged/pushed cycle mirror
 * @param {Record<string,string>} baseHashes  shredHashes of the state at cycle START
 * @param {object} live        a fresh clone of getData() taken at commit time
 * @returns {{ survivors: string[], honoredDeletes: string[], keptVanishes: string[],
 *             liveHashes: Record<string,string> }}
 *   survivors:      live entityIds written into the commit (created/edited mid-cycle)
 *   honoredDeletes: mirror entityIds removed because live deleted them mid-cycle
 *                   (tombstoned / cross-list — real deletions only)
 *   keptVanishes:   live-absent entityIds KEPT in the commit (bare mid-cycle
 *                   vanish with no deletion fingerprint — glitch-suspect)
 *   liveHashes:     shredHashes of `live` (reusable by the caller's no-op check)
 */
export function mergeMidCycleEdits(mirror, baseHashes, live) {
  const base = baseHashes || {};
  const liveData = live || {};
  const liveRows = shredState(liveData);
  const liveHashes = {};
  for (const row of liveRows) liveHashes[row.entityId] = hashEntity(row.entity);

  const survivors = [];
  for (const row of liveRows) {
    const id = row.entityId;
    if (base[id] === liveHashes[id]) continue; // untouched mid-cycle → pull result stands
    const liveEntity = row.entity;
    const mirrorEntity = getLocalEntity(mirror, id);

    if (mirrorEntity == null) {
      // Created mid-cycle (no cycle-start copy) — or edited mid-cycle while a
      // pulled delete/reconcile removed it from the mirror. Either way the live
      // copy survives (see header: bias toward keeping a concurrent edit).
      injectLive(mirror, liveEntity);
      survivors.push(id);
      continue;
    }

    if (entityKind(liveEntity) === SINGLETON_KIND) {
      // Run the live edit through the same per-bundle merge the pull uses, so a
      // pulled peer edit and the mid-cycle local edit BOTH land (union bundles),
      // and timestamped config pairs resolve by their own LWW.
      applyRemoteEntity(mirror, liveEntity);
      // Device-local bundles: the merge keeps "local" = the stale mirror copy;
      // the live value is this device's truth — write it through.
      if (isDeviceLocalBundle(mirror, liveEntity._key)) injectLive(mirror, liveEntity);
      survivors.push(id);
      continue;
    }

    // Concurrent edit vs. (possibly) pulled update of the SAME entity: LWW on
    // lastModified. Ties and timestamp-less entities prefer LIVE (see header).
    if (ts(getEntityLastModified(liveEntity)) >= ts(getEntityLastModified(mirrorEntity))) {
      injectLive(mirror, liveEntity);
      survivors.push(id);
    }
    // else: the mirror copy (a strictly newer pulled write) wins — nothing to do.
  }

  // Mid-cycle local deletions: in the cycle-start state and still in the mirror,
  // but gone from live. Honor only REAL deletions (tombstoned / cross-list); a
  // bare vanish is a glitch-suspect and the mirror copy is kept — exactly the
  // snapshotDeleteGuard bias, applied to the commit instead of the push.
  const wantDelete = [];
  for (const id of Object.keys(base)) {
    if (liveHashes[id] !== undefined) continue;      // still live
    if (getLocalEntity(mirror, id) == null) continue; // already gone from the mirror
    wantDelete.push(id);
  }
  // Same stale-tombstone rule as the push guard: the copy being deleted here is
  // the MIRROR copy (possibly a pulled update newer than cycle start), so its
  // lastModified is what the live tombstone must be at least as new as. A stale
  // tombstone (revived entity) demotes the vanish to glitch-suspect → kept.
  const { propagate, skipped } = partitionSnapshotDeletes(
    wantDelete, liveHashes, liveData, (eid) => getLocalEntity(mirror, eid),
  );
  for (const id of propagate) applyRemoteDelete(mirror, id);

  return { survivors, honoredDeletes: propagate, keptVanishes: skipped, liveHashes };
}
