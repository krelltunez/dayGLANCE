# `@glance-apps/sync` — Adapter Guide

> **Audience**: Engineers adding `@glance-apps/sync` to a new GLANCE app.
> Read `SYNC_PACKAGE_SPEC.md` first for the complete API reference.

---

## What Is an Adapter?

An adapter is the set of callbacks you pass to `createSyncEngine` that wire the engine to your app's data model:

- `buildPayload()` — reads live state and returns the cross-device sync payload
- `buildBackupPayload()` — reads storage-only state and returns the richer backup payload
- `applyPayload(data)` — writes a merged remote payload back into your app's state
- `mergePayloads(local, remote)` — merges a local snapshot with a remote payload; uses `mergeArrayById` internally
- `validateUploadPayload(payload)` / `validateApplyPayload(payload)` _(optional safety guards)_

You write these functions. The engine calls them at the right times. Everything else — HTTP routing, encryption, ETag management, retry — is handled by the package.

---

## Step 1: Define Your Payload Shape

Decide what data needs to sync across devices. Design a plain JSON object that captures it.

**Rules:**
- Every syncable item needs a **stable, globally unique ID** — a UUID, not an auto-increment integer. If your DB uses integers, add a `sync_id` UUID column and use that as the merge key.
- Every syncable item needs a **last-modified timestamp** (ISO string). This is the merge tie-breaker.
- Deletions must be represented as **tombstones** — a map of `{ id: deletedAt }` — not by absence. Items that are simply absent from a payload are *not* deleted; they are treated as "not yet seen."

**Where to store tombstones:**

- **React/localStorage apps** (dayGLANCE, lifeGLANCE): Store tombstones in localStorage under a dedicated key (e.g. `'myapp-tombstones'`). No schema migration needed; consistent with how the rest of the app stores data. Tombstones are read in `buildPayload` and written inline wherever a delete occurs.
- **Dexie/IndexedDB apps** (lastGLANCE): Store tombstones in a Dexie table. The app already has a schema migration system; a `tombstones` table fits naturally and keeps deletion + tombstone recording in a single atomic transaction.

Both approaches produce the same tombstone format in the payload (`{ id: deletedAt }`). The storage location is an implementation detail of each adapter.

```js
// Example payload shape
{
  items: [
    { id: 'uuid-...', title: 'Clean gutters', updatedAt: '2026-05-16T10:00:00Z', ... },
  ],
  categories: [
    { id: 'uuid-...', name: 'Home', updatedAt: '2026-05-16T09:00:00Z', ... },
  ],
  tombstones: {
    'uuid-deleted-item': '2026-05-15T08:00:00Z',
  }
}
```

---

## Step 2: Write `buildPayload`

Called immediately before every upload. Must return the current state of all syncable data.

**For React apps** (dayGLANCE, lifeGLANCE):

```js
// Keep a ref that always points to the latest state
const tasksRef = useRef(tasks);
useEffect(() => { tasksRef.current = tasks; });

const buildPayload = async () => ({
  items: tasksRef.current,
  tombstones: JSON.parse(localStorage.getItem('myapp-tombstones') || '{}'),
});
```

Tombstones must be read from localStorage (or IndexedDB), not React state, because tombstones are written outside the React render cycle.

**For Dexie/IndexedDB apps** (lastGLANCE):

```js
const buildPayload = async () => {
  const [items, categories, tombstones] = await Promise.all([
    db.items.toArray(),
    db.categories.toArray(),
    db.tombstones.toArray().then(rows =>
      Object.fromEntries(rows.map(r => [r.id, r.deletedAt]))
    ),
  ]);
  return { items, categories, tombstones };
};
```

---

## Step 3: Write `buildBackupPayload`

`buildBackupPayload` is a **semantically distinct** function from `buildPayload`, even if the two look similar for some apps.

- `buildPayload` returns the cross-device sync state: only data that makes sense on another device.
- `buildBackupPayload` returns a richer snapshot: sync data **plus** device-local preferences, UI settings, and any state that a restore-from-backup workflow should preserve.

Both must be **timer-safe** — called outside the React render cycle. Neither may read React state. Read from localStorage and IndexedDB only.

For React apps:

