import { useState, useRef, useEffect } from 'react';
import { initSessionKey } from '../utils/crypto.js';
import { isVaultEnabled } from '../sync/vaultConfig.js';
import { restoreDbRootKey } from '../sync/dbEngine.js';

const useCloudSync = () => {
  const [cloudSyncConfig, setCloudSyncConfig] = useState(() => {
    const saved = localStorage.getItem('day-planner-cloud-sync-config');
    if (!saved) return null;
    const config = JSON.parse(saved);
    // Generic WebDAV users pre-1.0.3: webdavUrl contained the full folder path
    // (e.g. https://dav.example.com/dayglance/). Extract the path into syncFolder
    // and strip webdavUrl back to the server root to match the new provider shape.
    if (config?.provider === 'webdav' && config?.webdavUrl && !config?.syncFolder) {
      try {
        const u = new URL(config.webdavUrl);
        const folder = u.pathname.replace(/^\/|\/$/g, '');
        config.syncFolder = folder || 'GLANCE/dayglance';
        config.webdavUrl = u.origin;
        localStorage.setItem('day-planner-cloud-sync-config', JSON.stringify(config));
      } catch { config.syncFolder = 'GLANCE/dayglance'; }
    }
    // Existing non-WebDAV users who never set a sync folder keep the old
    // 'dayglance' path so their sync does not break.
    if (config?.enabled && !config.syncFolder) {
      config.syncFolder = 'dayglance';
      localStorage.setItem('day-planner-cloud-sync-config', JSON.stringify(config));
    }
    return config;
  });
  const [cloudSyncStatus, setCloudSyncStatus] = useState('idle');
  const [cloudSyncError, setCloudSyncError] = useState(null);
  const [cloudSyncLastSynced, setCloudSyncLastSynced] = useState(() =>
    localStorage.getItem('day-planner-cloud-sync-last-synced') || null
  );
  const [cloudSyncConflict, setCloudSyncConflict] = useState(null); // { remoteData, remoteModified }

  // null  = key check pending (initSessionKey not yet resolved — show nothing)
  // true  = ready (key found in cache, or encryption not enabled)
  // false = passphrase required (encryption enabled, no cached key)
  const [syncKeyReady, setSyncKeyReady] = useState(null);

  const cloudSyncDebounceRef            = useRef(null);
  const suppressCloudUploadRef          = useRef(false);
  const suppressTimestampRef            = useRef(false);
  const suppressClearPendingRef         = useRef(false);
  // Shared lock for iCloud sync (which still lives in App.jsx as a parallel
  // transport). The WebDAV engine has its own internal lock; iCloud reads this
  // ref to know whether to skip a cycle.
  const cloudSyncInProgressRef          = useRef(false);
  const cloudSyncInitialDoneRef         = useRef(false);
  // Set in App.jsx to the engine's download() bound method, used by the
  // visibility/focus listener and the 60-second poll so they always call the
  // freshest closure.
  const cloudSyncDownloadRef            = useRef(null);
  // Set to true when iCloudSync is skipped because WebDAV holds the lock,
  // so the download cycle can re-run iCloud on completion (H2).
  const iCloudPendingRef = useRef(false);

  // Persist cloud sync config
  useEffect(() => {
    if (cloudSyncConfig) {
      localStorage.setItem('day-planner-cloud-sync-config', JSON.stringify(cloudSyncConfig));
    } else {
      localStorage.removeItem('day-planner-cloud-sync-config');
    }
  }, [cloudSyncConfig]);

  // On mount: attempt to restore the cached encryption key(s) from device storage
  // for whichever transports are active. syncKeyReady becomes false only when an
  // active transport needs a key that isn't cached, so the app shows the passphrase
  // prompt. Each tier has its OWN cached key (file tier vs GLANCEvault DB root key),
  // so we restore exactly the ones in use:
  //   • File tier  — needed only when WebDAV sync is enabled AND encrypted. A
  //     vault-only device has encryptionEnabled=true but enabled=false, so it must
  //     NOT be gated on the file-tier key (which it never writes) — that was the
  //     cause of the every-launch re-prompt.
  //   • GLANCEvault — needed whenever the vault is enabled; gated on its DB root key.
  useEffect(() => {
    const config = (() => {
      const saved = localStorage.getItem('day-planner-cloud-sync-config');
      return saved ? JSON.parse(saved) : null;
    })();

    const needFileKey  = !!(config?.enabled && config?.encryptionEnabled);
    const needVaultKey = isVaultEnabled();

    if (!needFileKey && !needVaultKey) {
      // No encrypted transport active — no passphrase needed.
      setSyncKeyReady(true);
      return;
    }

    Promise.all([
      needFileKey  ? initSessionKey()   : Promise.resolve(true),
      needVaultKey ? restoreDbRootKey() : Promise.resolve(true),
    ]).then(([fileOk, vaultOk]) => {
      // Ready only when every active tier restored its key; otherwise App shows
      // the passphrase prompt, and the entered passphrase re-derives + caches the
      // missing key(s) on the next sync.
      setSyncKeyReady(fileOk && vaultOk);
    });
  }, []);

  return {
    cloudSyncConfig, setCloudSyncConfig,
    cloudSyncStatus, setCloudSyncStatus,
    cloudSyncError, setCloudSyncError,
    cloudSyncLastSynced, setCloudSyncLastSynced,
    cloudSyncConflict, setCloudSyncConflict,
    syncKeyReady, setSyncKeyReady,
    cloudSyncDebounceRef,
    suppressCloudUploadRef,
    suppressTimestampRef,
    suppressClearPendingRef,
    cloudSyncInProgressRef,
    cloudSyncInitialDoneRef,
    cloudSyncDownloadRef,
    iCloudPendingRef,
  };
};

export default useCloudSync;
