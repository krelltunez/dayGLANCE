# `@glance-apps/intents` — package planning doc

The build plan, locked decisions, and phase sequencing for the GLANCE family's intent protocol package.

This doc is the source of truth for *how the package is being built*. The protocol itself is specced in `dayglance-intent-protocol.md`; this doc describes the package that implements it and the apps that consume it.

## Status

**Phase 1 in progress.** Schema decisions closed (May 2026). PR #1 (scaffold) is the active piece of work.

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
- WebDAV envelope helpers: `filenameFor`, `parseFilename`, `buildEnvelope`, `parseEnvelope`
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

### Phase 3: lastGLANCE adopts the protocol

Starts when dayGLANCE PRs #3, #7, #9 are merged (the starred critical path above).

| PR | Scope |
|---|---|
| #1 | Add `@glance-apps/intents` dependency; pull in constants and schemas |
| #2 | Per-chore `auto_schedule_to_dayglance` toggle (Dexie v2 migration: add the boolean field) |
| #3 | "Do this today" outbound `create` action, gated on WebDAV being configured |
| #4 | Auto-schedule logic when `auto_schedule_to_dayglance=true` chore crosses cadence threshold |
| #5 | WebDAV poller for inbound `notify`, filters on `source_app=app.lastglance` |
| #6 | Inbound handler: on `event=completed`, log a CompletionEvent with `source="dayglance"`. v1 ignores other events (defensive accept, no action). |
| #7 | Standalone-mode detection: WebDAV configured? dayGLANCE reachable? Hide integration UI accordingly. |
| #8 | Settings UI for the integration |

v1 ignores `uncompleted` events. If a user wants to remove a completion that came from a dayGLANCE un-completion, they delete it manually in lastGLANCE.

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

To get lastGLANCE shipping integration ASAP, the minimum path is:

**Phase 1 (all 8 PRs)** → **Phase 2 PRs #1-3 (handler skeleton + create execution)** → **Phase 2 PRs #7, #9 (WebDAV transport + notify emission)** → **Phase 3 (lastGLANCE)**

Phase 2 PRs #4-6, #8, #10-11 backfill afterward. Phase 4 transports run parallel.

This is the chosen ordering. End-to-end working before polish.

## Open items

- **Repo and npm credentials**: GitHub repo `intents` needs to exist with branch protection mirroring sync; `NPM_TOKEN` secret in repo settings for CI publishing in PR #8.
- **WebDAV endpoint default behavior in dayGLANCE settings UI**: the user-facing label and default-value behavior for "sync endpoint" vs "intent endpoint." Resolve before Phase 2 PR #11.
- **`uncompleted` semantics if added later**: defensive: ignore for v1 in lastGLANCE; revisit if user feedback demands handling.
- **Milestone completion semantics in lifeGLANCE** (date vs badge): resolve when scoping Phase 5. Doesn't affect the protocol.

## What this doc does not cover

- The protocol itself — see `dayglance-intent-protocol.md`
- Family-wide sequencing across apps — see `glance-family-roadmap.md`
- Per-app integration details from the consumer's perspective — see each app's spec doc
- The sync package precedent — see `@glance-apps/sync`'s own repo and docs