```js
const buildBackupPayload = async () => ({
  items: JSON.parse(localStorage.getItem('myapp-items') || '[]'),
  tombstones: JSON.parse(localStorage.getItem('myapp-tombstones') || '{}'),
  // These extras go in backups but not in the sync payload:
  settings: JSON.parse(localStorage.getItem('myapp-settings') || '{}'),
  uiPreferences: JSON.parse(localStorage.getItem('myapp-ui-prefs') || '{}'),
});
```

For Dexie apps, `buildBackupPayload` and `buildPayload` may share the same body if there are no device-local preferences to add. Write them as two separate named functions regardless — the distinction is part of the API contract and may diverge later.

---

## Step 4: Write `applyPayload`

Called after every successful download+merge with the merged data. Write it to your app's local state.

**For React apps:**

```js
const applyPayload = async (data) => {
  // Update localStorage first (source of truth for next buildPayload)
  localStorage.setItem('myapp-items', JSON.stringify(data.items));
  localStorage.setItem('myapp-tombstones', JSON.stringify(data.tombstones));
  // Then update React state
  setItems(data.items);
};
```

**For Dexie apps:**

```js
const applyPayload = async (data) => {
  await db.transaction('rw', db.items, db.categories, db.tombstones, async () => {
    await db.items.bulkPut(data.items);
    await db.categories.bulkPut(data.categories);
    // Write tombstones and delete tombstoned items
    for (const [id, deletedAt] of Object.entries(data.tombstones || {})) {
      await db.tombstones.put({ id, deletedAt });
      await db.items.delete(id);
    }
  });
};
```

---

## Step 5: Write `mergePayloads`

The engine does not know your data model, so it cannot merge payloads on its own. You provide `mergePayloads(local, remote) → merged` in config. The engine calls it between download and apply:

```
remote payload downloaded
       ↓
engine calls buildPayload() → local snapshot
       ↓
engine calls mergePayloads(local, remote) → merged
       ↓
engine calls applyPayload(merged)
```

Use `mergeArrayById` from the package for each syncable array:

```js
import { mergeArrayById, pruneTombstones } from '@glance-apps/sync';

const mergePayloads = (local, remote) => {
  const tombstones = pruneTombstones(
    { ...local.tombstones, ...remote.tombstones },
    90
  );
  return {
    items: mergeArrayById(
      local.items,
      remote.items,
      tombstones,
      { idField: 'id', timestampField: 'updatedAt' }
    ),
    tombstones,
  };
};
```

Pass it in config:

```js
createSyncEngine({
  // ...
  mergePayloads,
  // ...
});
```

`mergePayloads` must be synchronous. `mergeArrayById` is synchronous. If you need async lookups (e.g. Dexie FK resolution), do those in `applyPayload` instead — `mergePayloads` only decides which records win; `applyPayload` handles writing them.

---

## Step 6: Handle Nested Structures (lastGLANCE Pattern)

If your data has parent–child relationships (e.g. categories with subcategories), the sync layer should **flatten** them into two separate arrays rather than nesting them. This keeps `mergeArrayById` applicable to both arrays independently.

### The Problem

Auto-increment integer FK (`parent_category_id`) is device-local. Device A creates category with ID `3`; Device B creates a different category with ID `3`. These collide.

### The Solution: `sync_id` + `parent_sync_id`

Add `sync_id` (UUID) to every category. Add `parent_sync_id` (UUID | null) as the cross-device FK.

```sql
-- Schema migration
ALTER TABLE categories ADD COLUMN sync_id TEXT;
ALTER TABLE categories ADD COLUMN parent_sync_id TEXT;  -- stable cross-device FK
UPDATE categories SET sync_id = lower(hex(randomblob(16)));  -- backfill
```

In the payload, use `sync_id` as the merge key and `parent_sync_id` as the relationship:

```js
// Payload shape for nested categories
categories: [
  { id: 'uuid-root', name: 'Home', parentId: null, updatedAt: '...' },
  { id: 'uuid-child', name: 'Chores', parentId: 'uuid-root', updatedAt: '...' },
]
```

### Two-Pass Write in `applyPayload`

When writing categories back, write parents before children to resolve FK constraints:

```js
const applyPayload = async (data) => {
  await db.transaction('rw', db.categories, async () => {
    // Pass 1: write all categories (set parent_sync_id)
    await db.categories.bulkPut(data.categories);

    // Pass 2: resolve parent_sync_id → local parent_category_id
    for (const cat of data.categories) {
      if (cat.parentId) {
        const parent = await db.categories.where('sync_id').equals(cat.parentId).first();
        if (parent) {
          await db.categories.update(cat.id, { parent_category_id: parent.local_id });
        }
        // If parent not found (tombstoned): promote to root (don't delete)
      }
    }
  });
};
```

