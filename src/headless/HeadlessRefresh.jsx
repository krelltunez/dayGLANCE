// The headless refresh root (CLAUDE.md, "Headless refresh"): what the Android
// shell runs in an Activity-less WebView, on the launcher's REFRESH, while the
// app's process is dead. One cycle of every configured sync tier, then the
// launcher snapshot and heartbeat are re-pushed and the outcome is reported.
//
// This root is an ALLOWLIST, not App with features switched off. It composes
// only:
//   - the data layer: the store (useHeadlessStore), loadData and saveData
//     (useDataPersistence, useSaveOnChange), the day windows and the JOBO
//     ledger, which the sync apply writes through, with its completion
//     detector (useJoboDetector), so a completion this run makes or pulls
//     gets its Do record as it would with the app open;
//   - both sync tiers: the file-tier engine (sync/adapter.js) and the
//     GLANCEvault engine (sync/dbEngine.js), built and wired the way the app
//     builds them (hooks/useSyncEngines.js), with the same payload and apply
//     (hooks/useSyncEngineData.js);
//   - the launcher snapshot and heartbeat push (utils/launcherSnapshot.js,
//     utils/launcherHeartbeat.js);
//   - the launcher's queued writes, applied after the cycle's pull and pushed
//     by a second pass of the tiers (intents/useAndroidIntentBridge.js's
//     drainLauncherQueue, the app's own handler and ledger). A launcher write
//     is data the user made; without this it waited for the app to open.
// Nothing else initialises: no calendar fetch, no Obsidian, no reminders, no
// weather, no widgets, no automation intents, no UI. The native side holds the same
// line: its HeadlessBridge exposes only HEADLESS_BRIDGE_METHODS, so a module
// that did boot here would find no method, not a side effect.
//
// The reverse lock: if the user opens the app while this runs, the live
// instance must not share storage with a half-finished cycle. The choice is
// SIGNAL ABORT, not wait: the shell destroys this WebView before the live one
// loads (LauncherRefreshWorker.abortForLiveInstance), and this root also asks
// `headlessShouldAbort` at each phase boundary. The live instance's own start
// runs a cycle anyway, so nothing is lost by stopping; waiting would hold the
// splash for up to the cap for a result the app is about to produce itself.
// A run's only local edits are launcher writes, and each is saved before the
// native queue drops it: one the abort cut short is still queued for the app,
// and one saved but not yet pushed is pushed by the app's own first cycle.

import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import useHeadlessStore from './useHeadlessStore.js';
import { HEADLESS_OUTCOMES, headlessRequest } from './headlessMode.js';
import useCloudSync from '../hooks/useCloudSync.js';
import useDataPersistence from '../hooks/useDataPersistence.js';
import useSaveOnChange from '../hooks/useSaveOnChange.js';
import useDayWindows from '../hooks/useDayWindows.js';
import useJoboLedger from '../hooks/useJoboLedger.js';
import useJoboDetector from '../hooks/useJoboDetector.js';
import useSyncEngineData from '../hooks/useSyncEngineData.js';
import { useFileSyncEngine, useVaultSyncEngine } from '../hooks/useSyncEngines.js';
import { createDayGlanceEngine } from '../sync/adapter.js';
import { createDbEngine } from '../sync/dbEngine.js';
import { normalizeSyncFolder } from '../utils/syncFolder.js';
import { buildLauncherSnapshot } from '../utils/launcherSnapshot.js';
import { inboxFromStorage, inboxCountOf } from '../utils/inboxFilter.js';
import { latestSyncedAt } from '../utils/launcherHeartbeat.js';
import { nativeBridge, nativeTouchLauncherHeartbeat, nativeRecordLauncherRefresh } from '../native.js';
import { LAUNCHER_ACTIONS, LAUNCHER_ONLY, readLauncherLedger } from '../intents/launcherWrites.js';
import { drainLauncherQueue } from '../intents/useAndroidIntentBridge.js';
import { expandRecurringTasks } from '../utils/expandRecurringTasks.js';
import { computeRecurringExpansionRange } from '../utils/recurringExpansionRange.js';
import { frameInstancesForDate, isTaskVisibleForUser, isOwnedBy } from '@glance-apps/agenda-core';
import { readWeekStartDay, readCalendarFilter, readNativeTimeOverrides, readJoboEnabled } from '../utils/storedSlices.js';
import { getStoredWeatherCoords } from '../utils/solar.js';
import { fetchHourlyForecast } from '../utils/weatherForecast.js';
import { loadAlarmPrefs, loadDialLayers } from '../utils/dialPrefs.js';
import { dateToString } from '../utils/taskUtils.js';

