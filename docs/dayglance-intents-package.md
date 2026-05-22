# `@glance-apps/intents` — package planning doc

The build plan, locked decisions, and phase sequencing for the GLANCE family's intent protocol package.

This doc is the source of truth for *how the package is being built*. The protocol itself is specced in `dayglance-intent-protocol.md`; this doc describes the package that implements it and the apps that consume it.

## Status

**Phases 1, 2, and 2.5 intents-package work complete (May 2026).** `@glance-apps/intents@1.0.0` and `@glance-apps/intents@1.1.0` published. dayGLANCE consumes `1.0.0` in production. Phase 2.5 pre-work resolved (see "dayGLANCE PRs" below): one precursor patch release of `@glance-apps/sync` (`1.0.1` → `1.0.2`) adds a `getSessionKey()` export, then dayGLANCE PRs #12-16 are the active work and (along with that sync patch) block Phase 3 (lastGLANCE adoption).

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

**Package work complete (`@glance-apps/intents@1.1.0` published). dayGLANCE PRs are the active work; remain a blocker for Phase 3.**

Added after Phases 1-2 shipped to address the privacy concern that WebDAV intent files can sit on a third-party server (Koofr, Box, Hetzner) in plaintext. Self-hosted users have full control over their WebDAV; users on hosted WebDAV providers do not. Bringing intents encryption to parity with cloud sync's optional encryption closes that gap.

Affects both the `@glance-apps/intents` package (envelope format + helpers) and dayGLANCE (settings UI, emitter, poller). Cleanly additive: plaintext envelopes still work, both forms coexist in the same directory, consumers without keys skip encrypted events with a logged warning.

**Locked decisions:**

- **Same key as cloud sync.** Users who want intents encryption must have cloud sync encryption enabled first; the same passphrase derives the same key, used for both features. Intents encryption is a separate toggle but gated on sync encryption being on. The settings UI hides or disables the intents encryption toggle when sync encryption is off, with copy explaining the prerequisite.
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

| PR | Scope |
|---|---|
| #12 | Upgrade to `@glance-apps/intents@1.1.0` and `@glance-apps/sync@1.0.2`; no behavior change |
| #13 | Settings UI: intents encryption toggle in the integration settings panel; gated on sync encryption being enabled (hidden or disabled with explanatory copy when not). Surface the "uses cloud sync passphrase" note inline. |
| #14 | Emitter (Phase 2 PR #9): when intents encryption is on, call `hasEncryptionReady()` and `getSessionKey()` from `@glance-apps/sync`; pass the `CryptoKey` to `buildEncryptedEnvelope`. Wrap in try/catch for typed errors; surface failures to activity log. Document the fallback behavior when `hasEncryptionReady()` is false. |
| #15 | Poller (Phase 2 PR #7): inspect envelope; if `encrypted: true`, call `parseEncryptedEnvelope` with the `CryptoKey`; if plaintext, call `parseEnvelope`. On any typed error from the encrypted path (`NoKeyError`, `WrongKeyError`, `NotEncryptedError`, `MalformedEnvelopeError`), log distinct activity-log entry and skip event. |
| #16 | Activity log (Phase 2 PR #10): render distinct activity-log entries per error class. `NoKeyError` → "encryption not configured." `WrongKeyError` → "decryption failed (wrong key)." `NotEncryptedError` and `MalformedEnvelopeError` are defensive-only (shouldn't happen in normal operation) and surface as warnings if they do fire. |

**Critical-path subset for Phase 3:** `@glance-apps/sync@1.0.2` must be published before dayGLANCE PR #12. dayGLANCE PRs #12-16 land in parallel with lastGLANCE Phase 3 PRs; lastGLANCE needs both packages at their new versions but does not need dayGLANCE-side encryption to be enabled by any specific user when Phase 3 ships (the encryption is opt-in per app per user).

### Phase 3: lastGLANCE adopts the protocol

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

Phases 1, 2, and 2.5 package work complete. Current critical path to lastGLANCE shipping integration:

**`@glance-apps/sync@1.0.2` patch release (add `getSessionKey()` export)** → **dayGLANCE PR #12 (version bumps)** → **Phase 3 (lastGLANCE)**

Phase 2.5 dayGLANCE PRs #13-16 land in parallel with Phase 3. Phase 4 transports run parallel.

This is the chosen ordering. End-to-end working before polish.

## Open items

- **`uncompleted` semantics if added later**: defensive: ignore for v1 in lastGLANCE; revisit if user feedback demands handling.
- **Milestone completion semantics in lifeGLANCE** (date vs badge): resolve when scoping Phase 5. Doesn't affect the protocol.
- **Activity log UX for decryption failures** in dayGLANCE (Phase 2.5 PR #16): visual treatment for "skipped, couldn't decrypt" entries — distinct from successful events, surfaces enough info for the user to diagnose (timestamp, source_app, "decryption failed: no key" vs "decryption failed: wrong key") without leaking sensitive content.

## What this doc does not cover

- The protocol itself — see `dayglance-intent-protocol.md`
- Family-wide sequencing across apps — see `glance-family-roadmap.md`
- Per-app integration details from the consumer's perspective — see each app's spec doc
- The sync package precedent — see `@glance-apps/sync`'s own repo and docs
