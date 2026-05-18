// Sync engine for @glance-apps/sync.
//
// Orchestrates the download → validate → merge → apply → upload cycle that
// previously lived inline in dayGLANCE's App.jsx. The engine is app-agnostic
// — every data-shape decision is delegated to four required callbacks:
// buildPayload, buildBackupPayload, applyPayload, mergePayloads.
//
// Behavior preservation contract (vs. dayGLANCE pre-extraction):
//   - 5-second debounce stays in the caller (the engine does not debounce).
//   - 60-second poll stays in the caller; it calls engine.download().
//   - Visibility/focus listeners stay in the caller.
//   - Status sequence: emits 'uploading' | 'downloading' | 'success' | 'error' | 'idle'.
//     Auto-reverts 'success' → 'idle' after 3 s and 'error' → 'idle' after 5 s
//     unconditionally; the caller's onStatusChange handler is responsible for
//     guarding against overwriting a newer status (the dayGLANCE adapter does
//     this with a functional setState).
//   - Two-second minimum status hold on success (matches the original UX).
//   - Hard-stop error codes (APP_ID_MISMATCH, SCHEMA_FORWARD_INCOMPATIBLE) freeze
//     the engine — auto-retry paths are inert until clearHardStop() is called.
//   - Backwards compat: envelopes missing `schemaVersion` are treated as v1,
//     envelopes missing `appId` skip the identity check (legacy dayGLANCE files
//     written before Step 6 don't include either field).

import { createProviders, webdavFetch } from './providers.js';
import {
  hasEncryptionReady,
} from './crypto.js';
import {
  createAutoBackupDB,
  createAutoBackupProviders,
  AUTO_BACKUP_RETENTION,
  AUTO_BACKUP_INTERVALS,
} from './autoBackup.js';

// Package-level schema version written into every envelope. Bump alongside
// any breaking change to the envelope shape; consumers older than this will
// hard-stop with SCHEMA_FORWARD_INCOMPATIBLE.
export const SCHEMA_VERSION = 1;
export const SUPPORTED_MAX_SCHEMA_VERSION = 1;

// Envelope's `version` field. Currently a constant (matches dayGLANCE pre-
// extraction); reserved as a monotonic counter for a future major version.
const ENVELOPE_DATA_VERSION = 2;

const MAX_UPLOAD_BACKOFF_S   = 15 * 60; // 15 minutes
const MAX_DOWNLOAD_BACKOFF_S = 5 * 60;  // 5 minutes
const AUTH_FAILURE_BACKOFF_MS = 60 * 60 * 1000; // 1 hour
const LOCK_BACKOFF_MS = 30_000; // 30 s for 423 Locked
const SUCCESS_HOLD_MS = 3000;
const ERROR_HOLD_MS = 5000;
const MIN_SYNC_DURATION_MS = 2000;

/**
 * Creates a sync engine bound to the given app/transport/data config.
 * See SYNC_PACKAGE_SPEC.md (`createSyncEngine(config)` section) for the full
 * config schema and behavioral contract.
 */
