# lastGLANCE — `@glance-apps/sync` Integration Guide

> **Note**: This document lives in the dayGLANCE repo temporarily (alongside the package spec).
> **Transfer this file to the lastGLANCE repository** before integration work begins.
> Suggested path: `docs/SYNC_INTEGRATION.md`

---

## Overview

lastGLANCE is a TypeScript + React + Dexie (IndexedDB) app that tracks recurring chores ("last done" tracker). It has no existing sync infrastructure.

Key differences from dayGLANCE that affect the integration:

| Concern | dayGLANCE | lastGLANCE |
|---|---|---|
| Language | JavaScript | **TypeScript** |
| Storage | localStorage + React state | **Dexie (IndexedDB)** |
| IDs | Already UUIDs | **Auto-increment integers** (migration required) |
| Structure | Flat arrays | **Nested categories** (subcategories via `parent_category_id`) |
| Sync history | Has existing sync infra | **Starting fresh** |

---

## lastGLANCE Config Values

```ts
{
  storageKeyPrefix: 'lastglance',
  cryptoDBName: 'lastglance-crypto',
  autoBackupDBName: 'lastglance-auto-backups',
  syncFilename: 'lastglance-sync.json',
  appFolderName: 'lastglance',
  backupFilenamePrefix: 'lastglance-backup-',
  appId: 'lastglance',
  appName: 'lastGLANCE',
}
```

---

## Step 1: ID Migration (Required)

lastGLANCE uses auto-increment integers as primary keys. These cannot cross device boundaries — two devices will independently generate ID `3` and collide.

**Add `sync_id` (UUID) to every syncable table.**

### Dexie Schema Migration

```ts
// db.ts
import Dexie from 'dexie';
import { v4 as uuidv4 } from 'uuid';

class LastGlanceDB extends Dexie {
  items!: Dexie.Table<Item, number>;
  categories!: Dexie.Table<Category, number>;
  tombstones!: Dexie.Table<Tombstone, string>;

  constructor() {
    super('lastglance');

    // Existing schema (version 1-4 as currently defined)
    // ...

    // New version: add sync fields
    this.version(5).stores({
      items: '++id, sync_id, category_id, updatedAt',
      categories: '++id, sync_id, parent_category_id, parent_sync_id, updatedAt',
      tombstones: 'id, deletedAt',  // id is the sync_id of the deleted record
    }).upgrade(async tx => {
      // Backfill sync_id for existing items
      await tx.table('items').toCollection().modify(item => {
        if (!item.sync_id) item.sync_id = uuidv4();
        if (!item.updatedAt) item.updatedAt = item.lastDone || new Date().toISOString();
      });

      // Backfill sync_id and parent_sync_id for categories
      const cats = await tx.table('categories').toArray();
      const catById = Object.fromEntries(cats.map(c => [c.id, c]));

      await tx.table('categories').toCollection().modify(cat => {
        if (!cat.sync_id) cat.sync_id = uuidv4();
        if (!cat.updatedAt) cat.updatedAt = new Date().toISOString();
      });

      // Second pass: resolve parent_sync_id from parent_category_id
      // (categories must have sync_ids before we can set parent_sync_id)
      const catsWithSyncId = await tx.table('categories').toArray();
      const catBySyncId = Object.fromEntries(catsWithSyncId.map(c => [c.id, c]));

      await tx.table('categories').toCollection().modify(cat => {
        if (cat.parent_category_id) {
          const parent = catBySyncId[cat.parent_category_id];
          cat.parent_sync_id = parent?.sync_id ?? null;
        } else {
          cat.parent_sync_id = null;
        }
      });
    });
  }
}

export const db = new LastGlanceDB();
```

---

## Step 2: TypeScript Types

```ts
// types/sync.ts

export interface SyncItem {
  id: string;           // sync_id (UUID) — used as merge key
  local_id?: number;    // local Dexie PK (not in payload)
  title: string;
  notes?: string;
  lastDone: string | null;  // ISO string
  updatedAt: string;        // ISO string — merge timestamp
  category_id?: string;     // sync_id of parent category
}

export interface SyncCategory {
  id: string;           // sync_id (UUID)
  local_id?: number;    // local Dexie PK (not in payload)
  name: string;
  parentId: string | null;  // sync_id of parent category
  updatedAt: string;
}

export interface SyncPayload {
  items: SyncItem[];
  categories: SyncCategory[];
  tombstones: Record<string, string>;  // sync_id → deletedAt ISO string
}
```

