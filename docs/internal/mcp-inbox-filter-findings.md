# Inbox filtering for `dayglance_list_unscheduled_tasks` — discovery findings

Step 1 of the inbox-filtering work: how the app actually differentiates and filters
unscheduled tasks, established from the code before any implementation. Each finding cites
its source.

## 1. What the app's inbox filter actually is

**There is no persisted predicate object and no saved-filter record with an id.** The app's
inbox filter is six independent pieces of per-device UI state, each its own localStorage key,
composed at render time:

| State | Default | localStorage key |
|---|---|---|
| `hideCompletedInbox` | `false` | `hideCompletedInbox` |
| `hideProjectTasksInbox` | **`true`** (project tasks hidden by default) | `hideProjectTasksInbox` |
| `hideStandaloneTasksInbox` | `false` | `hideStandaloneTasksInbox` |
| `inboxPriorityFilter` | `0` (no threshold) | `inboxPriorityFilter` |
| `inboxTagFilter` | `[]` | `inboxTagFilter` |
| `inboxProjectFilter` | `[]` | `inboxProjectFilter` |

(App.jsx:559–578.) All six are in the device-settings backup roster
(`src/utils/deviceSettings.js:38–45` — "the inbox filter bar, in full"), so they are part of
the device-settings backup/restore work, but as raw per-device values, not as a nameable
filter entity anything could reference.

The composition lives in **`src/hooks/useComputedViews.js` → `filteredUnscheduledTasks`**
(:84–116), which applies, in order: the unconditional exclusions (`notBucketed`,
`!task.archived`, `isVisibleForUser` for multi-user), the project/standalone toggles (gated
on `goalsProjectsEnabled`; `inboxProjectFilter` overrides both toggles when non-empty), the
priority threshold, a hardcoded `!(task.completed && task.deadline)` exclusion, the
completed toggle, and the tag filter (`extractTags` over the title), then sorts. This
composed chain is the only thing that IS the "app's inbox filter", and it exists nowhere
but in that memo.

## 2. How bucket-list tasks are separated

**A structured field, not a tag convention.** Bucket items are ordinary rows in
`unscheduledTasks` carrying a **`bucketId`** field (`'b1' | 'b2'` — exactly two lists,
deliberately capped; `src/utils/bucketList.js:13`). The predicate is centralized:

```js
// src/utils/bucketList.js:34
export const notBucketed = (task) => !task?.bucketId;
```

The module documents it as "the unconditional Inbox exclusion. Applied at every
unscheduledTasks consumer that feeds Inbox lists, counts, or nag machinery" — and unlike the
project toggles it is not user-toggleable. Demoting a task to the bucket strips deadline and
priority (bucket items are pre-commitment). Tags do exist in the app (parsed from the title
by `extractTags`, `src/utils/taskUtils.js:17`, centralized), but bucket membership is not
tag-based and never was.

The current MCP item shape omits `bucketId` entirely (`buildUnscheduledItems`,
`src/utils/mcpReadModel.js:140`), which is why bucket items are indistinguishable on the
wire today.

## 3. Is the predicate reusable server-side?

Split answer, and the split is the design:

- **The composed UI filter is NOT reusable as a unit.** It is entangled with per-device UI
  state (six localStorage values), a feature flag (`goalsProjectsEnabled`), and the
  multi-user visibility closure. Two devices can hold different filter states for the same
  vault; "the user's current filter" is not a stable server-side referent, and exposing a
  reference to it would make MCP results depend on invisible per-device chrome.
- **The individual dimensions ARE reusable, trivially.** The three distinctions that matter
  (bucket membership, project membership, completion) are all structural task fields
  (`bucketId`, `projectId`, `completed`), and the one nontrivial predicate (`notBucketed`)
  is a pure, centralized one-liner that the renderer-side MCP read model can import
  directly — `src/trmnl.js` already imports it (line 11). No tag-string parsing is required
  for any of them.

## 4. The TRMNL standalone-count path

`src/trmnl.js:147–148`:

```js
// Inbox count — standalone tasks only (exclude those tied to a project)
const inboxCount = unscheduledTasks.filter((t) => notBucketed(t) && !t.completed && !t.projectId).length;
```

Exactly the "standalone open inbox" predicate, built from the imported `notBucketed` plus
the two structural fields. There is nothing to invent: the MCP filter for the motivating
use case is this line's predicate, reused.

## Pipeline fact relevant to Step 2

There is no database and no query engine: `unscheduledTasks` is an in-memory renderer array.
Today `buildUnscheduledItems` (renderer) maps the **full array** over IPC to the main
process, and `paginate` (`electron/mcpPagination.ts`, offset cursor `dgc1.` +
base64 `{"o":N}`) slices it there. So "filter in the query layer" concretely means:
**filter in `buildUnscheduledItems`, before the array crosses to `paginate`** — then
`total`, `truncated`, and `next_cursor` are computed against the filtered set by
construction. The full-array IPC hop is main↔renderer in-process and cheap at these sizes;
the cost being eliminated is the 347 items crossing the MCP wire and the model's context.

## Recommended design (for review, not implemented)

No reusable persisted predicate exists to reference by id — that branch is closed. But
inventing a filtering language is not needed either: the app's own distinctions are three
structural dimensions, so the tool gains **filter selection, not predicates**:

- `scope`: `'all'` (default) | `'standalone'` | `'project'` | `'bucket'` — implemented with
  the imported `notBucketed` and `projectId`, matching the app's own partition
  (`standalone` = `notBucketed && !projectId`, the TRMNL predicate's shape).
- `include_completed`: boolean, **default `true`** (wire-compatible; the app's
  `hideCompletedInbox` equivalent, inverted so absence changes nothing).

Explicitly out, per the non-goals: tag filters (title parsing), priority thresholds,
project-id narrowing, and the app's `archived` / `completed-with-deadline` /
`isVisibleForUser` specials — the last already applies to the MCP list today and stays as
is. Cursor binding (Step 3): encode `{o, f}` where `f` is the canonical filter tuple;
mismatch between cursor and arguments → `validation` error.

With `scope: 'standalone'`, `include_completed: false`, the tool returns precisely what
TRMNL counts and what the app's inbox shows under the equivalent toggles.
