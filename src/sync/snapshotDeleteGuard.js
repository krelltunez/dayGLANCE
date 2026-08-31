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
import { resolveRetirement } from '../utils/retiredTaskIds.js';

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

// Union of every deletion tombstone across all bundles in `m`, keeping the
// NEWEST parseable timestamp per id (a real re-delete after a revive re-stamps
// the tombstone, and the bundle merge keeps the newer value — unionNewerIso).
// A missing/unparseable value maps to Infinity: it authorizes unconditionally
// (the pre-timestamp-rule behavior; we cannot call it stale if we can't date
// it). Shared by the partition below and the polarity reassert.
function collectTombstones(m) {
  const tombstoned = new Map();
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
  return tombstoned;
}

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
 * @returns {{ propagate: string[], skipped: string[], excluded: string[], reasons: Record<string,string>, successorTombstoned: Array<{entityId: string, successor: string}> }}
 *   successorTombstoned: the SKIPPED entityIds whose retirement record names a
 *   successor that is TOMBSTONED-NOT-LIVE — the retire/tombstone oscillation
 *   signature (2026-08-31 SSE-speed war). Such a row is in a contradictory
 *   state the guard cannot resolve: the retirement says "the content lives on
 *   under the successor", the tombstone says "the successor is deleted" — so
 *   neither propagating the old id's delete (content loss if the tombstone is
 *   the truth) nor healing the old id back (revival war if the retirement is
 *   the truth) is safe to repeat forever. The caller runs these through the
 *   retirement-heal breaker (retirementHealBreaker.js) instead of healing at
 *   unbounded frequency. A successor merely ABSENT without a tombstone is NOT
 *   this condition — that is an ordinary glitch/heal case with no oscillation
 *   evidence.
 * @param {(entityId: string) => (boolean|string)} [isExcludedDeletedEntity]  called
 *   for a would-be 'glitch' row; return a truthy value when the vanished copy is
 *   one this device will NEVER reproduce in `cur`, so healing it every cycle is a
 *   futile loop. Independent causes qualify (src/sync/payloadExclusions.js): a
 *   class the payload builder STRUCTURALLY excludes (native / non-synced imports),
 *   or a task the FILE TIER's zombie-drop keeps out of getData() (completed, or
 *   older than the sync horizon — dropped by WebDAV/iCloud merge, invisibly to
 *   the vault). Either lands in the `excluded` bucket: not propagated, not
 *   heal-fetched, simply released from the baseline (the vault row is untouched;
 *   the next saved snapshot stops tracking it). Return a reason STRING
 *   ('payload-excluded' | 'completed' | 'sync-horizon') for accurate diagnostics,
 *   or `true` for the default 'payload-excluded'. Only would-be 'glitch' rows are
 *   tested — tombstoned, stale-tombstone, and cross-list are unaffected. Omitted
 *   → prior behavior.
 */
export function partitionSnapshotDeletes(deleteEntityIds, cur, mirror, getDeletedEntity, isExcludedDeletedEntity) {
  const ids = Array.isArray(deleteEntityIds) ? deleteEntityIds : [];

  // Every bare id present anywhere in the current payload (any kind). A cross-list
  // move leaves the id here under its new kind, so its old-kind delete is legitimate.
  const liveBareIds = new Set();
  for (const eid of Object.keys(cur || {})) liveBareIds.add(bareId(eid));

  const m = mirror && typeof mirror === 'object' ? mirror : {};
  const tombstoned = collectTombstones(m);

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
  const successorTombstoned = [];
  // Why each entityId landed where it did — 'retired' (an id-migration
  // retirement whose successor is live: superseded, propagate regardless of
  // timestamps), 'tombstoned' (a real deletion), a
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
  // Id-retirement record (utils/retiredTaskIds.js): { oldId → {retiredAt,
  // successor} }. Rides the mirror like the tombstone bundles.
  const retiredRecord = m.retiredTaskIds && typeof m.retiredTaskIds === 'object' ? m.retiredTaskIds : {};

  for (const eid of ids) {
    const id = bareId(eid);
    let rr;
    // RETIREMENT, decided BEFORE the tombstone timestamp rule: a vanished id
    // whose record names a successor that is LIVE in the current payload is
    // SUPERSEDED — the same task's identity moved, the content survives under
    // the successor — so its delete propagates REGARDLESS of timestamps. This
    // is deliberately exempt from the stale-tombstone LWW: a copy re-stamped
    // newer than the retirement (an offline edit crossing a stamp, a peer's
    // normalization re-stamp) is an edit belonging to the successor (the apply
    // path redirects its content there — applyTaskRetirements), never a
    // revival of the old id. Without this exemption the guard classified such
    // rows 'stale-tombstone' and heal-fetched them back forever — the
    // scan-evict ↔ guard-heal war (phase2TransitionSyncLoop repro). When the
    // successor is NOT live in `cur`, the record does not authorize anything
    // and the row falls through to the ordinary classification below —
    // conservative: never bless a delete whose surviving copy this device
    // can't see.
    const successor = resolveRetirement(retiredRecord, id);
    if (successor && successor !== id && liveBareIds.has(successor)) {
      propagate.push(eid); reasons[eid] = 'retired';
      continue;
    }
    // The oscillation signature, detected here and ACTED ON by the caller:
    // this id was retired, but its successor is dead-with-a-tombstone rather
    // than live. The row still classifies conservatively below (usually
    // skipped); the flag is what routes it through the heal breaker.
    const successorIsTombstonedNotLive =
      !!successor && successor !== id && !liveBareIds.has(successor) && tombstoned.has(successor);
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
    if (successorIsTombstonedNotLive && (reasons[eid] === 'glitch' || reasons[eid] === 'stale-tombstone')) {
      successorTombstoned.push({ entityId: eid, successor });
    }
  }
  return { propagate, skipped, excluded, reasons, successorTombstoned };
}

