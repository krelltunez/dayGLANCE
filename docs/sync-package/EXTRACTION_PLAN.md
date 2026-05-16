# `@glance-apps/sync` — Extraction Plan

> **Audience**: The engineer executing the extraction.
> Read `SYNC_PACKAGE_SPEC.md` and `ADAPTER_GUIDE.md` first.

This document is a sequenced, step-by-step work plan. Each step produces a shippable artifact that can be reviewed independently. **Do not skip steps or reorder them.**

---

## Pre-flight Checklist

Before starting Step 1, verify:

- [ ] Branch `claude/export-cloud-sync-8TBos` (or a fresh branch from latest main) is checked out in `krelltunez/dayGLANCE`
- [ ] The `docs/sync-package/` directory is committed (this file should be present)
- [ ] Node.js ≥ 20 is available (`node --version`)
- [ ] `npm` is configured to publish to GitHub Packages (`~/.npmrc` or project `.npmrc` with `@glance-apps:registry=https://npm.pkg.github.com`)
- [ ] A `GITHUB_TOKEN` with `write:packages` scope is available

---

## Step 1 — Create the Package Scaffold

**Goal**: An empty but valid npm package that can be installed from GitHub Packages.

### 1.1 Create the repository

Create `https://github.com/krelltunez/glance-sync` (new public repo). Initialize with a README.

### 1.2 Scaffold the package

```
packages/sync/
├── src/
│   ├── index.js          ← empty for now (named exports)
│   ├── crypto.js         ← empty placeholder
│   ├── providers.js      ← empty placeholder
│   ├── merge.js          ← empty placeholder
│   ├── autoBackup.js     ← empty placeholder
│   └── engine.js         ← empty placeholder
├── api/
│   └── webdav-proxy.js   ← copy verbatim from dayGLANCE/api/webdav-proxy.js
├── types/
│   └── index.d.ts        ← stub; fill in Step 6
├── package.json
└── README.md
```

`package.json`:
```json
{
  "name": "@glance-apps/sync",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.js",
  "types": "types/index.d.ts",
  "publishConfig": {
    "registry": "https://npm.pkg.github.com"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/krelltunez/glance-sync.git"
  }
}
```

### 1.3 Copy `webdav-proxy.js` verbatim

