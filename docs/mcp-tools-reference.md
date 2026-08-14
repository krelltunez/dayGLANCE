# dayGLANCE MCP Tool Reference

The complete tool and resource surface of the dayGLANCE MCP server, as registered by
`electron/mcpServer.ts` (per-request factory), `mcpReadTools.ts`, `mcpWriteTools.ts`, and
`mcpResources.ts`. This is the practical companion to the design spec (`mcp-server-spec.md` §5):
the spec explains *why*; this lists *what* — every tool, every parameter, every typed error.

Transport: Streamable HTTP at `http://127.0.0.1:7893/mcp` (port configurable in Settings →
Local Integrations), bearer-token auth. Claude Desktop connects through
[`@glance-apps/mcp-bridge`](https://github.com/glance-apps/mcp-bridge); Claude Code connects
directly (`claude mcp add --transport http`).

## Conventions

- **Dates and times are local** (§5.3): calendar dates are strict `YYYY-MM-DD`, times are
  wall-clock `HH:MM` in the machine's timezone. No UTC, no offsets, no timestamps. Responses
  echo the resolved date and IANA timezone. Times inside a DST gap (or the repeated hour) are
  rejected with a `validation` error naming the reason.
- **Errors are typed** (§5.2): every failure returns `{ error: { code, message } }` with
  `isError: true`. By-design rejections say so in the message — the model should report the
  design to the user, not retry another way.
- **`idempotency_key`** (all write tools, optional): 1–128 chars of `[A-Za-z0-9_.:-]`.
  Replaying the same key returns the first attempt's stored result (`replayed: true`) without
  repeating the write or journaling anything.
- **`device_calendar_event` items are read-only** everywhere: dayGLANCE holds EventKit read
  access only. Every write tool rejects them with `device_calendar_readonly`.
- **Consent gating**: the read surface exists only while the MCP server is enabled; device
  calendar events appear in reads only under the calendar tier; write tools return
  `read_only_mode` unless writes are enabled — all in Settings → Local Integrations.
- **Undo**: every successful write lands in the session write journal, reversible per task or
  in bulk from the bolt button in the app (and the macOS tray). Undone creates go to the
  recycle bin.

## Error codes

| Code | Meaning |
|---|---|
| `validation` | Malformed argument, or a by-design rejection (message says which). |
| `not_found` | No task/block/user with that id. |
| `device_calendar_readonly` | Target is a device calendar event (EventKit read-only). |
| `read_only_mode` | Writes are not enabled in Settings → Local Integrations. |
| `rate_limited` | Write gate: 30 writes/minute sliding window reached. |
| `writes_disabled` | Repeated rate-limit violations auto-disabled writes; re-enable requires user action. |
| `renderer_unavailable` | The dayGLANCE window is not available to answer (never an empty result). |
| `internal` | Unexpected failure; message carries what is known. |

---

## Read tools

### `dayglance_ping`
Connectivity check; touches no user data.
No parameters. Returns `{ ok: true, server: "dayGLANCE MCP" }`.

### `dayglance_get_today`
Today's schedule; resolves the current **local** calendar date on the user's machine — use
this instead of guessing the date.
No parameters. Returns blocks with local times, completion state, the resolved date, and the
IANA timezone. Includes `device_calendar_event` items only under the calendar consent tier.

### `dayglance_get_day`
One local calendar date's schedule. For the current date prefer `dayglance_get_today`.

| Param | Type | Required | Notes |
|---|---|---|---|
| `date` | string | yes | Strict `YYYY-MM-DD`, a real local calendar date. Not a timestamp. |

### `dayglance_list_unscheduled_tasks`
The inbox: tasks not yet scheduled onto a day. Paginated.

| Param | Type | Required | Notes |
|---|---|---|---|
| `limit` | integer | no | Page size 1–200. Default 50. |
| `cursor` | string | no | Opaque cursor from a previous response's `next_cursor`. |

Returns `{ items, truncated, next_cursor, total, timezone }`. Items carry `id`, `title`,
`priority` (0–3), `completed`, and `deadline` / `project_id` / `notes` when set.

### `dayglance_list_users` *(exists only while multi-user mode is on)*
The household members tasks can be assigned to. Returns active users as `{ id, name }`;
the `id` is what `assignee_id` accepts. Resolve names through this list, never guess an id.
No parameters.

### `dayglance_get_goal_progress`
Goal and project progress, duration-weighted, matching what the app shows.

| Param | Type | Required | Notes |
|---|---|---|---|
| `goal_id` | string | no | Narrow to one goal's tree. Unknown id → `not_found`. |
| `window` | `'active'` \| `'all'` | no | Default `'active'`; `'all'` includes archived/completed. |

---

## Write tools

All write tools run the same pipeline, in order: writes-enabled check (`read_only_mode`),
idempotency replay, rate gate (`rate_limited` / `writes_disabled`), argument validation,
then the mutation — which goes through the same store layer as the app's own edits, so sync,
Obsidian writeback, and the tray all react exactly as they would to a UI edit.

### `dayglance_create_task`
Two shapes, decided by `start`: **without** it, an unscheduled inbox task (may carry priority
and deadline); **with** it, a scheduled task placed directly onto the calendar in one call.

| Param | Type | Required | Notes |
|---|---|---|---|
| `title` | string | yes | Non-empty. Stored literally (no sigil parsing). |
| `notes` | string | no | |
| `project_id` | string | no | Attach to a project (ids from `dayglance_get_goal_progress`). |
| `assignee_id` | string | no | **Multi-user only** (absent from the schema otherwise). Ids from `dayglance_list_users`. |
| `priority` | integer | no | **Inbox, non-project only.** 0 none (default), 1 low, 2 medium, 3 high. |
| `deadline` | string | no | **Inbox, non-project only.** Local `YYYY-MM-DD`. |
| `start` | string | no | Local `"YYYY-MM-DD HH:MM"`; with `all_day`, a bare `YYYY-MM-DD`. Presence = scheduled create. |
| `duration_minutes` | integer | no | 1–1440. Default 30. Contradicts `all_day`. |
| `all_day` | boolean | no | With `start` only. |
| `repeat` | — | no | **Rejected**: recurring creation is not supported over MCP. |
| `idempotency_key` | string | no | Also seeds a deterministic task id, so replays converge. |

By-design `validation` rejections: priority/deadline with `start`; priority/deadline with
`project_id`; `all_day` + `duration_minutes`; `all_day` with a time in `start`; any `repeat`.
Unknown `assignee_id` → `not_found`.

### `dayglance_update_task`
Field editor for existing tasks, inbox or scheduled. **Absent leaves a field alone, present
sets it, a field named in `clear_fields` is removed.** Clearing only ever happens through the
explicit list — `null` or empty values never clear.

| Param | Type | Required | Notes |
|---|---|---|---|
| `task_id` | string | yes | Recurring-instance ids are rejected (see below). |
| `title` | string | no | Non-empty; trimmed. Can be set, never cleared. |
| `notes` | string | no | Empty string is a valid *set*; removal goes through `clear_fields`. |
| `priority` | integer | no | 0–3. **Inbox, non-project tasks only.** |
| `deadline` | string | no | Local `YYYY-MM-DD`. **Inbox, non-project tasks only.** |
| `assignee_id` | string | no | **Multi-user only.** Ids from `dayglance_list_users`. |
| `clear_fields` | string[] | no | Accepts only `"notes"`, `"deadline"`, `"assignee"` (assignee: multi-user only). Naming `title` or anything else → `validation`. |
| `idempotency_key` | string | no | |

Also `validation`: setting and clearing the same field in one call; a call that neither sets
nor clears anything. By-design rejections: priority/deadline (set **or** clear) on scheduled
tasks and on project tasks; recurring instances (dedicated error naming the synthetic
`recurring-<template>-<date>` id shape); CalDAV task-calendar tasks; `_native` events.
Not editable here: `project_id`; date/time/duration/completion have their own tools.

### `dayglance_schedule_task`
Schedule an unscheduled inbox task onto a day and time.

| Param | Type | Required | Notes |
|---|---|---|---|
| `task_id` | string | yes | Must be an inbox task; an already-scheduled id → `validation` pointing to `move_block`. |
| `start` | string | yes | Local `"YYYY-MM-DD HH:MM"`. |
| `duration_minutes` | integer | no | 1–1440. Defaults to the task's own duration, then 30. |
| `idempotency_key` | string | no | |

If the inbox task carried a priority or deadline, scheduling **drops them by design** and the
response lists them in `dropped_fields` with a note — tell the user rather than treating it
as an error.

### `dayglance_move_block`
Move a scheduled block to a new local start (same or different day).

| Param | Type | Required | Notes |
|---|---|---|---|
| `block_id` | string | yes | Recurring instances → `validation` (edit the series in dayGLANCE). |
| `new_start` | string | yes | Local `"YYYY-MM-DD HH:MM"`. |
| `idempotency_key` | string | no | |

### `dayglance_resize_block`
Change a scheduled block's duration without moving its start.

| Param | Type | Required | Notes |
|---|---|---|---|
| `block_id` | string | yes | Recurring instances → `validation`. |
| `duration_minutes` | integer | yes | 1–1440. |
| `idempotency_key` | string | no | |

### `dayglance_set_task_completion`
A **setter, not a toggle** — safe to retry, and `completed: false` is the agent's own undo.
Works for scheduled blocks, inbox tasks, and recurring-task instances
(`recurring-<template>-<date>` ids complete exactly one date of the series).

| Param | Type | Required | Notes |
|---|---|---|---|
| `task_id` | string | yes | |
| `completed` | boolean | yes | |
| `idempotency_key` | string | no | |

CalDAV task-calendar tasks are rejected (`validation`): completing one requires a CalDAV
write MCP does not perform.

---

## Resources (read-only)

| URI | Content |
|---|---|
| `dayglance://schedule/today` | Today's blocks and completion state, local date + timezone echoed. |
| `dayglance://schedule/week/current` | The week containing today, starting on the configured week-start day (`week_start_day`, 0 = Sunday). |
| `dayglance://goals/tree` | Goal/project hierarchy with duration-weighted progress — same data as `dayglance_get_goal_progress`. |

All three read over the same renderer path as the tools and respect the same consent tiers;
failures throw with the same code + message text a tool error would carry.

---

*Schema gating recap: `dayglance_list_users`, `assignee_id` (both write tools), and
`"assignee"` in `clear_fields` exist only while multi-user mode is on. The tool list is
rebuilt per request, so toggling multi-user or a consent tier updates what a connected
client sees on its very next request.*
