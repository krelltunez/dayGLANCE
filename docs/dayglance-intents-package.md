# `@glance-apps/intents` — package planning doc

The build plan, locked decisions, and phase sequencing for the GLANCE family's intent protocol package.

This doc is the source of truth for *how the package is being built*. The protocol itself is specced in `dayglance-intent-protocol.md`; this doc describes the package that implements it and the apps that consume it.

## Status

**Phases 1, 2, 2.5, and 3 shipped (May 2026).** `@glance-apps/intents@1.0.1` and `@glance-apps/intents@1.1.0` published. `@glance-apps/sync@1.0.3` published. dayGLANCE v2.11.0 (released 2026-05-24) consumes `@glance-apps/intents@1.1.0` and `@glance-apps/sync@1.0.3` with the full Phase 2.5 encryption surface in place. lastGLANCE v0.1.13 (in testing) consumes the same package versions with the Phase 3 integration including intents encryption.

**Phase 2.6 superseded by Phase 2.7 (May 2026).** Phase 2.6 (per-envelope salt, PBKDF2-per-envelope) shipped in dayGLANCE and lastGLANCE feature branches and resolved the cross-app key mismatch from Phase 2.5, but surfaced a new UX-breaking problem: PBKDF2-per-envelope requires the cloud sync passphrase in memory at every emit and poll, and the passphrase is not persisted across app sessions (only the derived sync key is). This forced a "re-enter passphrase every session" UX that is unacceptable for a set-and-forget product. Phase 2.7 replaces PBKDF2-per-envelope with HKDF-per-envelope against an intents-owned long-lived root key, derived once at intents-encryption setup and cached non-extractably in IndexedDB exactly like sync's session key. Sync is not modified. The shared salt that lets both apps derive the same intents root key lives on the WebDAV endpoint, not in either app's IndexedDB. Phase 2.7 is the current active work.

**Phase 4** (Android intent transport + web URL transport) has not started.

## Why a shared package

Precedent: `@glance-apps/sync@1.0.0` was extracted from dayGLANCE and now powers cloud sync across the family. Intents follows the same pattern, but extracted *before* a second consumer ships rather than after. The rationale for extracting first rather than building-then-extracting:

- The spec is unusually well-developed for a v1 protocol. Schema is stable; behavior decisions have been closed (see "Locked decisions" below).
- Three apps will consume the protocol (dayGLANCE, lastGLANCE, lifeGLANCE). Duplicating constants and validators across three apps risks drift.
- The "extract later" pattern depends on doing the extraction under pressure. We've earned that trust once with sync; doing it again costs nothing to skip.
- Once the schema is locked, the iteration-freedom argument for keeping it internal evaporates.

The trade is: schema must be right at v1.0.0. Adding required fields later is a major bump. The locked decisions below reflect that discipline.

## Package boundary

What's in the package:

- Schema constants (action names, intent action strings, field names, event types, version constant, priority enum, RRULE shorthand mappings)
- Zod schemas for all 5 action payloads + WebDAV file envelope, namespaced under `v1/`
- Normalizers: priority (int|string → canonical), recurring (shorthand → RRULE), tags (parse inline `#tags`, merge, dedupe), due (parse various date inputs to ISO 8601, infer all_day)
- Idempotency helpers: `createKey(source_app, source_entity_id, due)` and `eventId()`
- WebDAV envelope helpers: `filenameFor`, `parseFilename`, `buildEnvelope`, `parseEnvelope`. Envelope helpers accept an optional encryption key parameter; when provided alongside an `encrypted: true` envelope, the helpers transparently encrypt/decrypt the payload (added in package `1.1.0` as part of Phase 2.5).
- Crypto helpers (added in `1.1.0`): AES-GCM encrypt/decrypt primitives for use by the envelope helpers. Key derivation lives in each consumer's existing sync-encryption code; the package operates on derived keys only.
- TS types re-exported for consumers

What's deliberately not in the package:

- The `handleIntent` function itself. That's dayGLANCE-side; the package gives dayGLANCE the building blocks, not the handler.
- HTTP client for WebDAV. Each app uses its existing WebDAV client (dayGLANCE has one from sync).
- Polling loops, cursors, GC schedulers. App-owned because cadence is configurable per app.
- Android `BroadcastReceiver` glue. Android-specific, app-owned.
- UI/toast feedback. App-owned.

This boundary keeps the package's surface small and stable, and pushes app-specific decisions (cadence, HTTP retries, UI feedback) to where they belong.

## Locked decisions

### Schema-affecting (settled May 2026)

**`notify` event types (v1):** all five events shipped from day one: `completed`, `uncompleted`, `deleted`, `rescheduled`, `updated`.

- `updated` fires only on changes to: `title`, `notes`, `tags`, `priority`, `project`, `recurring`. Explicitly not: `completed_at` (use `completed`/`uncompleted`), `due` (use `rescheduled`), internal/UI state, sort order, focus flags, color changes, tag reorderings.
- Multi-field changes in a single save = **one** `updated` event, not one per field. The event represents the state transition; the payload carries the new state; consumers diff against their own last-known state if they care which fields moved.
- Consumers handle unknown events defensively. New event types can be added in minor versions because the spec already documents this expectation.

**`query` action (v1):** no `scope` parameter; always returns the full variable set.

V1 return variables (10 total):

| Variable | Type | Description |
|---|---|---|
| `%dg_count_today` | Integer | Incomplete tasks due today |
| `%dg_count_overdue` | Integer | Incomplete tasks past due |
| `%dg_count_week` | Integer | Incomplete tasks due in next 7 days |
| `%dg_count_total` | Integer | All incomplete tasks |
| `%dg_count_inbox` | Integer | Incomplete tasks in Inbox |
| `%dg_in_progress_title` | String | Currently active timed task; empty if none |
| `%dg_in_progress_end` | String | End time of in-progress task (HH:MM); empty if none |
| `%dg_in_progress_remaining_min` | Integer | Minutes remaining in active task; 0 if none |
| `%dg_next_title` | String | Next timed task today; empty if none |
| `%dg_next_time` | String | Start time of next task (HH:MM or "All day"); empty if none |

Additional variables can be added in minor versions. Consumers that don't recognize a variable safely ignore it.

