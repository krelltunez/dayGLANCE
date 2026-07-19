import { useCallback, useEffect, useRef, useState } from 'react';
import { AUTO_BACKUP_INTERVALS, AUTO_BACKUP_RETENTION } from '../utils/autoBackup.js';
import {
  isFolderBackupSupported, pickBackupFolder, loadFolderHandle, removeFolderHandle,
  queryFolderPermission, requestFolderPermission,
  readLiveBackup, writeLiveBackup, writeSnapshotBackup, payloadHasData,
} from '../utils/folderBackup.js';

// Debounce between a data save and the folder write. Short on purpose: on
// wipe-on-exit machines the whole point is that closing the window costs
// nothing, so the live file should trail the app by seconds, not minutes.
// visibilitychange/pagehide flush whatever is still pending.
const WRITE_DEBOUNCE_MS = 2500;

const LIVE_LAST_KEY = 'day-planner-folder-backup-live-last';
const SNAPSHOT_LAST_KEY = 'day-planner-folder-backup-snapshot-last';

/**
 * Continuous backup of the app's data to a user-chosen local folder via the
 * File System Access API (see src/utils/folderBackup.js for the file layout
 * and why this exists).
 *
 * State machine, per session:
 *   no handle            → 'disconnected' when the feature is enabled but the
 *                          stored handle is gone (wiped profile) — UI offers
 *                          the folder picker, which doubles as the restore flow.
 *   handle, no permission→ permission 'prompt' — UI offers one-click Reconnect;
 *                          onNeedsReconnect fires once so the user notices.
 *   handle + permission  → armed: every scheduleWrite() debounces into a live
 *                          file write, plus cadence snapshots with retention.
 *
 * Empty-state guard: the hook never overwrites a live file that has data with
 * a payload that has none ('guarded' status). That combination means the app
 * state was lost, not edited — restoring, not mirroring, is what's wanted.
 */
