# `@glance-apps/sync` — Authoritative API Specification

> **Status**: Pre-extraction reference. All decisions herein are finalized.
> Last updated: 2026-05-16

---

## Overview

`@glance-apps/sync` is a shared npm package (GitHub Packages, `@glance-apps` scope) that implements WebDAV-based cloud sync, end-to-end encryption, remote auto-backup, and conflict resolution for the GLANCE app family (dayGLANCE, lifeGLANCE, lastGLANCE).

The package is **transport-agnostic** and **app-agnostic**. It contains zero hardcoded app names, localStorage keys, or file paths. All app-specific behavior is injected via a config object.

---

## Package Identity

```
Package name:   @glance-apps/sync
Registry:       GitHub Packages (https://npm.pkg.github.com)
Repository:     https://github.com/krelltunze/glance-sync  (to be created)
Language:       JavaScript (ES modules) + TypeScript `.d.ts` declarations
Exports:        Named: createSyncEngine, mergeArrayById, mergeHelpers, cryptoUtils
```

TypeScript declarations are required because lastGLANCE is a TypeScript project.

---

## Entry Point

```js
import {
  createSyncEngine,
  mergeArrayById,
  mergeDailyNotes,
  mergeHabits,
  mergeHabitLogs,
  mergeRoutineDefinitions,
  mergeSyncData,
  pruneTombstones,
  encryptData,
  decryptData,
  setupEncryptionKey,
  setSyncPassphrase,
  clearEncryptionKey,
  hasEncryptionReady,
  isEncryptedEnvelope,
} from '@glance-apps/sync';
```

---

## `createSyncEngine(config)` — Primary API

Returns a sync engine object bound to the provided config. One engine per app instance.

### Config Object

All fields are required unless marked optional.

#### Storage keys

| Field | Type | Description |
|---|---|---|
| `storageKeyPrefix` | `string` | Prefix for all localStorage keys owned by this engine. E.g. `'day-planner'` → keys like `'day-planner-cloud-sync-config'`. |
| `cryptoDBName` | `string` | IndexedDB database name for the crypto key store. E.g. `'dayglance-crypto'`. |
| `autoBackupDBName` | `string` | IndexedDB database name for auto-backup records. E.g. `'dayglance-auto-backups'`. |

#### File/path config

| Field | Type | Description |
|---|---|---|
| `syncFilename` | `string` | Name of the sync file on the WebDAV server. E.g. `'dayglance-sync.json'`. |
| `appFolderName` | `string` | App-specific folder name on the WebDAV server. E.g. `'dayglance'`. Used by Nextcloud (path: `{appFolderName}/{syncFilename}`) and Koofr (Koofr root → `{appFolderName}/`). |
| `backupFilenamePrefix` | `string` | Prefix for backup file names. E.g. `'dayglance-backup-'`. Files are named `{prefix}{timestamp}.json`. |

#### App identity

| Field | Type | Description |
|---|---|---|
| `appId` | `string` | Short stable identifier written into every sync envelope. E.g. `'dayglance'`. **Hard-stop mismatch** — if a downloaded envelope's `appId` differs, sync halts immediately and emits `APP_ID_MISMATCH`. |
| `appName` | `string` | Human-readable name for error messages and UI. E.g. `'dayGLANCE'`. |

#### Data lifecycle callbacks (all async-capable)

| Field | Type | Description |
|---|---|---|
| `buildPayload()` | `async () => object` | Returns the full sync payload `data` object. Called immediately before every upload. **Must read live state** (React refs, localStorage tombstones, etc.) — not a snapshot. |
| `buildBackupPayload()` | `async () => object` | Returns the backup payload. Semantically distinct from `buildPayload`: sync payloads contain the cross-device state; backup payloads may include additional device-local data (settings, preferences) that aren't part of the sync protocol. Called on backup timer. **Must be safe to call without React context** (timer callbacks). Read from localStorage/IndexedDB only, not React state. |
| `applyPayload(data)` | `async (object) => void` | Applies a merged remote payload to local state. Called after every successful download+merge. For React apps: update both React state and localStorage. For IndexedDB apps (lastGLANCE): write to Dexie inside a transaction. |
| `mergePayloads(local, remote)` | `(object, object) => object` | Merges a local payload snapshot with a remote payload. Called by the engine between download and apply. The engine does not know the data model — this is always app-provided. Use `mergeArrayById` from the package for each syncable array. Must be synchronous. |
| `validateUploadPayload(payload)` _(optional)_ | `async (object) => { valid: boolean, reason?: string }` | Safety guard before upload. Returning `{ valid: false }` aborts the upload without error. Use to block empty payloads, schema problems, etc. |
| `validateApplyPayload(payload)` _(optional)_ | `async (object) => { valid: boolean, reason?: string }` | Safety guard before applying remote data locally. Returning `{ valid: false }` aborts the apply without error. |

