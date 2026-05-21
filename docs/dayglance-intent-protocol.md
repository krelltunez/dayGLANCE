# dayGLANCE intent protocol

> Despite the historical name, this is the universal cross-app contract for the GLANCE family. Any GLANCE app can act as an emitter or consumer of any action; the schema is symmetric. The doc retains "dayglance" framing where the implementation is genuinely dayGLANCE-specific (e.g., the `%dg_` return-variable prefix on Tasker).

## Overview

dayGLANCE exposes a generalized intent protocol for external task creation, completion, navigation, and state queries, plus outbound notifications when tasks originating from external apps change state. The protocol is consumed by Tasker, by the web URL bar, and (planned) by lastGLANCE and any future GLANCE-family app that needs cross-app coordination.

This is the universal cross-app contract for the GLANCE family. Apps coordinate with each other through this protocol and only this protocol — there is no separate hub layer or shared coordination service. Each GLANCE app remains fully usable without any other GLANCE app installed.

One schema, one handler, multiple transports. Inbound: source app doesn't matter: the handler validates the payload and executes the action. Outbound: dayGLANCE emits state changes for tasks that carry a source-app identifier, and consuming apps subscribe to events matching their own app id.

**Transport summary:**

| Transport | Role | Reach |
|---|---|---|
| WebDAV event log | Primary cross-app transport for the GLANCE family | Cross-platform, cross-network, cross-device |
| Android intents | Optimization for Android-to-Android same-device | Single Android device with both apps installed natively |
| Web URL query parameters | User-pasted URLs, browser-bar invocation, web-only callers | Whichever browser session has dayGLANCE loaded |

WebDAV is the transport that makes "complete a chore on my phone while away from home, have lastGLANCE on my desktop find out about it" work. It's also the transport that requires the user to have a WebDAV/Nextcloud backend configured, which is already the norm for the GLANCE family's audience.

## Status

**In active implementation.** The protocol is being implemented via a shared package, `@glance-apps/intents`, following the `@glance-apps/sync` extraction pattern. Schema decisions are locked.

The WebDAV event log is the v1 cross-app transport for the GLANCE family. lastGLANCE ships against it. Android intents are an optimization that ships when Tasker support ships; not on the critical path for GLANCE-family integration.

## Versioning

`schema_version` versions the entire protocol — envelope, all action payloads, all enum values. The implementing package `@glance-apps/intents` tracks the protocol version directly: package version `1.x.y` corresponds to protocol `schema_version` 1, package version `2.0.0` ships protocol `schema_version` 2 and is a coordinated multi-app upgrade.

**Breaking changes (major bump):**

- Removing a field, renaming a field, changing a field's type
- Removing an enum value
- Removing an action
- Changing required/optional status of a field
- Changing normalization behavior in a way that produces different outputs for the same input

**Non-breaking changes (minor bump):**

- Adding an optional field
- Adding a new enum value to a forward-compatible enum (where this spec documents that consumers should tolerate unknown values; `notify.event` qualifies, `priority` does not)
- Adding a new action
- Adding a new return variable to `query`

**Patch changes:**

- Bug fixes in validators or normalizers that bring behavior in line with this spec

## Relationship to deep-linking

Navigation deep-linking (`?view=day&date=2026-04-20` style URLs that open the app in a specific state) shipped in v2.6.0 via PR #12. That mechanism handles view/state routing with no data creation.

This protocol handles data actions: `?action=create&title=...` creates a task. Distinct mechanism, distinct handler, but both share URL-parsing infrastructure at app load. The deep-linking parser is the foundation this protocol's web transport builds on.

---

## Design principles

- **One schema, three transports.** WebDAV event log (cross-platform, cross-network), Android intents (Android same-device optimization), and web URL query parameters (user-pasted URLs) all converge on the same handler.
- **Title-based selection, UID-based execution.** External callers identify tasks by title for human-readable configuration; dayGLANCE resolves to the internal `id` at runtime.
- **All fields optional except where noted.** Intents degrade gracefully if optional fields are omitted.
- **Inline `#tags` supported in titles.** Parsed identically to native task entry.
- **Normalize at the edge.** Accept flexible input formats (e.g. priority as integer or string) and normalize inside the handler so external callers have latitude.
- **Idempotent handlers.** Every action can be processed more than once without harm. `complete` on an already-complete task is a no-op. `create` with matching `source_app` + `source_entity_id` + `due` updates rather than duplicates. `notify` consumers track event ids to dedupe. The WebDAV transport is at-least-once delivery; the handler tolerates that.
- **Return variables follow the `%dg_` convention.** Consistent across all callers where return variables apply (see transport sections).

