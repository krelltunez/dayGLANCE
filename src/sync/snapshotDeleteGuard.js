// Guard against the vault engine broadcasting a LOCAL-STATE GLITCH as permanent,
// fleet-wide deletion.
//
// THE HAZARD: src/sync/dbEngine.js seeds its push dirty-set by diffing the current
// in-memory payload (getData()) against the last-pushed snapshot. Any entity that
// was in the snapshot but is missing from getData() is marked as a DELETE and
// soft-deleted in the vault — where every other device then applies it. That diff
// has no way to tell "the user deleted this" from "the in-memory list transiently
// shrank" (a bad merge, a load/save race, an interrupted apply). So one device
// briefly dropping N tasks in memory deletes those N REAL tasks for the whole fleet.
// Observed: a device that diverged to a smaller task set emitted ~160 deletes for
// live, un-deleted tasks; the healthy device kept re-adding them → a delete↔re-add
// war over real data.
//
// THE INVARIANT: a genuine deletion always leaves a fingerprint.
//   • A permanent delete writes a deletion tombstone (deletedTaskIds / deletedFrameIds
//     / … — every delete path does this; see useRecycleBin, useTaskActions), OR
//   • a move (task → recycle bin, cross-list) keeps the entity's id present under a
//     DIFFERENT kind, so the id still appears somewhere in getData().
// An entity that vanishes from memory with NEITHER a tombstone NOR a surviving copy
// under another kind has no legitimate delete path — it is a suspected glitch. We
// skip its delete: the row stays in the vault (fail-safe toward KEEPING data).
// NOTE the row is NOT "simply re-pulled next cycle" — its seq sits below the pull
// cursor, so an incremental pull never re-lists it. Recovery is the caller's job:
// dbEngine.js re-fetches each skipped row by id (vault row-get) and re-injects it
// into the commit, and withholds the cycle's snapshot while any skipped row remains
// unrecovered so the row stays in the diff baseline (a transient shrink then
// self-heals against the OLD snapshot). A skipped glitch-delete costs at most a
// stale row that resurrects; propagating it costs real, irreversible data loss —
// so we bias hard toward keeping.
//
// THE TIMESTAMP RULE: a tombstone only AUTHORIZES a vanish-delete when it is at
// least as new as the copy being deleted. Tombstones linger for up to 60 days
// (tombstoneRetention.js), but a task can be deleted and then legitimately come
// BACK while its tombstone lingers — a newer edit beats the delete under
// newest-write-wins (a supported vault-tier flow as of @glance-apps/sync 1.6.0),
// or the user restores it from the recycle bin (useRecycleBin re-stamps
// lastModified to "now" precisely so the restore wins). During that window a
// transient shrink that drops the REVIVED task must not be blessed by the stale
// tombstone. So the tombstone bundles' VALUES (ISO deletion timestamps) are
// compared against the deleted copy's lastModified (via `getDeletedEntity`):
//
//   tombstoneTs >= lastModified − STALE_TOMBSTONE_EPSILON_MS  → real delete, propagate
//   tombstoneTs <  lastModified − epsilon                     → 'stale-tombstone', skip
//
// The epsilon covers real deletes where the same operation stamps the entity's
// lastModified moments after (or before) writing the tombstone — see the note at
// STALE_TOMBSTONE_EPSILON_MS. CONSERVATIVE FALLBACKS (all preserve the pre-rule
// behavior of "any tombstone authorizes"): no `getDeletedEntity` provided, the
// deleted copy has no parseable lastModified, or the tombstone value is missing/
// unparseable → the tombstone authorizes the delete. A false "stale" verdict
// would resurrect a genuinely deleted task (the old war symptom), so only a
// CLEARLY newer entity demotes its tombstone to glitch-suspect.
//
// Real deletions (tombstoned) and real moves (id survives elsewhere) are unaffected
// and still propagate exactly as before.

import { TOMBSTONE_BUNDLE_KEYS } from './tombstoneRetention.js';
import { getEntityLastModified } from './dbAdapter.js';

// Tolerance for the tombstone-vs-lastModified comparison. Delete-path audit
// (2026-07): every tombstone writer stamps `new Date().toISOString()` at delete
// time and none re-stamps the entity's lastModified during the delete, EXCEPT
// useTaskActions.moveToRecycleBin, which stamps the bin copy's lastModified to
// max(now, task.lastModified + 1000) — i.e. up to ~1s in the FUTURE (its
// anti-zombie stamp). Emptying the bin within that same second (useRecycleBin
// confirmEmptyBin, tombstone = now) then yields a tombstone up to ~1s OLDER
// than the recycleBin copy it deletes. 5s covers that 1s worst case five-fold
// plus modest cross-device clock skew, while staying far below any realistic
// delete→revive gap.
export const STALE_TOMBSTONE_EPSILON_MS = 5000;

// Bare id from an entityId ("tasks:abc" → "abc"). entityIds are "kind:id" and ids
// are UUIDs / stable keys, so the bare id is globally unique across kinds.
function bareId(entityId) {
  const s = String(entityId);
  const i = s.indexOf(':');
  return i < 0 ? s : s.slice(i + 1);
}

const parseTs = (v) => (v == null ? NaN : new Date(v).getTime());

