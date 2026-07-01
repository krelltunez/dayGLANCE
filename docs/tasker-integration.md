# dayGLANCE Tasker Integration

This guide explains how to automate dayGLANCE from Tasker (or any Android app that can send broadcasts) using the intents transport.

---

## Overview

dayGLANCE exposes four inbound broadcast actions that you can fire from Tasker, Macrodroid, Automate, or any app with `sendBroadcast` capability. Each action accepts a `payload` String extra containing a JSON object with the action's parameters.

When the action is processed, dayGLANCE sends an outbound `app.dayglance.RESULT` broadcast that you can receive in Tasker to check the outcome. dayGLANCE also emits `app.dayglance.NOTIFY` broadcasts whenever tasks change state (completed, rescheduled, updated, deleted).

> **Important:** dayGLANCE must be running for broadcasts to be processed — but it does **not** need to be in the foreground. Intents fired while the app is backgrounded are handled live, as long as the app has not been swiped away / killed by the system. For fully unattended automation (e.g. creating tasks while the app is closed), use the WebDAV transport instead.

---

## Supported inbound actions

| Action | Description |
|--------|-------------|
| `app.dayglance.CREATE` | Create a new task |
| `app.dayglance.COMPLETE` | Mark a task complete |
| `app.dayglance.OPEN` | Open the app and navigate to a specific task or tab |
| `app.dayglance.QUERY` | Request current task counts (response via RESULT broadcast) |

### Payload format

All four actions share the same broadcast structure. The payload is passed as a single `payload` **String** extra containing a JSON object:

```
Action:   app.dayglance.CREATE          (or COMPLETE / OPEN / QUERY)
Package:  com.dayglance.app             (required when sending from Tasker)
Extra:    payload  (String)  {"title":"Buy milk","due":"2026-06-10"}
```

---

## Action payloads

### CREATE

Creates a new task. `title` is required; all other fields are optional.

| Field | Type | Description |
|-------|------|-------------|
| `title` | string (required) | Task title. May include `#tag` syntax. |
| `due` | string | ISO 8601 date or datetime with offset (`2026-06-10` or `2026-06-10T09:00:00+01:00`). |
| `priority` | `"low"` \| `"medium"` \| `"high"` | Task priority. |
| `tags` | string[] | Array of tag strings (without `#`). |
| `notes` | string | Free-text notes body. |
| `project` | string | Project name or ID to assign the task to. |
| `source_app` | string | Identifier of the creating app (used for NOTIFY callbacks). |
| `source_entity_id` | string | Stable ID of the originating entity in the source app. |

**Example payload:**
```json
{"title":"Review pull request","due":"2026-06-10T14:00:00+01:00","priority":"high","tags":["work","dev"],"source_app":"tasker","source_entity_id":"task-42"}
```

**Result extras:**
- `success`: `true`
- `task_id`: the UUID of the newly created task

---

### COMPLETE

Marks an existing task complete. Identify the task by its `task_id` (UUID) or by `title` (fuzzy match).

| Field | Type | Description |
|-------|------|-------------|
| `task_id` | string | UUID of the task (preferred). |
| `title` | string | Title to fuzzy-match if `task_id` is not known. |

**Example payload:**
```json
{"task_id":"a1b2c3d4-..."}
```

**Result extras:**
- `success`: `true`
- `warning`: present if the task was already complete

---

### OPEN

Opens the app and optionally navigates to a specific task or tab.

| Field | Type | Description |
|-------|------|-------------|
| `task_id` | string | Open the task detail view for this UUID. |
| `tab` | `"glance"` \| `"timeline"` \| `"inbox"` \| `"goals"` | Navigate to this tab. |

**Example payload:**
```json
{"tab":"goals"}
```

> **Target must be Activity, not Broadcast Receiver.** Unlike CREATE / COMPLETE / QUERY (which just mutate state or return data and work fine as broadcasts), OPEN needs to bring dayGLANCE to the foreground. Android does not let a background broadcast launch an activity, so if you send OPEN as a **Broadcast Receiver** the tab will change silently underneath but the app won't come forward. In Tasker's Intent action, set **Target: Activity** and **Package: `com.dayglance.app`** for OPEN.

---

### QUERY

