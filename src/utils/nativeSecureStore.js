// The iOS shell's Keychain-backed secure store (SecureStoreBridge.swift).
//
// On iOS every app record and every connection setting lives in WKWebView
// storage, which iOS treats as evictable: a routine reboot purged it
// (2026-09-09) and the phone came back on onboarding with an empty GLANCEvault
// configuration and no cached keys. This module is the web side of the native
// mirror: the connection state and the cached key records are written here
// whenever they change, and read back on launch when web storage has none.
//
// Android keeps its own Keystore path (getSyncKey / storeSyncKey) and the web
// and Electron builds keep IndexedDB; on those platforms every call here is an
// inert no-op. The sync passphrase itself is never stored: after a purge a
// device that needs a key it cannot restore prompts once, as it does today.
//
// The iOS check is inlined (the same test as native.js isNativeIOS) so this
// module has no imports: tests that mock native.js keep working unchanged.

export const SECURE_SLOT = Object.freeze({
  // JSON of the GLANCEvault connection ({enabled, vaultUrl, vaultToken, accountId}).
  vaultConfig: 'vault-config',
  // JSON of the cloud sync preference (day-planner-cloud-sync-config).
  cloudSyncConfig: 'cloud-sync-config',
  // The file-tier AES key record ({rawKey, salt}) as base64 JSON, the same
  // shape @glance-apps/sync stores in the Android Keystore.
  syncKey: 'sync-key',
  // The GLANCEvault DB root key record ({rootBytes, salt}) as base64 JSON.
  dbRootKey: 'db-root-key',
});

export const secureStoreAvailable = () =>
  typeof window !== 'undefined' && !!window.DayGlanceIOS;

/** @returns {string|null} the stored value, null when absent or unavailable */
export function secureGet(slot) {
  if (!secureStoreAvailable()) return null;
  try {
    const v = window.DayGlanceNative.secureGet(slot);
    return typeof v === 'string' && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Writes value, or clears the slot when value is null. @returns {boolean} */
export function secureSet(slot, value) {
  if (!secureStoreAvailable()) return false;
  try {
    const r = window.DayGlanceNative.secureSet(slot, value == null ? null : String(value));
    return r === 'true';
  } catch {
    return false;
  }
}

/**
 * One-time migration read: a key record an earlier iOS build cached in
 * IndexedDB. Resolves null when the database or the record is absent. Where
 * the browser can list databases the open is skipped for a missing one, so
 * the read never creates an empty database as a side effect.
 */
export async function readIndexedDbRecord(dbName, storeName, id) {
  try {
    if (typeof indexedDB === 'undefined') return null;
    if (typeof indexedDB.databases === 'function') {
      const names = (await indexedDB.databases()).map((d) => d.name);
      if (!names.includes(dbName)) return null;
    }
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      if (!db.objectStoreNames.contains(storeName)) return null;
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(id);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
      });
    } finally {
      try { db.close(); } catch { /* ignore */ }
    }
  } catch {
    return null;
  }
}