const noop = () => {};
/**
 * The launcher writes a headless run applies. TOGGLE_ROUTINE is left queued for
 * the app: routine completions are saved by useRoutines, which this root does
 * not compose. A REFRESH is this run.
 */
const HEADLESS_WRITES = new Set(['create', 'complete', LAUNCHER_ONLY.UNCOMPLETE, LAUNCHER_ONLY.MOVE, LAUNCHER_ONLY.RESIZE]);
const appliesHeadlessly = (entry) => HEADLESS_WRITES.has(LAUNCHER_ACTIONS[entry?.action]);
const identity = (s) => s;
/** App's SCHED window default; it only widens the recurring expansion range. */
const SCHED_DAYS_SHOWN = 14;

/**
 * @param {object} props
 * @param {string} [props.clientId]  the REFRESH being answered; from the query by default
 * @param {() => object} [props.bridge]  the native bridge (window.DayGlanceNative)
 * @param {Function} [props.createFileEngine]  test seam for sync/adapter.js
 * @param {Function} [props.createVaultEngine] test seam for sync/dbEngine.js
 * @param {Function} [props.fetchForecast]     test seam for utils/weatherForecast.js
 * @param {Function} [props.flush]             react-dom's flushSync; a test seam for another renderer
 * @param {object}   [props.joboStore]         test seam for the JOBO ledger's store (jobo/store.js)
 * @param {() => Date} [props.now]
 */
