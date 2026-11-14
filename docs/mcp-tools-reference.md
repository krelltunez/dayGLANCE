# dayGLANCE MCP Tool Reference

The complete tool and resource surface of the dayGLANCE MCP server, as registered by
`electron/mcpServer.ts` (per-request factory), `electron/mcpWriteTools.ts` and
`electron/mcpJournalRead.ts` (the write journal read back), with the read
tools and resources from `@glance-apps/dayglance-mcp` (`packages/dayglance-mcp`: `readTools.js`,
`resources.js`, answered by its read model). This is the practical companion to the design spec (`mcp-server-spec.md` §5):
the spec explains *why*; this lists *what* — every tool, every parameter, every typed error.

Transport: Streamable HTTP at `http://127.0.0.1:7893/mcp` (port configurable in Settings →
Local Integrations), bearer-token auth; the listener is `@glance-apps/mcp-host`'s
(`packages/mcp-host`). Claude Desktop connects through
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
- **`routine` items are read-only** everywhere, and they **occupy the time they cover**. Treat a
  routine block as busy when looking for a free slot. Every write tool rejects them with
  `routine_readonly`: routines are managed in the dayGLANCE routines dashboard, whose write shape
  is not a task mutation. Routines exist only for the current day, so past and future dates never
  carry them. Writing to time a routine covers is refused with `routine_conflict`, and dayGLANCE
  will NOT shift your task to the next free slot, so read the day first when choosing a time.
- **Consent gating**: the read surface exists only while the MCP server is enabled; device
  calendar events appear in reads only under the calendar tier; write tools return
  `read_only_mode` unless writes are enabled — all in Settings → Local Integrations.
- **Undo**: every successful write lands in the session write journal, reversible per entity
  (task, goal or project) or in bulk from the bolt button in the app (and the macOS tray). Undone
  task creates go to the recycle bin; an undone goal or project create is removed with the same
  sync tombstone the app's own delete writes. `dayglance_list_mcp_writes` reads the journal back
  (this session's MCP writes only, not the app's own edits).
- **No deletes, no archiving** (owner, 2026-10-04): the surface has no delete tool for anything,
  and `status` on goals accepts `active` or `completed` only, on projects also `on-hold`. Archiving and deleting
  stay the user's own step in dayGLANCE. The one way an assistant's creation leaves the store is
  the user's undo.

## Error codes

| Code | Meaning |
|---|---|
| `validation` | Malformed argument, or a by-design rejection (message says which). |
| `not_found` | No task/block/user/goal/project/area/subtask with that id. |
| `device_calendar_readonly` | Target is a device calendar event (EventKit read-only). |
| `calendar_event_readonly` | Target is an event imported from a calendar feed; the feed owns it. |
| `note_changed` | A description write into a linked Obsidian note was refused because the note changed since `description_base` was read. Nothing was written. |
| `routine_readonly` | Target is a routine block. Routines are read-only over MCP by design. |
| `routine_conflict` | The requested time overlaps a routine block. dayGLANCE will not shift the task for you; pick a non-overlapping time. |
| `read_only_mode` | Writes are not enabled in Settings → Local Integrations. |
| `rate_limited` | Write gate: 30 writes/minute sliding window reached. |
| `writes_disabled` | Repeated rate-limit violations auto-disabled writes; re-enable requires user action. |
| `renderer_unavailable` | The dayGLANCE window is not available to answer (never an empty result). |
| `internal` | Unexpected failure; message carries what is known. |

---

## Block types

Every block returned by `dayglance_get_today`, `dayglance_get_day`, and the schedule resources
carries a `type`. All of them occupy the time they cover.

| `type` | What it is | Writable |
|---|---|---|
| `task` | An ordinary dayGLANCE task placed on the calendar. | yes |
| `recurring_task` | One occurrence of a repeating series, with a synthetic `recurring-<id>-<date>` id. Carries `series_id`, `series_start_date` and `repeat` (the `dayglance_create_task` shape). | complete with `dayglance_set_task_completion`; edit with `dayglance_update_recurring_task`; move/resize rejected |
| `device_calendar_event` | An event from the device calendar (EventKit). Carries `read_only: true`. Only under the calendar consent tier. | no |
| `calendar_event` | An event imported from an ICS or CalDAV calendar feed. Carries `read_only: true`; the feed owns it. Every write tool rejects it with `calendar_event_readonly`. | no |
| `routine` | A routine block placed on today's timeline, id `routine-<id>`. Carries `read_only: true`. | no |

Branch on `read_only` rather than on `type`: more than one type carries it, and more may later.

**`continues_from`: a task running past midnight.** A timed task belongs to the date it starts on,
and its block there carries its full `duration_minutes` (up to 24 hours), so its end may lie on the
next date. That next date's `blocks` then include the part after midnight as a block of its own,
marked with `continues_from`:

