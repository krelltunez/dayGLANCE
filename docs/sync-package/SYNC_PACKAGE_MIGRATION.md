# dayGLANCE — Cloud Sync Package Migration Guide

> **Purpose**: Documents how dayGLANCE migrates from its inline sync implementation to `@glance-apps/sync`.
> This is the dayGLANCE-specific counterpart to the general extraction plan.

---

## Context

dayGLANCE currently implements all cloud sync logic inline:

| Current file | Lines | Role |
|---|---|---|
| `src/mergeSync.js` | 878 | Merge engine |
| `src/utils/crypto.js` | ~340 | Encryption |
| `src/utils/cloudSyncProviders.js` | 276 | WebDAV providers |
| `src/utils/autoBackup.js` | 249 | Auto-backup |
| `src/hooks/useCloudSync.js` | 96 | Sync state hook |
| `src/App.jsx` (sync sections) | ~500 | Upload/download/merge orchestration |
| `api/webdav-proxy.js` | 147 | Vercel CORS proxy |
| `src/components/CloudSyncSettingsForm.jsx` | 218 | Settings UI |

After migration, the orchestration logic moves to `@glance-apps/sync` and dayGLANCE retains only its adapter (app-specific callbacks) and UI components.

---

## dayGLANCE Config Values

These are the exact values to pass when constructing the engine:

```js
{
  storageKeyPrefix: 'day-planner',
  cryptoDBName: 'dayglance-crypto',
  autoBackupDBName: 'dayglance-auto-backups',
  syncFilename: 'dayglance-sync.json',
  appFolderName: 'dayglance',
  backupFilenamePrefix: 'dayglance-backup-',
  appId: 'dayglance',
  appName: 'dayGLANCE',
}
```

These values are already hardcoded in the current implementation. Changing any of them would break existing users' sync files, so they must not change.

---

## localStorage Keys (must not change)

| Key | Current value | Used for |
|---|---|---|
| sync config | `'day-planner-cloud-sync-config'` | Provider credentials, enabled flag, encryptionEnabled |
| last synced | `'day-planner-cloud-sync-last-synced'` | Timestamp displayed in UI |
| tombstones | `'day-planner-tombstones'` | Deleted item IDs (managed by App.jsx) |

The engine reads the first two via `storageKeyPrefix`. Tombstones are app-managed (read in `buildPayload`).

---

## Payload Schema (must not change)

Existing users have `dayglance-sync.json` files on their WebDAV servers with this shape. The migration must preserve backward compatibility.

```json
{
  "schemaVersion": 1,
  "appId": "dayglance",
  "version": 42,
  "lastModified": "2026-05-16T10:00:00.000Z",
  "data": {
    "version": 2,
    "lastModified": "2026-05-16T10:00:00.000Z",
    "tasks": [...],
    "dailyNotes": {...},
    "habits": [...],
    "habitLogs": [...],
    "routineDefinitions": [...],
    "tombstones": {...}
  }
}
```

Note the double `version`/`lastModified` — one at the envelope level (package-managed) and one inside `data` (dayGLANCE legacy). The inner ones are kept for backward compatibility with clients that haven't yet updated to the package version.

**`schemaVersion: 1` is the current version.** Do not change it during extraction.

---

## `buildPayload` Implementation

The current `buildSyncPayload` function in `App.jsx` (line 4708) reads from React state via closures. After migration, it must read from refs:

```js
// dayGLANCE adapter
const buildPayload = () => {
  const tasks = tasksRef.current;
  const dailyNotes = dailyNotesRef.current;
  const habits = habitsRef.current;
  const habitLogs = habitLogsRef.current;
  const routineDefinitions = routineDefinitionsRef.current;
  const tombstones = JSON.parse(localStorage.getItem('day-planner-tombstones') || '{}');

  return {
    version: 2,
    lastModified: new Date().toISOString(),
    data: {
      version: 2,
      lastModified: new Date().toISOString(),
      tasks,
      dailyNotes,
      habits,
      habitLogs,
      routineDefinitions,
      tombstones,
    }
  };
};
```

All refs must be updated on every render (the ref-update-per-render pattern).

---

## `buildBackupPayload` Implementation

The current `buildAutoBackupPayload` (App.jsx line 3975-4002) reads exclusively from localStorage — it is already timer-safe. Preserve this pattern:

```js
const buildBackupPayload = () => {
  const rawTasks = localStorage.getItem('day-planner-tasks');
  const rawNotes = localStorage.getItem('day-planner-daily-notes');
  const rawHabits = localStorage.getItem('day-planner-habits');
  // ... etc
  return {
    tasks: rawTasks ? JSON.parse(rawTasks) : [],
    dailyNotes: rawNotes ? JSON.parse(rawNotes) : {},
    habits: rawHabits ? JSON.parse(rawHabits) : [],
    // ...
    tombstones: JSON.parse(localStorage.getItem('day-planner-tombstones') || '{}'),
  };
};
```

---

## `mergePayloads` Implementation

The current merge logic lives inline in `cloudSyncDownload` (App.jsx) via `mergeSyncData`. After extraction, pass it as `mergePayloads`:

```js
import { mergeSyncData } from '@glance-apps/sync';  // dayGLANCE orchestrator exported from package

const mergePayloads = (local, remote) => mergeSyncData(local, remote);
```

`mergeSyncData` is the dayGLANCE-specific orchestrator that calls `mergeArrayById` for tasks, habits, habitLogs, routineDefinitions, and `mergeDailyNotes` for the notes map. It is exported from the package alongside the generic primitives.

`mergePayloads` must be synchronous. `mergeSyncData` is synchronous.

---

