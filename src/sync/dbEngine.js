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

import { createDbSyncEngine, clearDbRootKey } from '@glance-apps/sync';
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

// Where the per-account DB root key is stored: the OS keystore on native shells
// (mirrors the file tier in adapter.js), IndexedDB elsewhere. Centralized so the
// engine and resetDbRootKey agree.
function nativeKeyConfig() {
  const bridge = typeof window !== 'undefined' ? window.DayGlanceNative : null;
  const isNativeApp = !!bridge?.httpRequest;
  return {
    cryptoDBName: CRYPTO_DB_NAME,
    nativeGetSyncKey: isNativeApp && bridge?.getSyncKey ? () => bridge.getSyncKey() : null,
    nativeStoreSyncKey: isNativeApp && bridge?.storeSyncKey ? (val) => bridge.storeSyncKey(val) : null,
  };
}

// Drop any cached DB root key (in-memory + keystore/IndexedDB) so the next sync
// re-derives it from the current session passphrase + the server's account salt.
// Called when the vault is enabled/disabled so a freshly-entered passphrase is
// authoritative — otherwise a key cached during an earlier attempt (wrong/old
// passphrase) stays locked in and decryption of other devices' rows fails.
export async function resetDbRootKey() {
  try { await clearDbRootKey(nativeKeyConfig()); } catch { /* ignore */ }
}

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

  // On native shells the root key is stored in the OS keystore (mirrors the file
  // tier in adapter.js), elsewhere in IndexedDB. Default these from the bridge so
  // callers (App wiring, save-time bootstrap) don't each have to pass them.
  const nativeBridge = typeof window !== 'undefined' ? window.DayGlanceNative : null;
  const isNativeApp = !!nativeBridge?.httpRequest;
  const nativeKeys = nativeKeyConfig();
  const nativeGetSyncKey = callbacks.nativeGetSyncKey ?? nativeKeys.nativeGetSyncKey;
  const nativeStoreSyncKey = callbacks.nativeStoreSyncKey ?? nativeKeys.nativeStoreSyncKey;

  // The vault client defaults to global fetch, which fails inside the Android
  // WebView (no CORS, restricted network) — the same reason the WebDAV file tier
  // routes through the native HTTP bridge (adapter.js / providers.js). Supply a
  // fetchImpl that bridges to it on native, the electron proxy on desktop
  // electron, and otherwise falls through to global fetch.
  const electronProxyFetch = typeof window !== 'undefined' && window.electronAPI?.isElectron
    ? (...args) => window.electronAPI.proxyFetch(...args)
    : null;
  const fetchImpl = callbacks.fetchImpl
    ?? (isNativeApp
      ? async (url, { method = 'GET', headers = {}, body } = {}) => {
        let r;
        try { r = JSON.parse(nativeBridge.httpRequest(method, url, JSON.stringify(headers), body ?? '')); }
        catch { throw new TypeError('Failed to fetch'); }
        if (!r) throw new TypeError('Failed to fetch');
        return {
          status: r.status,
          ok: r.ok,
          statusText: r.statusText,
          headers: { get: (h) => (h.toLowerCase() === 'etag' ? (r.headers?.etag ?? null) : null) },
          json: async () => JSON.parse(r.body),
          text: async () => r.body,
        };
      }
      : (electronProxyFetch || undefined));

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
    fetchImpl,
    nativeGetSyncKey,
    nativeStoreSyncKey,
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

  // dayGLANCE wraps the engine's push/pull steps in its own cycle so it can
  // (1) seed the dirty set by diffing app state into the mirror, (2) commit the
  // merged mirror back to React/localStorage ONLY on success, and (3) run
  // cross-list reconcile + snapshot. This wrapper is required regardless of the
  // package version — it is the bridge between the engine and dayGLANCE's
  // non-Dexie state, not a transport workaround.
  //
  // Cycle ORDER is pull-then-push. As of @glance-apps/sync 1.4.0 this is NOT a
  // correctness requirement and NOT a data-loss mitigation: the engine split the
  // cursor so a push never advances the pull cursor (getHighWaterMark is
  // pull-only; getPushAck tracks push idempotency), making push-then-pull and
  // pull-then-push equally safe. We keep pull-first only for marginal freshness —
  // merging remote before the push lets a bundle superset and any cross-list
  // reconcile flush in the SAME cycle instead of the next one. It is free, since
  // we compose the cycle from pullRemoteChanges/pushDirtyRows anyway to get
  // commit-only-on-success (the engine's own dbSyncCycle swallows errors, which
  // would let a failed cycle commit a partial mirror).
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