export default function HeadlessRefresh({
  clientId: clientIdProp,
  bridge = nativeBridge,
  createFileEngine = createDayGlanceEngine,
  createVaultEngine = createDbEngine,
  fetchForecast = fetchHourlyForecast,
  flush = flushSync,
  joboStore,
  now = () => new Date(),
} = {}) {
  const clientId = clientIdProp ?? headlessRequest(window.location?.search ?? '')?.clientId ?? '';
  const store = useHeadlessStore();
  const {
    dataLoaded, tasks, unscheduledTasks, recurringTasks, multiUserEnabled, meUserSyncId,
    gtdFrames, frameSets, todayRoutines: allTodayRoutines, routineCompletions, routinesEnabled,
    projects, goals, goalsProjectsEnabled, weatherTempUnit, use24HourClock, syncRetentionDays,
  } = store;

  // ── Data layer ───────────────────────────────────────────────────────────
  const {
    cloudSyncConfig, syncKeyReady,
    suppressCloudUploadRef, suppressTimestampRef, suppressClearPendingRef, cloudSyncInitialDoneRef,
  } = useCloudSync();
  const { dayWindowsRef, getDayWindow, applyRemoteDayWindows } = useDayWindows();
  const { joboRecords, joboLoaded, joboError, joboWritable, recordJobo, readJoboWorkingSet, applyRemoteJobo } = useJoboLedger({ store: joboStore });
  const joboRecordsRef = useRef(joboRecords);
  joboRecordsRef.current = joboRecords;
  const tasksLiveRef = useRef(tasks);
  tasksLiveRef.current = tasks;
  const unscheduledLiveRef = useRef(unscheduledTasks);
  unscheduledLiveRef.current = unscheduledTasks;
  const applyingRemoteDataRef = useRef(false);
  const isRemoteApply = () => applyingRemoteDataRef.current || suppressCloudUploadRef.current;

  const { loadData, saveData, stampTaskTimestamps } = useDataPersistence({
    ...store,
    todayRoutines: allTodayRoutines,
    cloudSyncConfig, cloudSyncInitialDoneRef, suppressTimestampRef,
    setUndoToast: noop, t: identity, isRemoteApply,
  });
  useSaveOnChange({
    ...store,
    todayRoutines: allTodayRoutines,
    saveData, checkConflicts: noop,
    suppressClearPendingRef, suppressCloudUploadRef, suppressTimestampRef,
  });
  // The app's completion detector over this run's state. A launcher completion
  // this run applies is a transition here and nowhere else: the app, opened
  // later, loads the task already completed and treats that as history (first
  // sight). The detector's writes are tracked so the push after the writes
  // can carry their records.
  const [joboEnabled] = useState(readJoboEnabled);
  const joboWritesRef = useRef(new Set());
  const recordJoboTracked = useCallback((records) => {
    const write = Promise.resolve(recordJobo(records));
    joboWritesRef.current.add(write);
    write.finally(() => joboWritesRef.current.delete(write)).catch(() => {});
    return write;
  }, [recordJobo]);
  useJoboDetector({
    tasks, unscheduledTasks, recurringTasks,
    readJoboWorkingSet, joboLoaded, joboWritable, recordJobo: recordJoboTracked,
    isRemoteApply,
    enabled: joboEnabled,
  });

  // ── Sync tiers ───────────────────────────────────────────────────────────
  const { buildSyncPayload, applyEngineData } = useSyncEngineData({
    ...store,
    allTodayRoutines,
    dayWindowsRef, joboRecordsRef, tasksLiveRef, unscheduledLiveRef,
    applyingRemoteDataRef, suppressClearPendingRef, suppressCloudUploadRef, suppressTimestampRef,
    applyRemoteDayWindows, applyRemoteJobo, stampTaskTimestamps,
  });
  // The engines call through this ref so they always run the latest closures
  // (the same shape App gives them, hooks/useSyncEngines.js).
  const callbacksRef = useRef({});
  callbacksRef.current = {
    buildPayload: buildSyncPayload,
    buildBackupPayload: buildSyncPayload,
    applyPayload: applyEngineData,
    multiUserEnabled,
    syncRetentionDays,
  };

  // What stopped a cycle, when the engine reports it rather than throwing:
  // a first-sync conflict, a missing passphrase, a transport error. Both
  // engines also call onError(null, null) to CLEAR a previous error at the
  // start of a cycle; that is not a blocker (the first device run read it as
  // one and reported `failed (vault:)` after a cycle that had succeeded).
  const blockerRef = useRef(null);
  const noteError = (tier) => (msg, code) => {
    if (!msg && !code) return;
    blockerRef.current = `${tier}: ${code || ''} ${msg || ''}`.trim();
  };
  // The app's engines (hooks/useSyncEngines.js), with only the reports wired:
  // no status UI, no cadence, no conflict dialog.
  const fileEngineRef = useRef(null);
  const vaultEngineRef = useRef(null);
  useFileSyncEngine({
    callbacksRef,
    engineRef: fileEngineRef,
    syncFolder: normalizeSyncFolder(cloudSyncConfig?.syncFolder),
    enabled: !!cloudSyncConfig?.enabled,
    createEngine: createFileEngine,
    handlers: {
      onError: noteError('file tier'),
      onConflict: () => { blockerRef.current = 'file tier: first sync needs the user to resolve a conflict'; },
      onPassphraseRequired: () => { blockerRef.current = 'passphrase required'; },
      // The app reloads to show the remote data; here it is already in state.
    },
  });
  useVaultSyncEngine({
    callbacksRef,
    engineRef: vaultEngineRef,
    dataLoaded,
    createEngine: createVaultEngine,
    handlers: { onError: noteError('vault') },
  });

  // What a launcher write reads and calls: the app's handler context, from the
  // latest commit (each write's flush re-renders, so the next one sees it).
  const writeContextRef = useRef(null);
  writeContextRef.current = {
    tasks, unscheduledTasks, recurringTasks, projects, goals, recycleBin: store.recycleBin,
    setTasks: store.setTasks, setUnscheduledTasks: store.setUnscheduledTasks, setRecurringTasks: store.setRecurringTasks,
  };

  // ── The run ──────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState('loading'); // loading | syncing | writes | synced | done
  // The tiers' cycles, run once for the pull and again to push launcher writes.
  const jobsRef = useRef([]);
  // No tier configured: the writes and the snapshot still run, the outcome says why.
  const noTierRef = useRef(false);
  const startedAtRef = useRef(null);
  // One cycle per root, whatever React does with effects (StrictMode re-runs them).
  const startedRef = useRef(false);
  // The forecast, requested when the run starts so it overlaps the sync.
  const forecastRef = useRef(null);

  const touchHeartbeat = useCallback(() => {
    const fileTier = cloudSyncConfig?.enabled ? fileEngineRef.current?.getLastSynced?.() : null;
    const dbTier = vaultEngineRef.current?.getLastSynced?.() ?? null;
    nativeTouchLauncherHeartbeat({ checkedAt: Date.now(), syncedAt: latestSyncedAt(fileTier, dbTier) });
  }, [cloudSyncConfig?.enabled]);

  const finish = useCallback((outcome, extra = {}) => {
    const durationMs = Date.now() - (startedAtRef.current ?? Date.now());
    touchHeartbeat();
    const entry = { clientId, outcome, durationMs, ...extra };
    nativeRecordLauncherRefresh(entry);
    try { bridge()?.headlessDone?.(JSON.stringify(entry)); } catch { /* the shell owns the cap */ }
    setPhase('done');
  }, [bridge, clientId, touchHeartbeat]);

  const shouldAbort = useCallback(() => {
    try { return bridge()?.headlessShouldAbort?.() === true; } catch { return false; }
  }, [bridge]);

  useEffect(() => { loadData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Every tier, awaited; the same pass the alive path runs for REFRESH.
  useEffect(() => {
    if (phase !== 'loading' || !dataLoaded || syncKeyReady === null) return;
    if (!joboLoaded && !joboError) return; // the ledger is a quick read; a failed one is held, not waited on
    if (startedRef.current) return;
    startedRef.current = true;
    setPhase('syncing');
    startedAtRef.current = Date.now();
    // The one fetch outside the sync tiers (CLAUDE.md, "Headless refresh"):
    // the dial's weather ring reads this forecast, and a phone left with the
    // app closed for days would otherwise show the temperatures of the day it
    // was last opened. Read-only: it writes no storage and no state, and its
    // only consumer is the snapshot below. A failure is no forecast, and the
    // shell keeps the last one.
    forecastRef.current = Promise.resolve(fetchForecast({
      coords: getStoredWeatherCoords(),
      tempUnit: weatherTempUnit,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })).catch(() => null);
    (async () => {
      if (shouldAbort()) return finish(HEADLESS_OUTCOMES.ABORTED, { reason: 'app opened' });
      if (syncKeyReady === false) return finish(HEADLESS_OUTCOMES.FAILED, { reason: 'passphrase required' });
      // One tier after the other, never side by side: each apply replaces
      // the task lists whole, so two applies in flight would each build from
      // state the other was about to change and the later one would drop
      // what the earlier pulled. The file tier runs first and the vault then
      // sees its result in the payload.
      const jobs = [];
      if (cloudSyncConfig?.enabled && fileEngineRef.current?.sync) jobs.push(() => fileEngineRef.current.sync());
      if (vaultEngineRef.current?.dbSyncCycle) jobs.push(() => vaultEngineRef.current.dbSyncCycle());
      jobsRef.current = jobs;
      if (jobs.length === 0) {
        // Nothing to pull from, so nothing to wait for: the launcher's writes
        // still land on this device and in the snapshot.
        noTierRef.current = true;
        setPhase('writes');
        return;
      }
      try {
        for (const job of jobs) await job();
      } catch (err) {
        return finish(HEADLESS_OUTCOMES.FAILED, { reason: err?.message || String(err) });
      }
      if (blockerRef.current) return finish(HEADLESS_OUTCOMES.FAILED, { reason: blockerRef.current });
      if (shouldAbort()) return finish(HEADLESS_OUTCOMES.ABORTED, { reason: 'app opened' });
      // The apply's state updates are committed before the next effect pass.
      setPhase('writes');
    })();
    // Keyed on readiness only: the cycle runs once (startedRef).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, dataLoaded, syncKeyReady, joboLoaded, joboError]);

  // After the pull: the launcher's queued writes, against the state the pull
  // settled (the same rule as the app's drain: not before the first pull,
  // intents/intentDrainGate.js). Each is saved before the queue drops it.
  // When any changed something, the tiers run again to push it.
  useEffect(() => {
    if (phase !== 'writes') return;
    (async () => {
      // Out of the effect phase: a write's setters flush synchronously.
      await Promise.resolve();
      if (shouldAbort()) return finish(HEADLESS_OUTCOMES.ABORTED, { reason: 'app opened' });
      let applied = 0;
      try {
        const raw = bridge()?.getPendingLauncherIntents?.();
        const parsed = raw ? JSON.parse(raw) : [];
        const writes = (Array.isArray(parsed) ? parsed : []).filter(appliesHeadlessly);
        const results = await drainLauncherQueue({
          entries: writes,
          context: () => writeContextRef.current,
          ack: (ids) => { try { bridge()?.ackLauncherIntents?.(JSON.stringify(ids)); } catch { /* re-delivered; the ledger dedupes */ } },
          flush,
        });
        applied = results.filter(r => r.result?.success && !r.result?.deduped).length;
      } catch (err) {
        console.warn('[headless] launcher writes:', err);
      }
      if (applied > 0) {
        // The detector records a completion one microtask after its commit;
        // let those writes land, and their state commit, before the push.
        await new Promise(resolve => setTimeout(resolve, 0));
        await Promise.allSettled([...joboWritesRef.current]);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (applied > 0 && jobsRef.current.length > 0) {
        if (shouldAbort()) return finish(HEADLESS_OUTCOMES.ABORTED, { reason: 'app opened' });
        try {
          for (const job of jobsRef.current) await job();
        } catch (err) {
          return finish(HEADLESS_OUTCOMES.FAILED, { reason: `pushing launcher writes: ${err?.message || err}` });
        }
        if (blockerRef.current) return finish(HEADLESS_OUTCOMES.FAILED, { reason: blockerRef.current });
      }
      setPhase('synced');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // After the cycle: the snapshot from settled state, then the outcome.
  // Declared after useSaveOnChange, so the save pass has already run for this
  // commit when it reads state.
  useEffect(() => {
    if (phase !== 'synced') return;
    (async () => {
      try {
        const weatherHourlyByDate = await (forecastRef.current ?? null);
        if (shouldAbort()) return finish(HEADLESS_OUTCOMES.ABORTED, { reason: 'app opened' });
        const nowDate = now();
        const todayStr = dateToString(nowDate);
        const isVisibleForUser = (task) => isTaskVisibleForUser(task, multiUserEnabled, meUserSyncId);
        const ownedBy = (item) => isOwnedBy(item, multiUserEnabled, meUserSyncId);
        const { rangeStart, rangeEnd } = computeRecurringExpansionRange({
          selectedDate: nowDate, today: nowDate, schedDaysShown: SCHED_DAYS_SHOWN, weekStartDay: readWeekStartDay(),
        });
        const snapshot = buildLauncherSnapshot({
          now: nowDate, todayStr,
          tasks, unscheduledTasks,
          expandedRecurringTasks: recurringTasks.length ? expandRecurringTasks(recurringTasks, { rangeStart, rangeEnd, today: todayStr }) : [],
          projects, goals, goalsProjectsEnabled, isVisibleForUser,
          // The same filter and stored preferences the app's Inbox uses.
          inboxCount: inboxCountOf(inboxFromStorage({ tasks, unscheduledTasks, recurringTasks, projects, goalsProjectsEnabled, isVisibleForUser })),
          todayRoutines: allTodayRoutines.filter(ownedBy), routineCompletions, routinesEnabled,
          // The sets as App passes them (#2305): without them every set's
          // frames would reach the launcher on every date.
          frameInstancesForDate: (date) => frameInstancesForDate(gtdFrames.filter(ownedBy), dateToString(date), { frameSets }),
          getDayWindow,
          weatherCoords: getStoredWeatherCoords(),
          // Null when the fetch failed: the shell keeps the last snapshot's
          // weather when a new one carries none.
          weatherHourlyByDate,
          weatherTempUnit,
          dialAlarm: loadAlarmPrefs(),
          dialLayers: loadDialLayers(),
          use24Hour: use24HourClock,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          updatedAt: Date.now(),
          handledWrites: readLauncherLedger(),
          // No device-calendar read in a headless run (the allowlist): the
          // provider reads the calendar itself with these, and without the
          // permission keeps the previous snapshot's events, which a sync
          // cannot change anyway.
          carryDeviceEvents: true,
          deviceCalendar: { filter: readCalendarFilter(), overrides: readNativeTimeOverrides() },
        });
        if (shouldAbort()) return finish(HEADLESS_OUTCOMES.ABORTED, { reason: 'app opened' });
        bridge()?.updateLauncherSnapshot?.(JSON.stringify(snapshot));
        if (noTierRef.current) finish(HEADLESS_OUTCOMES.FAILED, { reason: 'no sync tier is configured' });
        else finish(HEADLESS_OUTCOMES.RAN);
      } catch (err) {
        finish(HEADLESS_OUTCOMES.FAILED, { reason: `snapshot: ${err?.message || err}` });
      }
    })();
    // The snapshot is built once, from the state of the commit that settled the cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  return null;
}