---

## Actions

Five actions make up the protocol, in two directions. Inbound actions (`create`, `complete`, `open`, `query`) are sent from external callers to dayGLANCE. The outbound action (`notify`) is emitted from dayGLANCE to external apps when tasks with external provenance change state. Each action is defined once here and implemented once in the handler; transport sections below show how to invoke them.

### Inbound: external → dayGLANCE

### `create` — create a new task

Creates a task from any external source.

**Fields:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `title` | String | Yes | Supports inline `#tags` |
| `due` | String | No | ISO 8601; date-only for all-day, date+time for timed |
| `duration` | Integer | No | Minutes; requires `due` with time component |
| `all_day` | Boolean | No | Explicit all-day flag; inferred from `due` format if omitted |
| `deadline` | String | No | YYYY-MM-DD; Inbox tasks only |
| `tags` | String | No | Comma-separated list; merged with any inline `#tags` from `title` |
| `priority` | Integer or String | No | `0`-`3` or `none`/`low`/`medium`/`high`; normalized internally |
| `notes` | String | No | Plain text or markdown |
| `project` | String | No | Project name or ID; matched against existing projects |
| `recurring` | String | No | RRULE syntax or simplified shorthand (see below) |
| `source_app` | String | No | Reverse-DNS id of the creating app (e.g. `app.lastglance`); enables `notify` events back |
| `source_entity_id` | String | No | Opaque id meaningful to the source app; round-tripped in `notify` payloads. Requires `source_app`. |

**Behavior:**

- If `due` is provided, task is scheduled. If omitted, task goes to Inbox.
- If `project` does not match an existing project, task is created without a project (no error).
- Inline `#tags` in `title` are parsed and merged with `tags` field; duplicates deduped.
- `priority` accepts either representation: `0`/`1`/`2`/`3` or `none`/`low`/`medium`/`high`. Handler normalizes to the internal canonical form.
- If `source_app` + `source_entity_id` + `due` match an existing incomplete task, the handler updates that task rather than creating a duplicate. `%dg_warning` indicates the update path was taken. This is the duplicate-prevention mechanism for auto-scheduling consumers like lastGLANCE.

**Priority normalization table:**

| Input | Internal |
|---|---|
| `0` or `none` | none |
| `1` or `low` | low |
| `2` or `medium` | medium |
| `3` or `high` | high |

Case-insensitive on string values. Any other input is treated as unset and logged.

**Recurring syntax:** Full RRULE strings are accepted. A simplified shorthand is also supported for common cases: `daily`, `weekdays`, `weekly`, `monthly`, `yearly`. Shorthand is expanded to RRULE internally.

---

### `complete` — mark a task complete

Marks a named task complete. Primary trigger for NFC workflows, voice automations, and any external completion signal.

**Fields:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `title` | String | Yes | Matched against task titles; case-insensitive |
| `completed_at` | String | No | ISO 8601 timestamp; defaults to now |

**Behavior:**

1. Search incomplete tasks for a title matching `title` (case-insensitive; exact match first, then partial).
2. If exactly one match, mark complete with `completed_at`.
3. If multiple matches, complete the soonest-due matching task and set `%dg_warning` to indicate ambiguity and match count.
4. If no match, set `%dg_success = false` and `%dg_error = "no matching task"`.

**Multiple-match policy:** complete-soonest-due is the chosen behavior. It is predictable, never destructive beyond the one task the user most likely meant, and surfaces ambiguity through the return variable without interrupting the automation flow.

---

### `open` — deep link to a tab

Brings dayGLANCE to the foreground on a specific tab.

**Fields:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `tab` | String | Yes | See tab names below |

**Tab names:**

| Value | Tab | Notes |
|---|---|---|
| `glance` | GLANCE | Default if `tab` is omitted or unrecognized |
| `timeline` | Timeline | |
| `inbox` | Inbox | |
| `goals` | Goals | Only opens if Goals is enabled; falls back to GLANCE |
| `settings` | Settings | |

