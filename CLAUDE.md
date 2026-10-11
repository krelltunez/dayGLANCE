# Git Workflow

## Branch Strategy

Use a **fresh branch per logical task or PR**. Do not accumulate multiple unrelated changes on a single long-running branch.

- When starting a new task, create a new branch from the latest `main` (after fetching):
  ```
  git fetch origin main
  git checkout -b <descriptive-branch-name> origin/main
  ```
- Branch names should be short and descriptive (e.g. `fix-project-card-completed-at`, `weekly-review-goals-tiles`).
- Once a PR is merged, do not continue committing to that branch. Start fresh from `main` for the next task.

## Pull Requests

Always create a PR after pushing a branch. Use the GitHub MCP tools (`mcp__github__create_pull_request`) to do this — do not wait for the user to ask. Write a clear title and a summary that describes what changed and why.

## CRITICAL: Always check PR status before pushing

**Before pushing any commit to an existing branch**, use `mcp__github__pull_request_read` to check whether the PR for that branch has already been merged. If it has:

1. Do NOT push to that branch.
2. Create a new branch from the latest `main`.
3. Apply the changes to the new branch instead.

This check is mandatory — even mid-task, even for "small fixes", even when you just created the PR moments ago. PRs can be merged at any time.

## GitHub Issues

Do **not** post comments to GitHub issues directly using `mcp__github__add_issue_comment`. Instead, draft the proposed response and present it to the user so they can review and post it themselves.

# Bridge scenario harness