#### Transport bridges (optional)

| Field | Type | Description |
|---|---|---|
| `nativeHttpRequest` _(optional)_ | `async (method, url, headers, body) => { status, ok, body, headers }` | Native HTTP bridge for Android/iOS. When present, `webdavFetch` routes through this first. In dayGLANCE this is the `nativeHttpRequest` function from `src/native.js`. |
| `electronProxyFetch` _(optional)_ | `async (method, url, headers, body) => Response` | Electron IPC bridge. When present and `nativeHttpRequest` is absent, used as the second routing tier. |
| `proxyUrl` _(optional)_ | `string` | URL of the Vercel CORS proxy. Fallback when neither native nor Electron bridge is present. Each app deploys its own proxy. E.g. `'https://dayglance-webdav.vercel.app'`. |

#### Event callbacks

| Field | Type | Description |
|---|---|---|
| `onStatusChange(status)` | `(string) => void` | Called when sync status changes. Values: `'idle'`, `'syncing'`, `'error'`. |
| `onError(message, code, isHardStop)` | `(string, string, boolean) => void` | Called on sync or backup error. `isHardStop: true` means the engine has halted permanently and must not auto-retry. The caller is responsible for not clearing hard-stop errors automatically. |
| `onLastSyncedChange(isoString)` | `(string) => void` | Called after a successful sync with the ISO timestamp. |
| `onConflict(localData, remoteData)` _(optional)_ | `(object, object) => void` | Called when a conflict is detected during merge. Informational only — the merge engine resolves conflicts automatically using `lastModified` timestamps. |
| `onPassphraseRequired()` _(optional)_ | `() => void` | Called when encryption is configured but no session key is loaded (e.g. app restarted, new device). Caller should prompt the user for their passphrase. |

#### Retention (optional)

| Field | Type | Default | Description |
|---|---|---|---|
| `retentionDays` | `number` | `90` | Tombstones older than this many days are pruned from the sync payload before upload. |

---

### Return Value

```ts
interface SyncEngine {
  // Trigger a sync cycle (download → merge → upload). Idempotent if already running.
  sync(): Promise<void>;

  // Trigger upload only (no download). Used after local state changes.
  upload(): Promise<void>;

  // Trigger download+apply only (no upload).
  download(): Promise<void>;

  // Run a backup cycle for the given frequency.
  runBackup(frequency: 'hourly' | 'daily' | 'weekly'): Promise<void>;

  // Read current sync config from localStorage.
  getConfig(): object | null;

  // Write sync config to localStorage.
  setConfig(config: object): void;

  // Read last-synced timestamp from localStorage.
  getLastSynced(): string | null;

  // True if a sync is currently in progress.
  isSyncing(): boolean;

  // Expose the underlying crypto and merge utilities for use in applyPayload / buildPayload.
  crypto: CryptoUtils;
  merge: MergeUtils;
}
```

---

## Sync Envelope Schema

Every file written to WebDAV (sync and backup) uses this envelope:

```json
{
  "schemaVersion": 1,
  "appId": "dayglance",
  "version": 42,
  "lastModified": "2026-05-16T10:00:00.000Z",
  "data": { }
}
```

| Field | Type | Description |
|---|---|---|
| `schemaVersion` | `number` | Package-level schema version. Currently `1`. A downloaded file with `schemaVersion > SUPPORTED_MAX` triggers `SCHEMA_FORWARD_INCOMPATIBLE` (hard-stop). |
| `appId` | `string` | From config. Mismatch triggers `APP_ID_MISMATCH` (hard-stop). |
| `version` | `number` | Monotonically increasing integer. Incremented on every upload. Used with ETag for optimistic concurrency. |
| `lastModified` | `ISO 8601 string` | Wall-clock time of last write. Used as tie-breaker in merge. |
| `data` | `object` | App-specific payload returned by `buildPayload()`. |

When encryption is enabled, the entire envelope is encrypted before upload. The file on the server is an **encrypted envelope** containing the above as ciphertext. See Encryption section.

---

## Encryption

Encryption is end-to-end: plaintext never leaves the device.

### Algorithm