---

### `query` — read state

Returns current state as `%dg_`-prefixed variables. Callers use these for dashboards, Stream Deck badges, TTS announcements, and conditional automation logic.

**Fields:** `query` takes no parameters in v1. Future versions may add a `scope` field; consumers should not send unknown fields.

**Returned variables:**

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

**"In progress" definition:** a task with a `startTime` and `duration` where current time falls within `startTime` to `startTime + duration`. No new task state is introduced; this uses existing fields.

**"Next up" definition:** the next timed task scheduled for today with a `startTime` after now. More immediately actionable for dashboards and Stream Deck keys than "next by due date." Empty if no more timed tasks remain today.

---

### Outbound: dayGLANCE → external

### `notify` — emit a task state change

dayGLANCE emits `notify` when a task with `source_app` set changes state. Consuming apps subscribe to events matching their own app id and react accordingly. This is the mechanism that lets lastGLANCE log a CompletionEvent when a chore-originated task is checked off inside dayGLANCE, and it generalizes to any future GLANCE-family app that wants bidirectional sync.

`notify` is emitted over whichever transport(s) are active. On WebDAV, it appears as an event file in the shared event log. On Android intents (when both apps are on the same device), it appears as a broadcast. The schema is identical across transports.

**Fields:**

| Field | Type | Always present | Notes |
|---|---|---|---|
| `event_id` | String | Yes | Unique id for this event; consumers use this to dedupe at-least-once delivery |
| `source_app` | String | Yes | Filter: only the matching app should react |
| `source_entity_id` | String | Yes | Opaque id the source app uses to identify the origin record |
| `event` | String | Yes | One of `completed`, `uncompleted`, `deleted`, `rescheduled`, `updated` |
| `task_id` | String | Yes | dayGLANCE's internal task id |
| `title` | String | Yes | Current task title |
| `timestamp` | String | Yes | ISO 8601; when the state change occurred |
| `entity_type` | String | No | Type of entity that changed state; e.g. `task`, `goal`. dayGLANCE sets this on emission; consumers may filter on it or ignore it. |
| `due` | String | If applicable | Current `due` value; present on `rescheduled` and `updated` |
| `previous_due` | String | If applicable | Prior `due` value; present on `rescheduled` |
| `completed_at` | String | If applicable | Present on `completed`; equals `timestamp` |

**Events:**

| Event | Fires when |
|---|---|
| `completed` | Task marked complete (any surface: tap, swipe, `complete` action, etc.) |
| `uncompleted` | Previously-complete task reopened |
| `deleted` | Task deleted (user action or sync) |
| `rescheduled` | `due` changes |
| `updated` | One of these fields changes: `title`, `notes`, `tags`, `priority`, `project`, `recurring`. Explicitly not: `completed_at` (use `completed`/`uncompleted`), `due` (use `rescheduled`), internal/UI state, sort order, focus flags, color changes, tag reorderings. |

Consumers are expected to handle unknown events defensively; new event types may be added in future protocol versions.

**Multi-field changes:** when multiple fields change in a single save (e.g., user edits a task and changes title + priority + notes), this is one `updated` event, not one per field. The event represents the state transition; the payload carries the new state; consumers diff against their own last-known state if they care which fields moved.

**Behavior:**

- `notify` emits regardless of which surface caused the state change. A task completed via the `complete` inbound action still generates a `notify` event if it has `source_app` set.
- Tasks without `source_app` generate no `notify` events. Native dayGLANCE tasks are silent on this channel.
- `notify` is fire-and-forget from dayGLANCE's perspective on the Android intent transport. The WebDAV transport gives effectively at-least-once delivery (the event file stays in the log until garbage-collected). Consumers dedupe on `event_id` and should idempotently apply the same event twice without harm.
- Loopback safety: if a consumer's reaction to `notify` includes calling back into dayGLANCE (e.g. lastGLANCE updates its record and the user then manually re-triggers a schedule), the duplicate-prevention logic in `create` (matching on `source_app` + `source_entity_id` + `due`) prevents runaway loops.

**Return variables:** `notify` is outbound and does not set `%dg_` return variables. Consumers may set their own state in response.

---

## Return variables (inbound actions)

Every inbound action sets these so automations can branch on success:

