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
//     back out as a file-tier upload or a re-push. Because applyPayload has
//     REPLACE semantics, the commit is MERGE-AWARE: user writes made during the
//     async network window are folded into the mirror at commit time
//     (src/sync/commitMerge.js) so they survive; the post-cycle snapshot stays
//     the PRE-merge (vault-consistent) mirror so those survivors diff dirty and
//     push next cycle. See the commit block in dbSyncCycle.

import { createDbSyncEngine, clearDbRootKey, initDbRootKey, decryptEntity } from '@glance-apps/sync';
import { getVaultConfig, isVaultEnabled } from './vaultConfig.js';
import { getDeviceId } from './deviceId.js';
import {
  getLocalEntity as adapterGetLocalEntity,
  applyRemoteEntity as adapterApplyRemoteEntity,
  applyRemoteDelete as adapterApplyRemoteDelete,
  isInsertOnly,
  getEntityLastModified,
  reconcileCrossList,
} from './dbAdapter.js';
import { pruneAllTombstones, tombstoneCutoff } from './tombstoneRetention.js';
import { partitionSnapshotDeletes } from './snapshotDeleteGuard.js';
import { shredHashes, hashMapsEqual, mergeMidCycleEdits } from './commitMerge.js';

const APP_ID = 'dayglance';
const CRYPTO_DB_NAME = 'dayglance-db-crypto';

// The storage prefix App.jsx's engine uses (tests override it per device).
const DEFAULT_STORAGE_KEY_PREFIX = 'dayglance-vault';

// Every persisted cursor/baseline the DB tier keeps between cycles:
//   -db-sync-snapshot   the wrapper's post-cycle diff baseline (this file)
//   -db-sync-hwm        the engine's PULL cursor (@glance-apps/sync dbEngine.js)
//   -db-sync-push-ack   the engine's push idempotency marker
//   -db-sync-dirty      the engine's persisted dirty set
//   -db-sync-quarantine the engine's undecryptable-row retry set (seq-based,
//                       meaningless after a cursor reset — the full re-pull
//                       re-lists those rows anyway)
const SYNC_CURSOR_KEY_SUFFIXES = [
  '-db-sync-snapshot',
  '-db-sync-hwm',
  '-db-sync-push-ack',
  '-db-sync-dirty',
  '-db-sync-quarantine',
];

// Reset the DB tier's persisted sync-cursor state. MUST be called by every
// full-state-replacement path (restore from a local/remote backup, restore from
// a backup file, vault link/re-link/unlink) BEFORE the app reloads:
//
//  • The stale SNAPSHOT would diff the restored (older) rows as "changed" and
//    push them over the vault's NEWER rows.
//  • The stale pull HWM would skip forever every vault row whose seq is below
//    it — rows the restored data no longer contains are never re-pulled.
//  • The stale DIRTY set / push-ack refer to pre-restore state.
//
// After the reset the next cycle runs the first-sync path (HWM=0 + empty
// snapshot): the wrapper full-seeds the dirty set and then pulls BEFORE it
// pushes, and the engine's pull applies per-entity last-writer-wins — a vault
// row newer than the restored copy wins AND removes that entity from the dirty
// set (@glance-apps/sync dbEngine.js applyRemoteRow), so the full-seed MERGES;
// it never blind-pushes restored-but-older rows over newer vault rows.
export function resetVaultSyncCursor(storageKeyPrefix = DEFAULT_STORAGE_KEY_PREFIX) {
  for (const suffix of SYNC_CURSOR_KEY_SUFFIXES) {
    try { localStorage.removeItem(`${storageKeyPrefix}${suffix}`); } catch { /* ignore */ }
  }
}

// Native keystore slot for the DB root key. On native shells the bridge exposes a
// SINGLE legacy slot (getSyncKey/storeSyncKey) that the WebDAV file tier already
// uses; storing the DB root key there too makes the two tiers clobber each other,
// which on Android forces a passphrase re-prompt on every launch. Newer shells add
// per-slot methods, so we isolate the DB key under its own slot. The IndexedDB
// path (non-native) is already isolated via the distinct CRYPTO_DB_NAME.
const VAULT_KEY_SLOT = 'db';

