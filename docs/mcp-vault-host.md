# GLANCEvault MCP host: design note

**Status:** Draft, for the extraction work that precedes a prototype.
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

From `electron/` (line counts without tests):

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

**One real change for a network host:** the listener uses the SDK's `localhostHostValidation` / `localhostOriginValidation`. A host on a LAN box or behind a reverse proxy is reached by name, so the kit takes a configured Host allowlist (localhost stays the default) and the Electron server keeps passing the localhost one. TLS is the reverse proxy's job; the kit should refuse a non-loopback bind without a token configured.

### 2. The vault engine under Node (`@glance-apps/sync`, glance-sync repository)

Everything is `fetch` and Web Crypto, both present in Node 20+. Two things are browser-bound:

- **Sync bookkeeping in `localStorage`.** `dbEngine.js` reads and writes `globalThis.localStorage` directly for: the device id (`getOrCreateDeviceId`), `-db-sync-config`, `-db-sync-hwm` (pull cursor), `-db-sync-push-ack`, `-db-sync-dirty`, `-db-sync-last-synced`, `-db-sync-quarantine`, `-db-sync-credential-halt` and `-vault-credential`. Change: `createDbSyncEngine({ storage })`, a synchronous `{ getItem, setItem, removeItem }` defaulting to `globalThis.localStorage`, threaded through `getOrCreateDeviceId` too. It must stay synchronous and durable on return (the dirty set and cursors are written before the request that depends on them); a host backs it with a small file store that writes atomically.
- **The root key in IndexedDB.** `dbCrypto.js` stores the derived root key in IndexedDB unless `nativeGetSyncKey` / `nativeStoreSyncKey` are supplied. Those hooks, added for the native shells, are already the seam: the host supplies them (OS keyring, or a 0600 file), or re-derives from the passphrase at start. No package change needed beyond documenting it.

Note that the root key is module state (`_rootKey`): one account per process. Fine for a personal host; worth stating.

### 3. The dayGLANCE read path (this repo)

| Piece | Where | Node-ready? |
|---|---|---|
| Tool and resource registration, argument schemas | `electron/mcpReadTools.ts`, `mcpResources.ts`, `mcpInboxFilter.ts` (writes later: `mcpWriteTools.ts`, `mcp*Args.ts`) | Yes, they only see the bridge. Move so both servers register the same schemas. |
| Read model | `src/utils/mcpReadModel.js` → `recurrenceEngine`, `goalProgress`, `projectProgress`, `bucketList`, `mcpRoutines`, `mcpFrames` (→ `frameInstances`, `dayOccupancy`), `obsidianProjectNotes`, `mcpRepeat`, `taskMetadata`, plus `@glance-apps/agenda-core` and `@glance-apps/obsidian-format` | Yes. None of these touches `window`, `document`, `localStorage` or `indexedDB` (checked: the only matches are comments). |
| Rows → slices | `src/sync/dbAdapter.js`: `reassembleState(rows)` for a full read, `applyRemoteEntity` / `applyRemoteDelete` for incremental pulls, `absentCollectionKinds` | Needs its own import graph checked when moved. |
| Change nudges | `src/sync/vaultEventStream.js` (fetch-streaming SSE) | Probably; verify the streaming body under Node's `fetch`. |

**What the host must supply that the app derives from the device.** `useMcpBridge` is handed (App.jsx, the `useMcpBridge({...})` call): `tasks`, `recurringTasks`, `unscheduledTasks`, `recycleBin`, `goals`, `projects`, `areas`, `dailyNotes`, `bucketConfig`, `users`, `multiUserEnabled`, `routines`, `routinesDate`, `routineCompletions`, `routinesEnabled`, `frames`, `todayDate`, `nowMinutes`, `weekStartDay`, `isVisibleForUser`. Most come from the reassembled rows. The rest are host configuration:

- **Time zone and clock.** `todayDate` and `nowMinutes` come from the device's local clock. A server is often on UTC, so the host needs the user's IANA zone configured, and dates computed in it.
- **`weekStartDay`** is a per-device setting (`day-planner-week-start-day`), not synced. Host config.
- **Which user, in a multi-user account.** The app scopes routines and frames by owner *before* the bridge, because `isVisibleForUser` does not filter them (see the comment at the call site: skipping this leaks another member's routines). The host must be configured as one user and apply the same scoping.
- **Obsidian-linked descriptions.** The goal tree read awaits the Obsidian bridge for a linked goal's or project's description. The host has no vault notes: it must report those descriptions as unavailable, never as empty.

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

1. **Host kit package** from `electron/`; the Electron server switches to it with no behaviour change (`electron/mcpServer.transport.test.ts` stays green). Serves lastGLANCE too.
2. **`@glance-apps/sync`:** injectable storage for the vault engine; document the key hooks for Node.
3. **dayGLANCE MCP core package, read side:** tool and resource registration, the read model, the rows-to-slices path. The Electron server uses the shared registration.
4. **Read-only host prototype** (#2280's offer), in its own repository, against the packages.
5. **Writes:** choose A or B, then journal, consent and rate-limit parity.

## Open questions

1. Where the packages live and what they are called (the glance-apps organization, next to `@glance-apps/mcp-bridge`?).
2. Does the host count as a device for the vault's device list and for billing (`@glance-apps/billing`)?
3. Who owns the host repository: glance-apps, or the contributor who prototypes it?
4. Writes: A or B (above).