| Component | Choice |
|---|---|
| Symmetric cipher | AES-256-GCM |
| Key derivation | PBKDF2 (SHA-256, 310,000 iterations) |
| Salt | 16 bytes random, stored alongside ciphertext |
| IV | 12 bytes random, per-message |
| Key storage | IndexedDB (`cryptoDBName`) + Android Keystore bridge when available |

### Encrypted Envelope Format

```json
{
  "encrypted": true,
  "salt": "<base64>",
  "iv": "<base64>",
  "ciphertext": "<base64>"
}
```

`isEncryptedEnvelope(obj)` returns `true` if `obj.encrypted === true`.

### Crypto API (also exported standalone)

```ts
setupEncryptionKey(passphrase: string): Promise<void>
// Derives key from passphrase, generates salt, stores in IndexedDB.

setSyncPassphrase(passphrase: string): void
// Stores passphrase for re-authentication on existing encrypted setup.

clearEncryptionKey(): Promise<void>
// Removes key from IndexedDB and memory.

hasEncryptionReady(): boolean
// Returns true if a session key is loaded and ready.

encryptData(plaintext: object): Promise<EncryptedEnvelope>
// Encrypts plaintext object. Throws if no key is loaded.

decryptData(envelope: EncryptedEnvelope): Promise<object>
// Decrypts envelope. Throws if no key is loaded or ciphertext tampered.

isEncryptedEnvelope(obj: unknown): boolean
// Type guard.
```

### Android Keystore Bridge

When `config.nativeHttpRequest` is provided, the crypto module assumes the app has an Android Keystore bridge available and uses it for hardware-backed key storage. Detection is via function presence, not global name probing.

---

## Merge Engine

### `mergeArrayById(local, remote, tombstones, options?)`

The core merge primitive. Merges two arrays of objects using tombstone-based CRDT semantics.

```ts
mergeArrayById(
  local: object[],
  remote: object[],
  tombstones: Record<string, string>,  // id → ISO deletedAt
  options?: {
    idField?: string,       // default: 'id'
    timestampField?: string // default: 'updatedAt'
  }
): object[]
```

Rules:
1. Items present in `remote` but not `local`: added to result.
2. Items present in `local` but not `remote`: kept (not deleted by absence).
3. Items in both: winner is the one with the later `timestampField`.
4. Items whose `idField` appears in `tombstones`: excluded from result if `tombstones[id] >= item[timestampField]`.
5. Items tombstoned on one side but modified later on the other: modification wins (later timestamp beats tombstone).

### Exported Merge Helpers

These are the dayGLANCE-specific orchestrators, exported for convenience. Other apps will write their own orchestrators using `mergeArrayById`.

```ts
mergeDailyNotes(local, remote, tombstones): object
mergeHabits(local, remote, tombstones): object[]
mergeHabitLogs(local, remote, tombstones): object[]
mergeRoutineDefinitions(local, remote, tombstones): object[]
mergeSyncData(local, remote): object   // dayGLANCE full orchestrator
pruneTombstones(tombstones, retentionDays): Record<string, string>
```

---

## WebDAV Transport

### `webdavFetch(method, url, authHeaders, body?, extraHeaders?)`

Internal routing function. Route selection order:

1. `config.nativeHttpRequest` (Android/iOS native bridge) — if present
2. `config.electronProxyFetch` (Electron IPC) — if present and native absent
3. `fetch(config.proxyUrl + '/api/webdav-proxy', ...)` (Vercel CORS proxy) — fallback

The caller never needs to select a route. The engine selects automatically based on which bridges are provided.

### Supported Providers

| Provider key | Name | Notes |
|---|---|---|
| `nextcloud` | Nextcloud / WebDAV | Path: `{appFolderName}/{syncFilename}` under user's DAV root |
| `koofr` | Koofr | Fixed base URL `https://app.koofr.net/dav/Koofr/`; path: `{appFolderName}/{syncFilename}` |
| `webdav` | Generic WebDAV | URL configured directly; path: `{syncFilename}` relative to configured root |

Each provider exposes: `upload(config, envelope)`, `download(config)`, `test(config)`.

ETag is read on download and sent as `If-Match` on upload for optimistic concurrency. `412 Precondition Failed` triggers `PRECONDITION_FAILED` error and a retry after re-download.

### Vercel CORS Proxy (`api/webdav-proxy.js`)

- Fully portable — zero app-specific code
- Validates destination URL (blocks RFC 1918 private IPs to prevent SSRF)
- Forwards `Authorization` / `X-WebDAV-Auth` headers to upstream
- Forwards `ETag` / `If-Match` headers
- Disables Vercel body parser (`export const config = { api: { bodyParser: false } }`)
- **Each app deploys its own proxy instance.** Do not share a proxy across apps.

