# dayGLANCE Bridge: development notes

How the plugin works, for whoever changes it. The user-facing description is
[README.md](README.md). The design is `docs/obsidian-buildout-spec.md` and
`docs/obsidian-companion-spec.md` in the dayGLANCE repo.

## What it does (all of it)

- Writes `.dayglance/heartbeat` every 30 seconds while Obsidian has the vault
  open — `{"paired": bool, "accountId": string|null, "deviceId": "…", "ts": "…"}`.
  dayGLANCE reads this to skip launching Obsidian when it's already running,
  and (once arbitration lands) to decide vault-write arbitration. The file
  lives in a dot-directory, so Obsidian's indexer, search, graph view, and
  Obsidian Sync all ignore it. `deviceId` is a per-copy id kept in
  Obsidian's device-local storage for the vault (`src/localState.ts`) —
  along with the bridge cursor, the applied-intent set, the adopted scope
  and the linked-note map. `data.json` (which Obsidian's settings sync
  carries to every copy) holds only what is shared: the pairing, the
  settings and the config-row cache. On an Obsidian older than 1.8.7 the
  old data.json shape is kept unchanged.
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
  persisted per batch so crash replay is a no-op. **One applier per vault**
  (buildout spec 2.8): a plaintext `meta:applier` lease row names the copy
  that applies intents; every other copy of this vault (a second desktop)
  leaves the rows listable and receives the result through Obsidian Sync.
  The lease lasts five minutes, is renewed at half by its holder, and lapses
  when the holder quits or crashes, after which the next copy to drain
  claims it and applies from its following drain (a two-second settle
  covers two copies claiming at once). Within a drain the holder applies
  every intent for one note in a single write. In the other direction it
  reports plain **observations** — the latest state of daily notes and
  task-marked files, one upserted row per path — and never interprets an
  edit; that is dayGLANCE's scan pipeline's job.
  **The pairing split** (0.9.2, the 2026-09-29 incident): a re-pair on one
  desktop rotated the bridge key while two other copies kept the old
  data.json in memory for two days, and the drain's old rule for a row it
  could not decrypt ("sealed under a rotated-away generation, consume and
  delete") let whichever stale copy held the lease delete every write the
  fleet sealed under the new key, silently. Now a copy NEVER deletes an
  intent it cannot read: the row is held below the cursor floor, counted
  and said once, and dropped only after a week unreadable. A copy reads the
  vault's `meta:pairing` row before asserting its own and, when the vault
  was paired later than it was, STANDS DOWN: no lease, no applies, no
  reports, one console line, a warning in its settings tab, and
  `generation` plus `pairingStale` in its heartbeat so dayGLANCE's bridge
  panel says "this copy is behind, restart or re-pair" instead of "active".
  Every envelope carries the generation it was sealed under in the clear,
  so a held row names the pairing it needs. And the pairing is reloaded
  when Obsidian Sync changes data.json under a running copy
  (`onExternalSettingsChange`, Obsidian 1.5.7+), so a re-pair reaches every
  copy without a restart. Pinned by `test/scope.scenarios.test.ts` 25 and 26.
  **The fleet view** (the same day's second half): a stale copy said so on
  its own device, which is the machine the user is not sitting at. So every
  copy now publishes a plaintext status row, `meta:copy:<deviceId>` (its
  hostname or platform, plugin version, the pairing it holds, its stale
  verdict, how many intents it is holding), on change and hourly, deleted on
  unpair; every dayGLANCE device lists the copies under "Copies of this
  vault" and says on every machine when one is behind. dayGLANCE also
  probes its own oldest unconsumed intents every ten minutes and says so
  when one has waited that long while a copy holds the applier lease, which
  catches the effect whatever the cause. Scenarios 27 and 28.
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
  made from dayGLANCE (0.9.3: a bare note name on a request resolves as
  Obsidian resolves a link, and the record learns the note's real path). A linked note also carries a `dayglance:` frontmatter
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
  **Daily notes** the plugin creates (a task added to today from dayGLANCE,
  a completion-log entry) render an optional **Daily note template** the
  same way, here, at creation; without one, the daily note template text
  from dayGLANCE settings is used with `{{date}}` filled. With Templater's
  "trigger on new file creation" on, a template that asks for input is not
  applied at all (the trigger would run that prompt unattended); the
  settings tab says so.
  **A project's notes box is its note's description** (companion §4.3,
  owner ruling 2026-10-03): the paragraph under the note's title. The
  plugin puts the box into that slot at creation (`{{description}}` in a
  template), merges an existing box below whatever the note already says on
  link, and applies the planner's edits as a section replace
  (`project_note_description`). A save that carries a `base` the section no
  longer matches keeps the vault's text and appends the dayGLANCE text as a
  dated callout; a `wiki_note_write` whose `base` the note no longer matches
  is left alone.
  **A project's tasks live in its note** (companion §4.3, project routing):
  a task assigned to a linked project in dayGLANCE is written into the
  note's `## Tasks` section (created there, moved there on reassignment,
  removed on unassignment, its schedule as line metadata), and a task typed
  in the note imports assigned to the project. A linked note is in the task
  scope by virtue of the link, folder setting or not. The plugin applies
  `task_append` (note-task placement: section end, never sorted, never a
  missing note) and `task_remove` (the line carrying a block id) for this.
- **Add to dayGLANCE** (companion spec §4.2.1, `src/addTask.ts`,
  `src/addTaskModal.ts`): the editor's context menu, while text is
  selected, and the **Add selection to dayGLANCE as a task** command (an
  `editorCheckCallback`, so only with a selection) open a form: the title
  prefilled from the selection, an optional deadline, the app's priority
  (none to high) and, when the mirror can list them, the active projects.
  The task title is `<title> [[<link>]]`, the link being Obsidian's own
  link text for the note (`fileToLinktext`), always a wikilink. With
  **Link to the exact paragraph** on (Editor settings, off by default) the
  link names the block holding the selection's start: an id already at
  its end is reused, otherwise six random letters and digits are added
  through the editor. Never a `^dg-` id, written or linked (the writeback
  refuses to stamp a title holding `^dg-`), and never one on an unstamped
  task line (the parser would fold it into the title, the stamper would
  refuse the line): a task line, stamped or not, links to the note. The plugin emits a
  `task_create` action row under `act-create:` (sealed under the pairing
  subkey, the transport's 429 brake and own-seq record honoured, retried
  under one actionId); any paired dayGLANCE device with the account key
  builds the task, folder or not. Emitting needs only the pairing.
  It sends only once some current app announces `task_create`
  (companion §4.2.2, `src/appCapabilities.ts`: a sealed `meta:cap:<name>`
  row read by id; a yes cached per account and pairing generation in the
  device-local store, a no asked again on every open). Until then the form
  explains, Add is disabled, and nothing is emitted or written to the note.
  The creates it sent wait in a device-local list (`src/sentCreates.ts`)
  that the 30-second tick checks a few rows at a time; one still unconsumed
  after an hour shows as a waiting line in the agenda view.
- Seven commands: **Sync now** (drains pending intents + refreshes the
  heartbeat), **Enter pairing code**, **Unpair from GLANCEvault**
  (forgets the local credentials and the account key; revoke the token
  server-side too), **Open agenda**, the two link commands above, and
  **Add selection to dayGLANCE as a task**.

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

Apart from the pure editor-hiding rules, the Add to dayGLANCE helpers
(`test/addTask.test.ts`), the app capability reader
(`test/appCapabilities.test.ts`) and the waiting list
(`test/sentCreates.test.ts`), the plugin has no unit tests of its own; it is
exercised end to end by the bridge scenario harness in `test/`,
which runs from the repository root
with the rest of the suite (`npx vitest run`). The harness stubs the
`obsidian` module (`test/obsidianStub.ts`), serves an in-memory GLANCEvault
(`test/fakeGlanceVault.ts`), and drives the real transport plus the real
dayGLANCE sync hook against it (`test/harness.ts`). Add a scenario to
`test/scope.scenarios.test.ts` for any change to what the plugin stamps,
reports, or applies; Add to dayGLANCE has its own,
`test/addTask.scenarios.test.ts`.

## Build

```
npm install
npm run build          # type-checks, then bundles src/main.ts → main.js
npm run build:stamped  # the same, with the build time shown in the settings tab
npm run lint           # Obsidian's lint rules (eslint-plugin-obsidianmd)
```

`npm run build` is what releases use, and it is reproducible: the same
source always gives the same `main.js`, which Obsidian's directory checks a
release against. It carries no build time, so the settings tab shows only the
version. Use `build:stamped` for a build you copy into a vault by hand, so
the settings tab says which build that vault is running; never for a
release. Watch mode (`npm run dev`) is stamped too.

The lint is the rule set the community directory's automated review is
built on. An error fails the Bridge mirror workflow on every pull request
that touches the plugin; warnings are reported only. The remaining warnings
are the brand names "dayGLANCE" and "GLANCEvault" (the sentence-case rule
wants them lower-cased) and Obsidian 1.13 settings APIs, which cannot be
used below a 1.13 minimum. `.npmrc` sets `legacy-peer-deps`: the lint plugin
declares an exact peer, `obsidian@1.8.7`, that no other version of the
obsidian types satisfies, and it carries its own copy for its rules.

A build is three files, and all three ship: `main.js`, `manifest.json` and
`styles.css`. The CSS is not in `main.js` (0.9.4 moved it out of the
`<style>` elements the code used to inject), so a copy without `styles.css`
shows `^dg-` block ids again and an unstyled agenda. Copy all three when
deploying by hand, and attach all three to a release.

## Install

Users install it from Obsidian's community plugins (listed since 1.0.0,
2026-10-25), which installs and updates from the published releases of
`glance-apps/dayglance-bridge`. BRAT can install from the same repository, for
testing a release before it is published to everyone. To run your own build,
copy `main.js`, `manifest.json` and `styles.css` into
`<vault>/.obsidian/plugins/dayglance-bridge/` and enable the plugin in
Settings → Community plugins.

## Repo shape and the public mirror

The plugin is developed here, in the dayGLANCE repository, because its tests
run the real plugin against the app's real sync hook, and because it shares
its vault format with the app. It depends on three packages, all bundled into
`main.js`:

- `@glance-apps/obsidian-format`, the shared vault-format core, and
  `@glance-apps/agenda-core`, the shared agenda core: both `file:`-linked to
  `packages/` in this repository;
- `@glance-apps/sync`, from npm; only `vaultClient.js` and `dbCrypto.js` are
  imported, so the bundle carries the HTTP client and the crypto and none of
  the sync engine.

Obsidian's community directory and BRAT read a repository with
`manifest.json` at its root, so the plugin is also published to
[glance-apps/dayglance-bridge](https://github.com/glance-apps/dayglance-bridge),
which is generated from here and never edited directly:

- `scripts/bridge-mirror/assemble.mjs` builds its tree: this directory at the
  root without `test/`, the two shared packages under `packages/` with the
  `file:` links pointed at them, and the files in `mirror/` (the mirror's
  release workflow, `.gitignore`, `CONTRIBUTING.md`) at the root. The
  mirror's `LICENSE` is its own.
- `.github/workflows/bridge-mirror.yml` builds that tree on its own on every
  pull request that touches the plugin or the packages, and on `main` copies
  it to the mirror. When `manifest.json` carries a version the mirror has not
  tagged, it pushes the tag, and the mirror's release workflow builds it into
  a draft release with `main.js`, `manifest.json` and `styles.css`.
  Publishing that draft is what ships the version, so it stays a manual step.

To release a version: bump it in `manifest.json`, `package.json` and
`versions.json`, merge, then publish the draft release in the mirror.
