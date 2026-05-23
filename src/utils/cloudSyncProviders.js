// Shim: re-exports providers from @glance-apps/sync with dayGLANCE-pinned config.
// Callers use the same cloudSyncProviders shape and webdavFetch signature as before.
import { nativeHttpRequest as _nativeHttpRequest } from '../native.js';
import { webdavFetch as _webdavFetch, createProviders } from '@glance-apps/sync';

// iOS sets window.DayGlanceIOS = true. Its DayGlanceNative is a Proxy that
// makes every property truthy — explicitly exclude iOS so it falls through
// to the Vercel proxy path, same as the original webdavFetch logic.
const isAndroid =
  typeof window !== 'undefined' &&
  !window.DayGlanceIOS &&
  !!window.DayGlanceNative?.httpRequest;

const dayGlanceEngineConfig = {
  appFolderName: 'GLANCE/dayglance',
  syncFilename: 'dayglance-sync.json',

  // Android: pass the real bridge. iOS/web: null → falls through to proxy.
  nativeHttpRequest: isAndroid ? _nativeHttpRequest : null,

  // Electron: detect at module load (preload sets this up before renderer).
  electronProxyFetch:
    typeof window !== 'undefined' && window.electronAPI?.isElectron
      ? (...args) => window.electronAPI.proxyFetch(...args)
      : null,

  // Relative URL → proxy runs at the same origin as the app.
  proxyUrl: import.meta.env.VITE_WEBDAV_PROXY_URL ?? '',

  // Crypto config (threaded to encryptData/decryptData inside providers).
  cryptoDBName: 'dayglance-crypto',
  nativeGetSyncKey:
    isAndroid && window?.DayGlanceNative?.getSyncKey
      ? () => window.DayGlanceNative.getSyncKey()
      : null,
  nativeStoreSyncKey:
    isAndroid && window?.DayGlanceNative?.storeSyncKey
      ? (val) => window.DayGlanceNative.storeSyncKey(val)
      : null,
};

export const cloudSyncProviders = createProviders(dayGlanceEngineConfig);

// webdavFetch is used directly by App.jsx for CalDAV/ICS requests.
// Unwrap the curried factory so callers get the same (method, url, ...) signature.
export const webdavFetch = _webdavFetch(dayGlanceEngineConfig);