**`schema_version` semantics:** `schema_version` versions the entire protocol — envelope + all action payloads + all enum values. Package version tracks protocol version directly: package 1.x.y → protocol v1, package 2.0.0 → protocol v2.

Breaking changes (major bump required):

- Removing a field
- Renaming a field
- Changing a field's type
- Removing an enum value
- Removing an action
- Changing required/optional status of a field
- Changing normalization behavior in a way that produces different outputs for the same input

Non-breaking changes (minor bump):

- Adding an optional field
- Adding a new enum value to a forward-compatible enum (where the spec explicitly says consumers should tolerate unknown values — `notify.event` qualifies; `priority` does not because callers send those values)
- Adding a new action
- Adding a new return variable to `query`

Patch changes:

- Bug fixes in validators or normalizers that bring behavior in line with the documented spec

**`notify` payload addition:** optional `entity_type` field added at v1.0.0. dayGLANCE's emitter sets `entity_type=task` or `entity_type=goal` (and whatever types come later: routines, projects, etc.). Consumers ignore values they don't care about. Future-proofs against the kind of consumer the spec hasn't yet anticipated (e.g. a Tasker profile that branches differently for goal vs task completion).

### Behavior-only (from the spec's "Open decisions" table)

- **Multiple title match on `complete`:** complete soonest-due + set `%dg_warning` with ambiguity info.
- **"In progress" definition:** task with `startTime` and `duration` where current time falls within `startTime` to `startTime + duration`.
- **"Next up" definition:** next timed task scheduled for today with a `startTime` after now.
- **Web transport for `query`:** no-op + UI (open to GLANCE tab, no state read).

## Versioning policy

The package version and the protocol `schema_version` are kept in lockstep:

- `1.x.y` → protocol v1
- `2.0.0` → protocol v2 (breaking changes, coordinated multi-app upgrade)

Within v1: additive minor bumps, non-breaking. Consumers can upgrade freely.

Schema migration coexistence: when v2 ships, `src/schemas/v2/notify` exists alongside `src/schemas/v1/notify`, and consumers choose which version to validate against. This pattern is enabled by the versioned namespace structure but isn't exercised at v1.0.0.

## Build phases

### Phase 1: `@glance-apps/intents@1.0.0` published

Eight PRs in the intents repo:

| PR | Scope | Notes |
|---|---|---|
| #1 | Scaffold: package.json, tsconfig, Vitest, build pipeline, README skeleton, CI | Mirrors `@glance-apps/sync` conventions |
| #2 | `constants/` module: all enums and string constants, no logic | |
| #3 | `schemas/v1/`: Zod schemas for all 5 action payloads + envelope | Includes optional `entity_type` in notify |
| #4 | `normalize/`: priority, recurring, tags, due — each with unit tests | |
| #5 | `idempotency/`: createKey + eventId, with unit tests | |
| #6 | `webdav/`: filename parser/builder, envelope build/parse, with unit tests | |
| #7 | `types/`: re-exports, plus a public-API surface review pass | |
| #8 | Finalize README + CHANGELOG; manual `npm publish` from terminal (no CI publish step) | Publish is run by the maintainer locally, matching the `@glance-apps/sync` flow |

Test target: >90% coverage on normalizers and idempotency. Those are the parts where subtle bugs propagate into both consuming apps.

### Phase 2: dayGLANCE consumes the package

Eleven PRs in the dayGLANCE repo. Critical-path subset (PRs needed before lastGLANCE can adopt) is starred.

| PR | Scope |
|---|---|
| #1 | Add `@glance-apps/intents` dependency; wire constants through `DayGlanceNative` namespace; no behavior change ★ |
| #2 | Shared `handleIntent(action, payload)` handler skeleton: validation, normalization, idempotency hooks. Returns result objects but doesn't execute yet. ★ |
| #3 | `handleIntent.create` execution: existing task creation path, idempotency check via `createKey`, returns `task_id` ★ |
| #4 | `handleIntent.complete` execution: title search, soonest-due tiebreak, `%dg_warning` on ambiguity |
| #5 | `handleIntent.open` execution: tab routing |
| #6 | `handleIntent.query` execution: compute and return all 10 variables |
| #7 | WebDAV transport: poller, cursor (localStorage or settings), file-write helper. Configurable cadence. ★ |
| #8 | WebDAV GC: retention window setting, GC pass on launch + daily |
| #9 | Outbound `notify` emission: hook into task state changes, emit when `source_app` is set, write event file via package helpers ★ |
| #10 | Activity log UI: surface recent WebDAV events as a panel |
| #11 | Integration settings UI: WebDAV endpoint config (independent from sync endpoint), cadence settings, GC retention |

WebDAV endpoint is configurable independently from the sync endpoint, mirroring how cloud sync and remote backup are independent. Default is the same value but the user can split them.

### Phase 2.5: Optional encryption for WebDAV intent envelopes

**Shipped in dayGLANCE v2.11.0 (2026-05-24) and lastGLANCE v0.1.13 (testing). Phase 2.6 fixes a design flaw found in post-ship integration testing — see below.**

Added after Phases 1-2 shipped to address the privacy concern that WebDAV intent files can sit on a third-party server (Koofr, Box, Hetzner) in plaintext. Self-hosted users have full control over their WebDAV; users on hosted WebDAV providers do not. Bringing intents encryption to parity with cloud sync's optional encryption closes that gap.

Affects both the `@glance-apps/intents` package (envelope format + helpers) and dayGLANCE (settings UI, emitter, poller). Cleanly additive: plaintext envelopes still work, both forms coexist in the same directory, consumers without keys skip encrypted events with a logged warning.

**Locked decisions:**

