// dayGLANCE GLANCEvault DB engine wrapper (mirrors lastGLANCE
// src/sync/dbEngine.ts createDbEngine). Constructs @glance-apps/sync's
// createDbSyncEngine with dayGLANCE's entity↔row adapter, returning null when the
// vault is disabled so the whole DB path is inert. Additive and reversible: it
// shares the local data and sync passphrase with the file tier but never touches
// the WebDAV sync file.
//
// Two dayGLANCE-specific concerns the reference handles differently:
//
//  1. Dirty tracking. lastGLANCE calls markDirty at each Dexie write site
//     (queries.ts). dayGLANCE has no such data layer — it holds state in React +
//     localStorage and commits via one save path. So instead of annotating
//     hundreds of call sites, this wrapper computes the dirty set by DIFFING the
//     current shred against a persisted snapshot at cycle time. That captures
//     exactly the entities that changed (and, by absence, the ones deleted →
//     soft-delete), which is what markDirty-at-write-sites would have produced.
//     dirtyTracker.schedulePush still gives prompt push-on-write; this diff is
//     what decides *which* rows move.
//
//  2. Apply target. Remote applies mutate a per-cycle data MIRROR, never the
//     React/localStorage state directly, and the merged mirror is handed to
//     commitData once per cycle. commitData writes through the app's existing
//     applyPayload (which sets the suppress flags), so a pulled row never bounces
//     back out as a file-tier upload or a re-push.

import { createDbSyncEngine } from '@glance-apps/sync';
import { getVaultConfig, isVaultEnabled } from './vaultConfig.js';
import { getDeviceId } from './deviceId.js';
import {
  shredState,
  getLocalEntity as adapterGetLocalEntity,
  applyRemoteEntity as adapterApplyRemoteEntity,
  applyRemoteDelete as adapterApplyRemoteDelete,
  isInsertOnly,
  getEntityLastModified,
  reconcileCrossList,
} from './dbAdapter.js';

const APP_ID = 'dayglance';
const CRYPTO_DB_NAME = 'dayglance-db-crypto';

const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
const hashOf = (entity) => JSON.stringify(entity);

// entityId → entity-hash for the whole current state. Used to diff for dirtiness.
function snapshotShred(data) {
  const map = {};
  for (const row of shredState(data)) map[row.entityId] = hashOf(row.entity);
  return map;
}

/**
 * Build the dayGLANCE DB sync engine, or null when the vault is disabled.
 *
 * @param {object} callbacks
 * @param {() => object}        callbacks.getData      - current payload `.data` (e.g. buildSyncPayload().data)
 * @param {(data:object)=>void} callbacks.commitData   - write merged `.data` back (e.g. applyPayload)
 * @param {(s:string)=>void}   [callbacks.onStatusChange]
 * @param {(m:string,c:string)=>void} [callbacks.onError]
 * @param {string}             [callbacks.storageKeyPrefix] - override (tests / multi-instance)
 * @param {object}             [callbacks.vaultClient]      - injected client (tests)
 * @param {Function}           [callbacks.nativeGetSyncKey]
 * @param {Function}           [callbacks.nativeStoreSyncKey]
 * @param {string}             [callbacks.deviceId]
 */
export function createDbEngine(callbacks = {}) {
  if (!callbacks.vaultClient && !isVaultEnabled()) return null;
  const cfg = getVaultConfig() || {};
  const storageKeyPrefix = callbacks.storageKeyPrefix || 'dayglance-vault';
  const SNAPSHOT_KEY = `${storageKeyPrefix}-db-sync-snapshot`;

  const loadSnapshot = () => {
    try { return JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || '{}'); } catch { return {}; }
  };
  const saveSnapshot = (map) => {
    try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(map)); } catch { /* ignore */ }
  };

  // Per-cycle data mirror the adapter callbacks operate on. Seeded from getData
  // at the start of each cycle and committed at the end.
  let mirror = {};

  const engine = createDbSyncEngine({
    storageKeyPrefix,
    appId: APP_ID,
    vaultApp: APP_ID,
    cryptoDBName: CRYPTO_DB_NAME,
    vaultUrl: cfg.vaultUrl,
    vaultToken: cfg.vaultToken,
    accountId: cfg.accountId,
    deviceId: callbacks.deviceId || getDeviceId(),
    vaultClient: callbacks.vaultClient,
    nativeGetSyncKey: callbacks.nativeGetSyncKey || null,
    nativeStoreSyncKey: callbacks.nativeStoreSyncKey || null,
    getLocalEntity: (entityId) => adapterGetLocalEntity(mirror, entityId),
    applyRemoteEntity: (entityId, entity) => {
      // Bundle merges may leave us richer than the clobbered vault row; re-push
      // the superset so it converges at the vault (see dbAdapter / stage-2 doc).
      for (const id of adapterApplyRemoteEntity(mirror, entity)) engine.markDirty(id);
    },
    applyRemoteDelete: (entityId) => adapterApplyRemoteDelete(mirror, entityId),
    isInsertOnly,
    getEntityLastModified,
    onStatusChange: callbacks.onStatusChange,
    onError: callbacks.onError,
  });

  // In-flight guard so a debounced push never overlaps a cadence-triggered cycle.
  let syncing = false;

  // dayGLANCE composes its own cycle as PULL-then-PUSH (the engine's built-in
  // dbSyncCycle is push-then-pull). Pull-first matters here: the engine advances
  // its high-water mark on push (dbEngine.js:225), so a device that pushes before
  // pulling would skip rows written below its new cursor and never see them.
  // Pulling first means we always read up to the current head, merge it into the
  // mirror, then push the merged superset — so the HWM only ever advances past
  // rows we have actually seen. It also lets bundle merges push the merged value
  // in the same cycle rather than waiting for a re-push next cycle.
  const dbSyncCycle = async () => {
    if (typeof callbacks.getData !== 'function') return;
    if (syncing) return;
    syncing = true;
    callbacks.onError?.(null, null);
    try {
      mirror = clone(callbacks.getData()) || {};

      // Seed the dirty set: full snapshot on first-ever sync, else the diff.
      if (engine.getHighWaterMark() === 0) {
        for (const row of shredState(mirror)) engine.markDirty(row.entityId);
      } else {
        const prev = loadSnapshot();
        const cur = snapshotShred(mirror);
        for (const [id, h] of Object.entries(cur)) if (prev[id] !== h) engine.markDirty(id);
        for (const id of Object.keys(prev)) if (!(id in cur)) engine.markDirty(id); // deletes
      }

      callbacks.onStatusChange?.('downloading');
      await engine.pullRemoteChanges();   // merge remote into mirror first
      reconcileCrossList(mirror, (id) => engine.markDirty(id));
      callbacks.onStatusChange?.('uploading');
      await engine.pushDirtyRows();        // push merged superset + local changes
      await engine.updateDeviceCursor();

      callbacks.commitData?.(clone(mirror));
      saveSnapshot(snapshotShred(mirror));
      callbacks.onStatusChange?.('success');
    } catch (err) {
      const code = err && err.code ? err.code : 'NETWORK_ERROR';
      callbacks.onError?.(err?.message || String(err), code);
      callbacks.onStatusChange?.('error');
    } finally {
      syncing = false;
    }
  };

  return { ...engine, dbSyncCycle, sync: dbSyncCycle };
}

export { APP_ID, CRYPTO_DB_NAME };