| Field | Meaning |
|---|---|
| `continues_from` | the `YYYY-MM-DD` the task started on (the previous date) |
| `id`, `type`, `title`, `completed`, … | the task's own, unchanged: it is the **same** task, not a second one |
| `date` | the date being read |
| `start_time` | `"00:00"` |
| `duration_minutes` | the minutes it still runs after midnight (never past this date's own midnight) |

Treat that time as busy: the task occupies it, and every frame's `available_slots` on that date is
already net of it. Do not count it as another task on that date, and do not write to it as one: a
write takes the task's `id` as usual, and acts on the task on the date it started. A recurring
occurrence's continuation keeps its `recurring-<series>-<date>` id, whose date is the one it started
on, so completing it completes that occurrence. A task ending exactly at midnight has no
continuation. Only one date ahead: an event longer than a day (an imported one) shows its first
24 hours after midnight.
A `task` with `source: "caldav_tasks"` comes from a CalDAV task calendar: it is a task, but
editing and completing it need a CalDAV write MCP does not perform, so those are rejected.

Blocks and inbox items carry `assignee_id` when the task is assigned (multi-user), and inbox
items carry `duration_minutes`, the duration scheduling will default to.

**`link`** marks a task another GLANCE app created: `{ app, id }`, the app's short name
(`"lastglance"`) and the item's id there. From lastGLANCE that is a chore sent to dayGLANCE (`id`
is the chore's, for `lastglance_get_chore`), a reach-out to a person (the person's id) or a
birthday or date (`<date id>:<year>`). Completing, reopening, rescheduling or deleting a linked
task is reported back to that app through the GLANCE integration, as when the user does it in
dayGLANCE: completing a chore's task here completes the chore there, so do not complete it in both
apps. Absent on everything else.

**`created_at` and `completed_at`** ride every inbox item and every `task` and `recurring_task`
block (not events or routines). Each is `{ date, time }` on the machine's local clock (`date`
strict `YYYY-MM-DD`, `time` `HH:MM`, or `null` for an old completion recorded as a date only), or
`null` when not known. `created_at` is null for tasks made before dayGLANCE recorded creation
times; they are never backfilled. A recurring occurrence reports the series' creation and that
date's completion. `completed_at` is null on an open task.

**Plan history: `original_plan`, `deferrals`, `plan_trail`, `plan_trail_omitted`.** A task that
was rescheduled carries where it was first planned, how often it slipped, and where its recent
slips landed: the same story the app's plan-history panel tells, by the same rules. They ride
every inbox item, Bucket List item and `task` block (and the write responses, which use the same
shapes), beside `created_at`. **Each is omitted when it has nothing to say**, and most tasks have
none, so an absent field means "nothing recorded", never an error.

| Field | Shape | Present when |
|---|---|---|
| `original_plan` | `{ date, start_time, duration_minutes? }`: the plan the task was first given, in the block's own field names and formats | the task's current plan differs from it (its date, its start, or a duration the plan recorded). An inbox task that was once scheduled always differs: it has no plan now |
| `deferrals` | integer: how many times the task **slipped** | at least once |
| `plan_trail` | array of `{ moved_at, date, start_time, duration_minutes? }`, **oldest first**: `moved_at` is when the move was made (a `{ date, time }` stamp, like `created_at`), the rest is where it moved the task to | at least one slip was recorded |
| `plan_trail_omitted` | integer: slips counted in `deferrals` that `plan_trail` does not list, all older than its first entry | beside `plan_trail`, when the count exceeds it |

Read them with their limits:

- **`deferrals` counts slips, not moves.** A slip is a schedule change made after the task had
  come due (its start had passed). Laying out tomorrow by dragging tasks around is planning and is
  not counted, so a task moved five times the evening before reads `0`.
- **`plan_trail` keeps only the last 6 slips.** The count keeps rising after the trail stops
  growing; `plan_trail_omitted` says how many it no longer lists. Its newest (last) entry is usually
  where the task sits now. A task that slipped before dayGLANCE recorded the trail has `deferrals`
  with no `plan_trail`.
- **`original_plan` appears only when the plan changed**, and only for tasks first scheduled since
  dayGLANCE began recording it: older tasks are never backfilled, so no `original_plan` means "not
  known" as often as "never moved". A plan recorded before durations were has no `duration_minutes`.
  An all-day plan records its time as `"00:00"`.
- **Not on events or routines**, which a calendar or the routines dashboard moves, and not on a
  recurring occurrence: the app keeps plan history for one-off tasks, and an occurrence moved on
  its own date is an edit to its series.