- ~~**Same key as cloud sync.** Users who want intents encryption must have cloud sync encryption enabled first; the same passphrase derives the same key, used for both features. Intents encryption is a separate toggle but gated on sync encryption being on. The settings UI hides or disables the intents encryption toggle when sync encryption is off, with copy explaining the prerequisite.~~ **Premise false in implementation; superseded by Phase 2.6.** Each app generates its own random salt at first sync encryption and stores it in its own IndexedDB. Same passphrase + different salts = different derived keys. Phase 2.6 replaces the cross-app key reuse model with per-envelope salt embedded in the envelope.
- **Per-app toggle, not protocol-wide.** Each app decides independently whether to write encrypted events. Consumers handle both encrypted and plaintext events transparently.
- **Cipher: AES-GCM**, matching cloud sync. Per-event random IV stored in the envelope. No IV reuse.
- **Envelope shape with encryption:** plaintext envelope retains `event_id`, `timestamp`, `source_app`, `source_entity_id`, `due`, plus new fields `encrypted: true`, `iv`, and `payload_ciphertext`. Encrypted payload (base64-encoded ciphertext) contains `action`, `title`, `notes`, `tags`, `priority`, `recurring`, `project`, and any other user-readable fields. The plaintext envelope is the minimum needed for consumers to filter by `source_app`, compute idempotency keys (`source_app` + `source_entity_id` + `due`), and order/GC events without bulk decryption.
- **Only `create` and `notify` actions can be encrypted.** Other action types (`query`, `open`, `complete`) don't carry user-readable payload data and don't reliably have `source_app` / `source_entity_id` / `due` in the first place. Validators reject encrypted envelopes for action types other than `create` and `notify`. This keeps the invariant clean: an encrypted envelope is guaranteed to have the routing/idempotency header fields populated.
- **Consumer behavior on undecryptable events:** skip and log a warning. Never hard-fail. The activity log surfaces decryption failures so users can diagnose configuration drift between apps. Matches the protocol's existing defensive-consumer stance for unknown event types.

**Schema versioning:** non-breaking. The `encrypted` field is optional and additive; existing plaintext envelopes remain valid. Minor version bump (`1.x.y` → `1.(x+1).0`).

**Package API shape (locked during implementation, captured here for consumer reference):**

- **Separate functions, not overloads.** `buildEnvelope` and `parseEnvelope` stay synchronous and operate on plaintext. New `buildEncryptedEnvelope` and `parseEncryptedEnvelope` handle the encrypted path. Plaintext callers don't change; backward compatible.
- **Key type: `CryptoKey`** (Web Crypto API). The package accepts `CryptoKey` rather than raw bytes (`Uint8Array`). Reuses what cloud sync's derivation pipeline already produces, preserves non-extractable key handling, no internal `importKey` per operation.
- **Async only on the encrypted path.** `buildEncryptedEnvelope(payload, key): Promise<EncryptedEnvelope>` and `parseEncryptedEnvelope(file, key): Promise<Envelope>` are async because Web Crypto is async. Plaintext functions stay sync.
- **Failure signaling: typed errors thrown, not nullable returns.** Encrypted-path functions throw exported error classes: `NoKeyError`, `WrongKeyError`, `NotEncryptedError`, `MalformedEnvelopeError`, and (build-side) `InvalidPayloadError` (for attempting to encrypt a non-`create`/`notify` action). Consumers wrap in try/catch and branch on error type. Each error class maps directly to a distinct activity-log entry on the dayGLANCE side.

#### Package PRs (`@glance-apps/intents`) — **complete**

| PR | Scope | Status |
|---|---|---|
| #9 | `schemas/v1/`: extend envelope schema with optional `encrypted: true`, `iv` (base64), and `payload_ciphertext` (base64) fields. When `encrypted` is true, structural payload fields move into the encrypted blob. Validators accept both forms; reject encrypted envelopes for action types other than `create` and `notify`. | ✅ |
| #10 | `crypto/`: AES-GCM encrypt/decrypt helpers. Key parameter is a `CryptoKey` (consumer passes it in; package doesn't do passphrase derivation — that lives in each consumer's existing sync-encryption code). Exported error classes for failure modes. | ✅ |
| #11 | `webdav/`: add `buildEncryptedEnvelope` and `parseEncryptedEnvelope` (async, take a `CryptoKey`). Existing `buildEnvelope` and `parseEnvelope` remain synchronous and plaintext-only. | ✅ |
| #12 | Bump package to `1.1.0`; CHANGELOG entry; `npm publish`. | ✅ Published. |

#### dayGLANCE PRs

**Pre-work resolved.** Investigation confirmed `@glance-apps/sync@1.0.1` does not currently export the derived `CryptoKey`. The key is held in module-scoped state (`_sessionKey` in `crypto.js`) as a non-extractable `CryptoKey`, with `hasEncryptionReady()` exposed but no getter for the key itself. The derivation pipeline is clean: PBKDF2-SHA-256 at 310,000 iterations, AES-256-GCM, non-extractable at every `importKey` site (verified).

**Resolution: Option B — add a `getSessionKey()` getter to `@glance-apps/sync`.** One-line addition that surfaces the existing `_sessionKey` reference. The key remains non-extractable, so callers receive an opaque `CryptoKey` reference they can pass to Web Crypto operations but cannot extract raw bytes from. No change to derivation, storage, or lifecycle. The same getter serves both the dayGLANCE intents emitter and the lastGLANCE Phase 3 intents emitter; doing the structural work once benefits both repos.

**Resulting precursor PR in `@glance-apps/sync`:**

| PR | Scope | Status |
|---|---|---|
| sync #1 | Export `getSessionKey()` from `crypto.js`; CHANGELOG entry; patch release `1.0.2`; `npm publish` | pending |

dayGLANCE PR #12 below depends on `@glance-apps/sync@1.0.2` being published. Bumps both packages together.

