// In-memory two-device GLANCEvault simulator — TEST SUPPORT ONLY, never wired
// into the app. It exists to prove merge correctness across two devices sharing
// one vault, which a single-device losslessness test cannot see.
//
// It faithfully mirrors the push/pull contract of @glance-apps/sync's
// createDbSyncEngine (dbEngine.js) and drives the SAME app-side adapter
// callbacks the real engine calls (getLocalEntity / applyRemoteEntity /
// applyRemoteDelete / isInsertOnly / getEntityLastModified). Transport + crypto
// are stubbed: a row carries the plaintext entity through a JSON clone, which is
// exactly the serialization encryptEntity/decryptEntity perform (dbCrypto.js:274,
// 300) — so nested structures and keyed maps are exercised through the wire.
//
// Two deliberate, documented divergences from dbEngine.js, both behavior-
// preserving:
//   1. The pull cursor advances only on PULL (to the max seq seen), not on push.
//      dbEngine.js advances the HWM on push too (dbEngine.js:225); replicating
//      that here would let a device skip another device's rows that were written
//      between its own push and the next list. Because re-applying an
//      already-seen row is idempotent under LWW (skipped) and under the
//      insert-only bundle merges (union/recency no-ops), pulling from the lower
//      cursor is safe and simply avoids the skip — a strictly more conservative
//      cursor.
//   2. After each pull we run reconcileCrossList (the spec-5.2 cross-list
//      dedupe). In the live engine this hooks the end-of-cycle apply notify.

import {
  getLocalEntity,
  applyRemoteEntity,
  applyRemoteDelete,
  isInsertOnly,
  getEntityLastModified,
  reconcileCrossList,
} from './dbAdapter.js';

const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const tsNum = (v) => {
  if (v == null) return 0;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
};

// ── Vault: a single append-only log keyed by entityId with a global seq. Mirrors
// the GLANCEvault row shape { entityId, seq, ciphertext|deleted } — here the
// plaintext entity stands in for ciphertext.
export function createVault() {
  const rows = new Map(); // entityId -> { entityId, seq, entity|null, deleted }
  let seq = 0;
  return {
    upsert(entityId, entity) {
      rows.set(entityId, { entityId, seq: ++seq, entity: clone(entity), deleted: false });
    },
    remove(entityId) {
      rows.set(entityId, { entityId, seq: ++seq, entity: null, deleted: true });
    },
    list(since) {
      return [...rows.values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq);
    },
    snapshot() {
      return [...rows.values()].map((r) => ({ ...r, entity: clone(r.entity) }));
    },
  };
}

// ── Device: holds its own `.data`, a dirty set, and a pull cursor. `mutate` runs
// a local edit and records every entityId it touched as dirty (the markDirty/
// markDeleted wiring Part B installs at real write sites).
export function createDevice(name, initialData) {
  const data = clone(initialData) || {};
  const dirty = new Set();
  let cursor = 0;

  const markDirty = (entityId) => dirty.add(String(entityId));

  const push = (vault) => {
    for (const entityId of dirty) {
      const entity = getLocalEntity(data, entityId);
      if (entity == null) vault.remove(entityId);
      else vault.upsert(entityId, entity);
    }
    dirty.clear();
  };

  const pull = (vault) => {
    let maxSeq = cursor;
    for (const r of vault.list(cursor)) {
      if (r.seq > maxSeq) maxSeq = r.seq;
      if (r.deleted) {
        applyRemoteDelete(data, r.entityId);
        continue;
      }
      const remote = clone(r.entity);
      const local = getLocalEntity(data, r.entityId);
      if (local == null || isInsertOnly(remote)) {
        // Bundle merges may leave us richer than the clobbered vault row; re-push
        // the superset so it converges at the vault, not just locally.
        for (const id of applyRemoteEntity(data, remote)) markDirty(id);
      } else if (tsNum(getEntityLastModified(remote)) > tsNum(getEntityLastModified(local))) {
        applyRemoteEntity(data, remote);
      }
      // else: local newer/equal — keep local (mirrors dbEngine.js:272-279)
    }
    cursor = maxSeq;
    // Cross-list dedupe; a removed stale copy is soft-deleted on next push so the
    // vault converges too.
    reconcileCrossList(data, (loserId) => markDirty(loserId));
  };

  return {
    name,
    data,
    markDirty,
    // Run a local edit; `fn(data)` returns the list of touched entityIds.
    mutate(fn) {
      const touched = fn(data) || [];
      for (const id of touched) markDirty(id);
    },
    push,
    pull,
    // One full cycle: push then pull (the engine's order, dbEngine.js:319-321).
    sync(vault) {
      push(vault);
      pull(vault);
    },
  };
}

// Drive both devices to a fixed point: alternate full cycles until neither has
// pending dirty rows and a final cross-pull yields no change. Returns the number
// of rounds. Bounded so a non-converging bug fails loudly instead of hanging.
export function syncToConvergence(devA, devB, vault, maxRounds = 8) {
  for (let round = 1; round <= maxRounds; round++) {
    devA.sync(vault);
    devB.sync(vault);
    devA.sync(vault);
    devB.sync(vault);
    // Converged when a further pass changes nothing on either device.
    const before = JSON.stringify([devA.data, devB.data]);
    devA.sync(vault);
    devB.sync(vault);
    if (JSON.stringify([devA.data, devB.data]) === before) return round;
  }
  throw new Error('syncToConvergence: did not converge within maxRounds');
}
