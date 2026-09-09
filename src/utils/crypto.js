// Shim: re-exports crypto from @glance-apps/sync with dayGLANCE-pinned config.
// Callers use the same zero-config signatures as before; this file injects
// cryptoDBName and the Android Keystore bridge so the package has no
// hardcoded app names or global references.

import {
  encryptData as _encryptData,
  decryptData as _decryptData,
  setupEncryptionKey as _setupEncryptionKey,
  clearEncryptionKey as _clearEncryptionKey,
  initSessionKey as _initSessionKey,
  setSyncPassphrase,
  getSyncPassphrase,
  hasEncryptionReady,
  isEncryptedEnvelope,
} from '@glance-apps/sync';
import { SECURE_SLOT, secureGet, secureSet, secureStoreAvailable, readIndexedDbRecord } from './nativeSecureStore.js';

const CRYPTO_DB_NAME = 'dayglance-crypto';

// iOS uses a Proxy for DayGlanceNative that makes every property lookup truthy,
// so we must explicitly exclude iOS before treating the native bridge as Android.
// iOS has its own path: the file-tier key record is kept in the shell's
// Keychain (utils/nativeSecureStore.js) through the package's native hooks, the
// same record shape Android stores in its Keystore, so a WebKit storage purge
// no longer costs the key. Web and Electron stay on IndexedDB.
function getDayGlanceConfig() {
  if (secureStoreAvailable()) {
    return {
      cryptoDBName: CRYPTO_DB_NAME,
      nativeGetSyncKey: () => secureGet(SECURE_SLOT.syncKey),
      nativeStoreSyncKey: (val) => secureSet(SECURE_SLOT.syncKey, val),
    };
  }
  const isAndroid = typeof window !== 'undefined' &&
    !window.DayGlanceIOS &&
    !!window.DayGlanceNative?.getSyncKey;
  return {
    cryptoDBName: CRYPTO_DB_NAME,
    nativeGetSyncKey: isAndroid ? () => window.DayGlanceNative.getSyncKey() : null,
    nativeStoreSyncKey: isAndroid ? (val) => window.DayGlanceNative.storeSyncKey(val) : null,
  };
}

// Existing iOS installs cached the key in IndexedDB before the Keychain mirror
// existed. Move it once so the upgrade never re-prompts for the passphrase.
// The IndexedDB record is {id, rawKey: ArrayBuffer, salt: number[]}; the native
// record is the base64 JSON {rawKey: number[], salt: number[]} the package reads.
async function migrateLegacyIosSyncKey() {
  const record = await readIndexedDbRecord(CRYPTO_DB_NAME, 'keys', 'sync-key');
  if (!record || !record.rawKey) return false;
  const rawKey = Array.from(new Uint8Array(record.rawKey));
  const salt = Array.from(record.salt || []);
  return secureSet(SECURE_SLOT.syncKey, btoa(JSON.stringify({ rawKey, salt })));
}

export { setSyncPassphrase, getSyncPassphrase, hasEncryptionReady, isEncryptedEnvelope };

export const encryptData        = (data)         => _encryptData(data, getDayGlanceConfig());
export const decryptData        = (envelope)     => _decryptData(envelope, getDayGlanceConfig());
export const setupEncryptionKey = (passphrase)   => _setupEncryptionKey(passphrase, getDayGlanceConfig());
export const clearEncryptionKey = ()             => _clearEncryptionKey(getDayGlanceConfig());
export const initSessionKey     = async () => {
  const cfg = getDayGlanceConfig();
  if (await _initSessionKey(cfg)) return true;
  if (!secureStoreAvailable()) return false;
  if (await migrateLegacyIosSyncKey()) {
    console.info('[crypto] file-tier key moved from IndexedDB to the device secure store');
    return _initSessionKey(cfg);
  }
  return false;
};