---

## Error Codes

| Code | `isHardStop` | Description |
|---|---|---|
| `APP_ID_MISMATCH` | `true` | Downloaded envelope's `appId` does not match config. Sync halted. |
| `SCHEMA_FORWARD_INCOMPATIBLE` | `true` | Downloaded envelope's `schemaVersion` exceeds what this package version supports. Update required. |
| `PASSPHRASE_REQUIRED` | `false` | Encryption configured but no session key. User must re-enter passphrase. |
| `PRECONDITION_FAILED` | `false` | ETag mismatch (412). Retry after re-download. |
| `FORBIDDEN` | `true` | Server returned 403. Credentials may be revoked. |
| `AUTH_FAILURE` | `false` | Server returned 401. Credentials likely wrong. |
| `LOCKED` | `false` | Another sync is in progress. |
| `NETWORK_ERROR` | `false` | Fetch failed entirely (offline, DNS, timeout). |

**Hard-stop errors**: The engine sets status to `'error'` and stops all auto-retry. The UI must **not** auto-clear hard-stop error messages on a timer. They must persist until the user acknowledges them or reconfigures sync.

**Transient errors**: The engine sets status to `'error'` and will retry on the next scheduled sync tick.

---

## Auto-Backup

Auto-backup is independent of sync. It runs on a configurable schedule and writes versioned snapshot files to a separate WebDAV directory.

### Frequencies

| Frequency | Interval | Retention |
|---|---|---|
| `hourly` | 3600s | 24 copies |
| `daily` | 86400s | 30 copies |
| `weekly` | 604800s | 12 copies |

### Local IndexedDB Store (`autoBackupDBName`)

Backups are also kept locally in IndexedDB. The DB has a single `'backups'` object store with indexes on `timestamp` and `frequency`.

### Remote Backup Path

Nextcloud: `{appFolderName}/backups/{backupFilenamePrefix}{timestamp}.json`
Generic WebDAV: `{backupFilenamePrefix}{timestamp}.json` at configured root

### Backup Payload

`buildBackupPayload()` (not `buildPayload()`) is called for backups. These may differ:
- `buildPayload` can read React state (called synchronously in render cycle)
- `buildBackupPayload` **must not** read React state (called from a timer). Read localStorage and IndexedDB only.

---

## Concurrency and Locking

A single boolean lock (`isSyncing()`) prevents overlapping sync cycles. If `sync()` is called while a cycle is in progress, it returns immediately with `LOCKED`. The debounce delay in the caller (5 seconds in dayGLANCE) further reduces contention.

The lock is in-memory only. It does not survive page reload. On startup the engine always begins unlocked.

---

## localStorage Key Convention

All localStorage keys are prefixed with `storageKeyPrefix`:

| Key | Content |
|---|---|
| `{prefix}-cloud-sync-config` | Provider config object (JSON) |
| `{prefix}-cloud-sync-last-synced` | ISO timestamp of last successful sync |
| `{prefix}-tombstones` | Tombstone map `{ id: deletedAt }` (app manages this; engine reads via `buildPayload`) |

The engine writes only the first two. Tombstones are the app's responsibility.

---

## React Integration Pattern

Apps using React should follow the ref-update-per-render pattern to avoid stale closures in timers and event listeners:

```js
// In component / hook:
const syncRef = useRef(null);
useEffect(() => {
  syncRef.current = () => engine.sync();
});

// In timer / event handler (always reads latest):
const handleInterval = () => syncRef.current?.();
```

`createSyncEngine` does not manage React state directly. It calls callbacks (`onStatusChange`, `onLastSyncedChange`, etc.) which the app wires to its own state setters.

---

## Package Structure (planned)

```
packages/sync/
├── src/
│   ├── index.js              # Named exports
│   ├── engine.js             # createSyncEngine
│   ├── crypto.js             # Encryption (parameterized from dayGLANCE)
│   ├── providers.js          # WebDAV providers (parameterized from cloudSyncProviders.js)
│   ├── merge.js              # mergeArrayById + helpers (from mergeSync.js)
│   ├── autoBackup.js         # Auto-backup engine (parameterized from autoBackup.js)
│   └── proxy.js              # webdavFetch routing
├── api/
│   └── webdav-proxy.js       # Vercel CORS proxy (copied verbatim)
├── types/
│   └── index.d.ts            # TypeScript declarations
├── package.json
└── README.md
```