`api/webdav-proxy.js` in dayGLANCE has zero app-specific code. Copy it unchanged. This file is also the version dayGLANCE will read from the package going forward (or keep its own copy — either is fine; the package's copy is authoritative for new apps).

### 1.4 Publish `0.1.0`

```bash
npm publish --access public
```

Verify the package appears in GitHub Packages for `krelltunez`.

### Review gate: PR to `glance-sync` main. Package installs without errors.

---

## Step 2 — Extract `merge.js`

**Goal**: `mergeArrayById` and all merge helpers are in the package and tested.

### 2.1 Copy `mergeSync.js` → `packages/sync/src/merge.js`

`mergeSync.js` is fully portable — zero imports, zero app-specific references. The only change:

- Rename `mergeTaskArrays` → `mergeArrayById`
- Add `options` parameter: `{ idField = 'id', timestampField = 'updatedAt' } = {}`
- Replace hardcoded `'id'` and `'updatedAt'` references inside the function body with the option values
- Export all functions: `mergeArrayById`, `mergeDailyNotes`, `mergeHabits`, `mergeHabitLogs`, `mergeRoutineDefinitions`, `mergeSyncData`, `pruneTombstones`

### 2.2 Export from `src/index.js`

```js
export {
  mergeArrayById,
  mergeDailyNotes,
  mergeHabits,
  mergeHabitLogs,
  mergeRoutineDefinitions,
  mergeSyncData,
  pruneTombstones,
} from './merge.js';
```

### 2.3 Write unit tests

Create `packages/sync/test/merge.test.js`. Test cases (minimum):
- New item on remote → added to result
- Deleted item (tombstoned) → excluded from result
- Conflict: remote wins when `updatedAt` is later
- Conflict: local wins when `updatedAt` is later
- Tombstone beat by later modification → item survives
- Custom `idField` and `timestampField` options
- `pruneTombstones` removes entries older than `retentionDays`

### 2.4 Update dayGLANCE to import from package

In `dayGLANCE/src/mergeSync.js`:
```js
// Before: all logic inline
// After: re-export from package (keep file for now, gut the logic)
export { mergeArrayById, mergeDailyNotes, ... } from '@glance-apps/sync';
export { mergeSyncData } from '@glance-apps/sync';  // dayGLANCE-specific orchestrator stays
```

Or: delete `mergeSync.js` entirely and update all imports in `App.jsx` to point to `@glance-apps/sync`. Either is acceptable.

### Review gate: All merge tests pass. dayGLANCE still builds and syncs correctly.

---

## Step 3 — Extract `crypto.js`

**Goal**: Encryption functions are in the package with no hardcoded app names.

### 3.1 Copy `crypto.js` → `packages/sync/src/crypto.js`

One thing to parameterize: `const KEY_DB_NAME = 'dayglance-crypto'` (line 19 of current file).

Change to: accept `cryptoDBName` as a parameter threaded through from the engine config.

The Android Keystore bridge detection currently checks:
```js
!window.DayGlanceIOS && !!window.DayGlanceNative?.getSyncKey
```

Change to: use injected function presence. The engine will pass `config.nativeGetSyncKey` (a function or null). Crypto module checks `config.nativeGetSyncKey != null` — no global name probing.

All other crypto code is fully portable.

### 3.2 Export from `src/index.js`

```js
export {
  encryptData,
  decryptData,
  setupEncryptionKey,
  setSyncPassphrase,
  clearEncryptionKey,
  hasEncryptionReady,
  isEncryptedEnvelope,
} from './crypto.js';
```

### 3.3 Update dayGLANCE

In `dayGLANCE/src/utils/crypto.js`: re-export from `@glance-apps/sync`. Pass `cryptoDBName: 'dayglance-crypto'` and the native bridge when creating the engine.

### Review gate: Encryption/decryption round-trips correctly in dayGLANCE. Key persists across page reloads.

---

## Step 4 — Extract `providers.js`

**Goal**: WebDAV providers and `webdavFetch` are in the package, fully parameterized.

### 4.1 Copy `cloudSyncProviders.js` → `packages/sync/src/providers.js`

Five things to parameterize (see `SYNC_PACKAGE_SPEC.md` for details):

1. **Remove import**: `import { nativeHttpRequest } from '../native.js'` → deleted. `nativeHttpRequest` comes from config.
2. **`window.DayGlanceNative?.httpRequest`** → `config.nativeHttpRequest`
3. **`window.electronAPI?.isElectron`** → `config.electronProxyFetch != null`
4. **Nextcloud path**: `dayglance/dayglance-sync.json` → `{appFolderName}/{syncFilename}`
5. **Koofr hardcoded URL**: `https://app.koofr.net/dav/Koofr/dayGLANCE/dayglance-sync.json` → `https://app.koofr.net/dav/Koofr/{appFolderName}/{syncFilename}`
6. **Generic WebDAV path**: `/dayglance-sync.json` → `/{syncFilename}`
7. **Koofr test**: `!!window.DayGlanceNative` → `config.nativeHttpRequest != null`

The `webdavFetch` routing function becomes:
```js
const webdavFetch = (config) => async (method, url, authHeaders, body, extraHeaders) => {
  if (config.nativeHttpRequest) { ... }
  else if (config.electronProxyFetch) { ... }
  else { fetch(config.proxyUrl + '/api/webdav-proxy', ...) }
};
```

### 4.2 Export from `src/index.js`

`webdavFetch` is internal; no need to export. The provider objects are also internal — consumed by the engine.

### 4.3 Update dayGLANCE

`dayGLANCE/src/utils/cloudSyncProviders.js` is replaced by the engine config wiring. The sync form UI (`CloudSyncSettingsForm`) still needs to know provider names/fields — expose a `getProviders()` call or keep a thin wrapper that re-exports provider metadata.

### Review gate: Connection test, upload, and download work for at least Nextcloud and Generic WebDAV in dayGLANCE.

---

## Step 5 — Extract `autoBackup.js`

**Goal**: Auto-backup engine is in the package with parameterized strings.

### 5.1 Copy `autoBackup.js` → `packages/sync/src/autoBackup.js`

Three strings to parameterize:
- `'dayglance-auto-backups'` → `config.autoBackupDBName`
- `'dayglance-backup-'` → `config.backupFilenamePrefix`
- `dayglance/backups/` → `{config.appFolderName}/backups/`

### 5.2 Export utilities from `src/index.js`

```js
export { autoBackupDB, AUTO_BACKUP_RETENTION, AUTO_BACKUP_INTERVALS } from './autoBackup.js';
```

`autoBackupProviders` is internal (consumed by the engine config wiring).

### 5.3 Update dayGLANCE

`dayGLANCE/src/utils/autoBackup.js` re-exports from `@glance-apps/sync`. Pass the three config strings when constructing the engine.

### Review gate: Hourly backup runs and appears in Nextcloud. Restore from backup works.

---

## Step 6 — Extract `engine.js` + Wire `createSyncEngine`

**Goal**: `createSyncEngine` exists and dayGLANCE uses it. All sync orchestration is in the package.

This is the largest step. The sync orchestration currently lives in `App.jsx` (~500 lines across `buildSyncPayload`, `cloudSyncUpload`, `applyRemoteData`, `cloudSyncDownload`).

### 6.1 Implement `engine.js`

```js
export const createSyncEngine = (config) => {
  let syncing = false;

  const sync = async () => {
    if (syncing) { config.onError?.('Already syncing', 'LOCKED', false); return; }
    syncing = true;
    config.onStatusChange?.('syncing');
    try {
      await download();
    } finally {
      syncing = false;
      config.onStatusChange?.('idle');
    }
  };

  const upload = async () => { ... };
  const download = async () => { ... };
  const runBackup = async (frequency) => { ... };

  return { sync, upload, download, runBackup, isSyncing: () => syncing, ... };
};
```

Key behaviors to preserve from `App.jsx` (read the source carefully):
- **Upload safety check** (lines 4799-4806): refuse upload if payload has 0 items but local state is non-empty
- **ETag-based optimistic concurrency**: read ETag on download, send `If-Match` on upload; handle 412
- **Error backoff**: transient errors do not immediately retry
- **Hard-stop errors**: `APP_ID_MISMATCH` and `SCHEMA_FORWARD_INCOMPATIBLE` set `isHardStop: true` and stop all auto-retry
- **Merge flow**: download → parse envelope → validate `appId` and `schemaVersion` → decrypt if needed → merge with local → upload merged
- **Lock management**: boolean lock, cleared in `finally`

### 6.2 Wire dayGLANCE adapter

Create `dayGLANCE/src/sync/adapter.js`:
```js
import { nativeHttpRequest } from '../native.js';

export const createDayGlanceEngine = (refs, setters) => createSyncEngine({
  storageKeyPrefix: 'day-planner',
  cryptoDBName: 'dayglance-crypto',
  autoBackupDBName: 'dayglance-auto-backups',
  syncFilename: 'dayglance-sync.json',
  appFolderName: 'dayglance',
  backupFilenamePrefix: 'dayglance-backup-',
  appId: 'dayglance',
  appName: 'dayGLANCE',
  nativeHttpRequest,
  proxyUrl: import.meta.env.VITE_WEBDAV_PROXY_URL,

  buildPayload: () => ({
    version: 2,
    lastModified: new Date().toISOString(),
    data: {
      tasks: refs.tasksRef.current,
      dailyNotes: ...,
      tombstones: JSON.parse(localStorage.getItem('day-planner-tombstones') || '{}'),
    }
  }),

  buildBackupPayload: () => ({
    tasks: JSON.parse(localStorage.getItem('day-planner-tasks') || '[]'),
    ...
  }),

  applyPayload: async (data) => {
    localStorage.setItem('day-planner-tasks', JSON.stringify(data.tasks));
    setters.setTasks(data.tasks);
    ...
  },

  mergePayloads: (local, remote) => mergeSyncData(local, remote),

  onStatusChange: setters.setCloudSyncStatus,
  onError: (msg, code, isHardStop) => { setters.setCloudSyncError(msg); ... },
  onLastSyncedChange: setters.setCloudSyncLastSynced,
  onPassphraseRequired: setters.setShowPassphraseModal,
});
```

### 6.3 Remove `cloudSyncUpload`, `applyRemoteData`, `cloudSyncDownload` from `App.jsx`

Replace with calls to the engine. The debounce and polling timer remain in `App.jsx` (they are UI concerns).

### 6.4 Write TypeScript declarations (`types/index.d.ts`)

Cover the full public API:
- `createSyncEngine(config: SyncEngineConfig): SyncEngine`
- `mergeArrayById(...): T[]`
- All crypto functions
- All enum-style string literals for error codes

Required for lastGLANCE consumption.

### 6.5 Publish `1.0.0`

```bash
npm version 1.0.0
npm publish
```

### Review gate:
- dayGLANCE syncs end-to-end (upload, download, conflict, encryption, backup)
- TypeScript consumers can import without type errors (`tsc --noEmit` in lastGLANCE)
- PR in `glance-sync` with full changelog

---

## Step 7 — Integrate into lifeGLANCE

See `lifeGLANCE-SYNC_INTEGRATION.md` for the full integration spec.

High-level:
1. Add `@glance-apps/sync` dependency
2. Implement adapter callbacks (photos excluded, tombstones at boundary)
3. Deploy Vercel proxy
4. Wire engine into React state

---

## Step 8 — Integrate into lastGLANCE

See `lastGLANCE-SYNC_INTEGRATION.md` for the full integration spec.

High-level:
1. Dexie schema migration: add `sync_id` UUID column to all syncable tables
2. Add `parent_sync_id` to categories
3. Implement adapter callbacks (two-pass write, orphan promotion)
4. Deploy Vercel proxy
5. Wire engine into React/Dexie context

---

## Versioning Policy

- **Patch** (`0.1.x`): Bug fixes, no API changes
- **Minor** (`0.x.0`): New optional config fields, new exported utilities
- **Major** (`x.0.0`): Breaking changes to `createSyncEngine` config shape or envelope schema

When `schemaVersion` in the envelope changes (a breaking protocol change), bump the major version and update `SUPPORTED_MAX` in the engine.

---

## Rollback Plan

If the extraction breaks dayGLANCE:

1. Pin dayGLANCE to the previous package version in `package.json`
2. Revert the adapter wiring in `App.jsx` to the pre-extraction code
3. The old code is in git history — do not delete branches until all three apps are verified

The package itself is additive. Old apps can stay on an older version indefinitely.