Returns the current task counts. QUERY produces **no visible effect in dayGLANCE itself** — it only replies with an `app.dayglance.RESULT` broadcast. To see anything, you must set up a second Tasker profile to receive that broadcast (see [Receiving the RESULT broadcast](#receiving-the-result-broadcast-in-tasker) below) and, e.g., Flash `%result`.

No required payload fields. You may pass an empty JSON object `{}`.

**Result:** the `app.dayglance.RESULT` broadcast carries a `result` String extra (surfaced in Tasker as `%result`) containing a JSON object with `success: true` plus these count/next-up fields:

| Key | Meaning |
|-----|---------|
| `%dg_count_today` | Tasks scheduled for today |
| `%dg_count_overdue` | Scheduled tasks with a date before today |
| `%dg_count_week` | Tasks scheduled today through the next 6 days |
| `%dg_count_total` | All incomplete tasks (scheduled + inbox) |
| `%dg_count_inbox` | Incomplete inbox (unscheduled) tasks |
| `%dg_in_progress_title` | Title of the task in progress right now (empty if none) |
| `%dg_in_progress_end` | End time of the in-progress task (`HH:MM`) |
| `%dg_in_progress_remaining_min` | Minutes left in the in-progress task |
| `%dg_next_title` | Title of the next upcoming task today (empty if none) |
| `%dg_next_time` | Start time of the next task (`HH:MM`) |

Note the keys are already `%`-prefixed inside the JSON. They are **not** delivered as individual Tasker variables automatically — you get the whole object as the `%result` **string** and parse it (JSON parser / Variable Split) to pull out a value.

---

## Tasker example: create a task

1. **New Task** → Add action → **Intent**
2. Set:
   - **Action**: `app.dayglance.CREATE`
   - **Package**: `com.dayglance.app`
   - **Extra**: `payload:{"title":"Call dentist","due":"2026-06-11","priority":"medium"}`
   - **Target**: **Broadcast Receiver**
3. Optionally add a second action to receive the result (see below).

---

## Receiving the RESULT broadcast in Tasker

Every action (including QUERY) replies with an `app.dayglance.RESULT` broadcast, but **nothing displays it for you** — you have to receive it in a separate profile.

1. Create a **Profile** → **Event** → **System** → **Intent Received**
2. Set **Action** to `app.dayglance.RESULT`
3. In the linked task, read:
   - `%action` — the action that was handled (e.g. `app.dayglance.CREATE`)
   - `%result` — JSON string with the result object

### Example: show QUERY counts in a toast

Pair a QUERY sender with a RESULT receiver:

1. **Sender task** → Add action → **Intent**
   - **Action**: `app.dayglance.QUERY`
   - **Package**: `com.dayglance.app`
   - **Extra**: `payload:{}`
   - **Target**: **Broadcast Receiver**
2. **Receiver profile** → **Event** → **Intent Received**, **Action**: `app.dayglance.RESULT`, linked task:
   - **Variable → Java Script(let)** or a **JSON Read** action to parse `%result`, or simplest for a quick test:
   - **Alert → Flash**, Text: `%result` — this dumps the raw JSON so you can confirm the round-trip works.
   - To show just the today count: parse `%result` (e.g. Tasker's **Variable → Variable Convert → JSON Read**, giving `%dg_count_today`) then **Flash** `Today: %dg_count_today`.

If the Flash shows the JSON, the transport is working end-to-end. If nothing flashes, the RESULT profile isn't matching — double-check the action is exactly `app.dayglance.RESULT` and that Tasker is allowed to receive external intents.

---

## Outbound NOTIFY broadcast

dayGLANCE fires `app.dayglance.NOTIFY` whenever a task with a `source_app` + `source_entity_id` changes state. This lets the originating app react to completions, reschedules, etc.

**Extra:**
- `payload` (String) — full notify envelope as a JSON string

**Covered events:** `completed`, `uncompleted`, `deleted`, `rescheduled`, `updated`.

### Receiving NOTIFY in Tasker

1. **Profile** → **Event** → **Intent Received**, Action: `app.dayglance.NOTIFY`
2. In the linked task, parse `%payload` with a JSON parser or Variable Split action.

---

## Troubleshooting

- **Nothing happens:** Make sure dayGLANCE is still running (backgrounded is fine, but not swiped-away/killed). Broadcasts sent while the app is closed are not queued.
- **Task not found (COMPLETE):** Pass `task_id` instead of `title` for reliable matching.
- **No RESULT received:** Check that Tasker has permission to receive broadcasts from other apps. Ensure your intent filter matches `app.dayglance.RESULT` exactly.
- **For set-and-forget automation** (creating tasks without the app open): use the WebDAV transport — dayGLANCE polls a WebDAV directory for incoming intent files even when backgrounded.
