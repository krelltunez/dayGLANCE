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

## Example: complete a task by tapping an NFC tag

The most common automation — stick an NFC tag somewhere (by the door, on the pill bottle, on the bin) and complete a task by tapping your phone to it. No RESULT parsing needed; it's a single fire-and-forget broadcast.

You don't need to *write* anything to the tag — Tasker matches the tag's built-in hardware ID, so a blank tag works.

**1. Capture the tag's ID (once):**
- **New Profile → Event → NFC Tag** (leave the fields blank for now), link it to any throwaway task, and tap your tag. Tasker fills in `%nfc_id`. Note that value (or just Flash `%nfc_id` to read it), then delete the throwaway profile.

**2. Build the real profile:**
- **New Profile → Event → NFC Tag**, set **ID** to the value from step 1 so *only* this tag triggers.
- Linked **Task** → Add action → **Intent**:
  - **Action**: `app.dayglance.COMPLETE`
  - **Package**: `com.dayglance.app`
  - **Extra**: `payload:{"title":"Take out the trash"}`
  - **Target**: **Broadcast Receiver**

That's it — tap the tag, the task is marked complete silently.

**Matching the task:** `COMPLETE` accepts either `title` (fuzzy match, shown above — easiest for a stable/recurring task) or `task_id` (exact). If the title matches more than one open task, dayGLANCE completes the soonest-due one and returns a `warning` saying so. For a one-off task where you have the UUID, use `payload:{"task_id":"a1b2c3d4-..."}` instead — grab the id from the `task_id` field of a CREATE RESULT (see the CREATE recipe above).

**Confirming it worked (optional):** add a RESULT receiver (below) and Flash `%result` — a completion returns `{"success":true,...}`, or `{"success":false,"error":"no matching task"}` if the title didn't match anything.

> **App must be alive:** COMPLETE is a broadcast, so dayGLANCE has to be running (backgrounded is fine). If it's been swiped away, the tap is dropped. If you need it to work even when the app is closed, either set **Target: Activity** (opens the app to complete it) or use the WebDAV transport.

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
   - **Alert → Flash**, Text: `%result` — this dumps the raw JSON so you can confirm the round-trip works.

If the Flash shows `{"success":true,...,"%dg_count_today":0,...}`, the transport is working end-to-end. If nothing flashes, the RESULT profile isn't matching — double-check the action is exactly `app.dayglance.RESULT` and that Tasker is allowed to receive external intents.

### Parsing `%result` into a clean value

Flashing `%result` shows the whole JSON object. To pull out a single count, parse it first. Two ways:

> **Note:** *Variable Convert* is **not** the tool for this — its `JSON Encode` function goes the other way (variables → JSON). And **JavaScriptlet is its own action** (under **Code**), not a Variable Convert function.

**A. JavaScriptlet (most reliable — the `%`-prefixed keys confuse Tasker's built-in JSON parsers):**

Add an action → **Code → JavaScriptlet** *before* the Flash. Read `%result` with `local()` (its name has lowercase letters, so it's a *local* variable — `global()` would return nothing):
```js
var r = JSON.parse(local('result'));
setLocal('today', r['%dg_count_today']);
setLocal('inbox', r['%dg_count_inbox']);
```
Then **Alert → Flash**, Text: `Today: %today · Inbox: %inbox`

**B. Variable Search Replace (no JavaScript):**

Add **Variable → Variable Search Replace**:
- **Variable**: `%result`
- **Search**: `%dg_count_today":(\d+)`
- Tick **Store Matches in Array**, name it e.g. `%m`

The captured number lands in `%m1`, so **Flash** `Today: %m1`.

> **Heads-up — "Not running task … Already running / Abort New Task":** dayGLANCE sends a RESULT for *every* action and also emits NOTIFY broadcasts, so your receiver task can be triggered again while it's still running. If you see that warning, open the receiver task's properties (gear icon) and set **Collision Handling** to **Run Both Together** (or *Queue*) instead of *Abort New Task*. This is a Tasker setting, not a dayGLANCE issue — the first Flash still ran.

### More recipes

Every action's RESULT lands in the **same** `app.dayglance.RESULT` receiver, so real setups usually branch on `%action` and check `success` first. All of these go in a JavaScriptlet reading `local('result')`.

**Pull every QUERY field into clean variables:**
```js
var r = JSON.parse(local('result'));
setLocal('dg_today',   r['%dg_count_today']);
setLocal('dg_overdue', r['%dg_count_overdue']);
setLocal('dg_week',    r['%dg_count_week']);
setLocal('dg_total',   r['%dg_count_total']);
setLocal('dg_inbox',   r['%dg_count_inbox']);
setLocal('dg_next',    r['%dg_next_title']);
setLocal('dg_next_at', r['%dg_next_time']);
```
Then **Flash**: `%dg_today today · %dg_overdue overdue · next: %dg_next at %dg_next_at`

**Route one receiver by action** — `%action` holds the full action string (e.g. `app.dayglance.CREATE`). Add an **If** condition to each downstream action:
- `If %action ~ app.dayglance.QUERY` → parse counts and Flash them
- `If %action ~ app.dayglance.CREATE` → save the new id: **Variable Set** `%last_task_id` to the parsed `task_id` (use it later in a COMPLETE payload)
- `If %action ~ app.dayglance.COMPLETE` → Flash "Completed ✓"

(`~` is Tasker's "matches" operator.)

**Capture the new task's id after CREATE:**
```js
var r = JSON.parse(local('result'));
setLocal('new_id', r.task_id);   // '' if the create failed
```

**Fail loudly when something goes wrong** — `success` is `false` and `error` is populated on any failure:
```js
var r = JSON.parse(local('result'));
setLocal('ok',  r.success);      // "true" / "false" as a string in Tasker
setLocal('err', r.error);
```
Then **If** `%ok ~ false` → **Flash** `dayGLANCE: %err`. A `warning` field (e.g. "task already complete") may be present even when `success` is `true`.

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
