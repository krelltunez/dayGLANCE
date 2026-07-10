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
// Real deletions (tombstoned) and real moves (id survives elsewhere) are unaffected
// and still propagate exactly as before.

import { TOMBSTONE_BUNDLE_KEYS } from './tombstoneRetention.js';

// Bare id from an entityId ("tasks:abc" → "abc"). entityIds are "kind:id" and ids
// are UUIDs / stable keys, so the bare id is globally unique across kinds.
function bareId(entityId) {
  const s = String(entityId);
  const i = s.indexOf(':');
  return i < 0 ? s : s.slice(i + 1);
}

/**
 * Split the snapshot-diff's would-be deletes into those safe to propagate and those
 * to skip as suspected local-state glitches.
 *
 * @param {string[]} deleteEntityIds  entityIds the diff wants to delete (in snapshot, absent from cur)
 * @param {Record<string, unknown>} cur  current shredded state, keyed by entityId (snapshotShred output)
 * @param {object} mirror  the payload/mirror carrying the deletion tombstone bundles
 * @returns {{ propagate: string[], skipped: string[] }}
 */
export function partitionSnapshotDeletes(deleteEntityIds, cur, mirror) {
  const ids = Array.isArray(deleteEntityIds) ? deleteEntityIds : [];

  // Every bare id present anywhere in the current payload (any kind). A cross-list
  // move leaves the id here under its new kind, so its old-kind delete is legitimate.
  const liveBareIds = new Set();
  for (const eid of Object.keys(cur || {})) liveBareIds.add(bareId(eid));

  // Union of every deletion tombstone across all bundles. A real delete tombstones
  // the id; membership here means the delete is intentional.
  const tombstoned = new Set();
  const m = mirror && typeof mirror === 'object' ? mirror : {};
  for (const key of TOMBSTONE_BUNDLE_KEYS) {
    const bundle = m[key];
    if (bundle && typeof bundle === 'object') {
      for (const id of Object.keys(bundle)) tombstoned.add(String(id));
    }
  }

  const propagate = [];
  const skipped = [];
  // Why each entityId landed where it did — 'tombstoned' (a real deletion), a
  // cross-list move ('cross-list', the id survives under another kind), or a
  // suspected 'glitch' (skipped). Diagnostic only; callers that ignore it are
  // unaffected.
  const reasons = {};
  for (const eid of ids) {
    const id = bareId(eid);
    if (tombstoned.has(id)) { propagate.push(eid); reasons[eid] = 'tombstoned'; }
    else if (liveBareIds.has(id)) { propagate.push(eid); reasons[eid] = 'cross-list'; }
    else { skipped.push(eid); reasons[eid] = 'glitch'; }
  }
  return { propagate, skipped, reasons };
}
