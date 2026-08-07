/**
 * Full app-data reset — "start over from empty".
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * On iOS there was no way to get back to a clean slate. Deleting the app is the
 * obvious move and it does NOT work, because the app's data does not all live in
 * the app sandbox:
 *
 *   • localStorage / IndexedDB live in the WKWebView's default website data
 *     store, inside the sandbox — iOS DOES delete these on uninstall.
 *   • dayglance-sync.json lives in the iCloud ubiquity container, at
 *     ~/Library/Mobile Documents/iCloud~com~dayglance/ — OUTSIDE the app
 *     sandbox. iOS does not remove it when the app is deleted. So a fresh
 *     install finds an empty localStorage, reads the surviving file on its first
 *     sync cycle, merges it in, and every task is back — indistinguishable from
 *     "delete did nothing".
 *
 * Be precise about that second one: the file survives because of WHERE IT LIVES,
 * not because cloud syncing is on. The read is a local file read. A user who has
 * turned the app's iCloud toggle off, deleted the app, and reinstalled can still
 * get all their data back, because ICloudBridge.isAvailable() only checks that a
 * container path resolves — which is not the same question as "is iCloud enabled
 * for this app". (Reported in the field, not yet confirmed on-device.)
 *
 * A reset therefore has to reach that file too, or it is not a reset. That is the
 * `scope` parameter: 'device' wipes local state only and leaves the file (so
 * other devices are untouched — but this device can read it straight back, which
 * is why the UI says so plainly), 'everywhere' also deletes it. The delete goes
 * through the file bridge rather than a sync cycle, so it removes the surviving
 * local copy whether or not syncing is enabled.
 *
 * ── What 'everywhere' does NOT do ──────────────────────────────────────────
 * It does not wipe a fleet. Deleting the file is necessary but not sufficient
 * while another device is running:
 *
 *   1. this device deletes the file and clears its own storage, including
 *      day-planner-cloud-sync-last-synced;
 *   2. with no sync record it seeds a fresh EMPTY snapshot on its next cycle;
 *   3. another running device reads that empty snapshot and merges — and
 *      mergeArrayById keeps every local-only row when the remote side is empty
 *      and carries no tombstones — so it writes its FULL dataset straight back;
 *   4. this device pulls it down again.
 *
 * The seeding guard in App.jsx iCloudSync is not the lever here; step 3 is a
 * merge, not a seed, so tightening the seed path would not change the outcome.
 * Propagating a wipe would need a reset tombstone carried in the payload itself
 * (a `resetAt` other devices honour by wiping instead of merging). That is a new
 * destructive broadcast primitive in a sync engine deliberately biased toward
 * KEEPING data — see the hazard write-up at the top of sync/snapshotDeleteGuard.js
 * — so it is a considered change, not a patch, and is deliberately not done here.
 *
 * Note that quitting the other devices is NOT a workaround. A closed device still
 * holds its full localStorage, so it re-merges and republishes the moment it is
 * reopened — quitting only avoids the immediate race, it does not make the reset
 * stick. The only way to a clean fleet is to reset every device, leaving the
 * others closed until you have. The UI says exactly that.
 *
 * ── Shape ─────────────────────────────────────────────────────────────────
 * Every dependency is injected via `deps` so the whole thing is testable without
 * a browser: no direct references to window/localStorage/indexedDB outside the
 * default deps object. Nothing throws — each step records its own failure in
 * `errors` and the rest still runs, because a half-finished reset that stops on
 * the first error is worse than one that clears what it can and reports the gap.
 */

import * as icloudFileTransport from '../intents/icloudFileTransport.js';

/** The dayGLANCE snapshot inside the iCloud container's Documents/ folder. */
export const ICLOUD_SYNC_FILE = 'dayglance-sync.json';

/**
 * IndexedDB databases dayGLANCE creates. `indexedDB.databases()` is the
 * authoritative list where it exists, but it is unavailable on older WebKit, so
 * this hard-coded set is unioned in to guarantee coverage on iOS.
 *
 * Keep in sync with the DB_NAME constants in:
 *   obsidian.js, intents/outbox.js, intents/intentsKeyStore.js,
 *   sync/dbEngine.js, utils/folderBackup.js
 */