// Where the per-account DB root key is stored: the Android OS keystore on the
// Android shell (mirrors the file tier in crypto.js), IndexedDB everywhere else
// (web AND iOS). Centralized so the engine and resetDbRootKey agree.
//
// iOS gotcha (the every-launch passphrase re-prompt): iOS exposes
// window.DayGlanceNative as a Proxy whose every property reads truthy, so the
// old `!!bridge?.httpRequest` native-app check returned true on iOS and routed
// it through the bridge's (non-functional, proxy-faked) keystore methods. The
// DB root key was therefore never actually persisted, so restoreDbRootKey()
// returned false on every launch and the passphrase modal reappeared. Only
// Android — which sets no DayGlanceIOS marker and exposes a REAL getSyncKey —
// should use the native keystore; iOS uses IndexedDB (which persists across
// launches), exactly as src/utils/crypto.js does for the file tier.
export function nativeKeyConfig() {
  const bridge = typeof window !== 'undefined' ? window.DayGlanceNative : null;
  const isAndroid = !!bridge && !window.DayGlanceIOS && !!bridge.getSyncKey;
  if (!isAndroid) {
    return { cryptoDBName: CRYPTO_DB_NAME, nativeGetSyncKey: null, nativeStoreSyncKey: null };
  }
  // Prefer the isolated per-slot bridge methods; fall back to the shared legacy
  // slot on older shells (no isolation there, but no worse than before).
  if (bridge.getSyncKeyForSlot && bridge.storeSyncKeyForSlot) {
    return {
      cryptoDBName: CRYPTO_DB_NAME,
      nativeGetSyncKey: () => bridge.getSyncKeyForSlot(VAULT_KEY_SLOT),
      nativeStoreSyncKey: (val) => bridge.storeSyncKeyForSlot(VAULT_KEY_SLOT, val),
    };
  }
  return {
    cryptoDBName: CRYPTO_DB_NAME,
    nativeGetSyncKey: bridge.getSyncKey ? () => bridge.getSyncKey() : null,
    nativeStoreSyncKey: bridge.storeSyncKey ? (val) => bridge.storeSyncKey(val) : null,
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

// Restore the cached DB root key from device storage (keystore/IndexedDB) without
// the passphrase. Used by the app's load-time readiness gate so a vault-enabled
// device that already has its key cached unlocks silently instead of prompting.
// Returns false (not throwing) when no key is cached, so the caller can show the
// passphrase prompt.
export async function restoreDbRootKey() {
  try { return await initDbRootKey(nativeKeyConfig()); } catch { return false; }
}

const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
// entityId → entity-hash maps (shredHashes) are the diff/snapshot currency;
// they live in commitMerge.js so the dirty diff and the commit merge are
// guaranteed to hash identically.

// ─── TEMPORARY push diagnostic (gated) ────────────────────────────────────────
// Set localStorage 'dayglance-debug-push' = '1' to log, every cycle that pushes,
// exactly which rows are dirty and — for snapshot-diff rows — which field changed
// (old -> new). Purpose: name the real per-cycle moving value driving the SSE
// self-nudge loop, without assuming any particular field. Remove once diagnosed.
function debugPushEnabled() {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem('dayglance-debug-push') === '1'; }
  catch { return false; }
}
const debugShort = (v) => {
  let s;
  try { s = typeof v === 'string' ? v : JSON.stringify(v); } catch { s = String(v); }
  if (s === undefined) s = 'undefined';
  return s.length > 100 ? s.slice(0, 100) + '…' : s;
};
// Recursively list differing leaves between two parsed entities as "path: old -> new".
function debugDiffLeaves(a, b, path = '', out = []) {
  if (out.length >= 15) return out;
  if (a === b) return out;
  const oa = a && typeof a === 'object';
  const ob = b && typeof b === 'object';
  if (!oa || !ob) {
    out.push(`${path || '(root)'}: ${debugShort(a)} -> ${debugShort(b)}`);
    return out;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (out.length >= 15) break;
    debugDiffLeaves(a[k], b[k], path ? `${path}.${k}` : k, out);
  }
  return out;
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
  const storageKeyPrefix = callbacks.storageKeyPrefix || DEFAULT_STORAGE_KEY_PREFIX;
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
  //
  // BOTH native and electron bridges take POSITIONAL args
  // (method, url, headers, body) and return a plain {status, ok, statusText,
  // body, headers} object — NOT the fetch (url, init) -> Response signature the
  // vaultClient calls with. So each branch must adapt: destructure the (url,
  // init) call and re-issue it positionally, then wrap the result in a
  // Response-like shape. Passing the bridge through as `fetchImpl` directly is a
  // bug — the vaultClient's `doFetch(url, init)` would land the URL string in
  // the bridge's `method` slot, which the electron main process rejects with a
  // synthetic 400 ("Method not allowed") WITHOUT ever hitting the network (the
  // file tier avoids this by handing electronProxyFetch to providers.js, which
  // already calls it positionally).
  const electronProxyFetch = typeof window !== 'undefined' && window.electronAPI?.isElectron
    ? (...args) => window.electronAPI.proxyFetch(...args)
    : null;
  // Wrap a bridge's plain {status, ok, statusText, body, headers} result in the
  // subset of the Response interface the vaultClient consumes.
  const shapeResponse = (r) => {
    if (!r) throw new TypeError('Failed to fetch');
    return {
      status: r.status,
      ok: r.ok,
      statusText: r.statusText,
      headers: { get: (h) => (h.toLowerCase() === 'etag' ? (r.headers?.etag ?? null) : null) },
      json: async () => JSON.parse(r.body),
      text: async () => r.body,
    };
  };
  const fetchImpl = callbacks.fetchImpl
    ?? (isNativeApp
      ? async (url, { method = 'GET', headers = {}, body } = {}) => {
        // The native bridge is synchronous and returns a JSON string.
        let r;
        try { r = JSON.parse(nativeBridge.httpRequest(method, url, JSON.stringify(headers), body ?? '')); }
        catch { throw new TypeError('Failed to fetch'); }
        return shapeResponse(r);
      }
      : electronProxyFetch
        ? async (url, { method = 'GET', headers = {}, body } = {}) => {
          // electronProxyFetch is async (IPC) and returns the object directly.
          let r;
          try { r = await electronProxyFetch(method, url, headers, body ?? null); }
          catch { throw new TypeError('Failed to fetch'); }
          return shapeResponse(r);
        }
        : undefined);

  // Diagnostic: wrap the transport so every vault request logs its method, full
  // URL (which carries accountId + entityId) and HTTP status on failure. Turns a
  // bare "get row failed: 400" into the exact request that produced it, so we can
  // see at a glance whether accountId is populated and which entityId/route the
  // server rejected — instead of guessing across repos. Quiet on success.
  const rawFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  const loggingFetch = async (url, opts = {}) => {
    let res;
    try {
      res = await rawFetch(url, opts);
    } catch (e) {
      console.warn('[dayglance vault]', opts.method || 'GET', String(url), '→ network error:', e?.message || e);
      throw e;
    }
    if (!res || res.ok === false) console.warn('[dayglance vault]', opts.method || 'GET', String(url), '→', res?.status);
    return res;
  };

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
    fetchImpl: loggingFetch,
    deviceId: callbacks.deviceId || getDeviceId(),
    vaultClient: callbacks.vaultClient,
    nativeGetSyncKey,
    nativeStoreSyncKey,
    getLocalEntity: (entityId) => adapterGetLocalEntity(mirror, entityId),
    applyRemoteEntity: (entityId, entity) => {
      // TEMP diagnostic (gated on dayglance-debug-push): a remote row that revives
      // a row this device had dropped is the "re-created" half of a delete↔create
      // ping-pong. Logging every applied entityId shows whether the churn arrives
      // FROM the vault (another device re-pushing) vs originates locally.
      if (debugPushEnabled()) console.log('[pull] apply', entityId);
      // Bundle merges may leave us richer than the clobbered vault row; re-push
      // the superset so it converges at the vault (see dbAdapter / stage-2 doc).
      for (const id of adapterApplyRemoteEntity(mirror, entity)) engine.markDirty(id);
    },
    applyRemoteDelete: (entityId) => {
      // TEMP diagnostic (gated): a remote DELETE row for a row we still hold live
      // is the "deleted" half of the ping-pong — it proves the delete came from
      // the vault log (a peer's soft-delete), not from local state loss.
      if (debugPushEnabled()) console.log('[pull] DELETE', entityId);
      return adapterApplyRemoteDelete(mirror, entityId);
    },
    isInsertOnly,
    getEntityLastModified,
    onStatusChange: callbacks.onStatusChange,
    onError: callbacks.onError,
  });

  // In-flight guard so a debounced push never overlaps a cadence-triggered cycle.
  let syncing = false;

  // Re-fetch glitch-skipped rows by id and re-inject them into the mirror (see
  // the call site in dbSyncCycle for the full rationale). Uses the vault's
  // single-row GET — the same surface the engine's quarantine self-heal uses —
  // and the package's decryptEntity, which reads the SAME per-account root key
  // the engine's own pull just used (module-level key state in dbCrypto), so a
  // row that pulled fine will heal fine. Resolution outcomes per entityId:
  //   • row fetched + decrypted → re-injected into the mirror (recovered)
  //   • row absent/deleted at the vault → nothing to recover; the local absence
  //     matches the vault (convergence, not divergence) → resolved
  //   • no row-get on this client / fetch or decrypt failed → UNRESOLVED,
  //     returned to the caller (which withholds the snapshot and retries next
  //     cycle).
  const healGlitchSkips = async (skippedIds) => {
    const unresolved = [];
    const recovered = [];
    const canGetRow = typeof engine.vault?.getRow === 'function';
    for (const entityId of skippedIds) {
      // Already back in the mirror — the pull happened to re-list the row (e.g.
      // its seq sat above our cursor after all). Nothing to fetch.
      if (adapterGetLocalEntity(mirror, entityId) != null) continue;
      if (!canGetRow) { unresolved.push(entityId); continue; }
      try {
        const row = await engine.vault.getRow(APP_ID, entityId, cfg.accountId);
        if (row == null || row.deleted || !row.envelope) continue; // vault agrees it's gone
        const entity = await decryptEntity(row.envelope, entityId);
        // Plain insert (the row is absent from the mirror by definition). Any
        // enrichment re-push ids are ignored: the vault already holds this row,
        // and the snapshot diff re-pushes any divergence next cycle anyway.
        adapterApplyRemoteEntity(mirror, entity);
        recovered.push(entityId);
      } catch {
        unresolved.push(entityId); // transient failure — retry next cycle
      }
    }
    if (recovered.length) {
      console.warn(
        `[push] GUARD: recovered ${recovered.length} row(s) from the vault after a local-state vanish ` +
        `(re-fetched by id and re-committed). Ids:`,
        recovered.slice(0, 25), recovered.length > 25 ? `(+${recovered.length - 25} more)` : ''
      );
    }
    return unresolved;
  };

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
      const pushDbg = debugPushEnabled();
      // TEMP diagnostic (gated): log what getData() actually handed us this cycle.
      // A collection that momentarily drops to 0 (then refills next cycle) is the
      // "deleted → new" churn seen from the source side — it distinguishes a real
      // state wipe (count goes 0) from a remote delete-row (count stays, [pull]
      // DELETE fires instead).
      // Capture the seed-time payload counts, but DON'T log yet — only an ACTIVE
      // cycle (wrote / deleted / pulled / had dirty rows) prints its summary, so a
      // converged fleet's every-tick no-op cycles stay silent even with the flag on.
      let pushCountsLine = null;
      if (pushDbg) {
        const cnt = (k) => Array.isArray(mirror[k]) ? mirror[k].length
          : (mirror[k] && typeof mirror[k] === 'object' ? Object.keys(mirror[k]).length : 0);
        pushCountsLine = `[push] getData counts → tasks:${cnt('tasks')} unscheduled:${cnt('unscheduledTasks')} gtdFrames:${cnt('gtdFrames')} dailyNotes:${cnt('dailyNotes')} goals:${cnt('goals')} projects:${cnt('projects')}`;
      }
      const dbgChanges = pushDbg ? [] : null; // [{ id, kind, diff:[] }]
      // entityId → hash of the state as of cycle START. Reused three ways: the
      // dirty diff below, the mid-cycle-edit detection in the commit merge, and
      // (via the HWM=0 branch) the full seed.
      const baseHashes = shredHashes(mirror);
      // Bug-2 state: glitch-suspect vanish-deletes the guard skipped this cycle.
      let glitchSkipped = [];
      if (engine.getHighWaterMark() === 0) {
        for (const id of Object.keys(baseHashes)) engine.markDirty(id);
        if (pushDbg) console.log('[push] initial full-seed cycle (HWM=0) — every row dirty');
      } else {
        const prev = loadSnapshot();
        const cur = baseHashes;
        for (const [id, h] of Object.entries(cur)) {
          if (prev[id] === h) continue;
          engine.markDirty(id);
          if (dbgChanges) {
            let a, b;
            try { a = prev[id] === undefined ? undefined : JSON.parse(prev[id]); } catch { a = undefined; }
            try { b = JSON.parse(h); } catch { b = undefined; }
            dbgChanges.push({ id, kind: prev[id] === undefined ? 'new' : 'changed', diff: debugDiffLeaves(a, b) });
          }
        }
        // Deletes: an entity in the last snapshot but absent from getData(). Guard
        // against a transient in-memory shrink (a bad merge / load-save race) being
        // broadcast as permanent fleet-wide deletion — a real delete leaves a
        // tombstone or moves the id to another list; a bare vanish with neither is a
        // suspected glitch and is kept, not deleted. See snapshotDeleteGuard.js.
        const wantDelete = [];
        for (const id of Object.keys(prev)) {
          if (id in cur) continue;
          wantDelete.push(id);
        }
        const { propagate, skipped, reasons } = partitionSnapshotDeletes(wantDelete, cur, mirror);
        glitchSkipped = skipped;
        for (const id of propagate) {
          engine.markDirty(id); // deletes
          if (dbgChanges) dbgChanges.push({ id, kind: 'deleted', diff: [] });
        }
        // Diagnostic: name WHY each delete is being propagated (tombstoned = real
        // deletion; cross-list = the id survives under another kind). Catches a
        // bare-delete this device emits and its cause. Gated on dayglance-debug-push.
        if (debugPushEnabled() && propagate.length) {
          console.warn('[push] propagating delete(s):', propagate.map((id) => `${id} (${reasons[id]})`));
        }
        if (skipped.length) {
          console.warn(
            `[push] GUARD: skipped ${skipped.length} un-tombstoned vanish-delete(s) — ` +
            `suspected local-state glitch, rows kept (would-be fleet-wide deletion). ` +
            `Ids:`, skipped.slice(0, 25), skipped.length > 25 ? `(+${skipped.length - 25} more)` : ''
          );
        }
      }

      callbacks.onStatusChange?.('downloading');
      const pull = await engine.pullRemoteChanges();   // merge remote into mirror first
      // The engine's onRowsSkipped fires from its own dbSyncCycle, which we
      // bypass — so surface undecryptable-row skips from the pull result here.
      if (pull && pull.skipped > 0) callbacks.onRowsSkipped?.(pull.skipped, pull.skippedEntityIds || []);
      // Glitch-skip RECOVERY: a skipped (glitch-suspect) vanish-delete names a
      // row that is missing from local state but still live in the vault, and
      // whose seq sits BELOW the pull cursor (this device consumed it long ago)
      // — an incremental pull will NEVER re-list it. Without recovery a
      // PERSISTENT local shrink leaves this device permanently missing rows the
      // rest of the fleet still has. Re-fetch each such row by id (the same
      // row-get API the engine's quarantine self-heal uses) and re-inject it
      // into the mirror, so the commit below restores it to live state. Runs
      // BEFORE reconcile/prune/snapshot so the healed rows flow through the
      // rest of the cycle like any pulled row. Ids that could NOT be resolved
      // (no row-get on this client, network error, undecryptable) poison the
      // snapshot save below.
      let glitchUnresolved = [];
      if (glitchSkipped.length) glitchUnresolved = await healGlitchSkips(glitchSkipped);
      reconcileCrossList(
        mirror,
        (id) => engine.markDirty(id),
        // Diagnostic: log every cross-list collision in the MERGED MIRROR (the
        // shared vault state), so a bare-delete war driven by a peer's stale
        // second-kind copy (e.g. a lingering recycleBin row) is visible on THIS
        // device even though the peer emits the delete. Gated on dayglance-debug-push.
        debugPushEnabled()
          ? (c) => console.warn(`[reconcile] cross-list collision ${c.id} → keep ${c.winner}, delete [${c.losers.join(', ')}] |`, c.kinds)
          : undefined,
      );
      // Age tombstones out at the fixed 60-day window (src/sync/tombstoneRetention.js).
      // The vault bundle merge is grow-only (dbAdapter unionNewerIso), so a pull
      // re-adds every tombstone a peer still holds; without this the mirror would
      // never shed old tombstones and would disagree with the file-tier merge
      // (which prunes at 60 days), leaving the singleton row oscillating pruned↔
      // restored → push → seq advance → SSE self-nudge loop. Pruning HERE — after
      // pull/reconcile, before the push+snapshot save — means the pushed bundle,
      // the saved snapshot, and the committed state all carry the same pruned set,
      // so an unchanged cycle stays clean. The cutoff is day-floored, so the pruned
      // set only shifts once per day (one push), never every cycle. Local-only GC:
      // an entry we drop but a peer keeps is simply re-dropped next cycle, no churn.
      pruneAllTombstones(mirror, tombstoneCutoff());
      callbacks.onStatusChange?.('uploading');
      // TEMP diagnostic: capture the COMPLETE dirty set (snapshot-diff + pull
      // re-push + cross-list reconcile) right before the push, then report what
      // vault.batch actually wrote — so we can see if the client writes every
      // cycle and which exact row/field is moving. Gated on dayglance-debug-push.
      const dirtyBeforePush = pushDbg && typeof engine.getDirtySet === 'function' ? engine.getDirtySet() : null;
      const pushRes = await engine.pushDirtyRows();        // push merged superset + local changes
      if (pushDbg) {
        const wrote = (pushRes?.written ?? 0) + (pushRes?.deleted ?? 0);
        // Only a cycle that actually moved data logs — wrote/deleted to the vault,
        // pulled remote changes, or had a non-empty dirty set. A pure no-op tick
        // (the common case in a converged fleet) stays silent.
        const active = wrote > 0 || (pull?.applied ?? 0) > 0 || (dirtyBeforePush?.length ?? 0) > 0 || (dbgChanges?.length ?? 0) > 0;
        if (active) {
          if (pushCountsLine) console.log(pushCountsLine);
          console.log(`[push] cycle → vault.batch written:${pushRes?.written ?? 0} deleted:${pushRes?.deleted ?? 0} — client ${wrote > 0 ? 'DID' : 'did NOT'} write this cycle`);
          console.log('[push] dirty ids this cycle:', dirtyBeforePush ?? []);
          if (dbgChanges && dbgChanges.length) {
            for (const c of dbgChanges) {
              console.log(`[push]   snapshot-diff ${c.kind} ${c.id}${c.diff.length ? ` — ${c.diff.join('; ')}` : ''}`);
            }
          } else {
            console.log('[push]   dirt came from pull re-push / cross-list reconcile (superset), not a moving payload field');
          }
        }
      }
      await engine.updateDeviceCursor();

      // ── MERGE-AWARE COMMIT ─────────────────────────────────────────────────
      // The mirror was cloned from app state at cycle START; any user write made
      // during the async pull/push window above exists only in LIVE state. A
      // plain commitData(mirror) (which applyEngineData applies with replace
      // semantics) would revert those writes — and snapshotting that same mirror
      // made the loss permanent (never dirty, never pushed). So: capture the
      // VAULT-CONSISTENT snapshot first (the mirror exactly as pushed/pulled),
      // then merge mid-cycle live edits into the mirror (commitMerge.js) and
      // commit THAT.
      //
      // WHY THE SNAPSHOT IS THE PRE-MERGE MIRROR — the surviving-edit trace:
      //   cycle N   : task T@t1 everywhere. User edits T→T'@t2 during N's pull.
      //               Commit merge: live T'@t2 vs mirror T@t1 → live wins →
      //               commit contains T'. Snapshot saved = pushed mirror = T@t1.
      //   cycle N+1 : diff live(T'@t2) vs snapshot(T@t1) → hash differs → T is
      //               marked DIRTY → pushed. Snapshot now advances to T'.
      // Snapshotting the post-merge (committed) state instead would put T' in
      // the baseline, so cycle N+1 would see live == snapshot, never mark it
      // dirty, and the surviving edit would sit locally forever without ever
      // reaching the vault. The snapshot therefore always means "the state the
      // vault knows"; any local deviation from it is exactly the dirt to push.
      // (Same trace for a task CREATED mid-cycle: in the commit, absent from the
      // snapshot → 'new' in cycle N+1's diff → pushed. And for a pulled remote
      // change: in the snapshot AND in the commit → clean, no echo re-push.)
      const vaultSnapshot = shredHashes(mirror);
      const liveNow = clone(callbacks.getData()) || {};
      const { survivors, honoredDeletes, liveHashes } = mergeMidCycleEdits(mirror, baseHashes, liveNow);
      if (survivors.length || honoredDeletes.length) {
        // An injected mid-cycle row can collide cross-list with a pulled copy of
        // the same id under another kind — dedupe deterministically; the loser
        // is marked dirty so its stale vault row is soft-deleted next push.
        reconcileCrossList(mirror, (id) => engine.markDirty(id));
        if (debugPushEnabled()) {
          console.log('[commit] mid-cycle merge — survivors:', survivors, 'honored deletes:', honoredDeletes);
        }
      }
      // Cheap safety net on top of the merge: when the pull applied nothing and
      // the merged commit is byte-identical to current live state, commitData is
      // a pure no-op replace — skip it entirely (no spurious re-render, and no
      // window at all in which a replace could race a concurrent write).
      const mergedHashes = (survivors.length || honoredDeletes.length) ? shredHashes(mirror) : vaultSnapshot;
      const commitIsNoop = (pull?.applied ?? 0) === 0 && hashMapsEqual(mergedHashes, liveHashes);
      if (!commitIsNoop) callbacks.commitData?.(clone(mirror));

      // A cycle with UNRESOLVED glitch-skips is poisoned: saving its snapshot
      // would drop the vanished rows from the diff baseline, silencing the guard
      // forever (they sit below the pull HWM, so nothing would ever bring them
      // back). Withholding the snapshot keeps them in the baseline: a TRANSIENT
      // shrink self-heals next cycle (live regains the rows → hashes match the
      // old snapshot → clean), and a PERSISTENT shrink re-triggers the guard +
      // row-get heal next cycle. Withholding is safe for the push side: rows
      // pushed this cycle were acked, so re-diffing them next cycle just re-sends
      // idempotent upserts; propagated DELETES re-propagate only while their
      // tombstone / cross-list fingerprint still holds (they can never enter the
      // skipped/glitch set, so no guard loop) and a repeated soft-delete is
      // idempotent at the vault.
      if (glitchUnresolved.length === 0) {
        saveSnapshot(vaultSnapshot);
      } else {
        console.warn(
          `[push] GUARD: ${glitchUnresolved.length} glitch-suspect row(s) could not be re-fetched from the vault — ` +
          `snapshot withheld this cycle so they stay in the diff baseline and recovery retries next cycle. Ids:`,
          glitchUnresolved.slice(0, 25), glitchUnresolved.length > 25 ? `(+${glitchUnresolved.length - 25} more)` : ''
        );
      }
      callbacks.onStatusChange?.('success');
      return { applied: pull?.applied ?? 0, skipped: pull?.skipped ?? 0, skippedEntityIds: pull?.skippedEntityIds ?? [] };
    } catch (err) {
      const code = err && err.code ? err.code : 'NETWORK_ERROR';
      callbacks.onError?.(err?.message || String(err), code);
      callbacks.onStatusChange?.('error');
      return { applied: 0, skipped: 0, skippedEntityIds: [], error: err?.message, code };
    } finally {
      syncing = false;
    }
  };

  return { ...engine, dbSyncCycle, sync: dbSyncCycle };
}

export { APP_ID, CRYPTO_DB_NAME };