`dayglance-obsidian-plugin/test/` runs the real Obsidian plugin transport and
the real `useObsidianSync` hook against a stub Obsidian vault and an in-memory
GLANCEvault, under fake timers (`vitest.config.js` aliases `obsidian` to the
stub and the plugin's copy of `@glance-apps/sync` to the root one). When a
change touches what the plugin stamps, reports, or applies, or how the app
consumes the observation stream, add or extend a scenario in
`scope.scenarios.test.ts` rather than relying on a manual vault test. Obsidian
Sync timing, real editor buffers, and Templater stay manual.

# MCP transport suite

`electron/mcpServer.transport.test.ts` starts the real MCP listener on a free
loopback port and drives it with the official client over HTTP, against a
scripted renderer bridge. It holds the server to `docs/mcp-tools-reference.md`:
the tool and resource names are parsed from that file, so a tool added or
renamed has to land in both. When a change touches what is registered (a tool,
its schema or description, a timeout, a guard in front of a write), extend a
scenario there; the per-module unit tests cannot see that seam. Keep argument
schemas permissive where the planner carries a by-design message: the SDK
validates the schema before the handler runs and answers with its own generic
text, so a strict enum would hide the message the client is meant to read.

# Todoist integration

`src/todoist/` is a read-source integration: Todoist supplies tasks, dayGLANCE
owns the time blocks. `core.js` is pure and holds every data-safety rule;
`client.js` owns the transport and the `dg-todoist-*` storage keys;
`useTodoistSync.js` wires them to React state. `docs/todoist-integration.md`
describes the user-facing behaviour.

Rules that are load-bearing rather than stylistic, each covered by tests:

- **A missing source record means no information, never deletion.** Todoist
  snapshots list active resources, so absence is not evidence a task was
  completed or deleted. See the guards in `reconcileTask` and `pruneCache`.
- **Empty filters import nothing.** `matches` fails closed rather than treating
  "no criteria" as "everything".
- **The hook receives `recycleBin` but not `setRecycleBin`.** The integration is
  structurally unable to remove a user's tasks. Keep it that way.
- **Writeback is guarded and one-way.** Only ordinary non-recurring leaf tasks
  are closed, with durable command UUIDs written before the request so a retry
  cannot double-close. Nothing else is ever sent to Todoist.
- **The cache is pruned before every persist.** Inactive records that nothing
  references are dropped (`pruneCache`), so accumulated history stays bounded.
- **Account state is split across two homes, on purpose.** The cache is bulk
  derived data and lives in IndexedDB; the completion receipts, `lastSync` and
  `report` stay in localStorage. That is not an oversight to tidy up: a command
  UUID is written BEFORE its request goes out so a retry after a crash reuses it
  and cannot close a task twice, and only a synchronous write is durable the
  moment it returns. Use `readAccountState` / `writeAccountState`; do not reach
  for `stateKey` directly.

Strings live in the normal locale bundles under the `todoist` prefix, not in a
feature-local namespace. Add new keys to `public/locales/*/translation.json`;
`locales.test.js` enforces coverage across every language.

# JOBO ledger

`src/jobo/` holds the plan-versus-actual ledger (#1726). The design is
`docs/jobo-ledger-persistence.md`; the rules that are load-bearing:

- **The ledger is a collection, not a task field and not a cache.** Each Do
  record is its own row with its own `updatedAt`. The task gains no field.
- **`useJoboLedger` is the only writer.** Detectors, manual entry, importers and
  both sync tiers go through it; nothing else touches `dayglance-jobo`.
- **Not loaded is not empty.** `joboRecords` is `undefined` until a strict read
  succeeds, and the sync payload omits the key while it is. An unreadable
  ledger is never published as `[]`.
- **Both tiers pick with one rule.** Copies of one record converge by the
  shared pick (newer `updatedAt`, then lower `observedAt`); each tier's own
  "remote wins" tie is order-dependent and would never converge.
- **Ledger tombstones are never pruned, and the file-tier merge gets no sync
  horizon.** The horizon drops old local-only rows, tombstones included.
- **The flag gates the interface, never the data.** A device with JOBO off
  still loads, stores, pushes, pulls and merges records. It creates none from
  its own completions, and does not retro-create them on enable.
- **The detector is a planner over task snapshots, and its keys come from the
  source event.** `src/jobo/detector.js` keys a record on the task's own
  completion stamp, never on the observing device's clock, so two devices
  produce one id and `pickJoboRecord` picks one copy. Creation is
  ensure-present; an uncheck targets the record by the previous key and drops
  it to `partial`; a completion without a stamp makes no record. A recurring
  completion captures the occurrence the user saw (that date's exception
  over the template), and the Do `date` is the stamp's own prefix. The
  detector is one-shot because a failed write, local or remote, is held in
  the ledger and retried with backoff, and it builds against the ledger's
  `workingSet()` (committed plus held), never `joboRecords`, so an uncheck of
  a completion still held for retry is not lost (#1826). The working set is
  never published as state.
- **The JOBO view is built from the app's timeline, not beside it.** The Plan
  side is DAY's own `DayViewColumn` over 24 hours, so drag and drop, the hover
  line, click-to-add, the context menu, Frames and the real task cards come
  with it; the Do side (`src/components/jobo/DoColumn.jsx`) draws to the same
  grid and snaps to 15 minutes like every view. Do not reimplement timeline
  behaviour inside JOBO: extend the shared column instead.

# Adding a field to a task

Task rows cross four subsystems, and a new field has to be declared to each one
or it is silently dropped or, worse, mistaken for a user edit. Both failure modes
have shipped. `archived` and `originalPlan` are the worked examples; follow them.

**1. Does gaining the field count as an edit?** If the app writes it rather than
the user (derived, bookkeeping, write-once), strip or default it in
`normalizeField` in `src/utils/stampTimestamps.js`. Otherwise its appearance
re-stamps `lastModified`, and a fabricated stamp outranks a real completion made
on another device: the task resurrects. This is the dangerous one.

**2. Do both transports carry it through last-writer-wins?** The merge keeps the
newer copy WHOLE, so a copy from a device that never had the field wins and drops
it. Carry it forward in `src/sync/dbAdapter.js` (vault) and `src/mergeSync.js`
(file tier). A field that accumulates needs a MERGE rather than a carry, or two
devices that each saw something different keep only one side's: `deferrals` takes
the max and `planTrail` takes the union. Either rule has to be order-independent
and idempotent, since both tiers may apply it more than once and in either order.

**3. Does the apply carry it?** `src/utils/preserveStickyFields.js`, fed from the
live task list in `applyEngineData`. Missing this makes the loss permanent rather
than transient.

**4. Does it reach React STATE, not just localStorage?** State is what
`buildSyncPayload` pushes and what feeds `preserveStickyFields`. A field computed
in the persist pass and written only to storage is invisible to the entire sync
layer, and the next apply writes state back over it. If the persist pass is where
it is derived, write the result back with the relevant setter.

## Testing it

Assert the field is observable where the app actually reads it, not that the
function that computes it returned it. `originalPlan` had unit tests on every
boundary and still shipped in a state where it never survived a single sync
cycle, because nothing tested the path between the modules. Write at least one scenario that
walks save → state → push → apply, and mutation-check each guard by removing it
and confirming a test fails.

# App.jsx — Ongoing Decomposition

`App.jsx` started at ~30,000 lines and came down to ~9,600 across four refactor passes, then crept back to ~10,700 (October 2026); it is ~10,200 after the extractions below. Extracted so far:

- **ICS/CalDAV parser** → `src/utils/icsParser.js` (with tests)
- **Voice input pipeline** → `src/hooks/useVoiceInput.js`
- **Morning summary / evening reflection** → `src/hooks/useDailyBriefings.js`
- **Obsidian sync handlers** → `src/hooks/useObsidianSync.js`
- **Native calendar integration** → `src/utils/nativeCalendar.js` (with tests)
- **iCloud snapshot sync loop** → `src/hooks/useSnapshotFileSync.js` + `src/sync/snapshotFileSync.js` (with tests); iCloud is one transport (`src/sync/icloudSnapshotTransport.js`), Direct Access the next (`docs/direct-access-sync.md`)
- **Calendar file import** → `src/hooks/useCalendarFileImport.js` (with tests, #2016)
- **Widget snapshot** → `src/utils/widgetSnapshot.js` (with tests); the effect in App.jsx gathers inputs and owns the push
- **TRMNL push and auto-sync** → `src/hooks/useTrmnlSync.js` (with tests)
- **Overdue tasks** → `src/utils/getOverdueTasks.js` (with tests, #2023)

## Next candidates

Pure logic and logic that carries data-safety rules first; UI wiring last.
The context object and render at the end of the file (~2,300 lines) are
wiring, and moving them only relocates them. Sizes are approximate.

- **Calendar writeback and sync** (`syncTaskCompletionToCalDAV`,
  `syncWithCalendar`, `syncTaskCalendar`, ~500 lines): into the existing
  `useCalendarSync`.
- **Focus orchestration** (`enterFocusMode`, `startFocusTimer`,
  `exitFocusMode`, the phase and timer-end handlers): into `useFocusMode`.
- **Sync apply and payload** (`applyEngineData`, `buildSyncPayload`, ~600
  lines): the highest risk and the biggest payoff, so last and slowest. Write
  scenario tests that walk payload → apply → state before moving anything,
  and follow "Adding a field to a task" above.

## Guidance

App.jsx is still the largest file. When adding a new feature or fixing a bug there, consider extracting the surrounding logic into a hook (`src/hooks/`) or pure utility module (`src/utils/`, with tests) at the same time — the deps-object hook pattern (`useTaskActions`, `useObsidianSync`, etc.) is well established. Extract opportunistically, when it keeps the diff focused; don't extract for its own sake.

