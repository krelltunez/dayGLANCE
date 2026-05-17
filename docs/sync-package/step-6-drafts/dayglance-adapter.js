// dayGLANCE adapter for @glance-apps/sync.
//
// Intended target path: dayGLANCE/src/sync/adapter.js
//
// This file pins every dayGLANCE-specific config value (storage prefixes, file
// names, app identity, native bridge wiring) and provides the four data
// callbacks (buildPayload, buildBackupPayload, applyPayload, mergePayloads)
// plus the two validators (validateUpload, validateApply). The engine handles
// the orchestration; App.jsx only triggers it (debounce, poll, visibility).
//
// The exported factory takes refs + setters from useCloudSync and the data
// hooks — keeping React state out of the engine, in line with the
// SYNC_PACKAGE_SPEC's "no React inside the engine" rule.

import { createSyncEngine, mergeSyncData } from '@glance-apps/sync';
import { nativeHttpRequest } from '../native.js';

const isAndroid =
  typeof window !== 'undefined' &&
  !window.DayGlanceIOS &&
  !!window.DayGlanceNative?.httpRequest;

const electronProxyFetch =
  typeof window !== 'undefined' && window.electronAPI?.isElectron
    ? (...args) => window.electronAPI.proxyFetch(...args)
    : null;

// Static dayGLANCE config — every value that does not depend on per-instance
// state. Refs/setters are injected per-instance via createDayGlanceEngine.
const DAYGLANCE_CONFIG = {
  storageKeyPrefix:     'day-planner',
  cryptoDBName:         'dayglance-crypto',
  autoBackupDBName:     'dayglance-auto-backups',
  syncFilename:         'dayglance-sync.json',
  appFolderName:        'dayglance',
  backupFilenamePrefix: 'dayglance-backup-',
  appId:                'dayglance',
  appName:              'dayGLANCE',

  // Transport bridges — same wiring as cloudSyncProviders.js shim.
  nativeHttpRequest: isAndroid ? nativeHttpRequest : null,
  electronProxyFetch,
  proxyUrl: import.meta.env.VITE_WEBDAV_PROXY_URL ?? '',

  // Crypto bridges — same wiring as crypto.js shim.
  nativeGetSyncKey:
    isAndroid && window?.DayGlanceNative?.getSyncKey
      ? () => window.DayGlanceNative.getSyncKey()
      : null,
  nativeStoreSyncKey:
    isAndroid && window?.DayGlanceNative?.storeSyncKey
      ? (val) => window.DayGlanceNative.storeSyncKey(val)
      : null,
};

/**
 * Build dayGLANCE's sync payload — same shape as the pre-extraction
 * App.jsx buildSyncPayload() (data block only; the engine wraps it in
 * the envelope). All inputs are read live so the engine sees the latest
 * React state at upload time.
 */