- Stamps are written when the app saves a change, so a write's response reports the history as it
  stood before that write's own slip was counted; the next read includes it.

**`daily_note` rides every day read.** `dayglance_get_today`, `dayglance_get_day` and the
schedule resources return `daily_note`: `{ text, last_modified }` for the user's note on that
date as dayGLANCE shows it, or `null` when the date has no note. `last_modified` is present only
when the app knows it. Where an Obsidian vault is connected, the app's copy is kept in step with the
vault's daily note, so this is the same text. Read-only over MCP.

**Frames are not blocks.** `dayglance_get_today`, `dayglance_get_day`, and the schedule resources
also return a `frames` array beside `blocks`. A block is work ON the day; a frame is a window the
user set aside FOR a kind of work, so it is reported separately and never appears in `blocks`.

| Field | Meaning |
|---|---|
| `id` | `frame-<id>-<date>`: a frame recurs, so the id names the instance |
| `start` / `end` | the window itself |
| `available_slots` | free gaps, **already net** of every block the same read lists: tasks and recurring occurrences (including one still running from the night before, see `continues_from`), routines, elapsed time (today), and the frame's buffer. Device calendar events count only when `include_native` reads them |
| `available_minutes` | the sum of those slots |
| `tag_affinity` | the `#tags` this window is meant for |
| `energy_level` | `low` / `medium` / `high`, as the user set it |
| `buffer_minutes` | breathing room kept around each occupied stretch |
| `read_only` | always true; frames are edited in the app |

Do **not** subtract `blocks` from a frame yourself: `available_slots` has already done it, with the
buffer applied, and re-subtracting double-counts. Do your own matching against `tag_affinity`:
dayGLANCE reports the tags and filters nothing on your behalf.

An unplaced routine (chosen for today but never given a time) reports `all_day: true` with
`start_time` and `duration_minutes` both `null`: it is on the day but occupies no part of it.

## Read tools

### `dayglance_ping`
Connectivity check; touches no user data.
No parameters. Returns `{ ok: true, server: "dayGLANCE MCP" }`.

### `dayglance_get_today`
Today's schedule; resolves the current **local** calendar date on the user's machine — use
this instead of guessing the date.
No parameters. Returns `blocks`, `frames` and `daily_note` with local times, completion state, the
resolved date, and the IANA timezone. Blocks include `routine` blocks (today only), imported
`calendar_event` items, and, under the calendar consent tier, `device_calendar_event` items. A
task from yesterday still running after midnight appears as a block with `continues_from` (see
Block types).

### `dayglance_get_day`
One local calendar date's schedule, in the same shape as `dayglance_get_today`: `blocks`, `frames`
and `daily_note`. For the current date prefer `dayglance_get_today`.

| Param | Type | Required | Notes |
|---|---|---|---|
| `date` | string | yes | Strict `YYYY-MM-DD`, a real local calendar date. Not a timestamp. |

### `dayglance_list_unscheduled_tasks`
The inbox: tasks not yet scheduled onto a day. Paginated, with opt-in filter selection.
**Bucket List (someday/maybe) items are never returned** — the app's unconditional inbox
exclusion applies here, not a filter argument, and `bucketId` never appears on the wire.

| Param | Type | Required | Notes |
|---|---|---|---|
| `limit` | integer | no | Page size 1–200. Default 50. |
| `cursor` | string | no | Opaque cursor from a previous response's `next_cursor`. Bound to the filters it was issued under (see below). |
| `scope` | `'all'` \| `'standalone'` \| `'project'` | no | Default `'all'` (every unscheduled task). `'standalone'`: tasks not attached to a project — what the app itself counts as the inbox. `'project'`: only project-attached tasks. |
| `include_completed` | boolean | no | Default `true`. Pass `false` for open tasks only. |

Returns `{ items, truncated, next_cursor, total, timezone }`. Items carry `id`, `title`,
`priority` (0–3), `completed`, `created_at`, `completed_at`, `duration_minutes`, and `deadline` /
`project_id` / `notes` / `assignee_id` / `subtasks` when set, and the plan history (`original_plan`,
`deferrals`, `plan_trail`, `plan_trail_omitted`, see Block types) when there is one: an inbox task
keeps the history it gathered while it was scheduled.

Filtering happens before pagination: `total`, `truncated`, and `next_cursor` always describe
the **filtered** set. A filter matching nothing returns an empty list with `total: 0`, not an
error. Cursors encode the resolved filter they were minted under; presenting a cursor with
different filter arguments is a `validation` error naming both sides — restart with a fresh
call (no cursor) to change filters. Defaults are resolved before comparison, so omitting
`include_completed` on one page and passing `include_completed: true` on the next never
mismatches. `scope: 'standalone'` with `include_completed: false` is the app's own inbox
count (the same predicate the TRMNL integration uses).