| Variable | Type | Description |
|---|---|---|
| `%dg_success` | Boolean | `true` if the action completed successfully |
| `%dg_task_id` | String | ID of the affected task (for `create` and `complete`); empty otherwise |
| `%dg_error` | String | Error message if `%dg_success = false`; empty otherwise |
| `%dg_warning` | String | Non-fatal warning (e.g. ambiguous title match); empty otherwise |

---

## Transport: WebDAV event log

The primary cross-app transport for the GLANCE family. Works across platforms (iOS, Android, web, Electron), across networks (home, away, anywhere), and across devices. Each GLANCE app reads and writes a shared event directory in the user's WebDAV/Nextcloud backend; apps poll the directory on a configurable cadence and process new events through the same handler the other transports use.

### Why WebDAV

The GLANCE family's audience already runs Nextcloud or similar WebDAV-capable infrastructure for sync. Reusing that infrastructure as a message bus avoids introducing any new server, hub, or coordination service. The user owns the event log as files in their own storage; they can back it up, audit it, version it. There is nothing to host on the project side.

### Requirements

- The user has a WebDAV endpoint configured in each GLANCE app that participates in cross-app coordination.
- All participating apps point at the same WebDAV endpoint and the same shared parent path (the apps default to `/GLANCE/events/` under the configured WebDAV root; configurable per app for users with non-default layouts).

Apps that don't have WebDAV configured can still be used standalone. Cross-app integration is gated on WebDAV being available; the apps surface this clearly in their integration settings.

### Directory layout

Flat directory, one file per event, tagged with `source_app` (and on `notify`, with whatever filters consumers care about). Writers don't need to know who's subscribed; consumers filter on read.

```
/GLANCE/events/
  20260510T143022Z-7f3a9c.json
  20260510T143108Z-b21e44.json
  20260510T143400Z-c98a01.json
  ...
```

Filename format: `<ISO 8601 basic timestamp>-<short uuid>.json`. The timestamp prefix makes chronological listing trivial and keeps the most recent events near the top of any sorted view. The uuid suffix prevents collisions when two apps emit events in the same second.

### File format

Each file is a single JSON object representing one protocol message:

```json
{
  "schema_version": 1,
  "event_id": "20260510T143022Z-7f3a9c",
  "emitted_at": "2026-05-10T14:30:22Z",
  "emitted_by": "app.dayglance",
  "action": "notify",
  "payload": {
    "event": "completed",
    "source_app": "app.lastglance",
    "source_entity_id": "chore_42",
    "task_id": "tsk_8a91",
    "title": "Replace HVAC filter",
    "timestamp": "2026-05-10T14:30:22Z",
    "completed_at": "2026-05-10T14:30:22Z"
  }
}
```

Top-level fields are transport metadata; the `payload` object carries the action's schema as defined in the Actions section above. `action` can be any of the five protocol actions (`create`, `complete`, `open`, `query`, `notify`). In practice `notify` is the most common over WebDAV, but the channel is general; any app can emit any action.

### Reading and writing

**Writing:** PUT a new file at `/GLANCE/events/<timestamp>-<uuid>.json`. WebDAV PUT is atomic per-file; partial writes are not a concern.

**Reading:** PROPFIND on `/GLANCE/events/` with `Depth: 1`. Filter the returned listing by filename (process anything newer than the last-processed `event_id`). GET each new file, parse, dispatch through the handler.

**Cursor tracking:** Each app stores its own "last processed event_id" locally (not in the WebDAV log). Polling reads the directory, filters out anything ≤ cursor, processes new events in chronological order, advances cursor. Idempotency is required (and built into the handler) so reprocessing a duplicate event is harmless.

### Polling cadence

Configurable per app, with sensible defaults:

- **Foreground:** 2 minutes default. Configurable from 30 seconds to 30 minutes.
- **Background:** 15 minutes default. Configurable from 5 minutes to 24 hours.

The "real-time-ish" feel on foregrounded apps is good enough for the use cases that motivate cross-app integration (completion logging, occasional cross-device task creation). Cross-network propagation latency is a function of polling interval plus WebDAV sync latency; users on aggressive intervals see updates within a couple of minutes.

### Retention and garbage collection

Events are not deleted on processing. They remain in the log as a permanent record the user owns and can inspect.

Auto-delete after N days, default 30, configurable per app. Each app's GC pass runs on a slow cadence (e.g. once per app launch, or once per day in the background) and deletes events older than the configured retention window.

