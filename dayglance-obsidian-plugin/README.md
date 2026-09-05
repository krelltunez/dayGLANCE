# dayGLANCE Bridge (Obsidian plugin)

Phases 5–6 of the dayGLANCE Obsidian build-out (`docs/obsidian-buildout-spec.md`
in the dayGLANCE repo): heartbeat plus pairing. **Unlisted** — installed
manually or via BRAT, not submitted to the community directory.

## What it does (all of it)

- Writes `.dayglance/heartbeat` every 30 seconds while Obsidian has the vault
  open — `{"paired": bool, "accountId": string|null, "deviceId": "…", "ts": "…"}`.
  dayGLANCE reads this to skip launching Obsidian when it's already running,
  and (once arbitration lands) to decide vault-write arbitration. The file
  lives in a dot-directory, so Obsidian's indexer, search, graph view, and
  Obsidian Sync all ignore it. `deviceId` is a per-install id that rides
  `data.json` (and therefore Obsidian's settings sync) — it identifies the
  vault copy, not a device; see spec §3.3.
- **Pairing** (spec §3.12): when dayGLANCE drops a sealed pairing offer at
  `.dayglance/pairing`, the plugin shows a notice; the code is entered in
  the plugin's **settings tab** (Settings → dayGLANCE Bridge — status,
  code entry, unpair) or via the **Enter pairing code** command's modal,
  both driving the same flow. The code opens the offer, the carried device
  token is verified against GLANCEvault with one authenticated call, and
  the credentials (token + bridge-scoped subkey) are stored in
  `data.json`. The offer file is deleted after use.
- **Intent stream** (spec §3.6): while paired, the plugin drains semantic
  intents dayGLANCE emitted (task state changes, retitles, appends, note
  writes) from GLANCEvault and applies them to the vault through a pure,
  idempotent applier shared with dayGLANCE — drain on open plus a 30-second
  interval while foregrounded, with an applied-ID set and high-water mark
  persisted per batch so crash replay is a no-op. In the other direction it
  reports plain **observations** — the latest state of daily notes and
  task-marked files, one upserted row per path — and never interprets an
  edit; that is dayGLANCE's scan pipeline's job.
