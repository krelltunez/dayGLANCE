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

And the client for the vault's `/events` change nudges, so a host pulls
within a moment of another device's push, as the app does: the
fetch-streaming reader, the reconnecting client, the nudge coalescer, and the
own-write ack registry that keeps a device's own pushes from waking it.

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
share one copy. So is `@glance-apps/obsidian-format`, whose SSE frame parser
the event client reads the stream with. And `@glance-apps/agenda-core`, whose
`planTrailStops` says what counts as a recorded plan-trail stop: the trail
merge cleans with it, and every reader of the trail counts with it.

## Change nudges

The vault's `GET /events` stream nudges a client whenever the account's seq
advances (the wire contract is at the top of `src/vaultEvents.js`). A nudge
only adds a prompt pull on top of a poll the caller keeps:

```js
import { createDbSyncEngine, createVaultClient } from '@glance-apps/sync';
import {
  openWebSseStream, createVaultEventClient, createNudgeCoalescer, createKindFilter,
  withOwnAckRecording, isOwnWriteSeq,
} from '@glance-apps/dayglance-vault';

const engine = createDbSyncEngine({ ...config,
  // Record every write's ack, so the nudge each one causes is known as ours.
  vaultClient: withOwnAckRecording(createVaultClient({ vaultUrl, vaultToken })) });

const coalescer = createNudgeCoalescer({
  kinds: ['sync'],
  kindFilter: createKindFilter({ sync: 'dayglance' }), // only dayGLANCE's rows wake it
  isOwnSeq: isOwnWriteSeq,                              // our own echo wakes nothing
  onDrain: () => runCycle(), // pull, reconcileCrossList, pruneAllTombstones, push; one at a time
});

const events = createVaultEventClient({
  getConnection: () => ({ vaultUrl, vaultToken, accountId }),
  openStream: openWebSseStream, // globalThis.fetch: browsers, Electron, Node 20+
  onEvent: coalescer.handleEvent,
});
events.start();
// shutdown: events.stop(); coalescer.cancel();
```

The client reconnects with capped, jittered exponential backoff, and each
connection's `ready` frame reconciles anything missed while it was down. It
treats a 401 like any failure and keeps backing off (the error's message
names the status); a caller that wants to give up on a revoked token stops
it from `onStateChange`.

## API

| Module | Exports |
| --- | --- |
| `adapter.js` | Rows: `shredState(data)`, `reassembleState(rows)`, `getLocalEntity(data, entityId)`, `applyRemoteEntity(data, entity)` (merges in place, returns entityIds to re-push), `applyRemoteDelete(data, entityId)`, `reconcileCrossList(data, onLoser, onCollision, shouldSuppress)`. The engine's predicates: `isInsertOnly`, `getEntityLastModified`, `entityKind`, `makeEntityId`. Not-loaded-is-not-empty: `absentCollectionKinds`, `carryAbsentCollections`. `isDeviceLocalBundle`. The row model: `COLLECTION_KINDS`, `TASK_KINDS`, `CROSS_LIST_PRIORITY`, `DATE_MAP_KIND`, `SINGLETON_KIND`, `BUNDLE_OWNS`, `TOMBSTONE_BUNDLES`. |
| `engineCallbacks.js` | `vaultEngineCallbacks(getData, markDirty)`. |
| `tombstoneRetention.js`, `tombstoneHorizon.js` | The fixed tombstone window both tiers prune at: `TOMBSTONE_RETENTION_DAYS`, `COMPLETED_UID_RETENTION_DAYS`, `TOMBSTONE_BUNDLE_KEYS`, `tombstoneCutoff`, `completedUidCutoff`, `pruneAllTombstones`, `pruneTombstoneMap`, `pruneCompletedTaskUids`, `unionNewerIso`, `floorToUtcDayIso`, `tombstoneHorizon`. |
| `dayWindowSync.js` | The day-window map: `migrateDayWindows`, `mergeDayWindowMaps`, `dayWindowMapsEqual`, `resolveDayWindow`, `DAY_WINDOWS_STORAGE_KEY`, `DEFAULTS_KEY`. |
| `recurringExceptions.js` | A series' occurrence edits, merged per date: `mergeExceptions`, `withMergedExceptions`, `sameOccurrenceEdits`, and the save pass's `stampExceptionDates`, `stampExceptionChanges`, `applyExceptionStamps`. |
| `merges.js` | `mergeHabitLogs`, `mergeRoutineCompletions`, `mergeCompletedDates`. |
| `vaultEvents.js` | The `/events` client: `openWebSseStream`, `createVaultEventClient`, `createNudgeCoalescer`, `createKindFilter`, `backoffDelayMs`. |
| `ownWrites.js` | The own-write ack registry (module state, one per process): `recordOwnWriteSeq`, `isOwnWriteSeq`, `withOwnAckRecording`, `OWN_ACK_TTL_MS`. |
| `deferrals.js`, `planTrail.js`, `createdAt.js`, `retiredTaskIds.js`, `jobo.js` | `mergeDeferrals`; `mergePlanTrail`, `sameTrail`, `TRAIL_CAP`; `earlierCreatedAt`; `mergeRetiredTaskIds`, `pruneRetiredTaskIds`; `pickJoboRecord`. The rest of each rule (what a deferral is, recording a stop, stamping `createdAt`, recording a retirement, the JOBO record rules) stays in the app module of the same name, which imports these back. A few helpers those modules share are exported from the module files only, not from the package root. |

Where each piece came from is recorded in `docs/mcp-vault-host.md` in the
dayGLANCE repository.