GC is best-effort. If two apps both try to delete the same event, one of them gets a 404 and treats it as success. If no app runs GC for a long time, the log grows without bound but nothing breaks; the cost is WebDAV storage and slower directory listings.

### Multi-app cursor coordination

Apps don't coordinate cursors with each other. Each app tracks its own cursor independently. A new app installed later starts with no cursor and processes whatever events are still in the log; if the user wants a clean slate they can set the cursor to "now" on first run.

### Visibility into the event log (per-app surfacing)

Each app should surface a view of recent events as a built-in "log" or "activity" panel. The user can see what crossed the wire, when, and from where. This is on-brand for the audience (self-hosters value visibility into their own data flows) and makes debugging cross-app issues straightforward.

### Conflicts and ordering

The log is append-only in practice; no app modifies another app's events. Within a single device's processing pass, events are applied in chronological order by filename timestamp. Cross-device ordering is best-effort: if two devices emit events in the same minute, both events apply in whichever order they happen to be processed, and the handler's idempotency tolerates this.

The duplicate-prevention logic in `create` (`source_app` + `source_entity_id` + `due` matching) handles the most common ordering hazard: two devices both auto-scheduling the same chore before either has synced.

### Return values over WebDAV

Inbound actions emitted over WebDAV do not return synchronous results. The originating app discovers the outcome by observing subsequent `notify` events (e.g. firing a `create` and watching for the resulting `created` notification, when that event is added in a future revision). For v1, the actions that benefit most from WebDAV (`create` from lastGLANCE, `notify` from dayGLANCE) are fire-and-forget on the sending side; consumers don't need synchronous return values to do their job.

The `%dg_` return variables remain meaningful only on the Android intent transport (Tasker plugin variables) and the web URL transport (UI toast). They are not part of the WebDAV transport.

### Future: GLANCEcloud

For users who want cross-app integration but don't self-host, a future hosted product called **GLANCEcloud** would provide managed WebDAV (or WebDAV-equivalent) infrastructure. Architecturally, GLANCEcloud is a deployment option for the same transport the apps already speak. It's not a new protocol, not a hub, not a coordination service. Apps don't know whether their configured endpoint is a self-hosted Nextcloud or GLANCEcloud; the transport adapter is identical. GLANCEcloud is not on the v1 critical path; it's a separate beat with its own planning cycle.

---

## Transport: Android intents

Optimization for the Android-to-Android same-device case. When both apps are installed natively on the same Android device, intents provide a faster, lower-latency path than WebDAV polling. When that's not the case (different devices, non-Android platforms, no WebDAV available on one side), the WebDAV transport is the path.

Inbound actions are handled by a single `BroadcastReceiver` (`IntentReceiver`) registered in the Android manifest. The receiver does not require the app to be in the foreground. Outbound `notify` is a separate broadcast that consuming apps register to receive.

When both transports are active (Android with both apps installed *and* WebDAV configured), care is needed to avoid duplicate processing: dayGLANCE emits over both channels, and the consumer's idempotency (dedup on `event_id`) handles the case where both copies of the same event arrive. Recommended: each consumer disables the slower transport when it knows the faster one is available, but at-least-once + idempotency is the safety net.

**Inbound intent actions:**

| Protocol action | Android intent action |
|---|---|
| `create` | `app.dayglance.CREATE` |
| `complete` | `app.dayglance.COMPLETE` |
| `open` | `app.dayglance.OPEN` |
| `query` | `app.dayglance.QUERY` |

Extras map directly to the field names in each action's table above (e.g. `title`, `due`, `priority`).

**Outbound intent action:**

| Protocol action | Android intent action |
|---|---|
| `notify` | `app.dayglance.NOTIFY` |

dayGLANCE sends this as a broadcast whenever a task with `source_app` set changes state. Extras carry the `notify` payload fields (`source_app`, `source_entity_id`, `event`, `task_id`, `title`, `timestamp`, and event-specific fields). Consuming apps register a receiver for `app.dayglance.NOTIFY` and filter on `source_app` to ignore events meant for other consumers.

**Manifest registration (dayGLANCE side, inbound):**