**Orphan rule**: If a parent category is tombstoned but a child still exists (was modified after the tombstone), the child is **promoted to root** (set `parent_sync_id = null`), not deleted. Deletion-of-a-deletion is not a sync concern.

---

## Step 7: Exclude Binary Data (lifeGLANCE Pattern)

Photos are **not synced**. Photo data — blob and metadata — is stripped at the adapter boundary before upload. On a second device, an entry with a photo will arrive with no photo attached; the UI must handle this gracefully (show a placeholder, not an error).

Strip all photo fields in `buildPayload`:

```js
const buildPayload = async () => {
  const entries = entriesRef.current;
  return {
    // Strip all photo data — neither blob nor metadata crosses device boundaries
    entries: entries.map(({ photo_blob, photo, photo_data, ...rest }) => rest),
    tombstones: JSON.parse(localStorage.getItem('lifeglance-tombstones') || '{}'),
  };
};
```

In `applyPayload`, re-attach the local blob so it isn't lost on the originating device during a sync round-trip:

```js
const applyPayload = async (data) => {
  const localBlobMap = Object.fromEntries(
    entriesRef.current.filter(e => e.photo_blob).map(e => [e.id, e.photo_blob])
  );
  const entries = data.entries.map(e => ({
    ...e,
    photo_blob: localBlobMap[e.id] ?? null,
  }));
  localStorage.setItem('myapp-entries', JSON.stringify(entries));
  setEntries(entries);
};
```

This re-attachment is purely local — it does not affect the sync file or the other device.

---

## Step 8: Wire Up the Engine

```js
import { createSyncEngine } from '@glance-apps/sync';

const engine = createSyncEngine({
  storageKeyPrefix: 'myapp',
  cryptoDBName: 'myapp-crypto',
  autoBackupDBName: 'myapp-auto-backups',
  syncFilename: 'myapp-sync.json',
  appFolderName: 'myapp',
  backupFilenamePrefix: 'myapp-backup-',
  appId: 'myapp',
  appName: 'myApp',

  buildPayload,
  buildBackupPayload,
  applyPayload,
  mergePayloads: mergeRemoteWithLocal,

  // Optional bridges — provide whichever apply to your platform
  nativeHttpRequest: window.MyAppNative?.httpRequest ?? undefined,
  proxyUrl: 'https://myapp-webdav.vercel.app',

  onStatusChange: (status) => setSyncStatus(status),
  onError: (msg, code, isHardStop) => {
    setSyncError(msg);
    if (isHardStop) setSyncHalted(true);  // don't auto-clear
  },
  onLastSyncedChange: (ts) => setLastSynced(ts),
  onPassphraseRequired: () => setShowPassphrasePrompt(true),
});
```

---

## Step 9: Deploy the CORS Proxy

The `api/webdav-proxy.js` file from the package is a Vercel serverless function. Copy it into your app's `api/` directory and deploy to Vercel.

Each app must deploy its own proxy. Do not share a proxy across apps — the proxy forwards credentials and must be under the app's own domain/token scope.

```
my-app/
└── api/
    └── webdav-proxy.js   ← copied from @glance-apps/sync/api/webdav-proxy.js
```

Set `proxyUrl` in the engine config to your Vercel deployment URL.

---

## Checklist: New App Onboarding

- [ ] Every syncable item has a UUID `id` (not an auto-increment integer)
- [ ] Every syncable item has an `updatedAt` ISO string timestamp
- [ ] Deletions are recorded as tombstones, not just removed from state
- [ ] `buildPayload` reads live state (React refs or IndexedDB)
- [ ] `buildBackupPayload` is timer-safe (no React state); written as a separate function even if the body currently matches `buildPayload`
- [ ] `applyPayload` writes both storage and UI state
- [ ] `mergePayloads` is implemented using `mergeArrayById` and is synchronous
- [ ] Nested FK relationships use `sync_id` / `parent_sync_id`, not integer PKs
- [ ] Binary blobs are excluded from the payload
- [ ] CORS proxy deployed to Vercel
- [ ] Hard-stop errors are not auto-cleared in the UI
- [ ] Passphrase prompt wired to `onPassphraseRequired`
