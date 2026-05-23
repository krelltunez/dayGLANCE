// dayGLANCE adapter for @glance-apps/sync.
//
// Pins every dayGLANCE-specific engine config (storage prefixes, file names,
// app identity, native bridge wiring) and the two safety validators that
// previously lived inline in App.jsx (the empty-payload upload guard and the
// empty-merge apply guard). The four data callbacks (buildPayload,
// buildBackupPayload, applyPayload) plus all event callbacks come from App.jsx
// — they close over React state that this module deliberately does not see.

import { createSyncEngine, mergeSyncData } from '@glance-apps/sync';
import { nativeHttpRequest } from '../native.js';

const isNativeApp =
  typeof window !== 'undefined' &&
  !!window.DayGlanceNative?.httpRequest;

const electronProxyFetch =
  typeof window !== 'undefined' && window.electronAPI?.isElectron
    ? (...args) => window.electronAPI.proxyFetch(...args)
    : null;

const DAYGLANCE_CONFIG = {
  storageKeyPrefix:     'day-planner',
  cryptoDBName:         'dayglance-crypto',
  autoBackupDBName:     'dayglance-auto-backups',
  syncFilename:         'dayglance-sync.json',
  backupFilenamePrefix: 'dayglance-backup-',
  appId:                'dayglance',
  appName:              'dayGLANCE',

  nativeHttpRequest: isNativeApp ? nativeHttpRequest : null,
  electronProxyFetch,
  proxyUrl: import.meta.env.VITE_WEBDAV_PROXY_URL ?? '',

  nativeGetSyncKey:
    isNativeApp && window?.DayGlanceNative?.getSyncKey
      ? () => window.DayGlanceNative.getSyncKey()
      : null,
  nativeStoreSyncKey:
    isNativeApp && window?.DayGlanceNative?.storeSyncKey
      ? (val) => window.DayGlanceNative.storeSyncKey(val)
      : null,
};

// Mirrors App.jsx 4799-4806 pre-extraction. Refuses to upload an empty payload
// when localStorage still has data — a sign of a stale-state race that would
// otherwise wipe the remote.
const validateUploadPayload = async (envelope) => {
  const localTaskCount   = JSON.parse(localStorage.getItem('day-planner-tasks')        || '[]').length;
  const localInboxCount  = JSON.parse(localStorage.getItem('day-planner-unscheduled')  || '[]').length;
  const payloadTaskCount = (envelope.data?.tasks?.length || 0) + (envelope.data?.unscheduledTasks?.length || 0);
  if (localTaskCount + localInboxCount > 0 && payloadTaskCount === 0) {
    return {
      valid: false,
      reason: `payload has 0 tasks but localStorage has ${localTaskCount + localInboxCount}`,
    };
  }
  return { valid: true };
};

// Mirrors App.jsx 4858-4864 pre-extraction. Refuses to apply an empty merge
// result when local has data unless the remote claimed a real lastModified
// (an intentional "delete everything" propagation, allowEmpty:true).
const validateApplyPayload = async (envelope) => {
  const localTaskCount  = JSON.parse(localStorage.getItem('day-planner-tasks')       || '[]').length;
  const localInboxCount = JSON.parse(localStorage.getItem('day-planner-unscheduled') || '[]').length;
  const remoteTaskCount = (envelope.data?.tasks?.length || 0) + (envelope.data?.unscheduledTasks?.length || 0);
  if (!envelope.lastModified && localTaskCount + localInboxCount > 0 && remoteTaskCount === 0) {
    return {
      valid: false,
      reason: `remote has 0 tasks but local has ${localTaskCount + localInboxCount}`,
    };
  }
  return { valid: true };
};

/**
 * Build the dayGLANCE sync engine.
 *
 * @param {object} callbacks - data + event callbacks from App.jsx
 * @param {() => object|Promise<object>}          callbacks.buildPayload
 * @param {() => object|Promise<object>}          callbacks.buildBackupPayload
 * @param {(data, opts) => void|Promise<void>}    callbacks.applyPayload
 * @param {(status) => void}                      callbacks.onStatusChange
 * @param {(msg, code, isHardStop) => void}       callbacks.onError
 * @param {(iso) => void}                         callbacks.onLastSyncedChange
 * @param {(remoteData, remoteMod, etag) => void} callbacks.onConflict
 * @param {() => void}                            callbacks.onPassphraseRequired
 * @param {() => void}                            callbacks.onFirstSyncReload
 * @param {() => number}                          callbacks.getSyncRetentionDays
 */
export const createDayGlanceEngine = (callbacks, { appFolderName = 'GLANCE/dayglance' } = {}) => createSyncEngine({
  ...DAYGLANCE_CONFIG,
  appFolderName,
  buildPayload:        callbacks.buildPayload,
  buildBackupPayload:  callbacks.buildBackupPayload,
  applyPayload:        callbacks.applyPayload,
  mergePayloads:       (local, remote) => mergeSyncData(local, remote, callbacks.getSyncRetentionDays()),
  validateUploadPayload,
  validateApplyPayload,
  onStatusChange:      callbacks.onStatusChange,
  onError:             callbacks.onError,
  onLastSyncedChange:  callbacks.onLastSyncedChange,
  onConflict:          callbacks.onConflict,
  onPassphraseRequired: callbacks.onPassphraseRequired,
  onFirstSyncReload:   callbacks.onFirstSyncReload,
  retentionDays:       callbacks.getSyncRetentionDays(),
});
