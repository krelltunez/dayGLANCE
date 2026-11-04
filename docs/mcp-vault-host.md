# GLANCEvault MCP host: design note

**Status:** Draft, for the extraction work that precedes a prototype. Step 1 (the host kit), step 2 (`@glance-apps/sync` 2.4.0) and step 3 (3a: the read side's tools, read model and state; 3b: rows to slices) are done.
**Issue:** #2280. **Spec:** `docs/mcp-server-spec.md` §4.4 (r7).

## Decisions so far

- **GLANCEvault only.** The `/events` stream keeps reads current; per-row encryption and cursor pulls mean the host never reads and merges a whole file. The file tier (WebDAV, iCloud, Direct Access) gets no MCP host and is left as it is.
- **The host is a device, not a server feature.** A process the user runs, on a machine they control, with their passphrase. It enrolls like any device, pulls, decrypts locally, and pushes timestamped rows. GLANCEvault never holds a key, opt-in or not.
- **A separate component.** Its own repository and package. Neither the PWA Docker image nor the GLANCEvault server gains it.
- **Shared code, not copied code.** The host is built on packages extracted from this repo first. A second copy of the merge, the stamping rules or the read model would drift, and drift between devices is the failure §3.1 of the spec exists to prevent.
- **Read-only first.** Writes come later, with the desktop server's safety parity: consent tiers, write journal with undo, rate limit, kill switch.

## Shape

```
 MCP client ──HTTP──▶ MCP host (user's machine)            GLANCEvault (ciphertext only)
                      ├─ host kit: auth, Host/Origin, rate      ▲        │
                      │  limit, journal, idempotency, paging    │ push   │ /events nudge
                      ├─ dayGLANCE tools (same schemas as       │        ▼
                      │  docs/mcp-tools-reference.md)          vault engine: pull rows → decrypt
                      ├─ bridge: read model over local state ◀─ reassemble into slices
                      └─ local store: sync cursors, key, rows
```

The seam already exists. The desktop server's tools talk to a `RendererBridge` (`electron/mcpRendererBridge.ts`): `request(method, params)` resolves to `{ ok, data } | { ok: false, error }`. Electron answers it over IPC from live React state (`src/hooks/useMcpBridge.js`); the host answers it from its own reassembled copy, through the same `handleMcpRequest` (and later `handleMcpWrite`).

## What has to move, and what is in the way

### 1. The MCP host kit (generic; also for lastGLANCE)

**Done:** `packages/mcp-host`, published as `@glance-apps/mcp-host` (see its
README for the API). The Electron server runs on it with no behaviour change;
`electron/mcpServer.transport.test.ts` is unchanged in what it asserts, and
`electron/mcpServer.listener.test.ts` pins the log lines, realm and localhost
guards the server had before. Where the code said otherwise than the table
below:

- `mcpAuth`: the 401's realm was dayGLANCE's; it is now an argument (the
  listener's `realm`, default `<name> MCP`).
- `mcpPort`: the default port (7893) and the "dayGLANCE will not scan" wording
  were dayGLANCE's. The kit takes `defaultPort` and `appName`; `electron/mcpPort.ts`
  keeps 7893 and the one-argument functions main.ts calls.
- `mcpPagination`: the cursor prefix `dgc1.` was dayGLANCE's. The kit takes a
  `cursorPrefix` (default `mhc1.`); the read tools pass `dgc1.`, so cursors are
  byte-identical.
- `mcpJournal`: the undo op union, `undoGroupKey` and the recurring-date label
  are dayGLANCE's, not just the tray helpers. The kit's journal is generic over
  the op and takes a `groupKey` (and optional `groupLabel`); `electron/mcpJournal.ts`
  keeps the vocabulary, the grouping, and `journalGroups` / `journalSnapshot`
  bound to it.
- `mcpLocalTime`: `validateDurationMinutes` (the block bounds and the
  `duration_minutes` argument) stays in Electron.
- `RendererBridge`: the kit's types are `HostBridge` and `BridgeResult`. The
  `renderer_unavailable` code and its message stay with the Electron
  implementation; the tool contract (`docs/mcp-tools-reference.md`) still names it.

From `electron/` (line counts without tests), as planned:

| Module | Lines | Verdict |
|---|---|---|
| `mcpAuth.ts` | 92 | Generic. Bearer token, constant-time compare. |
| `mcpPort.ts` | 78 | Generic. |
| `mcpRateLimit.ts`, `mcpWriteGate.ts` | 79, 74 | Generic. |
| `mcpIdempotency.ts` | 99 | Generic store; `deterministicTaskIdFromSeed` is the one dayGLANCE-flavoured export and can stay with the tools. |
| `mcpPagination.ts` | 113 | Generic. |
| `mcpJournal.ts` | 263 | Generic journal and undo plan. `mcpIndicator` and `composeTrayTitle` are desktop tray concerns and stay in Electron. |
| `mcpDates.ts`, `mcpLocalTime.ts` | 72, 101 | Generic date and local-time validation. |
| `mcpServer.ts` | 165 | Split. The listener and its guard order (path → Host → Origin → token) are the kit; registering dayGLANCE's tools is not. |
| `mcpRendererBridge.ts` | 121 | Stays in Electron. The `RendererBridge` *type* moves to the kit. |
| `mcpDesktopConfig.ts`, `mcpDesktopSetup.ts`, `mcpDiscovery.ts` | 199, 90, 49 | Stay in Electron (client config writing and token discovery). |

**One real change for a network host:** the listener uses the SDK's `localhostHostValidation` / `localhostOriginValidation`. A host on a LAN box or behind a reverse proxy is reached by name, so the kit takes a configured Host allowlist (localhost stays the default) and the Electron server keeps passing the localhost one. TLS is the reverse proxy's job; the kit should refuse a non-loopback bind without a token configured. **Done as:** `startMcpListener({ host, allowedHosts, allowedOrigins })`, both lists defaulting to the SDK's localhost guards; a token is required on every bind, and a non-loopback one without it gets its own refusal. The Electron server passes neither list.

### 2. The vault engine under Node (`@glance-apps/sync`, glance-sync repository)

**Done in 2.4.0**, as planned below (its README: "Running the vault engine
under Node"). dayGLANCE and the Obsidian plugin use 2.4.0 and pass no
`storage`, so their keys stay in localStorage.

Everything is `fetch` and Web Crypto, both present in Node 20+. Two things are browser-bound:

- **Sync bookkeeping in `localStorage`.** `dbEngine.js` reads and writes `globalThis.localStorage` directly for: the device id (`getOrCreateDeviceId`), `-db-sync-config`, `-db-sync-hwm` (pull cursor), `-db-sync-push-ack`, `-db-sync-dirty`, `-db-sync-last-synced`, `-db-sync-quarantine`, `-db-sync-credential-halt` and `-vault-credential`. Change: `createDbSyncEngine({ storage })`, a synchronous `{ getItem, setItem, removeItem }` defaulting to `globalThis.localStorage`, threaded through `getOrCreateDeviceId` too. It must stay synchronous and durable on return (the dirty set and cursors are written before the request that depends on them); a host backs it with a small file store that writes atomically.
- **The root key in IndexedDB.** `dbCrypto.js` stores the derived root key in IndexedDB unless `nativeGetSyncKey` / `nativeStoreSyncKey` are supplied. Those hooks, added for the native shells, are already the seam: the host supplies them (OS keyring, or a 0600 file), or re-derives from the passphrase at start. No package change needed beyond documenting it.

Note that the root key is module state (`_rootKey`): one account per process. Fine for a personal host; worth stating.

### 3. The dayGLANCE read path (this repo)

**3a done:** `packages/dayglance-mcp`, published as `@glance-apps/dayglance-mcp`
(see its README). The Electron server registers the package's read tools and
resources with no behaviour change: the registered tool and resource list
(names, descriptions, input schemas) is byte-identical, and
`electron/mcpServer.transport.test.ts` changed only an import. A host answers
the same surface from its own copy of the slices through the same code;
`packages/dayglance-mcp/test/host.test.js` does exactly that in plain Node, on
the kit's listener, with no `window`, `document`, `localStorage` or
`indexedDB`.

What moved where:

| Was | Now |
|---|---|
| `electron/mcpReadTools.ts`, `mcpResources.ts`, `mcpInboxFilter.ts` | `packages/dayglance-mcp/src/readTools.js`, `resources.js`, `inboxFilter.js` (TypeScript ported to JavaScript; types in `types/index.d.ts`) |
| `src/utils/mcpReadModel.js`, `mcpFrames.js`, `mcpRepeat.js` | `packages/dayglance-mcp/src/readModel.js`, `frames.js`, `repeat.js` |
| `wireStamp` (`src/utils/taskMetadata.js`) | `packages/dayglance-mcp/src/wireStamp.js` |
| App.jsx's inline `useMcpBridge({...})` state | `buildMcpReadState` (`packages/dayglance-mcp/src/readState.js`), called by App.jsx in a memo |
| `src/utils/bucketList.js`, `frameInstances.js`, `dayOccupancy.js`, `userScope.js` | `packages/agenda-core/src/` (same names) |
| `src/utils/mcpRoutines.js` | `packages/agenda-core/src/routineBlocks.js` (the occupancy model is built on it) |
| `parseStamp` (`taskMetadata.js`); `noteDisplayName`, `noteLinkOf` (`obsidianProjectNotes.js`) | `packages/agenda-core/src/stamps.js`, `noteLink.js` |

`src/utils/bucketList.js` and `dayOccupancy.js` stay as one-line re-exports for
their many importers; `obsidianProjectNotes.js` re-exports the two link
functions and `taskMetadata.js` imports `parseStamp`. Everything else that
imported a moved module imports the package. The write tools (`mcpWriteTools.ts`,
`mcp*Args.ts`), the write model and `mcpNoteDescriptions.js` stay in the app.
The host kit gained `localMinutesOf` beside `localDateOf`, the wall clock in a
zone; the read model reaches both through `@glance-apps/mcp-host/src/dates.js`,
since the kit's root also loads the HTTP listener, which a browser bundle
cannot.

**3b done:** `packages/dayglance-vault`, published as
`@glance-apps/dayglance-vault` (see its README): how dayGLANCE's data maps to
vault rows and how a pulled row merges in. The app's engine wiring and the
file tier import it; every existing sync test passes with only its imports
changed. Its own name rather than a part of `dayglance-mcp`: the app's sync is
not MCP, and the file tier shares half of it.

What moved where (verbatim; the app modules that kept the rest of a rule
import the moved part back, so each rule exists once):

| Was | Now |
|---|---|
| `src/sync/dbAdapter.js` (whole) | `packages/dayglance-vault/src/adapter.js` |
| `src/sync/tombstoneRetention.js`, `src/utils/tombstoneHorizon.js`, `src/sync/dayWindowSync.js`, `src/utils/recurringExceptions.js` (whole; pure, and each is one rule both tiers apply) | `packages/dayglance-vault/src/` (same names) |
| `mergeHabitLogs`, `mergeRoutineCompletions`, `mergeCompletedDates` (`src/mergeSync.js`) | `merges.js` |
| `pickJoboRecord` and the record primitives it is built from (`src/jobo/core.js`) | `jobo.js` |
| `mergeDeferrals` (`utils/deferrals.js`); `mergePlanTrail`, `sameTrail`, `TRAIL_CAP` (`utils/planTrail.js`); `earlierCreatedAt` (`utils/createdAt.js`); `mergeRetiredTaskIds`, `pruneRetiredTaskIds` (`utils/retiredTaskIds.js`) | `deferrals.js`, `planTrail.js`, `createdAt.js`, `retiredTaskIds.js` |
| the five engine callbacks over the mirror (`src/sync/dbEngine.js`) | `vaultEngineCallbacks(getData, markDirty)` (`engineCallbacks.js`), which `dbEngine.js` now builds its callbacks from |

`mergeRoutineDefinitions` was always `@glance-apps/sync`'s; the adapter imports
it from there, which makes the sync package a peer dependency (one copy of its
module state). `dbEngine.js` itself stays in the app: the snapshot diff, the
delete guards, the own-write acks, the Obsidian and ghost-row gates and the
commit merge are a device's, and are bound to localStorage and IndexedDB. A
host runs the engine with the package's callbacks and, after each pull, the
same two calls the app's wrapper makes: `reconcileCrossList` and
`pruneAllTombstones`.

**The host path, proven in Node:** `packages/dayglance-vault/test/hostPull.e2e.test.js`,
with `window`, `document`, `localStorage` and `indexedDB` all undefined. A
device runs the real `createDbSyncEngine` (2.4.0) with Map-backed `storage`,
its key from the passphrase kept through `nativeGetSyncKey` /
`nativeStoreSyncKey`, and the package's callbacks over a realistic data
object (multi-user, recurring series with per-date exceptions and
completions, the inbox, goals, projects, areas, routines, frames, a daily
note, a tombstone, a JOBO record), and pushes. A host, a fresh engine with
its own storage and key slot and the same passphrase, pulls into an empty
object, and `handleMcpRequest` over `buildMcpReadState` answers `get_day`,
the goal tree and the inbox exactly as it does on the device's own data; a
full read (every live row decrypted, `reassembleState`) answers the same.
Then a completion, an occurrence change, a hard delete and a move to the bin
whose stale row the vault still holds reach the host on its next pull, which
resumes from its stored cursor. The vault is in memory behind a fetch shim, so
the real vault client and the real crypto run. Breaking the cross-list
reconcile, the routine-completion stamps' carry in `_extra`, or
`getEntityLastModified` fails it.

Remaining before a prototype:

| Piece | Where | Node-ready? |
|---|---|---|
| Change nudges | `src/sync/vaultEventStream.js` (fetch-streaming SSE) | Probably; verify the streaming body under Node's `fetch`. |

**What the host must supply that the app derives from the device.** The read
model answers over the state `buildMcpReadState(data, { now, timeZone,
userSyncId, weekStartDay })` builds. `data` is the synced slices under their
payload names (`tasks`, `recurringTasks`, `unscheduledTasks`, `recycleBin`,
`goals`, `projects`, `areas`, `dailyNotes`, `bucketConfig`, `users`,
`multiUserEnabled`, `todayRoutines`, `routinesDate`, `routineCompletions`,
`routinesEnabled`, `gtdFrames`), which come from the reassembled rows. The
options are host configuration:

- **Time zone and clock.** `todayDate` and `nowMinutes` are read in `timeZone`
  when it is given; the app gives none, since its clock is the user's. A
  server is often on UTC, so the host must configure the user's IANA zone. The
  zone also rides the state, so `created_at` and `completed_at` are reported in
  it. The tools' own "today" (`deps.timeZone()`) must be the same zone.
- **`weekStartDay`** is a per-device setting (`day-planner-week-start-day`), not synced. Host config.
- **Settings the vault never hands over.** The adapter keeps the receiving
  device's value for `multiUserEnabled` always, and, while it is on, for the
  feature toggles (`routinesEnabled`, `habitsEnabled`, `goalsProjectsEnabled`)
  so one member's choice is not everyone's. A host starting from an empty
  object would read multi-user off and, in a multi-user account, routines as
  disabled, and show none. Host config, seeded into its data before the
  first pull (the end-to-end test does exactly this).
- **Which user, in a multi-user account** (`userSyncId`). `buildMcpReadState`
  scopes routines and frames by owner, because `isVisibleForUser` does not
  filter them (skipping this leaks another member's routines and frames); the
  host is configured as one user and gets the same scoping by construction.
- **Obsidian-linked descriptions.** The goal tree read awaits the Obsidian
  bridge for a linked goal's or project's description (`mcpNoteDescriptions.js`,
  in the app). The host has no vault notes: it must report those descriptions
  as unavailable, never as empty. Not done in 3a: today the read model alone
  returns the record's (empty) description beside `obsidian_note`, as the app
  does when the vault is unreachable.

## Writes (after the read side)

Two options, to be chosen once the read side runs:

- **A, rows.** The host writes rows as a full device. Real-time, but every rule a write passes through in the app has to hold here too: `normalizeField` stamping (`src/utils/stampTimestamps.js`), tombstones (`recordDeletedTaskTombstone`), the dirty set, and the carry/merge rules of CLAUDE.md's "Adding a field to a task". `handleMcpWrite(state, setters, request)` is already pure over state and setters, which makes this plausible.
- **B, intents.** The host only reads rows and sends its changes as encrypted GLANCEvault intents, which the app applies the way it applies the launcher's queued writes. The app stays the only writer of task rows, but a write lands only when a device next runs.

Either way: consent tiers from §6.3 (read; read + write; the device-calendar tier does not apply), the journal with undo, the rate limit, a kill switch.

## Deployment and security notes

- Token required on any non-loopback bind; Host allowlist configured; TLS at a reverse proxy.
- Decrypted content is never logged.
- The privacy statement for the host is the device one: "this machine holds your key". Docs say plainly that running the host on the same box as a self-hosted GLANCEvault separates them by configuration, not by cryptography.

## Sequence

1. **Host kit package** from `electron/`; the Electron server switches to it with no behaviour change (`electron/mcpServer.transport.test.ts` stays green). Serves lastGLANCE too. **Done:** `packages/mcp-host` (`@glance-apps/mcp-host`).
2. **`@glance-apps/sync`:** injectable storage for the vault engine; document the key hooks for Node. **Done:** 2.4.0, which dayGLANCE and the Obsidian plugin now use.
3. **dayGLANCE MCP core package, read side:** tool and resource registration, the read model, the rows-to-slices path. The Electron server uses the shared registration. **3a done:** `packages/dayglance-mcp` (`@glance-apps/dayglance-mcp`): the tools, resources, read model and `buildMcpReadState`. **3b done:** `packages/dayglance-vault` (`@glance-apps/dayglance-vault`): the rows-to-slices path (was `src/sync/dbAdapter.js`) and the merge rules it shares with the file tier.
4. **Read-only host prototype** (#2280's offer), in its own repository, against the packages.
5. **Writes:** choose A or B, then journal, consent and rate-limit parity.

## Open questions

1. Where the packages live and what they are called (the glance-apps organization, next to `@glance-apps/mcp-bridge`?).
2. Does the host count as a device for the vault's device list and for billing (`@glance-apps/billing`)?
3. Who owns the host repository: glance-apps, or the contributor who prototypes it?
4. Writes: A or B (above).