- **Agenda sidebar** (companion spec 4.2): a right-sidebar view — mini
  month calendar over the selected day's agenda (scheduled tasks, recurring
  instances, imported calendar events; ±35 days around today; no inbox),
  with the day's placed routines as a pill strip underneath (name and start
  time). Read-only calendar events never sync, so each running dayGLANCE
  publishes a projection of the ones it holds (`proj:calendar:<deviceId>`
  rows on the bridge stream, built from a per-day cache of the fetches the
  app already makes) and the sidebar merges them with per-day authority (the
  device that fetched a day most recently supplies that day's events); the
  footer notes when the selected day's events are over an hour old. On a
  multi-user account the agenda shows one person's view: tasks unassigned or
  assigned to them, routines they own, and their devices' calendars. The
  viewer defaults to the user of the dayGLANCE device that paired the vault
  and can be changed (or set to Everyone) under "Show tasks for" in the
  settings tab. The viewer is also published in the pairing-meta row, and
  dayGLANCE uses it to scope what it writes into this vault and to assign a
  task first seen in the vault to that person. Tags in
  titles render faded; `[[wikilinks]]` render as their display text and
  click through to the note.
  It reads the account's task rows directly from GLANCEvault: enter your
  dayGLANCE **sync passphrase** once per device in the settings tab's
  "dayGLANCE account" section. The derived root key is kept in the plugin's
  own IndexedDB store on that device only; neither the passphrase nor the
  key is ever written to `data.json` (which Obsidian Sync would carry to
  every copy of the vault). The plugin never writes a data-plane row:
  checking a task's box emits a completion **action** on the bridge stream
  that a running dayGLANCE applies (so its completion log, vault writeback
  and sync all fire), and the box shows as pending until the mirror
  reflects it. Ribbon icon and **Open agenda** command.
- **Vault task scope** (companion spec §6): beyond daily notes, the settings
  tab takes folders and/or tags whose notes are task sources. Their open
  tasks, and tasks completed within a configurable window (30 days by
  default, 7 to 90), are stamped with an identity under the note's path
  and reported like daily-note tasks, a few notes per tick when a scope is
  first added. A note leaving the scope is reported as withdrawn. The
  scope rides the pairing-meta row so dayGLANCE applies the same window.
- **Project and goal notes** (companion spec §4.3): a note can be linked to
  a dayGLANCE project or goal. The link's identity is a `dayglance-id`
  frontmatter key the plugin writes; the path is only a cached locator on
  the dayGLANCE record. **Link current note to a dayGLANCE project or
  goal** picks from the mirror; **Unlink current note from dayGLANCE**
  removes the key. The plugin follows renames, reports a deleted note as
  missing (dayGLANCE keeps the project and offers a relink), re-finds a
  note by its key on a periodic walk, and applies link and unlink requests
  made from dayGLANCE. A linked note also carries a `dayglance:` frontmatter
  map the plugin maintains from its mirror: `kind`, `status`, and on a
  project note `goal` (a wikilink to the goal's note when it is linked).
  Counts and dates are deliberately not in it, so it is rewritten only when
  a status or a goal assignment changes, at most once every five minutes
  per note, never into unsaved edits. dayGLANCE wins inside that map;
  nothing outside it is read or written. A project or goal born in
  dayGLANCE can create its note here (the default body has a tasks
  section, a completions section, notes, decisions and a dated log; with
  Dataview installed the completions and, on a goal note, the projects
  table and monthly progress are live queries, otherwise a plain sentence
  stands in each place; chosen once at creation): the **Project and goal notes**
  settings choose the layout (one note; a folder with an index note; folders
  nested under the goal), the projects and goals folders, and optional
  template notes (rendered by Templater when it is installed and the
  template asks nothing interactively, otherwise `{{title}}`, `{{date}}`
  and `{{goal}}` are filled and the rest is left visible). Placement happens
  at creation only; linking an existing note never creates or moves.
  **A project's tasks live in its note** (companion §4.3, project routing):
  a task assigned to a linked project in dayGLANCE is written into the
  note's `## Tasks` section (created there, moved there on reassignment,
  removed on unassignment, its schedule as line metadata), and a task typed
  in the note imports assigned to the project. A linked note is in the task
  scope by virtue of the link, folder setting or not. The plugin applies
  `task_append` (note-task placement: section end, never sorted, never a
  missing note) and `task_remove` (the line carrying a block id) for this.
- Six commands: **Sync now** (drains pending intents + refreshes the
  heartbeat), **Enter pairing code**, **Unpair from GLANCEvault**
  (forgets the local credentials and the account key; revoke the token
  server-side too), **Open agenda**, and the two link commands above.

Network access happens only while paired (plus pairing verification), only
to the vault URL carried in the offer, via Obsidian's `requestUrl`. All
stream rows are AES-256-GCM under the pairing's bridge subkey.

- **Editor hiding** (display only, `src/editorHiding.ts`): two settings
  under Settings → dayGLANCE Bridge → Editor. *Hide dayGLANCE block ids*
  (default on) hides a well-formed `^dg-` token at the end of a line in
  Live Preview, except on the cursor line; block ids the user created are
  untouched, which is why this is a CodeMirror decoration rather than the
  vault-wide CSS snippet it replaces (CSS cannot match text). *Hide
  completed tasks in project and goal notes* (default off) hides checked
  task lines in notes linked to a dayGLANCE project or goal, in Live
  Preview and Reading view, again except on the cursor line; daily notes
  are unaffected. Both add CSS classes and let a stylesheet do the hiding;
  neither writes to a note. The line rules are pure
  (`src/editorHidingRules.ts`) and pinned by `test/editorHidingRules.test.ts`.

## Tests

Apart from the pure editor-hiding rules, the plugin has no unit tests of its
own; it is exercised end to end by the bridge scenario harness in `test/`,
which runs from the repository root
with the rest of the suite (`npx vitest run`). The harness stubs the
`obsidian` module (`test/obsidianStub.ts`), serves an in-memory GLANCEvault
(`test/fakeGlanceVault.ts`), and drives the real transport plus the real
dayGLANCE sync hook against it (`test/harness.ts`). Add a scenario to
`test/scope.scenarios.test.ts` for any change to what the plugin stamps,
reports, or applies.

## Build

```
npm install
npm run build      # type-checks, then bundles src/main.ts → main.js
```

## Manual install

Copy `manifest.json` and the built `main.js` into
`<vault>/.obsidian/plugins/dayglance-bridge/` and enable the plugin in
Settings → Community plugins.

## Repo shape

This directory is deliberately self-contained (own package.json, no imports
from dayGLANCE) so it can be extracted to its own public repository before
any community-directory submission without surgery. Its two dependencies —
`@glance-apps/obsidian-format` (the shared vault-format core, `file:`-linked
while the plugin lives here) and `@glance-apps/sync` (only `vaultClient.js`
is imported, so the bundle carries the HTTP client and none of the sync
engine) — are bundled into `main.js`.
