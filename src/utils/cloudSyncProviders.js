// Shim: re-exports providers from @glance-apps/sync with dayGLANCE-pinned config.
// Callers use the same cloudSyncProviders shape and webdavFetch signature as before.
import { nativeHttpRequest as _nativeHttpRequest } from '../native.js';
import { webdavFetch as _webdavFetch, createProviders } from '@glance-apps/sync';

// The native HTTP bridge exists on BOTH Android and iOS — iOS exposes it via
// the DayGlanceNative Proxy (dgbridge:// → URLSession). src/sync/adapter.js (the
// main sync engine) routes WebDAV through it on iOS, which is why main sync works
// there; webdavFetch must match. Otherwise iOS falls back to /api/webdav-proxy/,
// which is unreachable from the app's dg:// origin (proxyUrl is relative), so
// every request throws. Detection mirrors adapter.js exactly.
const isNativeApp =
  typeof window !== 'undefined' &&
  !!window.DayGlanceNative?.httpRequest;

const dayGlanceEngineConfig = {
  appFolderName: 'GLANCE/dayglance',
  syncFilename: 'dayglance-sync.json',

  // Android + iOS: use the native bridge. Web: null → falls through to proxy.
  nativeHttpRequest: isNativeApp ? _nativeHttpRequest : null,

  // Electron: detect at module load (preload sets this up before renderer).
  electronProxyFetch:
    typeof window !== 'undefined' && window.electronAPI?.isElectron
      ? (...args) => window.electronAPI.proxyFetch(...args)
      : null,

  isHostedApp:
    typeof window !== 'undefined' &&
    /(^|\.)(?:dayglance|lifeglance|lastglance)\.app$/.test(window.location.hostname),

  // Relative URL → proxy runs at the same origin as the app.
  proxyUrl: import.meta.env.VITE_WEBDAV_PROXY_URL ?? '',

  // Crypto config (threaded to encryptData/decryptData inside providers).
  cryptoDBName: 'dayglance-crypto',
  nativeGetSyncKey:
    isNativeApp && window?.DayGlanceNative?.getSyncKey
      ? () => window.DayGlanceNative.getSyncKey()
      : null,
  nativeStoreSyncKey:
    isNativeApp && window?.DayGlanceNative?.storeSyncKey
      ? (val) => window.DayGlanceNative.storeSyncKey(val)
      : null,
};

export const cloudSyncProviders = createProviders(dayGlanceEngineConfig);

// webdavFetch is used directly by App.jsx for CalDAV/ICS requests.
// Unwrap the curried factory so callers get the same (method, url, ...) signature.
export const webdavFetch = _webdavFetch(dayGlanceEngineConfig);