/**
 * Split the snapshot-diff's would-be deletes into those safe to propagate and those
 * to skip as suspected local-state glitches.
 *
 * @param {string[]} deleteEntityIds  entityIds the diff wants to delete (in snapshot, absent from cur)
 * @param {Record<string, unknown>} cur  current shredded state, keyed by entityId (snapshotShred output)
 * @param {object} mirror  the payload/mirror carrying the deletion tombstone bundles
 * @param {(entityId: string) => object|null} [getDeletedEntity]  returns the wrapped
 *   entity ({ _kind, value }) of the copy being deleted, so its lastModified can be
 *   compared against the tombstone (see THE TIMESTAMP RULE above). Omitted / null
 *   result / unparseable lastModified → the tombstone authorizes unconditionally.
 * @returns {{ propagate: string[], skipped: string[], excluded: string[], reasons: Record<string,string> }}
 * @param {(entityId: string) => (boolean|string)} [isExcludedDeletedEntity]  called
 *   for a would-be 'glitch' row; return a truthy value when the vanished copy is
 *   one this device will NEVER reproduce in `cur`, so healing it every cycle is a
 *   futile loop. Two independent causes qualify (src/sync/payloadExclusions.js):
 *   a class the payload builder STRUCTURALLY excludes (native / non-synced
 *   imports), or a task this device INTENTIONALLY AGED OUT (completed + archived,
 *   or completed + older than the retention window — pruned locally / by the file
 *   tier, invisibly to the vault). Either lands in the `excluded` bucket: not
 *   propagated, not heal-fetched, simply released from the baseline (the vault
 *   row is untouched; the next saved snapshot stops tracking it). Return a reason
 *   STRING ('payload-excluded' | 'retention-aged') for accurate diagnostics, or
 *   `true` for the default 'payload-excluded'. Only would-be 'glitch' rows are
 *   tested — tombstoned, stale-tombstone, and cross-list are unaffected. Omitted
 *   → prior behavior.
 */
export function partitionSnapshotDeletes(deleteEntityIds, cur, mirror, getDeletedEntity, isExcludedDeletedEntity) {
  const ids = Array.isArray(deleteEntityIds) ? deleteEntityIds : [];

  // Every bare id present anywhere in the current payload (any kind). A cross-list
  // move leaves the id here under its new kind, so its old-kind delete is legitimate.
  const liveBareIds = new Set();
  for (const eid of Object.keys(cur || {})) liveBareIds.add(bareId(eid));

  // Union of every deletion tombstone across all bundles, keeping the NEWEST
  // parseable timestamp per id (a real re-delete after a revive re-stamps the
  // tombstone, and the bundle merge keeps the newer value — unionNewerIso). A
  // missing/unparseable value maps to Infinity: it authorizes unconditionally
  // (the pre-timestamp-rule behavior; we cannot call it stale if we can't date it).
  const tombstoned = new Map();
  const m = mirror && typeof mirror === 'object' ? mirror : {};
  for (const key of TOMBSTONE_BUNDLE_KEYS) {
    const bundle = m[key];
    if (bundle && typeof bundle === 'object') {
      for (const [id, value] of Object.entries(bundle)) {
        const t = parseTs(value);
        const eff = Number.isNaN(t) ? Infinity : t;
        const prev = tombstoned.get(String(id));
        if (prev === undefined || eff > prev) tombstoned.set(String(id), eff);
      }
    }
  }

  // lastModified (epoch ms) of the copy being deleted; NaN when unavailable.
  const deletedLastModified = (eid) => {
    if (typeof getDeletedEntity !== 'function') return NaN;
    let entity = null;
    try { entity = getDeletedEntity(eid); } catch { entity = null; }
    return entity == null ? NaN : parseTs(getEntityLastModified(entity));
  };

  const propagate = [];
  const skipped = [];
  const excluded = [];
  // Why each entityId landed where it did — 'tombstoned' (a real deletion), a
  // cross-list move ('cross-list', the id survives under another kind), a
  // suspected 'glitch' (skipped, no fingerprint at all), 'stale-tombstone'
  // (skipped: tombstoned, but the deleted copy is clearly newer than the
  // tombstone — a revived entity whose old tombstone lingers), or
  // 'payload-excluded' (released from the baseline: the vanished copy belongs
  // to a class the payload builder structurally excludes). Diagnostic only;
  // callers that ignore it are unaffected.
  const reasons = {};
  // Release reason for a would-be 'glitch' row, or null to keep the glitch
  // classification. The predicate may return a specific reason STRING (e.g.
  // 'retention-aged') for accurate diagnostics, or `true` for the original
  // 'payload-excluded' meaning (back-compat with the #1198 callers).
  const releaseReason = (eid) => {
    if (typeof isExcludedDeletedEntity !== 'function') return null;
    let r;
    try { r = isExcludedDeletedEntity(eid); } catch { return null; }
    if (r === true) return 'payload-excluded';
    return typeof r === 'string' && r ? r : null;
  };
  for (const eid of ids) {
    const id = bareId(eid);
    let rr;
    if (tombstoned.has(id)) {
      const tombTs = tombstoned.get(id);
      const lastMod = deletedLastModified(eid);
      if (Number.isNaN(lastMod) || tombTs >= lastMod - STALE_TOMBSTONE_EPSILON_MS) {
        propagate.push(eid); reasons[eid] = 'tombstoned';
      } else if (liveBareIds.has(id)) {
        // The stale tombstone doesn't bless the delete, but the id survives under
        // another kind — a legitimate cross-list move, unaffected by the rule.
        propagate.push(eid); reasons[eid] = 'cross-list';
      } else {
        skipped.push(eid); reasons[eid] = 'stale-tombstone';
      }
    } else if (liveBareIds.has(id)) { propagate.push(eid); reasons[eid] = 'cross-list'; }
    else if ((rr = releaseReason(eid))) { excluded.push(eid); reasons[eid] = rr; }
    else { skipped.push(eid); reasons[eid] = 'glitch'; }
  }
  return { propagate, skipped, excluded, reasons };
}
