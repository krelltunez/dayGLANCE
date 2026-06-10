# dayGLANCE Tasker Integration

This guide explains how to automate dayGLANCE from Tasker (or any Android app that can send broadcasts) using the intents transport.

---

## Overview

dayGLANCE exposes four inbound broadcast actions that you can fire from Tasker, Macrodroid, Automate, or any app with `sendBroadcast` capability. Each action accepts a `payload` String extra containing a JSON object with the action's parameters.

When the action is processed, dayGLANCE sends an outbound `app.dayglance.RESULT` broadcast that you can receive in Tasker to check the outcome. dayGLANCE also emits `app.dayglance.NOTIFY` broadcasts whenever tasks change state (completed, rescheduled, updated, deleted).

> **Important:** dayGLANCE must be running and in the foreground (or at least not killed) for broadcasts to be processed. For fully unattended automation (e.g. creating tasks while the app is closed), use the WebDAV transport instead.

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
{"tab":"inbox"}
```

---

### QUERY

Returns the current task counts. The response arrives as an `app.dayglance.RESULT` broadcast.

No required payload fields. You may pass an empty JSON object `{}`.

**Result extras:**
- `success`: `true`
- `counts`: JSON object with today's task counts

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

1. Create a **Profile** → **Event** → **Intent Received**
2. Set **Action** to `app.dayglance.RESULT`
3. In the linked task, read:
   - `%action` — the action that was handled (e.g. `app.dayglance.CREATE`)
   - `%result` — JSON string with the result object

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

- **Nothing happens:** Make sure dayGLANCE is running. Broadcasts sent while the app is closed are not queued.
- **Task not found (COMPLETE):** Pass `task_id` instead of `title` for reliable matching.
- **No RESULT received:** Check that Tasker has permission to receive broadcasts from other apps. Ensure your intent filter matches `app.dayglance.RESULT` exactly.
- **For set-and-forget automation** (creating tasks without the app open): use the WebDAV transport — dayGLANCE polls a WebDAV directory for incoming intent files even when backgrounded.