## Upload Safety Check (must preserve)

The current `cloudSyncUpload` (App.jsx lines 4799-4806) refuses to upload if the payload has zero tasks but local state is non-empty. This prevents data loss from stale closures or race conditions.

The engine must implement this guard either:
- In `validateUploadPayload` (pass from adapter), or
- As a built-in engine behavior (upload guard)

Recommended approach — pass as `validateUploadPayload`:

```js
validateUploadPayload: async (payload) => {
  const localCount = JSON.parse(localStorage.getItem('day-planner-tasks') || '[]').length;
  if (payload.data.tasks.length === 0 && localCount > 0) {
    return { valid: false, reason: 'Upload blocked: payload has 0 tasks but local has ' + localCount };
  }
  return { valid: true };
},
```

---

## `applyPayload` Implementation

The current `applyRemoteData` (App.jsx lines 4853-5055) does two things:
1. Updates localStorage (all keys)
2. Updates React state (all setters)

After migration:

```js
const applyPayload = async (data) => {
  // 1. Persist to localStorage
  localStorage.setItem('day-planner-tasks', JSON.stringify(data.tasks));
  localStorage.setItem('day-planner-daily-notes', JSON.stringify(data.dailyNotes));
  localStorage.setItem('day-planner-habits', JSON.stringify(data.habits));
  localStorage.setItem('day-planner-habit-logs', JSON.stringify(data.habitLogs));
  localStorage.setItem('day-planner-routine-definitions', JSON.stringify(data.routineDefinitions));
  localStorage.setItem('day-planner-tombstones', JSON.stringify(data.tombstones));

  // 2. Update React state
  setTasks(data.tasks);
  setDailyNotes(data.dailyNotes);
  setHabits(data.habits);
  setHabitLogs(data.habitLogs);
  setRoutineDefinitions(data.routineDefinitions);
};
```

The safety check at lines 4858-4864 (refuse apply if remote has 0 tasks but local has data) moves to `validateApplyPayload`:

```js
validateApplyPayload: async (data) => {
  const localCount = tasksRef.current.length;
  if (data.tasks.length === 0 && localCount > 0) {
    return { valid: false, reason: 'Apply blocked: remote has 0 tasks but local has ' + localCount };
  }
  return { valid: true };
},
```

---

## Native HTTP Bridge

dayGLANCE's Android native bridge is in `src/native.js`:

```js
// nativeHttpRequest(method, url, headers, body) → { status, ok, body, headers }
import { nativeHttpRequest } from '../native.js';
```

Pass directly as `config.nativeHttpRequest`. No changes to `native.js` are needed.

---

## Electron Bridge

dayGLANCE has Electron support via `window.electronAPI`. The current check in `cloudSyncProviders.js`:
```js
window.electronAPI?.isElectron
```

After extraction, pass:
```js
electronProxyFetch: window.electronAPI?.isElectron
  ? (method, url, headers, body) => window.electronAPI.webdavRequest(method, url, headers, body)
  : undefined,
```

---

## UI Components (no changes required)

These files are already fully portable and require no changes during extraction:

- `src/components/CloudSyncSettingsForm.jsx` — settings form
- `src/components/SyncPassphraseModal.jsx`
- `src/components/BackupMenuModal.jsx`
- `src/components/AutoBackupSettingsForm.jsx`
- `src/components/AutoBackupManagerModal.jsx`
- `src/components/RestoreConfirmModal.jsx`

They all accept state/callbacks as props and have no direct sync logic.

---

## Desktop Tooltip Bug (fix during extraction)

`src/components/DesktopHeader.jsx` (lines 205-220) has a bug: the cloud icon's `title` attribute always shows the last-synced time, even when `status === 'error'`. The error message is never shown in the tooltip.

Fix during extraction (small, contained change):

```jsx
// Before:
title={`Cloud sync — last: ${formatTime(cloudSyncLastSynced)}`}

// After:
title={
  cloudSyncStatus === 'error' && cloudSyncError
    ? `Cloud sync error: ${cloudSyncError}`
    : `Cloud sync — last: ${formatTime(cloudSyncLastSynced)}`
}
```

---

## Migration Sequence

Follow `EXTRACTION_PLAN.md` step order. dayGLANCE-specific sequencing:

1. `merge.js` extracted → `mergeSync.js` becomes a re-export shim → verify sync works
2. `crypto.js` extracted → `crypto.js` becomes a re-export shim → verify encryption round-trip
3. `providers.js` extracted → `cloudSyncProviders.js` becomes a shim → verify connection test + upload/download
4. `autoBackup.js` extracted → `autoBackup.js` becomes a shim → verify backup creation
5. `engine.js` implemented → sync orchestration removed from `App.jsx` → full end-to-end verification
6. Re-export shims deleted (once all imports updated)
7. Fix desktop tooltip bug

---

## Verification Checklist

After extraction is complete:

- [ ] Sync upload works (new task appears on second device after sync)
- [ ] Sync download works (task created on second device appears after sync)
- [ ] Conflict resolution works (modify same task on two devices, later timestamp wins)
- [ ] Encryption: enable, reload, re-enter passphrase, verify data decrypts
- [ ] Encryption: new device, enter passphrase, verify sync works
- [ ] Auto-backup: trigger hourly backup, verify file appears on WebDAV
- [ ] Auto-backup: restore from backup, verify data appears
- [ ] Hard-stop error: corrupt `appId` in file, verify error persists (not auto-cleared)
- [ ] Transient error: go offline, verify retry on reconnect
- [ ] Desktop tooltip shows error message when status is 'error'
- [ ] Electron: verify proxy routing works
- [ ] Android: verify native bridge routing works
