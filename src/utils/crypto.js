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

// iOS uses a Proxy for DayGlanceNative that makes every property lookup truthy,
// so we must explicitly exclude iOS before treating the native bridge as Android.
function getDayGlanceConfig() {
  const isAndroid = typeof window !== 'undefined' &&
    !window.DayGlanceIOS &&
    !!window.DayGlanceNative?.getSyncKey;
  return {
    cryptoDBName: 'dayglance-crypto',
    nativeGetSyncKey: isAndroid ? () => window.DayGlanceNative.getSyncKey() : null,
    nativeStoreSyncKey: isAndroid ? (val) => window.DayGlanceNative.storeSyncKey(val) : null,
  };
}

export { setSyncPassphrase, getSyncPassphrase, hasEncryptionReady, isEncryptedEnvelope };

export const encryptData        = (data)         => _encryptData(data, getDayGlanceConfig());
export const decryptData        = (envelope)     => _decryptData(envelope, getDayGlanceConfig());
export const setupEncryptionKey = (passphrase)   => _setupEncryptionKey(passphrase, getDayGlanceConfig());
export const clearEncryptionKey = ()             => _clearEncryptionKey(getDayGlanceConfig());
export const initSessionKey     = ()             => _initSessionKey(getDayGlanceConfig());