---

## Step 3: `buildPayload`

Read from Dexie. Map local integer PKs to `sync_id` for the payload.

```ts
import { db } from './db';

const buildPayload = async (): Promise<SyncPayload> => {
  const [items, categories, tombstoneRows] = await Promise.all([
    db.items.toArray(),
    db.categories.toArray(),
    db.tombstones.toArray(),
  ]);

  const tombstones = Object.fromEntries(
    tombstoneRows.map(t => [t.id, t.deletedAt])
  );

  return {
    items: items.map(item => ({
      id: item.sync_id,
      title: item.title,
      notes: item.notes,
      lastDone: item.lastDone,
      updatedAt: item.updatedAt,
      category_id: item.category_sync_id ?? null,  // stable cross-device FK
    })),
    categories: categories.map(cat => ({
      id: cat.sync_id,
      name: cat.name,
      parentId: cat.parent_sync_id,
      updatedAt: cat.updatedAt,
    })),
    tombstones,
  };
};
```

---

## Step 4: `buildBackupPayload`

Identical to `buildPayload` for Dexie apps — both read from IndexedDB. No React state involved.

```ts
const buildBackupPayload = buildPayload;
```

---

## Step 5: Merge Orchestrator

```ts
import { mergeArrayById, pruneTombstones } from '@glance-apps/sync';

const mergePayloads = (local: SyncPayload, remote: SyncPayload): SyncPayload => {
  const tombstones = pruneTombstones(
    { ...local.tombstones, ...remote.tombstones },
    90
  );

  return {
    items: mergeArrayById(local.items, remote.items, tombstones, {
      idField: 'id',
      timestampField: 'updatedAt',
    }) as SyncItem[],

    categories: mergeArrayById(local.categories, remote.categories, tombstones, {
      idField: 'id',
      timestampField: 'updatedAt',
    }) as SyncCategory[],

    tombstones,
  };
};
```

---

## Step 6: `applyPayload` — Two-Pass Write

The key challenge: the payload uses `sync_id` / `parent_sync_id` for categories, but Dexie uses integer PKs with `parent_category_id`. A two-pass write resolves this.

```ts
const applyPayload = async (data: SyncPayload): Promise<void> => {
  await db.transaction('rw', db.items, db.categories, db.tombstones, async () => {

    // ── CATEGORIES ──

    // Pass 1: Write all categories (upsert by sync_id)
    for (const cat of data.categories) {
      // Skip tombstoned categories
      if (data.tombstones[cat.id]) continue;

      const existing = await db.categories.where('sync_id').equals(cat.id).first();
      if (existing) {
        await db.categories.update(existing.id, {
          name: cat.name,
          parent_sync_id: cat.parentId,
          updatedAt: cat.updatedAt,
        });
      } else {
        await db.categories.add({
          sync_id: cat.id,
          name: cat.name,
          parent_sync_id: cat.parentId,
          parent_category_id: null,  // resolved in pass 2
          updatedAt: cat.updatedAt,
        });
      }
    }

    // Pass 2: Resolve parent_sync_id → local parent_category_id
    for (const cat of data.categories) {
      if (!cat.parentId) continue;

      const parent = await db.categories.where('sync_id').equals(cat.parentId).first();
      const child = await db.categories.where('sync_id').equals(cat.id).first();

      if (child) {
        if (parent) {
          await db.categories.update(child.id, { parent_category_id: parent.id });
        } else {
          // Parent is tombstoned — promote child to root
          await db.categories.update(child.id, {
            parent_category_id: null,
            parent_sync_id: null,
          });
        }
      }
    }

    // Delete tombstoned categories (after resolving their children)
    for (const [syncId, deletedAt] of Object.entries(data.tombstones)) {
      const cat = await db.categories.where('sync_id').equals(syncId).first();
      if (cat) await db.categories.delete(cat.id);
    }

    // ── ITEMS ──

    for (const item of data.items) {
      // Skip tombstoned items
      if (data.tombstones[item.id]) continue;

      // Resolve category_id (sync_id → local integer id)
      let category_id: number | null = null;
      if (item.category_id) {
        const cat = await db.categories.where('sync_id').equals(item.category_id).first();
        category_id = cat?.id ?? null;
      }

      const existing = await db.items.where('sync_id').equals(item.id).first();
      if (existing) {
        await db.items.update(existing.id, {
          title: item.title,
          notes: item.notes,
          lastDone: item.lastDone,
          updatedAt: item.updatedAt,
          category_id,
          category_sync_id: item.category_id,
        });
      } else {
        await db.items.add({
          sync_id: item.id,
          title: item.title,
          notes: item.notes,
          lastDone: item.lastDone,
          updatedAt: item.updatedAt,
          category_id,
          category_sync_id: item.category_id,
        });
      }
    }

    // Delete tombstoned items
    for (const [syncId, _] of Object.entries(data.tombstones)) {
      const item = await db.items.where('sync_id').equals(syncId).first();
      if (item) await db.items.delete(item.id);
    }

    // ── TOMBSTONES ──

    // Persist tombstones to local DB (for future buildPayload calls)
    await db.tombstones.bulkPut(
      Object.entries(data.tombstones).map(([id, deletedAt]) => ({ id, deletedAt }))
    );
  });
};
```

