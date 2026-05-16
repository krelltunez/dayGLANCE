# lifeGLANCE — `@glance-apps/sync` Integration Guide

> **Note**: This document lives in the dayGLANCE repo temporarily (alongside the package spec).
> **Transfer this file to the lifeGLANCE repository** before integration work begins.
> Suggested path: `docs/SYNC_INTEGRATION.md`

---

## Overview

lifeGLANCE is a React + localStorage app (similar architecture to dayGLANCE). It tracks life entries — journal-like records that may include photos, mood, tags, and timestamps.

This guide describes how to add `@glance-apps/sync` to lifeGLANCE.

---

## lifeGLANCE Config Values

```js
{
  storageKeyPrefix: 'lifeglance',
  cryptoDBName: 'lifeglance-crypto',
  autoBackupDBName: 'lifeglance-auto-backups',
  syncFilename: 'lifeglance-sync.json',
  appFolderName: 'lifeglance',
  backupFilenamePrefix: 'lifeglance-backup-',
  appId: 'lifeglance',
  appName: 'lifeGLANCE',
}
```

---

## Step 1: Tombstone Infrastructure (required before sync can work)

lifeGLANCE does not yet have tombstone recording. Deletions currently remove items from state and localStorage with no record of the deletion. Without tombstones, deleted entries reappear on the next download from a device that still has them.

### 1.1 Add the tombstone localStorage key

```js
// Tombstone format: { [entryId: string]: deletedAt ISO string }
const TOMBSTONE_KEY = 'lifeglance-tombstones';

const getTombstones = () =>
  JSON.parse(localStorage.getItem(TOMBSTONE_KEY) || '{}');

const writeTombstone = (id) => {
  const tombstones = getTombstones();
  tombstones[id] = new Date().toISOString();
  localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(tombstones));
};
```

### 1.2 Write delete wrapper functions

Replace direct delete calls with wrappers that record tombstones atomically:

```js
const deleteEntry = (id) => {
  writeTombstone(id);
  const entries = JSON.parse(localStorage.getItem('lifeglance-entries') || '[]');
  localStorage.setItem(
    'lifeglance-entries',
    JSON.stringify(entries.filter(e => e.id !== id))
  );
  setEntries(prev => prev.filter(e => e.id !== id));
};
```

If lifeGLANCE has chapter or milestone entities that sync, write equivalent wrappers for each.

### 1.3 Update delete call sites

Search for every place an entry (or other syncable entity) is removed from state or localStorage. Replace with the wrapper. Common patterns to find:

```
setEntries(prev => prev.filter(...))   ← needs tombstone
localStorage.setItem('lifeglance-entries', ...)  ← if removing items
```

Do not add tombstones to purely UI state (selected entry, expanded sections, etc.) — only for persisted, syncable records.

### 1.4 Verify

After this step, deleting an entry should write to `lifeglance-tombstones` in localStorage. Inspect via DevTools → Application → Local Storage to confirm.

---

## Prerequisite: ID Strategy

Verify that life entries already use UUIDs as primary identifiers. If they use auto-increment integers, add a `sync_id` UUID field (see ADAPTER_GUIDE.md, Step 1).

Every syncable item must also have an `updatedAt` ISO string timestamp. If entries have only `createdAt`, add `updatedAt` (defaulting to `createdAt` for existing records).

---

## Payload Shape

Design the payload to include all syncable data:

```js
{
  entries: [
    {
      id: 'uuid-...',
      date: '2026-05-16',
      text: 'Had a great walk this morning.',
      mood: 4,
      tags: ['exercise', 'morning'],
      // no photo field — all photo data is stripped before upload
      updatedAt: '2026-05-16T10:00:00Z',
      createdAt: '2026-05-16T08:00:00Z',
    }
  ],
  tombstones: {
    'uuid-deleted-entry': '2026-05-15T08:00:00Z',
  }
}
```

---

## Binary Data (Photos)

**Photos are not synced.** On a second device, an entry that has a photo on the originating device will arrive with no photo. The UI must handle this gracefully (show a "no photo" placeholder, not an error or broken image).

### In `buildPayload`

Strip all photo data — blob and metadata — before the payload leaves the device:

```js
const buildPayload = () => {
  const entries = entriesRef.current;
  return {
    entries: entries.map(({ photo_blob, photo_data, photo, ...rest }) => rest),
    tombstones: JSON.parse(localStorage.getItem('lifeglance-tombstones') || '{}'),
  };
};
```

### Tombstones for deleted entries with photos

When an entry with a photo is deleted, write a tombstone for the entry as usual. Delete the photo blob locally. No special sync handling is needed for the blob.

---

## `buildPayload`