export const createSyncEngine = (config) => {
  const {
    storageKeyPrefix,
    appId,
    appName,
    buildPayload,
    buildBackupPayload,
    applyPayload,
    mergePayloads,
    validateUploadPayload,
    validateApplyPayload,
    onStatusChange,
    onError,
    onLastSyncedChange,
    onConflict,
    onPassphraseRequired,
    onFirstSyncReload,
  } = config;

  if (!storageKeyPrefix) throw new Error('createSyncEngine: storageKeyPrefix is required');
  if (!appId) throw new Error('createSyncEngine: appId is required');
  if (typeof buildPayload   !== 'function') throw new Error('createSyncEngine: buildPayload is required');
  if (typeof applyPayload   !== 'function') throw new Error('createSyncEngine: applyPayload is required');
  if (typeof mergePayloads  !== 'function') throw new Error('createSyncEngine: mergePayloads is required');

  // Resolve sub-modules with the shared config so they share crypto/proxy wiring.
  const providers = createProviders(config);
  const wf = webdavFetch(config);
  const autoBackupDB = createAutoBackupDB({ autoBackupDBName: config.autoBackupDBName });
  const autoBackupProviders = createAutoBackupProviders({
    backupFilenamePrefix: config.backupFilenamePrefix,
    appFolderName: config.appFolderName,
    webdavFetch: wf,
  });

  // localStorage keys owned by this engine.
  const KEY_CONFIG      = `${storageKeyPrefix}-cloud-sync-config`;
  const KEY_LAST_SYNCED = `${storageKeyPrefix}-cloud-sync-last-synced`;
  const KEY_LOCAL_MOD   = `${storageKeyPrefix}-cloud-sync-local-modified`;

  // ── In-memory state ─────────────────────────────────────────────────────
  let syncing              = false;
  let pendingFollowup      = false;
  let hardStopped          = false;
  let uploadErrorCount     = 0;
  let uploadBackoffUntil   = 0;
  let downloadErrorCount   = 0;
  let downloadBackoffUntil = 0;

  // ── Helpers ─────────────────────────────────────────────────────────────
  const getConfig = () => {
    const saved = localStorage.getItem(KEY_CONFIG);
    return saved ? JSON.parse(saved) : null;
  };

  const setConfig = (cfg) => {
    if (cfg) localStorage.setItem(KEY_CONFIG, JSON.stringify(cfg));
    else     localStorage.removeItem(KEY_CONFIG);
  };

  const getLastSynced = () => localStorage.getItem(KEY_LAST_SYNCED) || null;

  // Wraps a `{ data, lastModified? }` object with the envelope metadata required
  // by the package contract. Accepts either a bare data object or a pre-wrapped
  // envelope-like object (in which case existing lastModified is preserved).
  const wrapEnvelope = (built) => {
    const isWrapped = built && typeof built === 'object' && 'data' in built;
    const data = isWrapped ? built.data : built;
    const lastModified = (isWrapped && built.lastModified) || new Date().toISOString();
    return {
      schemaVersion: SCHEMA_VERSION,
      appId,
      version: (isWrapped && typeof built.version === 'number') ? built.version : ENVELOPE_DATA_VERSION,
      lastModified,
      data,
    };
  };

  // Validates a downloaded envelope. Returns the validated envelope or throws
  // a hard-stop Error. Backwards-compat: missing schemaVersion/appId are
  // accepted (legacy files written before Step 6).
  const validateEnvelope = (envelope) => {
    if (!envelope || typeof envelope !== 'object' || !envelope.data) {
      const err = new Error('Downloaded sync file is malformed (missing data field).');
      err.code = 'NETWORK_ERROR';
      throw err;
    }
    if (envelope.schemaVersion !== undefined && envelope.schemaVersion > SUPPORTED_MAX_SCHEMA_VERSION) {
      const err = new Error(
        `Remote sync file uses schema version ${envelope.schemaVersion}, ` +
        `which is newer than this version of ${appName || appId} supports. Please update the app.`
      );
      err.code = 'SCHEMA_FORWARD_INCOMPATIBLE';
      err.isHardStop = true;
      throw err;
    }
    if (envelope.appId !== undefined && envelope.appId !== appId) {
      const err = new Error(
        `Remote sync file belongs to "${envelope.appId}", not ${appName || appId}. ` +
        `Refusing to merge to prevent data loss.`
      );
      err.code = 'APP_ID_MISMATCH';
      err.isHardStop = true;
      throw err;
    }
    return envelope;
  };

  // Categorises a raw error into { code, isHardStop, message }.
  const classifyError = (err) => {
    if (err?.code === 'PASSPHRASE_REQUIRED') {
      return { code: 'PASSPHRASE_REQUIRED', isHardStop: false, message: err.message };
    }
    if (err?.code === 'APP_ID_MISMATCH' || err?.code === 'SCHEMA_FORWARD_INCOMPATIBLE') {
      return { code: err.code, isHardStop: true, message: err.message };
    }
    const msg = err?.message || String(err);
    if (msg === 'PRECONDITION_FAILED')    return { code: 'PRECONDITION_FAILED', isHardStop: false, message: msg };
    if (msg === 'FORBIDDEN')               return { code: 'FORBIDDEN',           isHardStop: true,  message: msg };
    if (msg.includes('401'))               return { code: 'AUTH_FAILURE',        isHardStop: false, message: msg };
    if (msg.includes('423'))               return { code: 'LOCKED',              isHardStop: false, message: msg };
    return { code: 'NETWORK_ERROR', isHardStop: false, message: msg };
  };

  // Renders a user-facing error string preserving the exact wording used by
  // dayGLANCE pre-extraction so the UX is unchanged.
  const formatErrorMessage = (cls) => {
    if (cls.code === 'AUTH_FAILURE') {
      return 'Authentication failed (401) — check your username and password in sync settings.';
    }
    if (cls.code === 'FORBIDDEN') {
      // Upload and download had slightly different wording pre-extraction. We
      // unify on the upload variant (it's the one users see most often).
      return "Sync blocked (403) — your server may be blocking Vercel's IP addresses.";
    }
    return cls.message;
  };

  const scheduleAutoRevert = (status, ms) => {
    setTimeout(() => onStatusChange?.('idle', { from: status }), ms);
  };

  // ── upload ──────────────────────────────────────────────────────────────
  /**
   * Uploads the current local state to the configured provider.
   * @param {object} [opts]
   * @param {object} [opts.prebuiltPayload] - Skip buildPayload(), use this instead.
   * @param {string} [opts.etag]            - If-Match etag for optimistic concurrency.
   * @param {boolean} [opts.skipLockCheck]  - Bypass the in-progress guard (used
   *   when called from within download()'s merge cycle to avoid self-deadlock).
   */
  const upload = async ({ prebuiltPayload, etag = null, skipLockCheck = false } = {}) => {
    if (hardStopped) return;
    const cfg = getConfig();
    if (!cfg?.enabled) return;
    if (!skipLockCheck && syncing) {
      pendingFollowup = true;
      return;
    }
    const provider = providers[cfg.provider];
    if (!provider) return;

    if (!skipLockCheck) syncing = true;
    const t0 = Date.now();
    onStatusChange?.('uploading');
    onError?.(null, null, false); // clear previous error
    try {
      const built = prebuiltPayload || await buildPayload();
      const envelope = wrapEnvelope(built);

      if (validateUploadPayload) {
        const check = await validateUploadPayload(envelope);
        if (!check?.valid) {
          // eslint-disable-next-line no-console
          console.error(`[${appId}] cloud sync upload aborted:`, check?.reason || 'validation failed');
          onStatusChange?.('idle');
          return;
        }
      }

      await provider.upload(cfg, envelope, etag);

      const elapsed = Date.now() - t0;
      if (elapsed < MIN_SYNC_DURATION_MS) {
        await new Promise(r => setTimeout(r, MIN_SYNC_DURATION_MS - elapsed));
      }

      uploadErrorCount = 0;
      uploadBackoffUntil = 0;
      const now = new Date().toISOString();
      localStorage.setItem(KEY_LAST_SYNCED, now);
      localStorage.setItem(KEY_LOCAL_MOD, envelope.lastModified);
      onLastSyncedChange?.(now);
      onStatusChange?.('success');
      scheduleAutoRevert('success', SUCCESS_HOLD_MS);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[${appId}] cloud sync upload error:`, err);
      const cls = classifyError(err);

      if (cls.code === 'PRECONDITION_FAILED') {
        // When download() is the caller, it handles the 412 retry itself. Bubble.
        if (skipLockCheck) throw err;
        onStatusChange?.('idle');
        return;
      }

      if (cls.code === 'AUTH_FAILURE') {
        uploadBackoffUntil = Date.now() + AUTH_FAILURE_BACKOFF_MS;
      } else {
        uploadErrorCount += 1;
        const ms = Math.min(30 * Math.pow(2, uploadErrorCount - 1), MAX_UPLOAD_BACKOFF_S) * 1000;
        uploadBackoffUntil = Date.now() + ms;
      }

      if (cls.isHardStop) hardStopped = true;
      onError?.(formatErrorMessage(cls), cls.code, cls.isHardStop);
      onStatusChange?.('error');
      scheduleAutoRevert('error', ERROR_HOLD_MS);
    } finally {
      if (!skipLockCheck) syncing = false;
    }
  };

  // ── download ────────────────────────────────────────────────────────────
  /**
   * Runs a full sync cycle: download → validate → merge → apply → upload-if-changed.
   * Idempotent — if another sync is in progress, sets a follow-up flag so the
   * current cycle reruns at completion to pick up the queued local change.
   */
  const download = async () => {
    if (hardStopped) return;
    const cfg = getConfig();
    if (!cfg?.enabled) return;
    const provider = providers[cfg.provider];
    if (!provider) return;

    if (syncing) {
      pendingFollowup = true;
      return;
    }
    syncing = true;
    const t0 = Date.now();
    onStatusChange?.('downloading');
    onError?.(null, null, false);

    let conflictShown = false;
    let passphraseRequired = false;

    // Inner helper: download, merge, apply, upload (if anything changed).
    // Returns true if a reload was triggered (caller should bail).
    const doCycle = async (overrideEtag) => {
      const downloaded = await provider.download(cfg);
      if (!downloaded) {
        // Empty remote — seed it with local state.
        await upload({ skipLockCheck: true });
        return false;
      }
      const { payload: remoteRaw, etag } = downloaded;

      // Validate envelope; hard-stop errors halt the sync without uploading.
      let remote;
      try {
        remote = validateEnvelope(remoteRaw);
      } catch (err) {
        if (err.isHardStop) {
          hardStopped = true;
          onError?.(err.message, err.code, true);
          onStatusChange?.('error');
          return false;
        }
        throw err;
      }

      const hasNeverSynced = !localStorage.getItem(KEY_LAST_SYNCED);
      if (hasNeverSynced && remote.lastModified) {
        // First-sync conflict: don't auto-merge; let the user decide via UI.
        conflictShown = true;
        onConflict?.(remote.data, remote.lastModified, etag || null);
        onStatusChange?.('idle');
        return false;
      }

      const localBuilt = await buildPayload();
      const localData = (localBuilt && typeof localBuilt === 'object' && 'data' in localBuilt)
        ? localBuilt.data
        : localBuilt;

      const mergeResult = mergePayloads(localData, remote.data);
      const { data: mergedData, localChanged, remoteChanged } = mergeResult;

      if (localChanged) {
        let mayApply = true;
        if (validateApplyPayload) {
          const check = await validateApplyPayload({ ...remote, data: mergedData });
          if (!check?.valid) {
            // eslint-disable-next-line no-console
            console.error(`[${appId}] applyRemoteData aborted:`, check?.reason || 'validation failed');
            mayApply = false;
          }
        }
        if (mayApply) {
          await applyPayload(mergedData, { allowEmpty: !!remote.lastModified });
          localStorage.setItem(KEY_LOCAL_MOD, new Date().toISOString());
        }
      }

      if (remoteChanged || localChanged) {
        const mergedPayload = {
          version: ENVELOPE_DATA_VERSION,
          lastModified: new Date().toISOString(),
          data: mergedData,
        };
        await upload({
          prebuiltPayload: mergedPayload,
          skipLockCheck: true,
          etag: etag || overrideEtag || null,
        });

        if (hasNeverSynced && localChanged) {
          onFirstSyncReload?.();
          return true;
        }
      }
      return false;
    };

    try {
      const reloaded = await doCycle(null);
      if (reloaded || conflictShown) return;

      downloadErrorCount = 0;
      downloadBackoffUntil = 0;
      const elapsed = Date.now() - t0;
      if (elapsed < MIN_SYNC_DURATION_MS) {
        await new Promise(r => setTimeout(r, MIN_SYNC_DURATION_MS - elapsed));
      }
      const now = new Date().toISOString();
      localStorage.setItem(KEY_LAST_SYNCED, now);
      onLastSyncedChange?.(now);
      onStatusChange?.('success');
      scheduleAutoRevert('success', SUCCESS_HOLD_MS);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[${appId}] cloud sync download error:`, err);
      const cls = classifyError(err);

      if (cls.code === 'PASSPHRASE_REQUIRED') {
        passphraseRequired = true;
        onPassphraseRequired?.();
        onError?.(cls.message, 'PASSPHRASE_REQUIRED', false);
        onStatusChange?.('idle');
        return;
      }

      if (cls.code === 'PRECONDITION_FAILED') {
        // Another device wrote between our download and upload — wait a random
        // jitter (1–3 s) to reduce collision probability, then retry once.
        const jitterMs = 1000 + Math.random() * 2000;
        await new Promise(r => setTimeout(r, jitterMs));
        try {
          await doCycle(null);
          downloadErrorCount = 0;
          downloadBackoffUntil = 0;
        } catch (retryErr) {
          // eslint-disable-next-line no-console
          console.error(`[${appId}] cloud sync retry after 412 failed:`, retryErr);
          // Apply the same exponential backoff used for other transient errors so
          // the engine backs off rather than hammering the server every poll cycle.
          downloadErrorCount += 1;
          const ms = Math.min(30 * Math.pow(2, downloadErrorCount - 1), MAX_DOWNLOAD_BACKOFF_S) * 1000;
          downloadBackoffUntil = Date.now() + ms;
          onError?.(formatErrorMessage(classifyError(retryErr)), classifyError(retryErr).code, false);
          onStatusChange?.('error');
          scheduleAutoRevert('error', ERROR_HOLD_MS);
        }
        return;
      }

      if (cls.code === 'AUTH_FAILURE') {
        downloadBackoffUntil = Date.now() + AUTH_FAILURE_BACKOFF_MS;
      } else if (cls.code === 'LOCKED') {
        downloadBackoffUntil = Date.now() + LOCK_BACKOFF_MS;
      } else {
        downloadErrorCount += 1;
        const ms = Math.min(30 * Math.pow(2, downloadErrorCount - 1), MAX_DOWNLOAD_BACKOFF_S) * 1000;
        downloadBackoffUntil = Date.now() + ms;
      }

      if (cls.isHardStop) hardStopped = true;
      // Use the download variant of the 403 message for compatibility.
      const msg = cls.code === 'FORBIDDEN'
        ? 'Sync blocked (403) — your server may be blocking requests.'
        : formatErrorMessage(cls);
      onError?.(msg, cls.code, cls.isHardStop);
      onStatusChange?.('error');
      scheduleAutoRevert('error', ERROR_HOLD_MS);
    } finally {
      // Conflict path: leave lock held — the UI dialog handlers release it via
      // resolveConflict*(). Passphrase path: release lock but don't mark sync
      // initialised. Otherwise: release lock and drain the follow-up queue.
      if (!conflictShown) {
        syncing = false;
        if (!passphraseRequired && pendingFollowup) {
          pendingFollowup = false;
          setTimeout(() => download(), 250);
        }
      }
    }
  };

  // ── Backup ──────────────────────────────────────────────────────────────
  /**
   * Runs one auto-backup cycle: builds the backup payload, saves to local IDB,
   * uploads to the remote backup directory, and prunes old copies. Independent
   * of sync — uses buildBackupPayload (NOT buildPayload) since it may be called
   * from a timer without React context.
   */
  const runBackup = async (frequency) => {
    if (!buildBackupPayload) {
      throw new Error('createSyncEngine: buildBackupPayload is required to call runBackup()');
    }
    const cfg = getConfig();
    if (!cfg?.enabled) return;
    const backupProvider = autoBackupProviders[cfg.provider] || autoBackupProviders.webdav;
    if (!backupProvider) return;

    const data = await buildBackupPayload();
    await autoBackupDB.saveBackup(frequency, data);
    const max = AUTO_BACKUP_RETENTION[frequency];
    if (max) await autoBackupDB.pruneBackups(frequency, max);
    try {
      await backupProvider.uploadBackup(cfg, data);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[${appId}] auto-backup upload error:`, err);
      onError?.(err.message, classifyError(err).code, false);
    }
  };

  // ── Connection test ─────────────────────────────────────────────────────
  const testConnection = async (testCfg) => {
    const provider = providers[testCfg.provider];
    if (!provider) return { success: false, error: 'Unknown provider' };
    try { return await provider.test(testCfg); }
    catch (err) { return { success: false, error: err.message }; }
  };

  // ── Public API ──────────────────────────────────────────────────────────
  return {
    // Lifecycle
    sync: download,
    upload,
    download,
    runBackup,
    test: testConnection,

    // Config
    getConfig,
    setConfig,
    getLastSynced,

    // State queries
    isSyncing:               () => syncing,
    isHardStopped:           () => hardStopped,
    clearHardStop:           () => { hardStopped = false; },
    hasEncryptionReady,
    getUploadBackoffUntil:   () => uploadBackoffUntil,
    getDownloadBackoffUntil: () => downloadBackoffUntil,

    // Sub-modules (exposed for app-level features the engine doesn't own —
    // e.g. dayGLANCE's conflict-resolution dialog and its iCloud sync code).
    providers,
    autoBackupDB,
    autoBackupProviders,
    webdavFetch: wf,
  };
};

export {
  AUTO_BACKUP_RETENTION,
  AUTO_BACKUP_INTERVALS,
};