### Orphan Promotion Rule

When a parent category is tombstoned but a child category still exists (it was modified after the parent's `deletedAt`), the child is **promoted to root** — `parent_category_id` and `parent_sync_id` are set to `null`. It is never deleted just because its parent was.

The merge engine (`mergeArrayById`) handles this correctly: if the child's `updatedAt` is later than the tombstone timestamp for the parent, the child survives the merge. The `applyPayload` two-pass write above implements the promotion.

---

## Step 7: Tombstone Recording

When a user deletes an item or category in lastGLANCE, write a tombstone:

```ts
const deleteItem = async (item: Item) => {
  await db.transaction('rw', db.items, db.tombstones, async () => {
    await db.items.delete(item.id);
    await db.tombstones.put({
      id: item.sync_id,  // use sync_id as the tombstone key
      deletedAt: new Date().toISOString(),
    });
  });
  // Trigger a sync
  engineRef.current?.sync();
};
```

---

## Step 8: Engine Setup

```ts
import { createSyncEngine } from '@glance-apps/sync';

const engine = createSyncEngine({
  storageKeyPrefix: 'lastglance',
  cryptoDBName: 'lastglance-crypto',
  autoBackupDBName: 'lastglance-auto-backups',
  syncFilename: 'lastglance-sync.json',
  appFolderName: 'lastglance',
  backupFilenamePrefix: 'lastglance-backup-',
  appId: 'lastglance',
  appName: 'lastGLANCE',

  buildPayload,
  buildBackupPayload,
  applyPayload,
  mergePayloads,

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

## Step 9: TypeScript Configuration

`@glance-apps/sync` ships with `types/index.d.ts`. Ensure `tsconfig.json` allows module resolution:

```json
{
  "compilerOptions": {
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  }
}
```

Verify no type errors: `tsc --noEmit`.

---

## CORS Proxy

Copy `api/webdav-proxy.js` from `@glance-apps/sync` into lastGLANCE's `api/` directory. Deploy to Vercel under a lastGLANCE-specific project.

If lastGLANCE doesn't currently use Vercel, the proxy is a single serverless function and requires no framework integration — it can be deployed as a standalone Vercel project from the `api/` directory alone.

---

## Verification Checklist

- [ ] Dexie migration runs cleanly on existing data (`sync_id` backfilled for all records)
- [ ] `parent_sync_id` backfilled correctly for categories with parents
- [ ] Item created on Device A appears on Device B after sync
- [ ] Item deleted on Device A is tombstoned and removed on Device B
- [ ] Category created on Device A appears on Device B with correct parent relationship
- [ ] Nested category: parent deleted on Device A → child promoted to root on Device B (not deleted)
- [ ] Conflict: same item modified on two devices → later `updatedAt` wins
- [ ] Encryption round-trip works
- [ ] Hard-stop error (`appId` mismatch) persists in UI
- [ ] TypeScript: `tsc --noEmit` passes with zero errors
- [ ] Auto-backup appears in WebDAV folder separate from dayGLANCE and lifeGLANCE