```js
const buildPayload = () => ({
  entries: entriesRef.current.map(({ photo_blob, ...rest }) => rest),
  tombstones: JSON.parse(localStorage.getItem('lifeglance-tombstones') || '{}'),
});
```

---

## `buildBackupPayload`

Timer-safe version — read from localStorage only:

```js
const buildBackupPayload = () => {
  const raw = localStorage.getItem('lifeglance-entries');
  const entries = raw ? JSON.parse(raw) : [];
  return {
    entries: entries.map(({ photo_blob, ...rest }) => rest),
    tombstones: JSON.parse(localStorage.getItem('lifeglance-tombstones') || '{}'),
  };
};
```

---

## `applyPayload`

```js
const applyPayload = async (data) => {
  // Preserve local photo blobs — remote payload has metadata only
  const localEntries = entriesRef.current;
  const localBlobMap = Object.fromEntries(
    localEntries.filter(e => e.photo_blob).map(e => [e.id, e.photo_blob])
  );

  // Merge photo blobs back into applied entries
  const entries = data.entries.map(e => ({
    ...e,
    photo_blob: localBlobMap[e.id] ?? null,
  }));

  localStorage.setItem('lifeglance-entries', JSON.stringify(entries));
  localStorage.setItem('lifeglance-tombstones', JSON.stringify(data.tombstones));
  setEntries(entries);
};
```

This ensures local photo blobs are not lost when remote data is applied on the originating device (sync round-trip). On a second device that never had the photo, `localBlobMap[e.id]` will be undefined and `photo_blob` will be null — the UI should show a "no photo" state for that entry.

---

## Merge Orchestrator

```js
import { mergeArrayById, pruneTombstones } from '@glance-apps/sync';

const mergePayloads = (local, remote) => {
  const tombstones = pruneTombstones(
    { ...local.tombstones, ...remote.tombstones },
    90
  );
  return {
    entries: mergeArrayById(local.entries, remote.entries, tombstones, {
      idField: 'id',
      timestampField: 'updatedAt',
    }),
    tombstones,
  };
};
```

---

## Engine Setup

```js
import { createSyncEngine } from '@glance-apps/sync';
import { nativeHttpRequest } from './native.js';  // if lifeGLANCE has a native bridge

const engine = createSyncEngine({
  storageKeyPrefix: 'lifeglance',
  cryptoDBName: 'lifeglance-crypto',
  autoBackupDBName: 'lifeglance-auto-backups',
  syncFilename: 'lifeglance-sync.json',
  appFolderName: 'lifeglance',
  backupFilenamePrefix: 'lifeglance-backup-',
  appId: 'lifeglance',
  appName: 'lifeGLANCE',

  buildPayload,
  buildBackupPayload,
  applyPayload,
  mergePayloads,

  nativeHttpRequest,  // pass only if native HTTP bridge exists
  proxyUrl: import.meta.env.VITE_WEBDAV_PROXY_URL,

  onStatusChange: setSyncStatus,
  onError: (msg, code, isHardStop) => {
    setSyncError(msg);
    if (isHardStop) setSyncHalted(true);
  },
  onLastSyncedChange: setLastSynced,
  onPassphraseRequired: () => setShowPassphraseModal(true),
});
```

---

## CORS Proxy

Copy `api/webdav-proxy.js` from `@glance-apps/sync` into lifeGLANCE's `api/` directory. Deploy to Vercel under a lifeGLANCE-specific project.

Set `VITE_WEBDAV_PROXY_URL` in Vercel environment variables to your deployment URL.

---

## UI Components

The following components from dayGLANCE can be copied and adapted for lifeGLANCE with minimal changes:

- `CloudSyncSettingsForm.jsx` — provider config, encryption setup
- `SyncPassphraseModal.jsx` — passphrase entry
- `BackupMenuModal.jsx` / `AutoBackupSettingsForm.jsx` — backup management

These accept state/callbacks as props. Wire them to lifeGLANCE's state and the engine's `getConfig()` / `setConfig()` methods.

---

## Verification Checklist

- [ ] Entry created on Device A appears on Device B after sync
- [ ] Entry deleted on Device A is tombstoned and removed on Device B
- [ ] Photo blob is preserved on Device A after applying remote payload (not overwritten with null)
- [ ] Photo is not present in the sync file on WebDAV
- [ ] Conflict: same entry modified on two devices → later `updatedAt` wins
- [ ] Encryption: enable, reload, re-enter passphrase, verify entries decrypt
- [ ] Hard-stop error persists in UI (not auto-cleared)
- [ ] Auto-backup appears in lifeGLANCE Nextcloud folder (separate from dayGLANCE)
