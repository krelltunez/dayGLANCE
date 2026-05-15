import { useState, useRef, useEffect } from 'react';
import { initSessionKey } from '../utils/crypto.js';

const useCloudSync = () => {
  const [cloudSyncConfig, setCloudSyncConfig] = useState(() => {
    const saved = localStorage.getItem('day-planner-cloud-sync-config');
    return saved ? JSON.parse(saved) : null;
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
  const cloudSyncInProgressRef          = useRef(false);
  const cloudSyncInitialDoneRef         = useRef(false);
  const cloudSyncDownloadRef            = useRef(null);
  // Upload-specific backoff (used by cloudSyncUpload)
  const cloudSyncErrorCountRef          = useRef(0);
  const cloudSyncBackoffUntilRef        = useRef(0);
  // Download-specific backoff (separate so upload failures don't block downloads and vice versa)
  const cloudSyncDownloadErrorCountRef  = useRef(0);
  const cloudSyncDownloadBackoffUntilRef = useRef(0);
  // Set to true when a debounce-triggered download fires while another download
  // holds the lock, so the running cycle schedules a follow-up download on
  // completion to pick up the pending local change (and any concurrent remote
  // writes) rather than blindly uploading over them (H1).
  const cloudSyncPendingUploadRef = useRef(false);
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
    cloudSyncErrorCountRef,
    cloudSyncBackoffUntilRef,
    cloudSyncDownloadErrorCountRef,
    cloudSyncDownloadBackoffUntilRef,
    cloudSyncPendingUploadRef,
    iCloudPendingRef,
  };
};

export default useCloudSync;