const buildDayGlancePayload = (sources) => () => {
  const {
    syncRetentionDays,
    completedTaskUids,
    tasks, unscheduledTasks, recycleBin, recurringTasks,
    syncUrl, taskCalendarUrl, unscheduledOrderTimestamp,
    routineDefinitions, todayRoutines, routinesDate, routineCompletions,
    minimizedSections, use24HourClock, weatherZip, weatherTempUnit,
    removedTodayRoutineIds, dailyNotes,
    habits, habitLogs, habitsEnabled, routinesEnabled,
    gtdFrames, goals, projects, goalsProjectsEnabled,
    obsidianConfig,
    stampTaskTimestamps, isNativeApp,
  } = sources();

  const uidCutoff = syncRetentionDays > 0
    ? new Date(Date.now() - syncRetentionDays * 86400000)
    : null;
  const prunedUids = [...completedTaskUids].filter(uid => {
    if (!uidCutoff) return true;
    const m = uid.match(/::(\d{4}-\d{2}-\d{2})$/);
    return !m || new Date(m[1]) >= uidCutoff;
  });

  return {
    version: 2,
    lastModified: new Date().toISOString(),
    data: {
      tasks: stampTaskTimestamps(
        tasks.filter(t => !t._native && !(isNativeApp() && t.imported && !t.isTaskCalendar && t.importSource !== 'file')),
        'day-planner-tasks'
      ),
      unscheduledTasks: stampTaskTimestamps(
        unscheduledTasks.filter(t => !(isNativeApp() && t.imported && !t.isTaskCalendar && t.importSource !== 'file')),
        'day-planner-unscheduled'
      ),
      unscheduledOrderTimestamp,
      recycleBin: stampTaskTimestamps(recycleBin, 'day-planner-recycle-bin'),
      syncUrl,
      taskCalendarUrl,
      completedTaskUids: prunedUids,
      recurringTasks: stampTaskTimestamps(recurringTasks, 'day-planner-recurring-tasks'),
      routineDefinitions,
      todayRoutines: stampTaskTimestamps(todayRoutines, 'day-planner-today-routines'),
      routinesDate,
      routineCompletions,
      minimizedSections,
      use24HourClock,
      weatherZip,
      weatherTempUnit,
      deletedTaskIds:         JSON.parse(localStorage.getItem('day-planner-deleted-task-ids')         || '{}'),
      deletedRoutineChipIds:  JSON.parse(localStorage.getItem('day-planner-deleted-routine-chip-ids') || '{}'),
      deletedFrameIds:        JSON.parse(localStorage.getItem('day-planner-deleted-frame-ids')        || '{}'),
      removedTodayRoutineIds,
      dailyNotes,
      habits,
      habitLogs,
      habitLogTimestamps: JSON.parse(localStorage.getItem('day-planner-habit-log-timestamps') || '{}'),
      habitsEnabled,
      habitsEnabledUpdatedAt:  localStorage.getItem('day-planner-habits-enabled-updated-at')  || null,
      deletedHabitIds:    JSON.parse(localStorage.getItem('day-planner-deleted-habit-ids')    || '{}'),
      routinesEnabled,
      routinesEnabledUpdatedAt: localStorage.getItem('day-planner-routines-enabled-updated-at') || null,
      gtdFrames,
      goals,
      deletedGoalIds:    JSON.parse(localStorage.getItem('day-planner-deleted-goal-ids')    || '{}'),
      projects,
      deletedProjectIds: JSON.parse(localStorage.getItem('day-planner-deleted-project-ids') || '{}'),
      goalsProjectsEnabled,
      goalsProjectsEnabledUpdatedAt: localStorage.getItem('day-planner-goals-projects-enabled-updated-at') || null,
      obsidianConfig: obsidianConfig ?? null,
      obsidianConfigUpdatedAt: localStorage.getItem('day-planner-obsidian-config-updated-at') || null,
      tombstonePrunedBefore: syncRetentionDays > 0
        ? new Date(Date.now() - syncRetentionDays * 86400000).toISOString()
        : null,
    },
  };
};

/**
 * Safety guard for upload (mirrors the App.jsx 4799-4806 check). Refuses to
 * upload an empty payload when localStorage still has data — a sign of a
 * stale-state race that would wipe the remote.
 */
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

/**
 * Safety guard for apply (mirrors the App.jsx 4858-4864 check). Refuses to
 * apply an empty merge result when local has data unless the remote claimed a
 * real lastModified (an intentional "delete everything" propagation).
 */
const makeValidateApplyPayload = (envelope) => async () => {
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
 * Construct the dayGLANCE sync engine.
 *
 * @param {Function} sources       - () => snapshot of all React state/refs
 *                                   the payload builder needs (read live).
 * @param {Object}   callbacks     - { applyPayload, onStatusChange, onError,
 *                                     onLastSyncedChange, onConflict,
 *                                     onPassphraseRequired, onFirstSyncReload,
 *                                     getSyncRetentionDays, buildBackupPayload }
 */
export const createDayGlanceEngine = (sources, callbacks) => {
  const {
    applyPayload,
    onStatusChange,
    onError,
    onLastSyncedChange,
    onConflict,
    onPassphraseRequired,
    onFirstSyncReload,
    getSyncRetentionDays,
    buildBackupPayload,
  } = callbacks;

  return createSyncEngine({
    ...DAYGLANCE_CONFIG,
    buildPayload:        buildDayGlancePayload(sources),
    buildBackupPayload,
    applyPayload,
    mergePayloads:       (local, remote) => mergeSyncData(local, remote, getSyncRetentionDays()),
    validateUploadPayload,
    validateApplyPayload: (envelope) => makeValidateApplyPayload(envelope)(),
    onStatusChange,
    onError,
    onLastSyncedChange,
    onConflict,
    onPassphraseRequired,
    onFirstSyncReload,
    retentionDays:       getSyncRetentionDays(),
  });
};
