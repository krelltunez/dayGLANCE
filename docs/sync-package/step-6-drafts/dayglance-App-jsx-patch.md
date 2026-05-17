# App.jsx wiring guide (Step 6)

> Apply **after** `@glance-apps/sync@1.0.0` is published and `dayGLANCE/package.json` is bumped to `^1.0.0`. Until then, App.jsx must stay unchanged so the dev/CI build keeps passing.

## Files touched

| File | Change |
|---|---|
| `src/App.jsx` | Replace `buildSyncPayload`, `cloudSyncUpload`, `applyRemoteData`, `cloudSyncDownload`, `cloudSyncTest` with engine method calls; keep the React-facing wrappers (debounce/poll/visibility effects, `applyRemoteData` as the engine's `applyPayload` callback, and the conflict-dialog handlers). |
| `src/sync/adapter.js` | NEW — copy from `docs/sync-package/step-6-drafts/dayglance-adapter.js`. |
| `src/hooks/useCloudSync.js` | Strip the in-progress / backoff / error-count refs that now live inside the engine. Keep `cloudSyncDebounceRef`, `suppressCloudUploadRef`, `suppressTimestampRef`, `suppressClearPendingRef`, `cloudSyncInitialDoneRef`, `cloudSyncDownloadRef`, `cloudSyncPendingUploadRef`, `iCloudPendingRef`. |
| `package.json` | Bump `@glance-apps/sync` from `^0.5.0` to `^1.0.0`. |

## App.jsx — replacement of the sync block

### Before (current code, lines ~4708-5209)

```js
const buildSyncPayload = () => { /* 70-line builder */ };
const cloudSyncUpload  = async (prebuiltPayload, opts) => { /* 70 lines */ };
const applyRemoteData  = (data, opts) => { /* 200-line setter cascade */ };
const cloudSyncDownload = async () => { /* 140 lines */ };
cloudSyncDownloadRef.current = cloudSyncDownload;
const cloudSyncTest = async (config) => { /* 8 lines */ };
```

### After

```js
// applyRemoteData stays as the engine's applyPayload callback — its job is to
// mutate React state + localStorage in the correct order. Keep it as-is.
const applyRemoteData = (data, { allowEmpty = false } = {}) => { /* unchanged */ };

// Pull the sync engine in. Built once and held in a ref so React re-renders
// don't tear it down.
const cloudSyncEngineRef = useRef(null);
if (!cloudSyncEngineRef.current) {
  cloudSyncEngineRef.current = createDayGlanceEngine(
    // sources(): live snapshot of state at upload time. Use a function so
    // closures read the latest React state on every call.
    () => ({
      syncRetentionDays, completedTaskUids,
      tasks, unscheduledTasks, recycleBin, recurringTasks,
      syncUrl, taskCalendarUrl, unscheduledOrderTimestamp,
      routineDefinitions, todayRoutines, routinesDate, routineCompletions,
      minimizedSections, use24HourClock, weatherZip, weatherTempUnit,
      removedTodayRoutineIds, dailyNotes,
      habits, habitLogs, habitsEnabled, routinesEnabled,
      gtdFrames, goals, projects, goalsProjectsEnabled,
      obsidianConfig,
      stampTaskTimestamps, isNativeApp,
    }),
    {
      applyPayload:       (data, opts) => applyRemoteData(data, opts),
      onStatusChange:     (status) => setCloudSyncStatus(prev => {
        // Guard: don't let a queued 'idle' overwrite an in-flight upload/download.
        if (status === 'idle' && (prev === 'uploading' || prev === 'downloading')) return prev;
        return status;
      }),
      onError:            (msg, code, isHardStop) => {
        // null clears errors; non-null sets them. Hard-stop errors stay until
        // the user reconfigures sync.
        setCloudSyncError(msg);
      },
      onLastSyncedChange: setCloudSyncLastSynced,
      onConflict:         (remoteData, remoteModified, etag) =>
        setCloudSyncConflict({ remoteData, remoteModified, etag }),
      onPassphraseRequired: () => setSyncKeyReady(false),
      onFirstSyncReload:    () => window.location.reload(),
      getSyncRetentionDays: () => syncRetentionDays,
      buildBackupPayload:   /* existing autoBackup payload builder */ buildAutoBackupPayload,
    }
  );
}

// Thin wrappers so the rest of App.jsx (conflict dialog, loadData restore
// path, MobileSettingsPanel, etc.) keeps the same call signatures.
const cloudSyncUpload   = (prebuilt, opts = {}) =>
  cloudSyncEngineRef.current.upload({ prebuiltPayload: prebuilt, ...opts });
const cloudSyncDownload = () => cloudSyncEngineRef.current.download();
const cloudSyncTest     = (config) => cloudSyncEngineRef.current.test(config);
const buildSyncPayload  = () =>
  // Retained for the conflict dialog's merge handler (line ~8364) which needs
  // localData before calling mergeSyncData manually. The engine's internal
  // buildPayload is the same function.
  buildDayGlanceData();
```

> `buildDayGlanceData` here is the same function body as the current
> `buildSyncPayload` — it stays in App.jsx because it reads many state slices.
> The adapter's payload builder is wired to read this same function through
> the `sources()` closure.

### Reset the in-flight refs

Replace direct ref reads with engine queries:

```js
// Before
if (cloudSyncInProgressRef.current) { ... }
cloudSyncDownloadBackoffUntilRef.current = 0;

// After
if (cloudSyncEngineRef.current.isSyncing()) { ... }
// (backoff is managed inside the engine — visibility handler doesn't need
// to clear it; engine resets on success automatically. To force-clear after
// the user returns to the foreground, expose engine.clearBackoff() if needed.)
```

### Effect simplifications

The 5-second debounce effect (App.jsx line ~1274) stays unchanged — it still
calls `cloudSyncUpload()`. The 60-second poll (line ~1484) and the
visibilitychange handler (line ~1186) still call `cloudSyncDownloadRef.current?.()`.

The `useEffect` at line ~1473 ("download on app load") still calls
`cloudSyncDownload()`. Once the engine is wired, this effect runs the engine's
download cycle on mount.

## useCloudSync.js — slimming down

The engine subsumes these refs — drop them from the hook:
- `cloudSyncInProgressRef`
- `cloudSyncErrorCountRef`
- `cloudSyncBackoffUntilRef`
- `cloudSyncDownloadErrorCountRef`
- `cloudSyncDownloadBackoffUntilRef`

Keep these (App.jsx still uses them directly):
- `cloudSyncDebounceRef` — App.jsx owns the 5-second debounce timer
- `suppressCloudUploadRef`, `suppressTimestampRef`, `suppressClearPendingRef`
  — these gate the timestamp tracking effects during `applyRemoteData`
- `cloudSyncInitialDoneRef` — gates the local-modified timestamp until first
  sync completes
- `cloudSyncDownloadRef` — visibility/poll handlers call through it
- `cloudSyncPendingUploadRef`, `iCloudPendingRef` — used by the iCloud sync code

## Conflict dialog (App.jsx ~lines 8350-8420)

Currently calls `applyRemoteData` and `cloudSyncUpload` directly. After
extraction these still work — they're the thin wrappers from above.

```js
// "Merge" button — unchanged logic, just uses the engine internally
const localData = buildSyncPayload().data;
const { data: mergedData } = mergeSyncData(localData, cloudSyncConflict.remoteData);
applyRemoteData(mergedData);
const mergedPayload = { version: 2, lastModified: new Date().toISOString(), data: mergedData };
await cloudSyncUpload(mergedPayload, { skipLockCheck: true, etag: cloudSyncConflict.etag });
```

No behavioural change — the engine's `upload()` accepts the same arguments.

## Things deliberately NOT moved into the engine

- iCloud sync code (App.jsx ~lines 1313-1444). iCloud uses an entirely
  different transport (native iCloud container, fs.watch, NSMetadataQuery)
  that the engine doesn't know about. The engine's `isSyncing()` is queried
  by iCloud code so they serialise on the same lock — that's the only point
  of contact.
- The 5-second upload debounce. UI concern.
- The 60-second poll. UI concern.
- Window visibility / focus listeners. UI concern.
- Midnight refresh, calendar auto-sync, TRMNL auto-sync. Unrelated.
- The passphrase modal display. App-level UI; engine signals via
  `onPassphraseRequired`.

## Testing notes (for the App.jsx PR)

Once 1.0.0 publishes and App.jsx is rewired:

1. `npm test` — all existing dayGLANCE tests pass.
2. Manual: configure sync against a self-hosted WebDAV server, run through:
   - First sync from empty remote (upload-seed).
   - Second device connects → first-sync conflict dialog appears.
   - Edit a task → debounce → upload.
   - Edit on another device → 60 s poll → download → merge → apply → upload.
   - 412 retry path (write conflicting versions from two devices simultaneously).
   - APP_ID_MISMATCH: manually edit the remote sync file to set
     `"appId": "wrong"` → confirm dayGLANCE shows the hard-stop error.
   - SCHEMA_FORWARD_INCOMPATIBLE: set `"schemaVersion": 99` → confirm
     hard-stop error.
   - Enable encryption → confirm round-trip on both devices.
   - Hourly auto-backup creates a file and appears in the Nextcloud backup
     directory.
   - Restore from a backup file.