### `dayglance_list_bucket_list`
The Bucket List: someday/maybe items kept out of the inbox on purpose, in two lists with the
user's own headings (by default Anytime and Someday). No parameters. Returns
`{ lists: [{ id, heading, items }], timezone }`; items are inbox-shaped plus `bucket_id` (plan
history included) and carry no priority or deadline (demotion strips them). Archived items are left out, as the app
leaves them out. Read-only over MCP: moving an item between the Bucket List and the inbox is
done in dayGLANCE.

### `dayglance_list_users` *(exists only while multi-user mode is on)*
The household members tasks can be assigned to. Returns active users as `{ id, name }`;
the `id` is what `assignee_id` accepts. Resolve names through this list, never guess an id.
No parameters.

### `dayglance_get_goal_progress`
Goals and projects with their fields and duration-weighted progress, matching what the app shows.

| Param | Type | Required | Notes |
|---|---|---|---|
| `goal_id` | string | no | Narrow to one goal's tree. Unknown id → `not_found`. |
| `window` | `'active'` \| `'all'` | no | Default `'active'` (everything not archived or completed, on-hold projects included); `'all'` includes archived/completed. |

Each goal: `id`, `title`, `status`, `description`, `start_date`, `target_date` (null when unset),
`progress_percent`, `projects`, plus when present `area_id` and `area_name`, `assignee_ids`
(multi-user), and `obsidian_note` (`{ path, name, missing }`). Each project: `id`, `title`,
`status`, `description`, `progress_percent` (null when nothing is measurable), `tasks_done`,
`tasks_total`, plus when present `goal_id`, `target_date` (the project's own due date,
`YYYY-MM-DD`), `assignee_ids`, `obsidian_note`. Standalone projects are listed under
`standalone_projects`.

**A goal or project with `obsidian_note` keeps its description in that note's opening section**
(companion spec §4.3). This tool reads it from the note: such an entity carries
`description_source: "obsidian_note"` and `description_base`, the hash of the section as read, to
pass back on a write. When this computer cannot read the note from the vault folder (the folder was
never chosen here, or the read fails), or its copy of the note is older than the one the bridge
plugin last reported (file modification time against file modification time), the section is the
plugin's report instead, and the entity also carries `description_reported_at`, when the plugin
reported it: the text is as current as that report. A note the plugin reports deleted is not filled
in. When neither is available (no folder, and the vault is not paired or the plugin has not reported
the note), the pointer alone is returned and `description` is empty. Reads open the linked notes, at
most 40 per call. Tasks carry `project_id`, so `dayglance_get_day` and
`dayglance_list_unscheduled_tasks` give a project's tasks.

### `dayglance_list_areas`
The areas of life a goal can belong to, as `{ id, name }`, in the user's order. Use the id as
`area_id` on `dayglance_create_goal` and `dayglance_update_goal`. Areas are managed in dayGLANCE
and cannot be created over MCP.

### `dayglance_list_mcp_writes`
The changes MCP clients made through this server **since dayGLANCE last started**, newest first:
what this assistant, or another one, already changed this session. It is the session write journal
(§4.3 of the spec, the list the bolt button shows) read back. **It is not a task's history**: edits
made in the dayGLANCE app, on other devices or by sync, and anything before the last restart, are
not in it, and a write the user has undone from the bolt button leaves it. A read: available in
read-only mode, on the dayGLANCE-data read tier; the renderer is not asked.

| Param | Type | Required | Notes |
|---|---|---|---|
| `task_id` | string | no | Only writes that touched this task (a block's id is its task's). A recurring occurrence id (`recurring-<series>-<date>`) lists that date's completions. |
| `subtask_id` | string | no | Only writes that touched this subtask. |
| `series_id` | string | no | Only writes that touched this repeating series, its occurrences' completions included. |
| `goal_id` | string | no | Only writes that touched this goal. |
| `project_id` | string | no | Only writes that touched this project itself. A task added to a project is listed under its `task_id`. |
| `limit` | integer | no | Page size 1–200. Default 50. |
| `cursor` | string | no | Opaque cursor from a previous response's `next_cursor`, bound to the filters it was issued under. |

Every filter given must match. An id is the one the write used: a task the Obsidian integration
re-keyed since is listed under its old id.

Returns `{ items, total, truncated, next_cursor, timezone }`; `total` counts the filtered list,
which is the whole session's (the journal is not trimmed, so nothing older is dropped). Each item:

- `at`: when the write was made, as `{ date, time }` in the local zone, the convention of
  `created_at`.