/**
 * THE POLARITY REASSERT (2026-08-31 db-tier war — the engine upsert-flip).
 *
 * The engine's push has no delete POLARITY: pushDirtyRows re-classifies each
 * dirty entityId at push time by local presence — present in the mirror →
 * UPSERT, absent → soft-delete (verified against @glance-apps/sync
 * dbEngine.js). And the pull runs BETWEEN the snapshot diff (which authorized
 * the delete and marked the id dirty) and the push. So a pulled row — above
 * all this device's OWN echo, which the pull re-lists every cycle because a
 * push never advances the pull cursor — re-supplies the mirror, and the
 * blessed delete silently flips into an upsert ("written:2 deleted:0" on a
 * delete-only dirty set): the war's resurrection primitive. The tombstone-LWW
 * leg exists for the opposite direction (a pulled TOMBSTONE against a live
 * local row, applyRemoteRow) but not for this one — a delete intent carries
 * no timestamp into the push, so nothing ever weighed the pulled copy against
 * the evidence that authorized the delete.
 *
 * This helper is that missing weighing, run AFTER the pull on the deletes the
 * diff actually propagated:
 *   • 'tombstoned' — the authorizing tombstone (recomputed from the POST-pull
 *     mirror bundles, so a peer's fresher tombstone or revival counts) still
 *     at-least-ties the resupplied copy's lastModified (same epsilon as the
 *     partition) → EVICT: the delete stands; remove the pulled copy from the
 *     mirror so the push keeps delete polarity. A copy NEWER than its
 *     tombstone is a genuine revival → ACCEPT the flip (that upsert is
 *     correct newest-write-wins behavior).
 *   • 'retired' — supersede-regardless-of-timestamps, exactly as the
 *     partition ruled it: the successor still live in the mirror → EVICT. A
 *     successor no longer live → ACCEPT (conservative: never bless a delete
 *     whose surviving copy this device can't see — the partition's own rule).
 *   • any other reason → ACCEPT (cross-list moves resolve through reconcile).
 *
 * Pure: returns the split; the CALLER evicts (mirror mutation stays in
 * dbEngine, beside the other mirror writes).
 *
 * @param {Array<{entityId: string, reason: string}>} propagated  deletes the
 *   diff marked dirty this cycle (post acked-delete and latch filtering)
 * @param {object} mirror  the POST-pull mirror (tombstone bundles, retirement
 *   record, task lists)
 * @param {(entityId: string) => object|null} getLiveEntity  the mirror's
 *   current copy of the row ({ _kind, value }), null when absent
 * @returns {{ evict: Array<{entityId: string, reason: string}>, accepted: Array<{entityId: string, reason: string}> }}
 *   evict: delete still authorized — remove the resupplied copy pre-push;
 *   accepted: the flip is legitimate (revival / vanished successor).
 */
export function reassertPropagatedDeletes(propagated, mirror, getLiveEntity) {
  const m = mirror && typeof mirror === 'object' ? mirror : {};
  const evict = [];
  const accepted = [];
  if (!Array.isArray(propagated) || propagated.length === 0) return { evict, accepted };
  const tombstoned = collectTombstones(m);
  const retiredRecord = m.retiredTaskIds && typeof m.retiredTaskIds === 'object' ? m.retiredTaskIds : {};
  const liveTaskIds = new Set(
    [...(Array.isArray(m.tasks) ? m.tasks : []), ...(Array.isArray(m.unscheduledTasks) ? m.unscheduledTasks : [])]
      .filter(Boolean).map((t) => String(t.id)),
  );
  for (const { entityId, reason } of propagated) {
    let live = null;
    try { live = getLiveEntity(entityId); } catch { live = null; }
    if (live == null) continue; // polarity intact — the push will delete
    const id = bareId(entityId);
    if (reason === 'retired') {
      const successor = resolveRetirement(retiredRecord, id);
      if (successor && successor !== id && liveTaskIds.has(successor)) {
        evict.push({ entityId, reason });
      } else {
        accepted.push({ entityId, reason });
      }
      continue;
    }
    if (reason === 'tombstoned') {
      const tombTs = tombstoned.get(id);
      const liveTs = parseTs(getEntityLastModified(live));
      if (tombTs !== undefined && (Number.isNaN(liveTs) || tombTs >= liveTs - STALE_TOMBSTONE_EPSILON_MS)) {
        evict.push({ entityId, reason });
      } else {
        accepted.push({ entityId, reason });
      }
      continue;
    }
    accepted.push({ entityId, reason });
  }
  return { evict, accepted };
}