export const KNOWN_INDEXEDDB_NAMES = Object.freeze([
  'dayglance-crypto',
  'dayglance-db-crypto',
  'dayglance-folder-backup',
  'dayglance-intents-crypto',
  'dayglance-intents-outbox',
  'dayglance-obsidian',
]);

/**
 * A blocked deleteDatabase() never settles while another tab or a live
 * connection holds the DB open. We reload immediately after a reset, which
 * closes those connections, so waiting forever would just hang the UI —
 * time out and report it instead.
 */
const DELETE_DB_TIMEOUT_MS = 3000;

// ── Reset-in-progress guard ────────────────────────────────────────────────
// Between "localStorage wiped" and "page reloaded" the React tree is still
// mounted and still holds every task in state. Any save or sync that fires in
// that window would write it all straight back — useSaveOnChange's effect
// re-persists localStorage, and the 15-second iCloud poll re-seeds the file we
// just deleted. Both check this flag. It is deliberately module-level rather
// than a ref: the writers live in different modules and the flag must outlive
// any component that unmounts mid-reset. It is never cleared — the reload that
// follows is what clears it, by tearing down the module registry.
let resetInProgress = false;

/** True from the moment a reset starts until the page reloads. */
export function isResetInProgress() {
  return resetInProgress;
}

/** Marks a reset as started. Exported for tests; callers get it via resetAppData. */
export function beginReset() {
  resetInProgress = true;
}

/** Test-only escape hatch — production code relies on the reload to clear it. */
export function __resetGuardForTests() {
  resetInProgress = false;
}

// ── Individual steps ───────────────────────────────────────────────────────

/**
 * Clears localStorage and sessionStorage wholesale.
 *
 * A key-prefix sweep would be more surgical, but the origins this app runs on
 * (dg:// in the iOS WKWebView, file:// in Electron, its own hostname on the web)
 * belong to dayGLANCE alone, so there is nothing else in there to preserve —
 * and a prefix list silently misses any key added later without updating it.
 * "Reset everything" should mean everything.
 */
export function clearWebStorage({ localStorage, sessionStorage }, errors) {
  try {
    localStorage?.clear();
  } catch (err) {
    errors.push(`localStorage: ${err?.message ?? err}`);
  }
  try {
    sessionStorage?.clear();
  } catch (err) {
    errors.push(`sessionStorage: ${err?.message ?? err}`);
  }
}

/**
 * Deletes every dayGLANCE IndexedDB database.
 * Returns the names that were successfully deleted.
 */
export async function deleteIndexedDbDatabases({ indexedDB }, errors) {
  if (!indexedDB) return [];

  // Union of what the browser reports and what we know we create — either
  // source alone leaves a gap (databases() is missing on older WebKit; the
  // hard-coded list goes stale when a new store is added).
  const names = new Set(KNOWN_INDEXEDDB_NAMES);
  if (typeof indexedDB.databases === 'function') {
    try {
      for (const { name } of await indexedDB.databases()) {
        if (name) names.add(name);
      }
    } catch (err) {
      errors.push(`indexedDB.databases(): ${err?.message ?? err}`);
    }
  }

  const deleted = [];
  for (const name of names) {
    try {
      await deleteOneDatabase(indexedDB, name);
      deleted.push(name);
    } catch (err) {
      errors.push(`indexedDB "${name}": ${err?.message ?? err}`);
    }
  }
  return deleted;
}

function deleteOneDatabase(indexedDB, name) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(arg);
    };
    const timer = setTimeout(
      () => finish(reject, new Error('delete blocked (timed out)')),
      DELETE_DB_TIMEOUT_MS,
    );

    let req;
    try {
      req = indexedDB.deleteDatabase(name);
    } catch (err) {
      finish(reject, err);
      return;
    }
    req.onsuccess = () => finish(resolve);
    req.onerror = () => finish(reject, req.error ?? new Error('delete failed'));
    // onblocked is not terminal — the delete still completes once the other
    // connection closes, so let the timeout decide rather than failing here.
  });
}