```xml
<receiver android:name=".IntentReceiver" android:exported="true">
  <intent-filter>
    <action android:name="app.dayglance.CREATE" />
    <action android:name="app.dayglance.COMPLETE" />
    <action android:name="app.dayglance.OPEN" />
    <action android:name="app.dayglance.QUERY" />
  </intent-filter>
</receiver>
```

**Manifest registration (consumer side, outbound):**

```xml
<receiver android:name=".DayGlanceNotifyReceiver" android:exported="true">
  <intent-filter>
    <action android:name="app.dayglance.NOTIFY" />
  </intent-filter>
</receiver>
```

Each consuming app filters incoming `NOTIFY` broadcasts by checking the `source_app` extra matches its own app id; events for other consumers are ignored.

**Return variables over broadcast (inbound actions only):**

Results are sent back via a standard broadcast that Tasker intercepts as plugin variables:

```kotlin
val result = Intent("app.dayglance.RESULT")
result.putExtra("dg_success", success)
result.putExtra("dg_task_id", taskId)
result.putExtra("dg_error", error)
// ...
sendBroadcast(result)
```

---

## Transport: web URL

The inbound actions are invokable via URL query parameters when dayGLANCE is loaded in a browser. The URL parser runs at app load and delegates to the shared handler. The outbound `notify` action has no URL-bar equivalent (URLs are user-driven, one-shot, and not a subscription channel); web consumers receive `notify` events via the WebDAV transport instead.

**URL format:**

```
https://dayglance.app/?action=<action>&<field>=<value>&...
```

**Examples:**

```
https://dayglance.app/?action=create&title=Take%20out%20bins%20%23home&due=2026-04-25&priority=medium

https://dayglance.app/?action=complete&title=Feed%20cat

https://dayglance.app/?action=open&tab=inbox
```

**Parameter conventions:**

- All field names match the Android intent extras exactly (one schema).
- Values are URL-encoded per standard rules.
- Boolean fields accept `true`/`false` (case-insensitive).
- Comma-separated values (e.g. `tags`) are encoded as a single URL-encoded string: `tags=home%2Cerrands`.

**Return variables:** on web, return variables are not applicable in the Tasker sense. Instead, the handler shows a toast or inline confirmation in the UI indicating success or failure. Programmatic callers (e.g. another web app opening dayGLANCE) should check for the expected state change rather than relying on return values.

**Query action on web:** the `query` action returns state, but the web URL transport is not the right channel for programmatic state reads (use the Android intent channel for same-device Android, or a future dedicated API). When `?action=query` is loaded, the app opens to the GLANCE tab and no-ops.

---

## Shared handler

All transports converge on a single internal function:

```javascript
// Called by the Android receiver via the DayGlanceNative bridge,
// by the web URL parser on app load,
// and by the WebDAV poller on each new event file.
handleIntent(action, payload) -> result
```

The handler:

1. Validates the payload against the schema for the requested action.
2. Normalizes flexible inputs (e.g. priority integer/string).
3. Checks idempotency: if this `event_id` (notify) or `source_app` + `source_entity_id` + `due` triple (create) has already been processed, treat as a no-op or update accordingly.
4. Executes the action against the existing data model.
5. Returns a result object for the transport layer to format (broadcast extras on Android, toast/UI on web, written-event-file on WebDAV).

All business logic lives in the JS layer. The Android receiver is a thin adapter that passes data through the existing `DayGlanceNative` bridge:

```javascript
window.DayGlanceNative.onIntent(action, payload);
```

The WebDAV poller is similarly thin: it reads new event files, parses, and calls `handleIntent(action, payload)` once per event.

No logic is duplicated in native code or in transport adapters.

---

## Consumers

### Tasker

External users build Tasker profiles that send the Android intents. Public documentation covers intent names, field names, and example profiles. Tasker is a same-device Android consumer, so it uses the Android intent transport directly; no WebDAV involvement on the Tasker side.

**NFC workflow (the distinctive case):**

1. User writes an NFC tag using any NFC-writing app.
2. Tag triggers a Tasker profile.
3. Profile sends `app.dayglance.COMPLETE` with `title` set to the task name.
4. dayGLANCE marks the task complete without needing to be open.

Suggested user-facing copy:

> "Tap an NFC tag to mark a dayGLANCE task complete. No need to open the app. Attach tags to physical objects: your desk, gym bag, coffee maker, front door. Configure once in Tasker."

