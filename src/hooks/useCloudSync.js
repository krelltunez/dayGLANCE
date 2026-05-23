import { useState, useRef, useEffect } from 'react';
import { initSessionKey } from '../utils/crypto.js';

const useCloudSync = () => {
  const [cloudSyncConfig, setCloudSyncConfig] = useState(() => {
    const saved = localStorage.getItem('day-planner-cloud-sync-config');
    if (!saved) return null;
    const config = JSON.parse(saved);
    // Existing users who never set a sync folder keep the old 'dayglance' path
    // so their sync does not break. New users get 'GLANCE/dayglance' by default.
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

  // On mount: attempt to restore the session encryption key from device storage.
  // If encryption is enabled but no cached key exists, syncKeyReady stays false
  // so the app can show the passphrase prompt.
  useEffect(() => {
    const config = (() => {
      const saved = localStorage.getItem('day-planner-cloud-sync-config');
      return saved ? JSON.parse(saved) : null;
    })();

    if (config?.encryptionEnabled) {
      initSessionKey().then((found) => {
        // found = true  → key restored silently, unlock sync immediately
        // found = false → passphrase prompt will be shown by App
        setSyncKeyReady(found);
      });
    } else {
      // Encryption not configured — no passphrase needed.
      setSyncKeyReady(true);
    }
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