/**
 * Clears the Cache Storage API (service-worker / PWA asset caches).
 * Returns the cache names that were deleted.
 */
export async function clearCacheStorage({ caches }, errors) {
  if (!caches?.keys) return [];
  const deleted = [];
  try {
    for (const key of await caches.keys()) {
      try {
        await caches.delete(key);
        deleted.push(key);
      } catch (err) {
        errors.push(`cache "${key}": ${err?.message ?? err}`);
      }
    }
  } catch (err) {
    errors.push(`caches.keys(): ${err?.message ?? err}`);
  }
  return deleted;
}

/**
 * Deletes the iCloud snapshot so a reinstall — or the next sync cycle on this
 * device — has nothing to restore from. This is the step that makes a reset
 * actually stick on iOS.
 *
 * Returns { attempted, ok }. `attempted: false` means the platform has no iCloud
 * transport (Android, web, non-Mac Electron), which is not an error.
 *
 * Deliberately scoped to dayGLANCE's own file: GLANCE/users/ and GLANCE/events/
 * in the same container are shared with the other GLANCE apps, and wiping them
 * would reset data this app does not own.
 */
export async function clearICloudSnapshot({ icloud }, errors) {
  if (!icloud?.isAvailable?.()) return { attempted: false, ok: false };
  try {
    const ok = await icloud.deleteFile(ICLOUD_SYNC_FILE);
    if (!ok) errors.push('iCloud snapshot could not be deleted');
    return { attempted: true, ok };
  } catch (err) {
    errors.push(`iCloud snapshot: ${err?.message ?? err}`);
    return { attempted: true, ok: false };
  }
}

// ── Orchestration ──────────────────────────────────────────────────────────

const defaultDeps = () => ({
  localStorage: typeof window !== 'undefined' ? window.localStorage : null,
  sessionStorage: typeof window !== 'undefined' ? window.sessionStorage : null,
  indexedDB: typeof window !== 'undefined' ? window.indexedDB : null,
  caches: typeof window !== 'undefined' ? window.caches : null,
  icloud: icloudFileTransport,
});

/**
 * Wipes dayGLANCE's data and returns a summary.
 *
 * @param {object}  options
 * @param {'device'|'everywhere'} [options.scope='device']
 *        'device'     — local storage only; the iCloud snapshot survives.
 *        'everywhere' — also deletes the iCloud snapshot.
 * @param {object}  [deps] Injected browser/platform APIs (tests override these).
 * @returns {Promise<{scope, indexedDb: string[], caches: string[],
 *                    cloud: {attempted: boolean, ok: boolean}, errors: string[]}>}
 *
 * The caller is responsible for reloading afterwards — see reloadAfterReset().
 * Until it does, the in-memory React state is still live and the reset guard is
 * the only thing stopping it from being written back.
 */
export async function resetAppData({ scope = 'device' } = {}, deps = defaultDeps()) {
  beginReset();
  const errors = [];

  // Cloud first, local second. The reverse order leaves a window where local is
  // empty but the snapshot still exists, and a sync cycle in that window would
  // treat the empty device as "nothing to merge" and pull everything back.
  const cloud =
    scope === 'everywhere'
      ? await clearICloudSnapshot(deps, errors)
      : { attempted: false, ok: false };

  const indexedDb = await deleteIndexedDbDatabases(deps, errors);
  const cacheNames = await clearCacheStorage(deps, errors);
  clearWebStorage(deps, errors);

  return { scope, indexedDb, caches: cacheNames, cloud, errors };
}

/**
 * Reloads into the now-empty app. Separate from resetAppData so the caller can
 * show the outcome (or an error) before the page goes away, and so tests can
 * assert on the reset without a jsdom navigation.
 */
export function reloadAfterReset(location = typeof window !== 'undefined' ? window.location : null) {
  location?.reload?.();
}