export default function useFolderBackup({
  enabled, snapshotFrequency, dataLoaded, disabled,
  buildPayload, onNeedsReconnect,
}) {
  const supported = isFolderBackupSupported();

  const [folderName, setFolderName] = useState(null); // null = no handle this session
  const [permission, setPermission] = useState(null); // 'granted' | 'prompt' | null
  // 'idle' | 'writing' | 'error' | 'guarded' | 'disconnected'
  const [status, setStatus] = useState('idle');
  const [lastWritten, setLastWritten] = useState(() => {
    try { return localStorage.getItem(LIVE_LAST_KEY); } catch { return null; }
  });

  const handleRef = useRef(null);
  const armedRef = useRef(false);
  const liveHasDataRef = useRef(false);
  const debounceRef = useRef(null);
  const writingRef = useRef(false);
  const writePendingRef = useRef(false);
  const notifiedReconnectRef = useRef(false);

  // Latest-value refs so the stable callbacks below never close over stale props.
  const buildPayloadRef = useRef(buildPayload);
  buildPayloadRef.current = buildPayload;
  const snapshotFrequencyRef = useRef(snapshotFrequency);
  snapshotFrequencyRef.current = snapshotFrequency;
  const onNeedsReconnectRef = useRef(onNeedsReconnect);
  onNeedsReconnectRef.current = onNeedsReconnect;

  const doWrite = useCallback(async () => {
    const handle = handleRef.current;
    if (!handle || !armedRef.current) return;
    if (writingRef.current) { writePendingRef.current = true; return; }
    writingRef.current = true;
    try {
      const payload = buildPayloadRef.current?.();
      if (!payload) return;
      if (!payloadHasData(payload) && liveHasDataRef.current) {
        armedRef.current = false;
        setStatus('guarded');
        return;
      }
      setStatus('writing');
      await writeLiveBackup(handle, payload);
      liveHasDataRef.current = payloadHasData(payload);
      const now = new Date().toISOString();
      try { localStorage.setItem(LIVE_LAST_KEY, now); } catch { /* ignore */ }
      setLastWritten(now);
      setStatus('idle');

      // Cadence snapshot alongside the live write. The last-snapshot marker
      // lives in localStorage; on wipe-on-exit machines it resets each session,
      // giving one snapshot per session — exactly the history those machines
      // otherwise lack. Retention pruning bounds the file count either way.
      const freq = snapshotFrequencyRef.current || 'daily';
      let last = null;
      try { last = localStorage.getItem(SNAPSHOT_LAST_KEY); } catch { /* ignore */ }
      const interval = AUTO_BACKUP_INTERVALS[freq] ?? AUTO_BACKUP_INTERVALS.daily;
      const elapsed = last ? (Date.now() - new Date(last).getTime()) / 1000 : Infinity;
      if (elapsed >= interval) {
        await writeSnapshotBackup(handle, payload, AUTO_BACKUP_RETENTION[freq] ?? 30);
        try { localStorage.setItem(SNAPSHOT_LAST_KEY, now); } catch { /* ignore */ }
      }
    } catch (err) {
      console.error('Folder backup write failed:', err);
      setStatus('error');
    } finally {
      writingRef.current = false;
      if (writePendingRef.current) {
        writePendingRef.current = false;
        doWrite();
      }
    }
  }, []);

  // Called (via a ref) after every saveData() pass. Cheap no-op until armed.
  const scheduleWrite = useCallback(() => {
    if (!armedRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      doWrite();
    }, WRITE_DEBOUNCE_MS);
  }, [doWrite]);

  // Arm write-through for `handle`, unless the empty-state guard trips.
  const evaluateAndArm = useCallback(async (handle) => {
    let live = null;
    try {
      live = await readLiveBackup(handle);
    } catch (err) {
      console.error('Folder backup: could not read live file:', err);
    }
    liveHasDataRef.current = payloadHasData(live);
    const current = buildPayloadRef.current?.();
    if (liveHasDataRef.current && current && !payloadHasData(current)) {
      armedRef.current = false;
      setStatus('guarded');
      return false;
    }
    armedRef.current = true;
    setStatus('idle');
    doWrite();
    return true;
  }, [doWrite]);

  /**
   * Pick a folder (user gesture). If it already holds a live backup with data,
   * does NOT arm — returns { existing } so the caller can ask the user whether
   * to restore it or replace it with this device's current data.
   */
  const connect = useCallback(async () => {
    try {
      const handle = await pickBackupFolder();
      handleRef.current = handle;
      setFolderName(handle.name);
      setPermission('granted');
      let existing = null;
      try { existing = await readLiveBackup(handle); } catch { /* treat as absent */ }
      if (payloadHasData(existing)) {
        armedRef.current = false;
        liveHasDataRef.current = true;
        return { ok: true, existing };
      }
      liveHasDataRef.current = false;
      armedRef.current = true;
      setStatus('idle');
      doWrite();
      return { ok: true, existing: null };
    } catch (err) {
      if (err?.name === 'AbortError') return { ok: false, cancelled: true };
      console.error('Folder backup connect failed:', err);
      return { ok: false, error: err.message };
    }
  }, [doWrite]);

  // User explicitly chose to replace the folder's backup with current data
  // (the "Replace" branch of the connect prompt) — consent overrides the guard.
  const armOverwrite = useCallback(() => {
    liveHasDataRef.current = false;
    armedRef.current = true;
    setStatus('idle');
    doWrite();
  }, [doWrite]);

  // Re-grant permission on the stored handle (user gesture), then arm.
  const reconnect = useCallback(async () => {
    let handle = handleRef.current;
    if (!handle) {
      try { handle = await loadFolderHandle(); } catch { handle = null; }
    }
    if (!handle) return { ok: false };
    try {
      const p = await requestFolderPermission(handle);
      setPermission(p);
      if (p !== 'granted') return { ok: false };
      handleRef.current = handle;
      setFolderName(handle.name);
      const armed = await evaluateAndArm(handle);
      return { ok: true, armed };
    } catch (err) {
      console.error('Folder backup reconnect failed:', err);
      return { ok: false, error: err.message };
    }
  }, [evaluateAndArm]);

  const disconnect = useCallback(async () => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    armedRef.current = false;
    handleRef.current = null;
    setFolderName(null);
    setPermission(null);
    setStatus('idle');
    try { await removeFolderHandle(); } catch { /* ignore */ }
  }, []);

  /**
   * Restore entry point (user gesture): reuse the stored handle when it can be
   * (re-)granted, otherwise open the picker. Returns { handle, payload } with
   * payload null when the folder has no readable live backup. Throws
   * AbortError when the user cancels the picker.
   */
  const openForRestore = useCallback(async () => {
    let handle = handleRef.current;
    if (!handle) {
      try { handle = await loadFolderHandle(); } catch { handle = null; }
    }
    if (handle) {
      let p = await queryFolderPermission(handle);
      if (p !== 'granted') p = await requestFolderPermission(handle);
      if (p !== 'granted') handle = null;
    }
    if (!handle) handle = await pickBackupFolder();
    handleRef.current = handle;
    setFolderName(handle.name);
    setPermission('granted');
    const payload = await readLiveBackup(handle);
    return { handle, payload };
  }, []);

  // Session start: reload the persisted handle and arm if permission survived.
  useEffect(() => {
    if (disabled || !supported || !dataLoaded || !enabled) return;
    if (handleRef.current) return; // already connected via connect()/restore
    let stale = false;
    (async () => {
      let handle = null;
      try { handle = await loadFolderHandle(); } catch { /* ignore */ }
      if (stale) return;
      if (!handle) {
        // Enabled (config restored from a backup) but the handle didn't survive
        // the profile wipe — the UI offers the picker to reconnect.
        setStatus('disconnected');
        return;
      }
      handleRef.current = handle;
      setFolderName(handle.name);
      let p = 'prompt';
      try { p = await queryFolderPermission(handle); } catch { /* ignore */ }
      if (stale) return;
      setPermission(p);
      if (p === 'granted') {
        await evaluateAndArm(handle);
      } else if (!notifiedReconnectRef.current) {
        // requestPermission needs a user gesture, so just surface it once.
        notifiedReconnectRef.current = true;
        onNeedsReconnectRef.current?.();
      }
    })();
    return () => { stale = true; };
  }, [disabled, supported, dataLoaded, enabled, evaluateAndArm]);

  // Flush a pending debounced write when the app is being closed or hidden —
  // best effort, but Chrome reliably fires visibilitychange before a PWA
  // window closes, and the debounce window is short.
  useEffect(() => {
    if (disabled || !supported) return;
    const flush = () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
        doWrite();
      }
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [disabled, supported, doWrite]);

  return {
    supported, folderName, permission, status, lastWritten,
    connect, reconnect, disconnect, armOverwrite, scheduleWrite, openForRestore,
  };
}
