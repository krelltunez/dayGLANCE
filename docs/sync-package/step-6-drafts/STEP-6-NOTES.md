# Step 6 — draft package files and dayGLANCE adapter

This directory contains the artefacts for Step 6 of EXTRACTION_PLAN.md. They
are **drafts**, not committed package code — the agent executing Step 6 does
not have push access to the `glance-sync` repository, so the package-side
changes need to be applied manually before publishing 1.0.0.

## What's here

| File | Goes to | Purpose |
|---|---|---|
| `engine.js` | `glance-sync/src/engine.js` | The `createSyncEngine` factory — replaces the empty placeholder in 0.5.0. |
| `types-index.d.ts` | `glance-sync/types/index.d.ts` | Full TypeScript declarations for the public API (lastGLANCE requirement). |
| `engine-tests.js.draft` | `glance-sync/test/engine.test.js` | Vitest suite covering validation, hard-stop codes, 412 retry, conflict, status sequence. Renamed to `.draft` here so dayGLANCE's vitest doesn't auto-discover it. |
| `index-additions.js` | merged into `glance-sync/src/index.js` | Exports added: `createSyncEngine`, `SCHEMA_VERSION`, `SUPPORTED_MAX_SCHEMA_VERSION`. |
| `dayglance-adapter.js` | `dayGLANCE/src/sync/adapter.js` | dayGLANCE-pinned config + four data callbacks + two validators. |
| `dayglance-App-jsx-patch.md` | applied to `dayGLANCE/src/App.jsx` | Description of the App.jsx and `useCloudSync.js` changes (held until 1.0.0 publishes). |

## Sequence to publish & cut over

1. **Copy package drafts** into the `glance-sync` repository:
   - `engine.js` → `src/engine.js` (overwrite the placeholder)
   - `types-index.d.ts` → `types/index.d.ts` (overwrite the stub)
   - `engine.test.js` → `test/engine.test.js`
   - Apply `index-additions.js` to `src/index.js`
2. **Bump version**: `glance-sync/package.json` → `"version": "1.0.0"`.
3. **Run tests**: `npm test` — should pass all existing merge/crypto tests plus
   the new engine tests.
4. **Dry-run publish**: `npm publish --dry-run` — verify the file list and tarball.
5. **Open a PR in `glance-sync`** with the changelog (1.0.0 entry below).
6. After merge, **publish**: `npm publish`.
7. In dayGLANCE on this branch (`step-6-engine-adapter`):
   - Copy `dayglance-adapter.js` → `src/sync/adapter.js`.
   - Apply the App.jsx and `useCloudSync.js` changes per `dayglance-App-jsx-patch.md`.
   - Bump `package.json`: `@glance-apps/sync` → `^1.0.0` (and `npm install`).
   - `npm run build && npm test` — confirm dayGLANCE still works.
   - Push and open the dayGLANCE PR.

## CHANGELOG entry for 1.0.0

> ### 1.0.0 — Sync engine extracted
>
> First major release. `createSyncEngine(config)` is now the recommended
> entry point — apps no longer need to implement their own download/merge/
> upload orchestration.
>
> **Added**
> - `createSyncEngine(config): SyncEngine` — full orchestration with status
>   callbacks, optimistic concurrency, hard-stop error codes, and follow-up
>   queueing.
> - `SCHEMA_VERSION` / `SUPPORTED_MAX_SCHEMA_VERSION` exports.
> - TypeScript declarations covering the full public API.
> - Envelope identity: every uploaded envelope now carries `schemaVersion` and
>   `appId`. Downloads with a mismatched `appId` or a forward-incompatible
>   `schemaVersion` hard-stop the engine instead of corrupting data.
>
> **Compatibility**
> - Legacy envelopes (written by dayGLANCE before this version) lack
>   `schemaVersion` and `appId`; the engine accepts them and treats them as
>   schemaVersion=1 / unknown-app (no identity check).
> - `mergeArrayById`, `mergeSyncData`, `encryptData`, `decryptData`, and the
>   provider/auto-backup factories are unchanged from 0.5.0.

## What was not changed from the EXTRACTION_PLAN spec

- **Envelope `version` field**: still emitted as the constant `2` to preserve
  byte-for-byte compatibility with existing dayGLANCE deployments. The spec
  describes it as a monotonic counter; this is left for a future major.
- **Status callback signature**: `(status, hints?)` instead of `(status)`. The
  optional second arg carries `{ from }` on auto-revert calls so adapters can
  implement guarded setState without a wrapping closure. Old code that
  ignores the second arg continues to work.

## What's deliberately NOT in the engine

- **iCloud sync** (App.jsx ~1313-1444): a separate transport that runs in
  parallel with WebDAV on Apple devices. It uses the engine's `isSyncing()`
  to share the in-progress lock, but is otherwise independent. Lives in
  App.jsx.
