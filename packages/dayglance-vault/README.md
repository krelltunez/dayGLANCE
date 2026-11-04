# @glance-apps/dayglance-vault

dayGLANCE's **GLANCEvault data adapter**: how dayGLANCE's synced data maps to
vault rows, and how a pulled row is merged into it. Extracted from the
dayGLANCE app (#2280) so that every GLANCEvault client of dayGLANCE's data, the
app on each device and a host the user runs, applies rows with one copy of
the rules. A second copy would drift, and drift between devices is exactly
what these rules exist to prevent.

With the adapter come the merge and retention rules it applies that the
app's file tier (WebDAV, iCloud, Direct Access) applies too, so each rule
still exists in one place: tombstone retention, the day-window map, recurring
exceptions, and the merges of `deferrals`, `planTrail`, `createdAt`,
`retiredTaskIds`, habit logs, routine completions, `completedDates` and the
JOBO ledger's pick.

Plain ESM JavaScript for Node 20+ and the browser, with hand-written types in
`types/`. No storage, no React, no browser globals: the engine, its
bookkeeping and the device's guards are the caller's.

## Running it against the engine

`@glance-apps/sync`'s `createDbSyncEngine` is data-shape agnostic: it calls
five data callbacks. `vaultEngineCallbacks(getData, markDirty)` builds them
over a data object (the sync payload's `.data`):

```js
import { createDbSyncEngine } from '@glance-apps/sync';
import {
  vaultEngineCallbacks, reconcileCrossList, pruneAllTombstones, tombstoneCutoff, reassembleState,
} from '@glance-apps/dayglance-vault';

const data = {}; // a host starting empty; the app passes its per-cycle mirror
const engine = createDbSyncEngine({
  storageKeyPrefix, appId: 'dayglance', accountId, vaultUrl, vaultToken, deviceId,
  storage, nativeGetSyncKey, nativeStoreSyncKey,     // see @glance-apps/sync's README
  ...vaultEngineCallbacks(() => data, (id) => engine.markDirty(id)),
});

await engine.pullRemoteChanges();
// After a pull, as the app's wrapper does every cycle: one copy of a task
// live under two lists, and tombstones aged out at the fixed window.
reconcileCrossList(data, (id) => engine.markDirty(id));
pruneAllTombstones(data, tombstoneCutoff());
```

`data` then holds the slices under their payload names (`tasks`,
`recurringTasks`, `goals`, `dailyNotes`, ...), ready for
`@glance-apps/dayglance-mcp`'s `buildMcpReadState`. The app's wrapper
(`src/sync/dbEngine.js`) builds its callbacks from the same function and wraps
the apply and the delete in its own guards.

`@glance-apps/sync` is a peer dependency: the engine keeps the root key and
the vault client's brake in module state, so the adapter and the engine must
share one copy.

## API

| Module | Exports |
| --- | --- |
| `adapter.js` | Rows: `shredState(data)`, `reassembleState(rows)`, `getLocalEntity(data, entityId)`, `applyRemoteEntity(data, entity)` (merges in place, returns entityIds to re-push), `applyRemoteDelete(data, entityId)`, `reconcileCrossList(data, onLoser, onCollision, shouldSuppress)`. The engine's predicates: `isInsertOnly`, `getEntityLastModified`, `entityKind`, `makeEntityId`. Not-loaded-is-not-empty: `absentCollectionKinds`, `carryAbsentCollections`. `isDeviceLocalBundle`. The row model: `COLLECTION_KINDS`, `TASK_KINDS`, `CROSS_LIST_PRIORITY`, `DATE_MAP_KIND`, `SINGLETON_KIND`, `BUNDLE_OWNS`, `TOMBSTONE_BUNDLES`. |
| `engineCallbacks.js` | `vaultEngineCallbacks(getData, markDirty)`. |
| `tombstoneRetention.js`, `tombstoneHorizon.js` | The fixed tombstone window both tiers prune at: `TOMBSTONE_RETENTION_DAYS`, `COMPLETED_UID_RETENTION_DAYS`, `TOMBSTONE_BUNDLE_KEYS`, `tombstoneCutoff`, `completedUidCutoff`, `pruneAllTombstones`, `pruneTombstoneMap`, `pruneCompletedTaskUids`, `unionNewerIso`, `floorToUtcDayIso`, `tombstoneHorizon`. |
| `dayWindowSync.js` | The day-window map: `migrateDayWindows`, `mergeDayWindowMaps`, `dayWindowMapsEqual`, `resolveDayWindow`, `DAY_WINDOWS_STORAGE_KEY`, `DEFAULTS_KEY`. |
| `recurringExceptions.js` | A series' occurrence edits, merged per date: `mergeExceptions`, `withMergedExceptions`, `sameOccurrenceEdits`, and the save pass's `stampExceptionDates`, `stampExceptionChanges`, `applyExceptionStamps`. |
| `merges.js` | `mergeHabitLogs`, `mergeRoutineCompletions`, `mergeCompletedDates`. |
| `deferrals.js`, `planTrail.js`, `createdAt.js`, `retiredTaskIds.js`, `jobo.js` | `mergeDeferrals`; `mergePlanTrail`, `sameTrail`, `TRAIL_CAP`; `earlierCreatedAt`; `mergeRetiredTaskIds`, `pruneRetiredTaskIds`; `pickJoboRecord`. The rest of each rule (what a deferral is, recording a stop, stamping `createdAt`, recording a retirement, the JOBO record rules) stays in the app module of the same name, which imports these back. A few helpers those modules share are exported from the module files only, not from the package root. |

Where each piece came from is recorded in `docs/mcp-vault-host.md` in the
dayGLANCE repository.