**Reference emitter pattern (for PR #14):**

```js
import { hasEncryptionReady, getSessionKey } from '@glance-apps/sync';
import { buildEncryptedEnvelope } from '@glance-apps/intents';

// Only runs when cloudSyncConfig.encryptionEnabled && intentsConfig.encryptionEnabled
if (hasEncryptionReady()) {
  const key = getSessionKey(); // non-extractable CryptoKey
  const envelope = await buildEncryptedEnvelope(intentPayload, key);
  // ... push envelope via WebDAV
}
```

The two-check pattern (settings-time `intentsConfig.encryptionEnabled` plus runtime `hasEncryptionReady()`) handles the case where intents encryption is configured-on but no key is currently cached in session (e.g., new device that hasn't entered the passphrase yet). When `hasEncryptionReady()` is false but encryption is configured, the emitter falls back to plaintext (defensible default — events still flow) or queues the event for later (more correct but more state to manage). PR #14 should pick one and document the choice in the PR description; default recommendation is fall back to plaintext with an activity-log entry noting the configuration drift, since the absence of a session key typically means the user hasn't completed setup on this device yet and the alternative (silent queueing) is harder to diagnose.

**Shipped in dayGLANCE v2.11.0.** All five PRs landed and are in production. The encryption toggle is functional but cannot succeed cross-app until Phase 2.6 ships; the path is dormant for any user who flips it on because lastGLANCE is not yet released to a wider audience. Activity-log copy from PR #16 will be revised in Phase 2.6 to reflect the new semantics of `WrongKeyError`.

| PR | Scope |
|---|---|
| #12 | Upgrade to `@glance-apps/intents@1.1.0` and `@glance-apps/sync@1.0.2`; no behavior change |
| #13 | Settings UI: intents encryption toggle in the integration settings panel; gated on sync encryption being enabled (hidden or disabled with explanatory copy when not). Surface the "uses cloud sync passphrase" note inline. |
| #14 | Emitter (Phase 2 PR #9): when intents encryption is on, call `hasEncryptionReady()` and `getSessionKey()` from `@glance-apps/sync`; pass the `CryptoKey` to `buildEncryptedEnvelope`. Wrap in try/catch for typed errors; surface failures to activity log. Document the fallback behavior when `hasEncryptionReady()` is false. |
| #15 | Poller (Phase 2 PR #7): inspect envelope; if `encrypted: true`, call `parseEncryptedEnvelope` with the `CryptoKey`; if plaintext, call `parseEnvelope`. On any typed error from the encrypted path (`NoKeyError`, `WrongKeyError`, `NotEncryptedError`, `MalformedEnvelopeError`), log distinct activity-log entry and skip event. |
| #16 | Activity log (Phase 2 PR #10): render distinct activity-log entries per error class. `NoKeyError` → "encryption not configured." `WrongKeyError` → "decryption failed (wrong key)." `NotEncryptedError` and `MalformedEnvelopeError` are defensive-only (shouldn't happen in normal operation) and surface as warnings if they do fire. |

**Critical-path subset for Phase 3:** historical — `@glance-apps/sync@1.0.2` published before dayGLANCE PR #12 landed. dayGLANCE PRs #12-16 shipped in v2.11.0. lastGLANCE Phase 3 PRs shipped in v0.1.13.

### Phase 3: lastGLANCE adopts the protocol

**Shipped in lastGLANCE v0.1.13 (testing).** All 13 PRs landed. The intents-encryption surface (PRs #11-13) is functional but inherits the same cross-app key-mismatch issue as dayGLANCE; revised in Phase 2.6 (see below — appears after this section because it was discovered during post-Phase-3 testing).

Starts when dayGLANCE PRs #3, #7, #9 are merged (the starred critical path above) **and** Phase 2.5 package PRs #9-12 are published (encryption support in the package).

| PR | Scope |
|---|---|
| #1 | Add `@glance-apps/intents` dependency; pull in constants and schemas |
| #2 | Data model: per-chore `auto_schedule_to_dayglance` boolean (Dexie v2 migration) |
| #3 | Outbound `create` action: shared emitter that writes a WebDAV event file via the package's envelope helpers, gated on WebDAV being configured |
| #4 | Card-level `+ dG` button: appears on chore cards when cadence threshold crossed; tap emits `create` via the Phase 3 PR #3 emitter |
| #5 | Overdue notification popup: "Send to dayGLANCE" button in the existing overdue notification UI; tap emits `create` |
| #6 | Per-chore `auto_schedule_to_dayglance` toggle in chore edit form (UI only; data model in PR #2); auto-schedule logic emits `create` when toggle is on and chore crosses cadence threshold |
| #7 | WebDAV poller for inbound `notify`, filters on `source_app=app.lastglance` |
| #8 | Inbound handler: on `event=completed`, log a CompletionEvent with `source="dayglance"`. v1 ignores other events (defensive accept, no action). |
| #9 | Standalone-mode detection: WebDAV configured? dayGLANCE reachable? Hide integration UI accordingly. |
| #10 | Settings UI for the integration |
| #11 | Intents encryption toggle in integration settings, gated on cloud sync encryption being enabled. Same "uses cloud sync passphrase" copy as dayGLANCE. |
| #12 | Outbound emitter (PR #3) consumes intents encryption setting: when on, call `hasEncryptionReady()` and `getSessionKey()` from `@glance-apps/sync@1.0.2+` and pass the `CryptoKey` to `buildEncryptedEnvelope`. Wrap in try/catch for typed errors. Same fallback-when-no-key behavior as dayGLANCE PR #14. |
| #13 | Inbound poller (PR #7) inspects envelope; if `encrypted: true`, call `parseEncryptedEnvelope` with the `CryptoKey`; if plaintext, call `parseEnvelope`. On typed errors from the encrypted path, log to activity log and skip event. |

v1 ignores `uncompleted` events. If a user wants to remove a completion that came from a dayGLANCE un-completion, they delete it manually in lastGLANCE.

The three outbound trigger surfaces (PRs #4, #5, #6) all converge on the shared emitter from PR #3. UI surfaces are additive; the per-instance card and notification buttons are the primary discoverability, the per-chore toggle is the set-and-forget option. Default for the toggle is off.

Intents encryption (PRs #11-13) is additive on top of the integration. Plaintext intents work end-to-end without it; the encryption layer activates only when the user enables both cloud sync encryption and intents encryption. Consumers handle plaintext and encrypted events transparently in the same directory.

### Phase 2.6: Per-envelope salt (fixes the Phase 2.5 cross-app key mismatch)

**Superseded by Phase 2.7.** Phase 2.6 shipped as feature branches in both apps and successfully resolved the cross-app key mismatch from Phase 2.5, but introduced a passphrase-availability problem that broke the set-and-forget UX. The PBKDF2-per-envelope model requires the cloud sync passphrase in memory at every emit and poll; the passphrase is not persisted across app sessions (only the derived sync key is). This forced users to re-enter their passphrase every session for intents to work — unacceptable. Phase 2.7 replaces PBKDF2-per-envelope with HKDF-per-envelope against an intents-owned root key; passphrase needed only at intents-encryption setup, never again. Phase 2.6 design retained below for history; do not implement.

#### Why this exists

Phase 2.5 shipped with the assumption that sync's session key (`getSessionKey()`) would be the same across apps using the same passphrase, and the intents emitter could hand that key to `buildEncryptedEnvelope`. Integration testing in late May 2026 produced `WrongKeyError` on every cross-app decrypt despite the same passphrase entered in both apps.

Investigation into `@glance-apps/sync@1.0.3` source (`src/crypto.js`) revealed the cause:

- Each app generates its own random 16-byte salt via `crypto.getRandomValues` at first encryption (`crypto.js:180`).
- Each app stores its salt in its own IndexedDB (`KEY_STORE = 'keys'`, record id `sync-key`, in a database named by the caller-supplied `cryptoDBName` — distinct per app).
- The salt is therefore per-app-instance, not shared. Two apps + same passphrase + independently-random salts = two different `CryptoKey`s.
- Sync itself dodges this for its own files by **embedding the salt in the first 16 bytes of every encrypted file** (`crypto.js:254,277`) and re-deriving the key from the passphrase + extracted salt on read (`crypto.js:300-320`). The cached session key is a hot-path optimization for the common case of an app reading its own files; the *real* key for any file is derivable from passphrase + the salt in that file.

The intents emitter pattern in Phase 2.5 short-circuits this by passing the cached session key directly. That works inside one app. It does not work cross-app.

#### Scope of impact

- **No production users affected.** lastGLANCE has not shipped to a wider audience; only the developer's testing setup has both apps connected to a shared WebDAV endpoint. dayGLANCE v2.11.0 ships the intents-encryption toggle but the path is dormant in the absence of a second app.
- **The intents-encryption toggle in dayGLANCE v2.11.0 is technically reachable** for any user who happened to enable it, but with no second app emitting encrypted envelopes, nothing in the WebDAV directory will be encrypted for that user to fail to decrypt. The failure mode only manifests when both apps are configured and one emits to the other.

#### Resolution: mirror sync's per-file salt pattern in the envelope

The intents package generates a fresh 16-byte salt per envelope, embeds it alongside `iv` and `payload_ciphertext`, and the consumer re-derives the key from the passphrase + the salt in the envelope. Same passphrase + same salt-from-envelope = same key, regardless of which app encrypted it. `getSessionKey()` is no longer involved in the cross-app encrypted path.

This adds 16 bytes (24 base64 chars) per encrypted envelope. Negligible relative to a typical task payload.

#### Locked decisions

- **Per-envelope random salt, embedded in the envelope alongside `iv` and `payload_ciphertext`.** Field name: `salt` (base64). Generated fresh per envelope via `crypto.getRandomValues(new Uint8Array(16))`. No salt reuse across envelopes (matches sync's per-file pattern).
- **Key derivation happens on both emit and consume sides, per envelope.** The cached session key from `getSessionKey()` is not used in the cross-app encrypted path. Sync's cached session key remains for sync's own purposes.
- **`@glance-apps/sync` exposes `deriveKeyForSalt(salt: Uint8Array): Promise<CryptoKey>`.** Takes a salt, runs PBKDF2 against the cached passphrase, returns a non-extractable `CryptoKey`. Sync's existing derivation parameters are preserved: PBKDF2-SHA-256, 310,000 iterations, AES-256-GCM, non-extractable. (`getSessionKey()` from `1.0.2` remains exported; it's just not what intents uses going forward.)
- **Passphrase stays inside sync.** The intents package never sees the passphrase; it only ever calls `deriveKeyForSalt(salt)` on sync and receives a `CryptoKey` back. This preserves the boundary where sync owns passphrase lifecycle and key derivation.
- **Intents-package API: `buildEncryptedEnvelope` and `parseEncryptedEnvelope` take a `deriveKey` callback rather than a `CryptoKey`.** Signature: `deriveKey: (salt: Uint8Array) => Promise<CryptoKey>`. The emitter passes `sync.deriveKeyForSalt`. The package generates the salt internally on build, extracts it from the envelope on parse, and calls the callback to get the key for that salt. This keeps the package decoupled from sync — any consumer that can produce a `CryptoKey` for a given salt can use it.
- **Envelope shape:** plaintext envelope retains `schema_version`, `event_id`, `emitted_at`, `emitted_by`, plus the hoisted `source_app`, `source_entity_id`, `due` fields, plus new fields `encrypted: true`, `salt` (base64, 16 bytes), `iv` (base64, 12 bytes), and `payload_ciphertext` (base64). The plaintext-header fields remain unencrypted so consumers can filter by `source_app`, compute idempotency keys, and order/GC events without bulk decryption.
- **Versioning: `@glance-apps/intents@1.2.0`.** Additive minor bump. Plaintext envelopes still parse. `@glance-apps/intents@1.1.0` encrypted envelopes (no `salt` field) become legacy; package validators reject them with `MalformedEnvelopeError` (no `salt` present in an `encrypted: true` envelope). Since 1.1.0 encrypted envelopes never worked cross-app in practice, no real-world data is at risk; the only such envelopes that exist are from integration testing and can be wiped.
- **`@glance-apps/sync`: minor bump to `1.1.0`** for the `deriveKeyForSalt` export.
- **Error classes unchanged.** `NoKeyError`, `WrongKeyError`, `NotEncryptedError`, `MalformedEnvelopeError`, `InvalidPayloadError` keep their meanings. `WrongKeyError` becomes rare-to-vanishing in practice once per-envelope salt is in place — it would fire only on actual passphrase mismatch between apps, not on the salt-mismatch case that motivated this phase.

#### Package PRs (`@glance-apps/intents`)

| PR | Scope |
|---|---|
| #13 | `schemas/v1/`: extend encrypted envelope schema with required `salt` (base64) field when `encrypted: true`. Validators reject encrypted envelopes without `salt` or with malformed `salt` (decoded length ≠ 16 bytes). |
| #14 | `crypto/`: refactor AES-GCM helpers to accept a `deriveKey` callback. Internal-only change for the helper signatures; the public API change is in PR #15. |
| #15 | `webdav/`: change `buildEncryptedEnvelope` signature from `(args, key)` to `(args, deriveKey)` and `parseEncryptedEnvelope` signature from `(raw, key)` to `(raw, deriveKey)`. Build path: generate salt, call `deriveKey(salt)`, encrypt, embed salt+iv+ciphertext in envelope. Parse path: read salt from envelope, call `deriveKey(salt)`, decrypt. |
| #16 | Bump package to `1.2.0`; CHANGELOG entry noting the change to the encrypted-path API (plaintext path unchanged); `npm publish`. |

The 1.1.0 → 1.2.0 jump changes the encrypted-path function signatures, but no production consumer is on the encrypted path in a way that matters (dayGLANCE v2.11.0 ships the path but no end user has a working second-app counterpart to exercise it; lastGLANCE testing is the only place encrypted envelopes have actually flowed, and that's the developer's setup). Bumping minor rather than major reflects the protocol `schema_version` discipline (envelope shape is additive: a new required field inside an already-optional encrypted form). **Decision: `1.2.0`.**

#### Package PR in `@glance-apps/sync`

| PR | Scope |
|---|---|
| sync #3 | Add `deriveKeyForSalt(salt: Uint8Array): Promise<CryptoKey>` export to `crypto.js`. Reuses the existing PBKDF2 pipeline (310k iters, SHA-256) and the cached passphrase. Returns non-extractable `CryptoKey`. CHANGELOG entry; minor bump to `1.1.0`; `npm publish`. |

Must publish before the dayGLANCE Phase 2.6 PRs below.

#### dayGLANCE PRs (target version: v2.11.1 or v2.12.0)

| PR | Scope |
|---|---|
| #17 | Upgrade to `@glance-apps/intents@1.2.0` and `@glance-apps/sync@1.1.0`; no behavior change |
| #18 | Settings UI: revised copy on the intents encryption toggle. Replaces the Phase 2.5 "uses cloud sync passphrase" line with "Uses your cloud sync passphrase. Each event is independently re-keyed; no setup beyond entering the passphrase." Same gating logic. |
| #19 | Emitter (Phase 2 PR #9 / Phase 2.5 PR #14): when intents encryption is on, pass `sync.deriveKeyForSalt` to `buildEncryptedEnvelope` instead of the cached `CryptoKey`. Wrap in try/catch for typed errors; surface failures to activity log. Same plaintext-fallback behavior as the Phase 2.5 emitter for `hasEncryptionReady()` false. |
| #20 | Poller (Phase 2 PR #7 / Phase 2.5 PR #15): when envelope is `encrypted: true`, call `parseEncryptedEnvelope(raw, sync.deriveKeyForSalt)`. On any typed error from the encrypted path, log distinct activity-log entry and skip event. |
| #21 | Activity log: copy revision. `WrongKeyError` becomes "decryption failed (wrong passphrase — verify same passphrase used in both apps)." Other error-class copy unchanged from Phase 2.5 PR #16. |

#### lastGLANCE PRs (target version: v0.1.14)

Same shape as the dayGLANCE PRs above. lastGLANCE Phase 3 PRs #11-13 (the intents-encryption surface) need the same mechanical updates: package upgrade, emitter and poller switch from cached `CryptoKey` to `sync.deriveKeyForSalt` callback, settings copy and activity-log copy revised. Specced as a separate handoff for the lastGLANCE repo.

#### Critical path

`@glance-apps/sync@1.1.0` published **and** `@glance-apps/intents@1.2.0` published → dayGLANCE PR #17 + lastGLANCE equivalent land → end-to-end test → ship dayGLANCE v2.11.1 (or v2.12.0) and lastGLANCE v0.1.14 in coordination.

#### Test plan

- **Package**: round-trip test in the intents repo: build an encrypted envelope with one `deriveKey` callback, parse with a separately-constructed `deriveKey` callback that runs PBKDF2 with the same passphrase. Confirm payload matches. Also: round-trip with mismatched passphrases produces `WrongKeyError`. Round-trip with envelope missing `salt` produces `MalformedEnvelopeError`.
- **End-to-end**: replay the original failing scenario. Emit an encrypted `create` from lastGLANCE; confirm dayGLANCE's poller decrypts it. Emit an encrypted `notify` from dayGLANCE; confirm lastGLANCE's poller decrypts it. Both should produce no `WrongKeyError` in the activity log.

#### Migration / cleanup

- Any encrypted envelopes from Phase 2.5 integration testing in the shared WebDAV directory should be deleted manually before Phase 2.6 testing begins. They lack the `salt` field and will fail `MalformedEnvelopeError` under the new schema.
- No production migration needed: no end user has ever had a working encrypted intents envelope, because lastGLANCE has not shipped to a wider audience yet. The cross-app failure mode is only reproducible in the developer's setup.

### Phase 2.7: HKDF-per-envelope with intents-owned root key (supersedes Phase 2.6)

**Active work. Sync is not modified in this phase.**

#### Why this exists

Phase 2.6 (per-envelope salt, PBKDF2-per-envelope) successfully resolved the Phase 2.5 cross-app key mismatch but introduced a UX-breaking problem: PBKDF2 requires the passphrase as input, and the cloud sync passphrase is not persisted across app sessions. Sync itself doesn't need the passphrase across sessions because sync uses one long-lived derived key that gets cached as a non-extractable `CryptoKey` in IndexedDB and reused for every operation. Intents Phase 2.6 broke that pattern by deriving a fresh key per envelope, which means the passphrase has to be available every time. Result: users would have to re-enter their cloud sync passphrase every app session for intents emission and polling to work. Unacceptable for a set-and-forget product.

#### Resolution: intents owns a long-lived root key, derived once at setup, reused via HKDF per envelope

Phase 2.7 gives intents its own long-lived root key, derived once when the user enables the intents encryption toggle. That root key gets cached non-extractably in IndexedDB exactly like sync's session key. Per envelope, the encryption key is derived by HKDF from the cached root key plus a fresh per-envelope salt — fast (single hash, not 310k PBKDF2 iterations) and requires only the cached root key, no passphrase. Both apps derive the same per-envelope key from the same root key + the same envelope salt.

Cross-app root-key agreement is achieved by storing a shared intents-encryption salt on the WebDAV endpoint, not in either app's IndexedDB. First app to enable intents encryption against a given WebDAV endpoint writes the salt; second app reads it on setup. Same passphrase + same shared salt = same root key in both apps. The passphrase is used at setup time only; it is discarded from intents' memory after the root key is derived and cached.

After setup, no operation in intents requires the cloud sync passphrase. The cached root key is sufficient. Set-and-forget UX restored.

#### Sync is not modified

Sync's session key, its IndexedDB schema, its salt model, its PBKDF2 parameters, and its file-encryption pipeline are unchanged. The only thing intents asks of sync at runtime is access to the cloud sync passphrase *at intents-encryption setup* — specifically, when the user turns the intents encryption toggle on, intents needs the passphrase available right then to derive its root key. After that, intents has its own cached root key and never touches sync's key material or passphrase again.

If the user is enabling intents encryption in the same session in which they configured sync encryption, the passphrase is already in memory and the setup is seamless. If the user enabled sync encryption in a prior session and is enabling intents encryption now (with passphrase not in memory), intents prompts for the passphrase as part of the toggle-on flow — same UX as configuring sync encryption itself. After this one-time prompt, the user is set-and-forget.

#### Locked decisions

- **Intents-owned root key, cached non-extractably in IndexedDB.** Separate from sync's cached key. Lives in an intents-owned IndexedDB database; does not co-mingle with sync's storage.
- **Shared root salt stored on WebDAV.** First app to enable intents encryption writes the salt to a file in the WebDAV intents directory (filename and exact location TBD by Code; the package planning doc is not the right place to fix the byte layout). Subsequent apps read the salt from there during their own intents-encryption setup. The salt is associated with the WebDAV-shared intents store, not with any one client.
- **Root key derivation:** PBKDF2-SHA-256, 310,000 iterations, AES-256-bits of output, against the cloud sync passphrase + the shared WebDAV-stored salt. Matches sync's PBKDF2 parameters for consistency. Output imported as a non-extractable `CryptoKey` with `usages: ['deriveKey']` so HKDF can derive envelope keys from it without ever exposing the raw key material. (If HKDF-from-non-extractable-key has a Web Crypto API gotcha here, see the Code prompt's pre-work step — adjust the import usages or design accordingly.)
- **Per-envelope key derivation:** HKDF-SHA-256 with the cached intents root key as input keying material, the per-envelope salt as salt, and a fixed info string (e.g. `"glance-intents-envelope-v1"`). Output: a non-extractable AES-256-GCM `CryptoKey` with `usages: ['encrypt', 'decrypt']`. Fresh per-envelope salt generated via `crypto.getRandomValues(new Uint8Array(16))`, embedded in the envelope alongside `iv` and `payload_ciphertext` — same envelope shape as Phase 2.6.
- **Envelope shape unchanged from Phase 2.6.** The `salt` field is still present and still 16 bytes; what changes is how the consumer derives the key from it (HKDF against cached root key, not PBKDF2 against passphrase).
- **Versioning:** `@glance-apps/intents@1.3.0`. Additive minor bump for the API change (callback semantics change but signature stays similar). Plaintext envelopes still parse. Phase 2.6 encrypted envelopes (no migration path to Phase 2.7 keys, since they were derived from a different process) are wiped manually before testing; no production data exists.
- **Intents-package API:** `buildEncryptedEnvelope` and `parseEncryptedEnvelope` continue to take a `deriveKey` callback `(salt: Uint8Array) => Promise<CryptoKey>`. The callback's *implementation* changes (it now runs HKDF against a cached root key instead of PBKDF2 against the passphrase), but the package API stays the same. This is intentional — the package doesn't care how the key is derived, only that the consumer can produce one for a given salt.
- **Setup flow:** the intents encryption toggle, when turned on, runs the setup sequence: ensure cloud sync encryption is enabled (gating); ensure passphrase is in memory (prompt if not); fetch or write the shared root salt on WebDAV; derive root key; cache root key in IndexedDB; discard passphrase from intents' memory. The toggle reflects success or failure of this sequence.
- **Error class additions:** consider adding `SetupRequiredError` or similar to distinguish "intents encryption toggle is on but root key not cached" from `NoKeyError` (current Phase 2.6 catch-all). Specifics deferred to Code.

#### Migration / cleanup

- **For the developer's testing setup:** before Phase 2.7 testing begins, manually delete all encrypted envelopes from `/GLANCE/events/` (the shared WebDAV intents directory). They lack any Phase 2.7-compatible key material and will fail. Also delete any IndexedDB intents-related state in both apps. Turn off the intents encryption toggle in both apps, then turn it back on as part of Phase 2.7 testing — first toggle-on writes the shared salt, second toggle-on reads it.
- **For eventual public release:** no production migration story is needed because no end user has ever successfully used intents encryption (Phase 2.5 had cross-app mismatch, Phase 2.6 was UX-broken before public release). Phase 2.7 is the first version that ships to users in a working state.

#### Package PRs (`@glance-apps/intents`)

Specifics deferred to Code's pre-work investigation. The high-level shape:

| Area | Change |
|---|---|
| `crypto/` | Add HKDF-based key derivation helper alongside the existing AES-GCM helpers. The package may not need direct HKDF code if the consumer's `deriveKey` callback handles it; depends on where the boundary makes most sense. |
| `webdav/` | `buildEncryptedEnvelope` and `parseEncryptedEnvelope` signatures unchanged; the consumer-provided `deriveKey` callback's semantics change. |
| Schema | No change to envelope shape. `salt` field still required when `encrypted: true`. |
| Version | Bump to `1.3.0`. CHANGELOG entry explaining the move from PBKDF2-per-envelope to HKDF-from-cached-root-key. |

#### Consumer (dayGLANCE + lastGLANCE) PRs

In each app:

| Area | Change |
|---|---|
| Intents encryption setup | New setup flow on toggle-on: prompt for passphrase if not in memory, fetch-or-write shared salt on WebDAV, derive root key, cache root key in IndexedDB, discard passphrase. |
| Emitter | `deriveKey` callback now runs HKDF against cached intents root key (not PBKDF2 against passphrase). If root key isn't cached, surface activity-log error matching the new "setup not complete" semantics. Do not fall back to plaintext. |
| Poller | Same as emitter on the read side. |
| Settings UI | Toggle copy revised to reflect the one-time setup model: "Uses your cloud sync passphrase. Set up once; remains active across sessions." Or similar — copy decision deferred. |
| Activity log | Error copy revised to reflect the new failure modes: "Intents encryption setup incomplete" replaces "passphrase not available" for the common case. |

#### Test plan

- **Package**: round-trip test in the intents repo: build an encrypted envelope, parse it back, confirm payload matches. Mismatched root key produces `WrongKeyError`. Missing-`salt` envelope produces `MalformedEnvelopeError`.
- **End-to-end (cross-session UX)**: configure intents encryption in both apps. Close and reopen both apps without entering any passphrase. Emit an encrypted intent from one app, confirm the other decrypts it without any passphrase prompt. This is the core UX requirement.
- **End-to-end (cross-app)**: same as Phase 2.6 test plan. Emit encrypted `create` from lastGLANCE, decrypt in dayGLANCE. Emit encrypted `notify` from dayGLANCE, decrypt in lastGLANCE.
- **Setup flow**: with sync encryption already configured in a prior session (passphrase not in memory), enable intents encryption in one app. Confirm the passphrase prompt appears, completes successfully, writes the shared salt to WebDAV, and toggles intents encryption on. Then enable intents encryption in the second app; confirm it reads the existing shared salt and toggles on without prompting for the salt (still needs passphrase since intents needs to derive its root key in this app too).

### Phase 4: Android intent transport + web URL transport (parallel-eligible)

Both transports converge on the same `handleIntent` from Phase 2, so they're additive surfaces, not core changes. Can run parallel to Phase 3.

Android intent transport (dayGLANCE):

| PR | Scope |
|---|---|
| #1 | Manifest: declare `IntentReceiver`, intent filters per `ANDROID_ACTIONS` constant |
| #2 | `IntentReceiver`: parse extras, validate, call `window.DayGlanceNative.onIntent` |
| #3 | Bridge wiring: `onIntent` invokes `handleIntent`, captures result, sends `app.dayglance.RESULT` broadcast |
| #4 | Outbound `app.dayglance.NOTIFY` broadcast: parallel emission alongside WebDAV |
| #5 | Public Tasker-facing spec doc published in dayGLANCE repo's `docs/` |

Web URL transport (dayGLANCE):

| PR | Scope |
|---|---|
| #1 | URL parser at app load: detect `?action=`, parse query string, validate, call `handleIntent` |
| #2 | Toast feedback UI |
| #3 | `query` no-op behavior on web (route to GLANCE tab without state-affecting side effects) |

### Phase 5: lifeGLANCE adopts the protocol (bidirectional)

Sits after lifeGLANCE v1.7 (Android), once the family-roadmap sequencing makes lifeGLANCE ready to take on cross-app work.

User-facing surface: a "track in [other app]" checkbox in each app's create/edit form for the relevant entity type. When checked, the entity is mirrored in the other app, with a visual badge on the card in both apps signaling the linkage. State changes (date, completion) flow via the existing protocol.

| PR | Scope |
|---|---|
| #1 | Add `@glance-apps/intents` dependency |
| #2 | Outbound `create` from lifeGLANCE when "track as dayGLANCE Goal" checked on a future-dated milestone |
| #3 | "Track in lifeGLANCE" checkbox on dayGLANCE Goals; outbound `create` to lifeGLANCE on check |
| #4 | Inbound `create` handler in lifeGLANCE: receives Goal→Milestone push from dayGLANCE, creates a milestone |
| #5 | WebDAV poller in lifeGLANCE for `notify` events filtered on `source_app=app.lifeglance` |
| #6 | Inbound `notify` handler in lifeGLANCE: `rescheduled` updates milestone date, `completed` marks milestone complete, `deleted` prompts the user |
| #7 | Outbound `notify` from lifeGLANCE on milestone date change (so dayGLANCE Goal date stays in sync) |
| #8 | Visual badge UI in both apps for linked records |
| #9 | Standalone-mode detection in lifeGLANCE |

Pre-existing pair linking (user has separate dayGLANCE Goal and lifeGLANCE Milestone that should be linked): not supported. User workaround is to delete one and recreate via the checkbox.

## Test strategy

Three layers:

1. **Package-level tests** (in `@glance-apps/intents` repo): schemas validate correctly, normalizers produce expected outputs, idempotency keys are stable, envelopes round-trip. Pure functions, fast, deterministic, high coverage.
2. **Handler tests** (in dayGLANCE repo): `handleIntent('create', payload)` produces the right database state. One test file per action. Independent of transport.
3. **Transport tests** (per transport, per app): URL parsing, WebDAV file dispatch, Android intent parsing. Verifies wiring, not business logic.

End-to-end tests (lastGLANCE emits `create`, dayGLANCE picks it up, completes it, emits `notify`, lastGLANCE logs CompletionEvent) come last. One or two of these is enough; bulk of confidence comes from layers 1-3.

## Critical-path ordering

Phases 1, 2, 2.5, and 3 shipped. Phase 2.6 was a dead-end branch (resolved cross-app mismatch but broke UX). Phase 2.7 (HKDF-per-envelope with intents-owned root key) is the active work.

**`@glance-apps/intents@1.3.0` (HKDF-based key derivation)** → **dayGLANCE PRs + lastGLANCE counterparts (intents-encryption setup flow + emitter + poller + UI)** → **coordinated release: dayGLANCE v2.11.1 (or v2.12.0) + lastGLANCE v0.1.14**

Sync is not modified in Phase 2.7. `@glance-apps/sync@1.1.0` (the Phase 2.6 release) remains valid but its `deriveKeyForSalt` export is unused by Phase 2.7 — left in place for any other consumer that may want it.

Phase 4 transports (Android intent + web URL) have not started and are parallel-eligible with Phase 2.7.

End-to-end working before polish.

## Open items

- **`uncompleted` semantics if added later**: defensive: ignore for v1 in lastGLANCE; revisit if user feedback demands handling.
- **Milestone completion semantics in lifeGLANCE** (date vs badge): resolve when scoping Phase 5. Doesn't affect the protocol.
- **Activity log UX for decryption failures** in dayGLANCE (Phase 2.5 PR #16): visual treatment for "skipped, couldn't decrypt" entries — distinct from successful events, surfaces enough info for the user to diagnose (timestamp, source_app, "decryption failed: no key" vs "decryption failed: wrong key") without leaking sensitive content.

## What this doc does not cover

- The protocol itself — see `dayglance-intent-protocol.md`
- Family-wide sequencing across apps — see `glance-family-roadmap.md`
- Per-app integration details from the consumer's perspective — see each app's spec doc
- The sync package precedent — see `@glance-apps/sync`'s own repo and docs