- **The 5-second debounce, 60-second poll, and visibility/focus listeners**:
  UI concerns. Stay in App.jsx.
- **The conflict-resolution UI dialog**: app-level UI. The engine signals via
  `onConflict(remoteData, remoteModified, etag)` and the dialog buttons call
  the engine's public methods (`upload({ etag })`, the `applyPayload` callback)
  to act on the user's choice.

## Behavior-preservation audit

These behaviors from pre-extraction dayGLANCE are preserved in the engine:

| Behavior | App.jsx source | Engine source |
|---|---|---|
| Upload safety check (0-task payload + non-empty local → abort) | 4799-4806 | `validateUploadPayload` callback (`dayglance-adapter.js`) |
| Apply safety check (0-task remote + non-empty local + no real remote.lastModified → abort) | 4858-4864 | `validateApplyPayload` callback (`dayglance-adapter.js`) |
| 412 PRECONDITION_FAILED retry once with re-download | 5141-5150 | `engine.js` download/catch block |
| 401 backoff for 1 hour | 4833 / 5154 | `engine.js` `AUTH_FAILURE_BACKOFF_MS` |
| 423 LOCKED 30 s retry | 5158 | `engine.js` `LOCK_BACKOFF_MS` |
| Exponential backoff capped at 15 min (upload) / 5 min (download) | 4836-4837 / 5161-5163 | `engine.js` `MAX_UPLOAD_BACKOFF_S` / `MAX_DOWNLOAD_BACKOFF_S` |
| 2-second minimum status hold on success | 4810 / 5123 | `engine.js` `MIN_SYNC_DURATION_MS` |
| 3-second auto-revert of 'success' → 'idle' | 4818 / 5128 | `engine.js` `scheduleAutoRevert('success', SUCCESS_HOLD_MS)` |
| 5-second auto-revert of 'error' → 'idle' | 4847 / 5172 | `engine.js` `scheduleAutoRevert('error', ERROR_HOLD_MS)` |
| First-sync conflict path (never-synced + remote has data) | 5087-5092 | `engine.js` `if (hasNeverSynced && remote.lastModified)` |
| Empty remote → seed with local | 5079-5082 | `engine.js` `if (!downloaded)` |
| Follow-up download queue when upload arrives while download in flight | 4779-4783, 5182-5187 | `engine.js` `pendingFollowup` boolean |
| Lock-cleared-in-finally pattern | 4848-4850, 5173-5193 | `engine.js` `finally` block |
| KEY_LAST_SYNCED / KEY_LOCAL_MOD localStorage writes | 4814-4816 | `engine.js` `upload()` success branch |
| User-facing 401 error message | 4840-4841 / 5165-5166 | `engine.js` `formatErrorMessage` |
| User-facing 403 error messages | 4842-4843 / 5167-5168 | `engine.js` `formatErrorMessage` and download catch |

## Questions answered during the investigation

> How does dayGLANCE currently determine `localChanged` vs `remoteChanged`?

`mergeSyncData` already returns `{ data, localChanged, remoteChanged }` — both
flags are computed inside the merge engine based on which side contributed a
newer item. The engine threads these through verbatim. (See merge.js line 109.)

> How does `cloudSyncInitialDoneRef` work, and how does the engine's first-sync
> conflict path handle it?

`cloudSyncInitialDoneRef` is an App.jsx-side ref that signals "OK to start
recording local-modified timestamps." The engine doesn't need it — it only
tracks whether a download cycle completed without throwing. The App.jsx ref
remains in `useCloudSync.js` and is flipped in the `dataLoaded && !cloudSync
Config?.enabled` branch (App.jsx 1479) and after a successful download (the
engine's `onLastSyncedChange` callback is a fine spot to also flip it).

> The `passphrase` flow — where does it get held, where does the engine pick
> it up on retry?

The package's `crypto.js` holds `_sessionPassphrase` in a module-scoped
variable. When the user enters the passphrase, `setSyncPassphrase(p)` stashes
it. On the next `decryptData` call (during the next download cycle), if
`_sessionKey` is missing, the module derives a key from
`_sessionPassphrase + salt-from-file`. If decryption succeeds, the derived key
is promoted to `_sessionKey` and cached in IndexedDB. This flow is unchanged
by Step 6 — the engine's `onPassphraseRequired` callback just surfaces the
state to the UI.

> Do APP_ID_MISMATCH and SCHEMA_FORWARD_INCOMPATIBLE exist in App.jsx today?

No. They are new in Step 6 — dayGLANCE today doesn't write `appId` or
`schemaVersion` into envelopes and doesn't check them on download. The engine
adds both fields on upload (so future downloads can validate) and tolerates
their absence on download (so legacy files still work).