**Home Assistant bridge:** HA automations send HTTP webhooks to a Tasker HTTP listener, which fires the appropriate dayGLANCE intent. A direct HA integration can replace the Tasker intermediary later without changing the underlying protocol.

### lastGLANCE

lastGLANCE is the GLANCE-family consumer the bidirectional design was built around. It uses the protocol in both directions, primarily over the WebDAV transport (which is what makes "complete on phone away from home, see it on home desktop" work). When both apps are running on the same Android device, the Android intent transport may be used as an optimization.

- **Outbound from lastGLANCE:** fires `create` against dayGLANCE, either manually (user taps "do this today") or automatically when a chore crosses its cadence threshold. Every `create` includes `source_app=app.lastglance` and a `source_entity_id` matching the lastGLANCE-side chore id.
- **Inbound to lastGLANCE:** subscribes to `notify` events (polling the WebDAV log, registering for `app.dayglance.NOTIFY` broadcasts on Android, or both), filters for `source_app=app.lastglance`, and logs a CompletionEvent with `source="dayglance"` whenever the `event=completed` case fires.

Duplicate prevention is handled by the `create` behavior noted above: dayGLANCE matches on `source_app` + `source_entity_id` + `due` and updates rather than duplicating. This means lastGLANCE auto-scheduling a chore and the user subsequently triggering it manually results in one task, not two, even across devices.

lastGLANCE must run usefully without dayGLANCE installed *and* without WebDAV configured. The integration layer is a power-up, not a dependency. lastGLANCE detects each prerequisite independently (dayGLANCE presence, WebDAV configuration) and hides the relevant UI when either is missing.

### lifeGLANCE

lifeGLANCE adopts the protocol for bidirectional Goal↔Milestone linking with dayGLANCE. Either app can originate the linked record: a user can create a milestone in lifeGLANCE and check "track as dayGLANCE Goal," or create a Goal in dayGLANCE and check "track in lifeGLANCE." Whichever side originates emits an outbound `create` to the other, with appropriate `source_app` provenance (`app.lifeglance` when lifeGLANCE owns the canonical record, dayGLANCE-native when dayGLANCE does). State changes flow via `notify`: date changes on either side propagate to the other; Goal completion in dayGLANCE marks the corresponding milestone as completed in lifeGLANCE.

This consumer is planned after lifeGLANCE v1.7 (Android). The protocol itself supports the integration with no schema changes beyond the additions already in v1.0.0; the work is on each app's consumer side.

---

## Shared-protocol efficiencies

- **Schema designed once.** Tasker, lastGLANCE, and future apps target the same fields.
- **Bidirectional pattern designed once.** `source_app` + `source_entity_id` provenance and the `notify` event handle any future consumer that needs two-way sync without schema changes.
- **Return variables designed once.** `%dg_task_id`, success flags, error strings share one contract where return variables apply.
- **Error handling built once.** Invalid payloads, missing required fields, and sync conflicts are handled in a single place.
- **Testing done once.** All transports converge on the same handler. Tests target the handler, not each caller. A consumer using one transport works the same as a consumer using another.
- **Documentation done once.** Future apps target the same protocol; docs scale across consumers without duplication.

---

## Resolved decisions

The following were originally listed as open and have been locked:

| Decision | Resolution |
|---|---|
| Multiple title match on `complete` | Complete soonest-due + `%dg_warning` (described in the `complete` section above) |
| "In progress" definition | Active timed window: task with `startTime` and `duration` where current time falls within `startTime` to `startTime + duration` |
| "Next up" definition | Next timed task today with a `startTime` after now |
| Web transport for `query` | No-op + UI: opens to GLANCE tab without performing a state read |

---

## Build order

The package and consumer implementations follow this sequence:

1. `@glance-apps/intents@1.0.0` is published as the shared package containing schemas, normalizers, idempotency helpers, and WebDAV envelope helpers.
2. dayGLANCE consumes the package, implements the shared `handleIntent` handler, ships the WebDAV transport and outbound `notify` emission.
3. lastGLANCE consumes the package, wires outbound `create` and inbound `notify` consumption.
4. Android intent transport and web URL transport ship in dayGLANCE as additive surfaces over the same `handleIntent`.
5. lifeGLANCE adopts the package for bidirectional Goal↔Milestone integration.