- `tool`: the write tool, e.g. `dayglance_schedule_task`.
- `summary`: what changed, in words, as the bolt button shows it.
- the ids it touched, when set: `task_id`, `subtask_id`, `series_id`, `goal_id`, `project_id`.
- `changes` (when dayGLANCE kept field-level before-state): `[{ field, before }]`, each field under
  its read-tool name, holding the value it had **just before that write**, in the form the read
  tools show it (`completed_at` as a stamp, `assignee_id` for a task, `assignee_ids` for a goal or
  project, `null` where the field was unset). Present for edits of tasks, subtasks, goals and
  projects (a linked note's `description` included), moves (`date`, `start_time`, `all_day`),
  resizes (`duration_minutes`), completions (`completed`, `completed_at`) and scheduling (`date`
  and `start_time` were unset, plus the `priority` and `deadline` the schedule dropped). Creates
  carry none, and neither does a repeating-series edit (its undo snapshot holds every series field,
  touched or not, so it cannot say which changed; the summary names them).

There is **no `after`**. The journal keeps only what an undo needs, the value before; the current
value is a read away, and reading it is the only way to get it right, since a later edit (in the
app, on another device, or by another write) may have changed it again.

Never in the output: the undo descriptor itself, its internal fields (bookkeeping keys, a linked
note's path and hash), and the caller's `idempotency_key`.

---

## Write tools

Placements are checked against routine occupancy. `dayglance_create_task` (with a start),
`dayglance_schedule_task`, `dayglance_move_block`, and `dayglance_resize_block` refuse with
`routine_conflict` when the requested span overlaps a routine block, naming the routine and its
span. **dayGLANCE does not shift your task to the next free time**, which would make the tool
report a placement you did not ask for. Task-on-task overlap remains allowed; only routines are
protected, because they cannot be moved over MCP. A task ending exactly when a routine begins
does not conflict.


All write tools run the same pipeline, in order: writes-enabled check (`read_only_mode`),
idempotency replay, rate gate (`rate_limited` / `writes_disabled`), argument validation,
then the mutation — which goes through the same store layer as the app's own edits, so sync,
Obsidian writeback, and the tray all react exactly as they would to a UI edit.

**Task ids can change; the old id keeps working.** When the Obsidian integration claims a
task (a project task whose project has a linked note), it re-keys the task to
`obsidian-dg-<id>` shortly after creation. Every write tool that takes a task or block id
resolves a retired id to its successor, so an id `dayglance_create_task` returned stays
usable. A response for a resolved id carries the task's current id plus `resolved_from`,
the id you passed.

### `dayglance_create_task`
Two shapes, decided by `start`: **without** it, an unscheduled task, in the inbox or in a
project via `project_id` (either may carry priority and deadline); **with** it, a scheduled task placed directly onto the calendar in one call.
With `start` **and** `repeat`, a repeating series starting on `start`'s date (see below).

| Param | Type | Required | Notes |
|---|---|---|---|
| `title` | string | yes | Non-empty. Stored literally (no sigil parsing). |
| `notes` | string | no | |
| `project_id` | string | no | Attach to a project (ids from `dayglance_get_goal_progress`). The task takes the project's colour and assignees, and its **New task defaults** where the call leaves them out (below). Unknown id → `not_found`. A completed or archived project → `validation`: it takes no new tasks (reopen a completed one with `dayglance_update_project`, `status: 'active'`). |
| `assignee_id` | string | no | **Multi-user only** (absent from the schema otherwise). Ids from `dayglance_list_users`. |
| `priority` | integer | no | **Unscheduled only** (inbox or project). 0 none (default), 1 low, 2 medium, 3 high. |
| `deadline` | string | no | **Unscheduled only** (inbox or project). Local `YYYY-MM-DD`. |
| `start` | string | no | Local `"YYYY-MM-DD HH:MM"`; with `all_day`, a bare `YYYY-MM-DD`. Presence = scheduled create. |
| `duration_minutes` | integer | no | 1–1440. Default: the project's New task default (with `project_id`), else the user's default task duration (Settings → General, 30 unless changed). Pass it only when the user names a length. Contradicts `all_day`. |
| `all_day` | boolean | no | With `start` only. |
| `repeat` | object | no | With `start` only: make it a repeating series. See below. |
| `idempotency_key` | string | no | Also seeds a deterministic task id, so replays converge. |

By-design `validation` rejections: priority/deadline with `start`; `all_day` + `duration_minutes`; `all_day` with a time in `start`; `repeat` without `start`.

**A project's New task defaults** (set in the project's form, #2336) are copied onto a task created in
it, as the app's own create paths copy them, and fill only what the call leaves out: the duration
when `duration_minutes` is absent (inbox, scheduled and series creates alike), the notes when
`notes` is absent or empty, the project's `#tags` appended to the title where it lacks them, the
project's checklist as subtasks, and its energy (`effort` or `restore`) as the task's own. Later edits to the project never reach tasks already created.
A goal's or an area's defaults are not read here: they seed new projects, so a task takes them
through its project. With no project, or a project with no default duration, the task takes the
user's **default task duration** (Settings → General, per device, 30 unless changed).
Unknown `assignee_id` → `not_found`.

**`repeat`** mirrors what the app itself can repeat, and nothing more:

| Field | Applies to | Notes |
|---|---|---|
| `frequency` | all | Required: `daily`, `weekly`, `biweekly` (every 2 weeks), `monthly`, `yearly`. Yearly repeats on `start`'s month and day. |
| `days_of_week` | weekly, biweekly | Non-empty array of `sun` `mon` `tue` `wed` `thu` `fri` `sat`. Default: `start`'s weekday. |
| `day_of_month` | monthly | 1–31, clamped to the last day in shorter months. Default: `start`'s day. |
| `nth_weekday` | monthly | `{ "week": 1-5, "day": "tue" }` instead of `day_of_month`. A 5th the month lacks is skipped; there is no "last". |
| `until` | all | Inclusive local `YYYY-MM-DD`, not before `start`. |
| `count` | all | Total occurrences, 1–1000. |

There is no `interval`: passing one is a by-design `validation` error naming what is supported,
never an approximation. Unknown fields and fields for another frequency are `validation` too, as
is a pattern with no occurrence before it ends. The routine check applies to the first occurrence.

A series response carries `series` (`id`, `title`, `repeat`, `start_date`, and `project_id` /
`notes` when set), `first_occurrence` (a `recurring_task` block) and `next_occurrences` (up to five
dates), so the pattern can be checked against what the user asked for. Undo removes the series,
as deleting it in the app does.

### `dayglance_update_task`
Field editor for existing tasks: inbox, project, or scheduled. **Absent leaves a field alone, present
sets it, a field named in `clear_fields` is removed.** Clearing only ever happens through the
explicit list — `null` or empty values never clear.

| Param | Type | Required | Notes |
|---|---|---|---|
| `task_id` | string | yes | Recurring occurrences are rejected: use `dayglance_update_recurring_task`. |
| `title` | string | no | Non-empty; trimmed. Can be set, never cleared. |
| `notes` | string | no | Empty string is a valid *set*; removal goes through `clear_fields`. |
| `priority` | integer | no | 0–3. **Unscheduled tasks only** (inbox or project). |
| `deadline` | string | no | Local `YYYY-MM-DD`. **Unscheduled tasks only** (inbox or project). |
| `assignee_id` | string | no | **Multi-user only.** Ids from `dayglance_list_users`. |
| `project_id` | string | no | Move the task into a project (ids from `dayglance_get_goal_progress`). Unknown id → `not_found`. A completed or archived project → `validation`, unless the task is already in it. |
| `clear_fields` | string[] | no | Accepts only `"notes"`, `"deadline"`, `"project"`, `"assignee"` (assignee: multi-user only). Naming `title` or anything else → `validation`. |
| `idempotency_key` | string | no | |

Also `validation`: setting and clearing the same field in one call; a call that neither sets
nor clears anything. By-design rejections: priority/deadline (set **or** clear) on scheduled
tasks; recurring occurrences (dedicated error pointing to `dayglance_update_recurring_task`);
CalDAV task-calendar tasks; `_native` events.
Date/time/duration/completion have their own tools, and subtasks have
`dayglance_add_subtask` and `dayglance_update_subtask`.
A `task_id` returned by `dayglance_create_task` keeps working after the Obsidian re-key to
`obsidian-dg-…`; the response carries the current id plus `resolved_from`.

### `dayglance_update_recurring_task`
Edit a repeating series, for one occurrence or for all of them. The scope is **required**, the
same question the app asks when an occurrence is edited:

- `"occurrence"`: the change is written to that date only.
- `"series"`: the change goes to the series, and the same field is cleared from any occurrence
  that had been edited on its own, so the new value shows on every date. Fields the call does not
  name are left alone either way.

| Param | Type | Required | Notes |
|---|---|---|---|
| `task_id` | string | yes | `recurring-<series>-<YYYY-MM-DD>`, as `dayglance_get_day` lists it. A date the series does not fall on → `not_found`. |
| `scope` | string | yes | `"occurrence"` or `"series"`. |
| `title` | string | no | Non-empty. Either scope. |
| `start_time` | string | no | Local `"HH:MM"`, checked on the occurrence's date. Makes an all-day occurrence timed. Either scope. |
| `duration_minutes` | integer | no | 1–1440. Either scope. |
| `all_day` | boolean | no | Either scope. Contradicts `start_time` / `duration_minutes` when true; `false` on an all-day occurrence needs `start_time`. |
| `notes` | string | no | **Series only.** |
| `project_id` | string | no | **Series only.** Unknown id → `not_found`. A completed or archived project → `validation`, unless the series is already in it. |
| `repeat` | object | no | **Series only.** Replaces the whole pattern, its end included, in the `dayglance_create_task` shape. The series start never moves earlier. |
| `assignee_id` | string | no | **Multi-user only.** Either scope. |
| `clear_fields` | string[] | no | `"notes"`, `"project"` (series only), `"assignee"` (multi-user; means everyone). |
| `idempotency_key` | string | no | |

`validation` for a missing or unknown scope, a series-only field with `"occurrence"`, setting and
clearing the same field, or a call that names nothing. The edited occurrence's new time is checked
against routines (`routine_conflict`). Completions are never changed: completing an occurrence is
`dayglance_set_task_completion`. Moving a single occurrence to another date is not supported.

The response carries `series` and `next_occurrences` as for a create, plus `occurrence` (the
edited date as it now reads, or `null` when a new pattern no longer falls on it), `scope`, and
`unchanged: true` when the edit matched what was already stored (nothing is journaled then).
Undo restores the fields and occurrence edits the call changed.

### `dayglance_schedule_task`
Schedule an unscheduled inbox task onto a day and time.

| Param | Type | Required | Notes |
|---|---|---|---|
| `task_id` | string | yes | Must be an inbox task; an already-scheduled id → `validation` pointing to `move_block`. |
| `start` | string | yes | Local `"YYYY-MM-DD HH:MM"`. |
| `duration_minutes` | integer | no | 1–1440. Defaults to the task's own duration, then the user's default task duration. |
| `idempotency_key` | string | no | |

If the inbox task carried a priority or deadline, scheduling **drops them by design** and the
response lists them in `dropped_fields` with a note — tell the user rather than treating it
as an error.

### `dayglance_move_block`
Move a scheduled block to a new local start (same or different day).

| Param | Type | Required | Notes |
|---|---|---|---|
| `block_id` | string | yes | Recurring occurrences → `validation` (use `dayglance_update_recurring_task`). |
| `new_start` | string | yes | Local `"YYYY-MM-DD HH:MM"`. |
| `idempotency_key` | string | no | |

### `dayglance_resize_block`
Change a scheduled block's duration without moving its start.

| Param | Type | Required | Notes |
|---|---|---|---|
| `block_id` | string | yes | Recurring occurrences → `validation` (use `dayglance_update_recurring_task`). |
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

A task with `link` (see Blocks) came from another GLANCE app: completing or reopening it is
reported back to that app, so a lastGLANCE chore's task completed here is the chore done in
lastGLANCE. The response's block or item carries the same `link`.

### `dayglance_add_subtask`
Add a subtask to a task (inbox, project, or scheduled). Subtasks are the task's own checklist,
reported as `subtasks` (`{ id, title, completed }`) on tasks and blocks.

| Param | Type | Required | Notes |
|---|---|---|---|
| `task_id` | string | yes | Recurring instances → `validation`. |
| `title` | string | yes | Non-empty; trimmed. |
| `idempotency_key` | string | no | A replay returns the same subtask. |

Returns the resulting task or block and the new `subtask`. **There is no subtask delete**; the
user's undo removes subtasks an assistant added.

### `dayglance_update_subtask`
Edit a subtask's title, its completion (a setter, not a toggle), or both.

| Param | Type | Required | Notes |
|---|---|---|---|
| `task_id` | string | yes | |
| `subtask_id` | string | yes | From the task's `subtasks`. Unknown → `not_found`. |
| `title` | string | no | Non-empty; can be set, never cleared. |
| `completed` | boolean | no | |
| `idempotency_key` | string | no | |

### `dayglance_create_goal`
Create a goal. New goals are active; the colour is copied from the area at creation, as the form
does.

| Param | Type | Required | Notes |
|---|---|---|---|
| `title` | string | yes | |
| `description` | string | no | The goal's notes box. |
| `start_date` | string | no | Local `YYYY-MM-DD`. |
| `target_date` | string | no | Local `YYYY-MM-DD`; must not precede `start_date`. |
| `area_id` | string | no | From `dayglance_list_areas`. Unknown → `not_found`. |
| `assignee_ids` | string[] | no | **Multi-user only.** Ids from `dayglance_list_users`. |
| `idempotency_key` | string | no | A replay returns the same goal. |

### `dayglance_update_goal`
Field editor for goals, with the `update_task` contract: absent leaves alone, present sets, a name
in `clear_fields` removes.

| Param | Type | Required | Notes |
|---|---|---|---|
| `goal_id` | string | yes | |
| `title` | string | no | Can be set, never cleared. |
| `description` | string | no | On a goal with `obsidian_note`, the opening section of that note (see below). |
| `description_base` | string | no | The `description_base` a read returned. With it, a note write is refused with `note_changed` if the note changed since; without it the write is unconditional. Only with `description`. |
| `start_date` / `target_date` | string | no | Local `YYYY-MM-DD`. |
| `area_id` | string | no | |
| `status` | `'active'` \| `'completed'` | no | `'archived'` → `validation` (by design). Completing requires every child project that is not archived to be completed (one on hold included), the form's own rule. |
| `assignee_ids` | string[] | no | **Multi-user only.** Replaces the list. |
| `clear_fields` | string[] | no | `"description"`, `"start_date"`, `"target_date"`, `"area"`, `"assignees"` (multi-user). |
| `idempotency_key` | string | no | |

### `dayglance_create_project`
Create a project, standalone or under a goal. A project under a goal takes the goal's colour and
assignees at creation and follows neither afterwards (the form's inheritance). It also starts with
the New task defaults its goal holds for new projects, each field from the goal, else from the goal's
area (#2336), copied once, as the project form copies them.

| Param | Type | Required | Notes |
|---|---|---|---|
| `title` | string | yes | |
| `goal_id` | string | no | Omit for standalone. Unknown → `not_found`. |
| `description` | string | no | The project's notes box. |
| `target_date` | string | no | Local `YYYY-MM-DD` — the project's own due date, matching a goal's target date. Independent of its tasks' deadlines. |
| `assignee_ids` | string[] | no | **Multi-user only.** Overrides the inheritance. |
| `idempotency_key` | string | no | |

### `dayglance_update_project`
Field editor for projects, same contract.

| Param | Type | Required | Notes |
|---|---|---|---|
| `project_id` | string | yes | |
| `title` | string | no | |
| `description` | string | no | On a project with `obsidian_note`, the opening section of that note (see below). |
| `description_base` | string | no | As on `dayglance_update_goal`. |
| `goal_id` | string | no | Move under another goal. `"goal"` in `clear_fields` makes it standalone. |
| `target_date` | string | no | Local `YYYY-MM-DD` — the project's own target date. `"target_date"` in `clear_fields` removes it. |
| `status` | `'active'` \| `'on-hold'` \| `'completed'` | no | `'archived'` → `validation`. `'on-hold'` pauses the project: it stays listed and intact but is not flagged stalled, warned about its target date or given hyperGLANCE sessions; `'active'` resumes it. Completing requires every task in the project to be completed. |
| `assignee_ids` | string[] | no | **Multi-user only.** |
| `clear_fields` | string[] | no | `"description"`, `"goal"`, `"assignees"` (multi-user), `"target_date"`. |
| `idempotency_key` | string | no | |

**Descriptions in linked notes.** For a goal or project with `obsidian_note`, `description` on
the update tools writes the opening section of that note through the app's own section save: the
note is read again first and, when `description_base` was given and the section moved, nothing is
written and the call fails with `note_changed` (read the entity again and retry with the new base).
The rest of the note is never touched. The response carries `description_source`, the new
`description_base`, and `note_write`: `"written"` when the file was written directly, `"queued"`
when the bridge plugin will apply it the next time Obsidian is open (always the case for a section
read from the plugin's report on a computer without the folder), during which a read can still
return the old text. The re-read before the write uses the same source as the read: the newer of
the file here and the plugin's report. The write journal reverses it by putting the previous section back under the
same rule, so an undo never overwrites an edit made in Obsidian meanwhile; such an undo reports as
skipped. Other fields in the same call are applied to the record as usual.

---

## Resources (read-only)

| URI | Content |
|---|---|
| `dayglance://schedule/today` | Today's `blocks`, `frames` and `daily_note`, local date + timezone echoed. Includes `routine` blocks. |
| `dayglance://schedule/week/current` | The week containing today, starting on the configured week-start day (`week_start_day`, 0 = Sunday). Each day carries its own `blocks`, `frames` and `daily_note`. Only the day that is today can carry `routine` blocks; the other six showing none is expected. |
| `dayglance://goals/tree` | Goal/project hierarchy with duration-weighted progress — same data as `dayglance_get_goal_progress`, descriptions read from linked Obsidian notes included. |

All three read over the same renderer path as the tools and respect the same consent tiers;
failures throw with the same code + message text a tool error would carry.

---

*Schema gating recap: `dayglance_list_users`, `assignee_id` (task write tools), `assignee_ids`
(goal and project tools), and `"assignee"` / `"assignees"` in `clear_fields` exist only while
multi-user mode is on. The tool list is
rebuilt per request, so toggling multi-user or a consent tier updates what a connected
client sees on its very next request.*
