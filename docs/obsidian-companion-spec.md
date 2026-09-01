# dayGLANCE Obsidian companion — Phase 8

**Status:** Draft for iteration
**Supersedes:** `dayglance-obsidian-companion.md` (written before the bridge plugin existed)
**Depends on:** Phases 0–7 of `obsidian-buildout-spec.md`

---

## 1. What changed since v1

The original companion spec was written when dayGLANCE's only route into a vault
was reading and writing markdown files directly, on three different transports
(browser FSA, Electron main-process, Android SAF). Every feature had to be
expressible as "read a file, modify it in memory, write it back," and anything
requiring knowledge of the Obsidian runtime had to be approximated.

That constraint is gone. The bridge plugin (Phases 5–7) runs inside Obsidian,
holds a GLANCEvault credential, and can talk to Obsidian's own APIs and to other
plugins. Three things follow:

- **Templater support stops being an approximation.** v1 proposed
  reimplementing a subset of Templater's variables and warning about the rest.
  The plugin can ask Templater itself to render a template, with its full
  JavaScript engine.
- **Dataview stops being a formatting convention we hope works.** The plugin can
  query Dataview directly and verify.
- **dayGLANCE can render inside Obsidian**, not just write files it will later
  read back.

---

## 2. Decision of record: direct access is frozen at feature-complete

**Phase 8 targets plugin users.** Direct filesystem access (FSA, Electron
main-process, SAF) is considered complete as of Phase 7 and does not gain new
Obsidian features.

**This is a freeze, not a deprecation.** Direct access keeps working, keeps
getting bug fixes, and a user who never installs the plugin has exactly what
they have today: two-way task sync, block-ID identity, format reading,
completion timestamps, frontmatter on generated notes. That is a real
integration and it remains one.

**Rationale.** Every phase so far had to work three ways, and the cross-platform
matrix produced a large share of the defects. A plugin-only phase targets one
runtime, with real APIs, where the plugins we want to interoperate with actually
exist. That is a materially better engineering problem.

**Not a strict cutoff.** Where a Phase 8 feature extends naturally to direct
access at low cost, it should. The point is that direct access is no longer a
design constraint, not that it is forbidden to benefit.

**Platform consequence, intended:** the plugin runs on Obsidian mobile, so iOS
and Android users get Phase 8 by installing it, same as desktop. "Install the
plugin" becomes the answer on every platform. Tablets are a specific target —
an iPad running Obsidian alongside dayGLANCE is a first-class case, not an
afterthought.

**Precedent.** This mirrors the WebDAV decision: a transport that works stays
working, while new capability is built on the one that can carry it.

---

## 3. The goal, stated plainly

dayGLANCE is the execution layer. Obsidian is where the artifacts live.

A user's project accumulates notes, documents, research, meeting records, and
links in their vault. The work of actually doing that project — scheduling it,
blocking time for it, completing things — happens in dayGLANCE. Today those two
halves are unaware of each other beyond individual task lines.

Phase 8 connects them, in both directions:

- **Vault → dayGLANCE:** Obsidian is where the context is. dayGLANCE should
  understand it.
- **dayGLANCE → vault:** dayGLANCE is where the record of what happened is. The
  vault should keep it, permanently, in a form Obsidian's ecosystem can read.

---

## 4. Features

Ordered by dependency and risk, not by value.

### 4.1 Completion log

**The single highest-value item, and the safest.**

Every task completed in dayGLANCE is logged into the daily note for the date it
was completed, under a configurable heading (default `## Completed`) — including
tasks that were never Obsidian tasks at all. This makes the complete record of
what a user did available inside their vault, permanently, queryable by Dataview
and readable by AI plugins like Copilot and Smart Connections without any
dayGLANCE-specific integration.

**Why it's the safest thing in the phase:** it is append-only content under its
own heading. It does not participate in identity, retitle, reconciliation, or
any of the machinery that consumed Phases 2 through 7. A section that only ever
grows has no war potential.

**Foundation already built.** Phase 4's completion-timestamp work established
the timestamp itself (`completedAt` on scheduled tasks, local-offset ISO), the
Tasks-plugin detection, and the format-selection rule. The log consumes that
directly.

#### Entry format

```markdown
## Completed

- [x] Review Q2 contract draft [completion:: 2026-04-06T14:32:00] [project:: Acme migration] [priority:: 2] #legal #review
- [x] Call accountant [completion:: 2026-04-06T11:15:00] [priority:: 1] #finance
- [x] Update roadmap [completion:: 2026-04-06T09:45:00] [project:: dayGLANCE]
```

| dayGLANCE field | Log format | Notes |
|---|---|---|
| `title` (tags stripped) | Checkbox label | Tags rendered separately, see below |
| `completedAt` | `[completion:: ISO8601]` | |
| `projectId` | `[project:: name]` | Resolved to name; see 4.3 for the linked variant |
| `priority` | `[priority:: 0-3]` | Omitted when 0 |
| `date` / `deadline` | `[due:: YYYY-MM-DD]` | Omitted when absent |
| inline `#tags` from title | `#tag #tag` | Extracted from the title, appended after fields |
| `notes` | Omitted | Too verbose for a log line |
| recurrence | `[recurring:: true]` | Only when from a recurrence template |

**Tag handling:** dayGLANCE's tag model is "hashtags live in the title string."
Strip them from the label, render them after the fields, so the label reads
cleanly and the tags are queryable as standard Obsidian tags.

**Inline field syntax:** bracket `[field:: value]` for v1 — visible in reading
mode, which makes it verifiable. A setting for parenthesis syntax can follow.

#### Open decisions

| Decision | Options | Note |
|---|---|---|
| Heading | Fixed `## Completed` / configurable | Configurable, matching the existing tasks heading pattern |
| Uncomplete | Remove entry / leave / strikethrough | **Decided: leave.** See below |
| Query examples | App UI / docs / none | Docs only; Dataview isn't universally installed |
| Offline failure | Queue and retry / fail with indicator | See below |

**Uncomplete: the entry stays. Decided.** The log is a historical record, not a
reflection of current state. If a user uncompletes a task, the completion still
happened — they marked it done at that moment, and that remains true regardless
of what they decided afterward. A historical record that gets rewritten is not
a historical record.

v1 reached the same answer for a weaker reason ("modifying written vault content
is riskier than appending"), which the plugin's write discipline has since made
untrue. The reason that survives is the one above.

**This is also what keeps the log safe.** Append-only under its own heading is
the property that keeps it out of the identity, retitle, and reconciliation
machinery. The moment it removes lines it acquires a find-and-modify path and
joins the surface that has caused every problem in Phases 2 through 7. The
decision is worth defending on those grounds alone if it is ever revisited.

**Offline failure.** v1 recommended failing silently with a status indicator.
Phase 3 built real failure surfacing (latched sync-error state, named causes,
SAF revocation messaging). The log should use it rather than inventing a
parallel story. Whether a failed entry is *queued* is a separate question, and
the plugin's outbox is a natural home if so.

**Should this extend to direct access?** Probably yes — it's file appending, the
thing direct access does. Worth costing.

---

### 4.2 The dayGLANCE sidebar view

**The only feature that makes Obsidian better rather than making the vault more
useful.** A user working in their notes keeps their day visible without
switching apps.

#### Shape

- A right-sidebar view: **mini month calendar** on top, **agenda for the
  selected day** below.
- Reads **directly from GLANCEvault**, not through dayGLANCE. The plugin already
  holds a credential and a transport. This means the view works whether or not
  dayGLANCE is running anywhere.
- **Read-only, with one exception: completing a task.** Completion is already a
  supported cross-boundary action — a user can check a box in a daily note today
  and have it reflected in dayGLANCE — so allowing it here introduces no new
  semantics.
- Rescheduling, drag-to-move, and task creation are **explicitly out of scope**
  for v1. Each introduces write semantics the boundary doesn't currently have.

#### Consequence

This is GLANCEvault-only by construction. That is accepted: it's consistent with
the freeze decision, and it is a genuine argument in favor of GLANCEvault Pro
existing.

#### Open questions
- Live via SSE, or refreshed on view activation plus a poll? **Leaning SSE, same
  as Phase 7** — the plugin already holds a connection and the constraints are
  similar. Worth confirming that a passive view should hold one, since Phase 7's
  connection exists to apply intents rather than to feed a display.
- What does it show when the credential is missing or the vault unreachable?
- Mobile layout — the sidebar metaphor differs on phones and tablets.

---

### 4.3 Project and goal notes

**The most powerful item in the phase, and the reason the framing above
matters.**

A project in dayGLANCE is currently an ID and a name. A project in someone's
vault is a note accumulating everything about that project. Connecting them
means dayGLANCE tasks link into vault context, and vault notes accumulate a
record of execution.

#### Shape

- A dayGLANCE project or goal can be **linked to a vault note** — chosen from
  the vault, or created from a template.
- **dayGLANCE can create the vault structure for a project born in dayGLANCE.**
  Decided: a project created in the app should be able to produce its Obsidian
  home — a folder, an index note, optionally a template-driven structure —
  without the user leaving dayGLANCE to set it up manually. This is more than
  note creation; it is dayGLANCE creating vault structure, and it should be
  scoped as such.
- Tasks belonging to that project **link to the note** in their vault
  representation: `[project:: [[Acme migration]]]` rather than a bare name, so
  Obsidian's backlink graph shows every task that touched it.
- The project note optionally carries **dayGLANCE-maintained frontmatter**:
  status, open task count, next scheduled date, completion percentage.
- Completion log entries for that project link back, so the note's backlinks
  pane becomes a record of everything completed toward it.

#### Identity — the risk, and why it's smaller than it looks

Task identity consumed Phases 2 through 7. Project identity is a different
problem:

- Projects are **few** (tens, not hundreds).
- They are **long-lived** and renamed rarely.
- They **already have stable UUIDs** in dayGLANCE — nothing like the
  content-hash scheme that caused every identity war.

The genuine question is the *link*: if a user renames the vault note, Obsidian
updates wikilinks throughout the vault, but dayGLANCE's stored reference must
follow. Obsidian's rename event is observable by the plugin, which is exactly
the kind of thing only the plugin can see. That should be designed explicitly
rather than discovered.

**Open questions**
- What exactly does "create the workspace" produce — a folder plus index note, a
  configurable template, or something the user defines per project?
- Where do goals differ from projects here?
- Does the frontmatter update on every change, or on a cadence? (The
  `data.json` churn lesson applies: frequent small writes to a synced file have
  costs.)
- What happens when the note or folder is deleted but the project remains?

---

### 4.6 Templater, via guarded delegation

**Investigated and confirmed viable.** v1 proposed dayGLANCE implementing a
subset of Templater's variables and leaving unsupported ones visible. The plugin
can do better, but not unconditionally — delegation is a guarded ladder, not a
replacement.

#### The API

`app.plugins.plugins['templater-obsidian'].templater` is a public typed field.
The clean delegation points are `read_and_parse_template(config)` and
`parse_template(config, content)` — pure render, no file writes — with the
config built by `create_running_config(template_file, target_file, run_mode)`.

**Undocumented but de-facto stable.** None of this appears in Templater's docs,
which cover only the user-facing `tp.*` surface. But the core render signatures
are identical from v1.12.0 (2021) through v2.25.0 (Aug 2026), with one
backward-compatible widening and one transient wobble (a required
`RunningConfig.frontmatter` field appeared in 2.18.0 and was gone by 2.20.0).
QuickAdd ships a 534-line integration against exactly these methods, and
obsidian-book-search does the same.

**Copy QuickAdd's pattern:** `typeof x === 'function'` feature detection,
`.call(templater, …)` binding, and a non-Templater fallback.

**Do not rely on the on-create trigger.** Templater has a documented "trigger on
file creation" setting that auto-renders new files, but as of 2.21.0 it is
device-local, default-off, and no longer detectable via the synced
`plugin.settings` object — it moved to `localStorage`, which broke QuickAdd's
existing detection.

#### The sharp edge: unattended rendering hangs

`tp.system.prompt` and `tp.system.suggester` open a modal and settle only on
user action. **There is no timeout anywhere in Templater.** With Obsidian in the
background, the modal opens invisibly and the render promise stays pending
forever, with the file parked in Templater's pending set.

dayGLANCE creates daily notes precisely when nobody is looking at Obsidian, so
this is not an edge case.

**The guard: pre-scan the template text for `tp.system.` and refuse delegation
for those templates**, falling back to the subset renderer with interactive
variables left visible.

**Not a `Promise.race` timeout.** Racing abandons a live invisible modal and
leaves Templater's pending-set state dirty. The pre-scan is strictly better.

#### The ladder

Delegate when all three hold: Templater is installed, the methods feature-detect,
and the template contains no interactive calls. Otherwise fall back to v1's
subset with unsupported variables left visible.

**The fallback is still right, and more so now.** Leaving raw `<% %>` visible is
Templater's own on-create failure behavior, so it reads as normal to a Templater
user, and the visible residue is what lets them notice and fix it.

#### Failure detection

Templater's failure modes are loud to us rather than silent. Parse errors never
propagate — every call site wraps in an error handler that shows a Notice and
returns null or undefined, and `create_new_note_from_template` deletes the note
it just made. So a break at the API seam looks like a missing method (feature
detection fails, fall back) or a null render (fall back), both detectable at the
call site. Surface it in the plugin's status line the way the stamping tri-state
already is.

The silent-wrong-output modes are narrow: a cancelled `tp.system.prompt`
interpolates the literal text `null`, and a broken template under the on-create
trigger leaves raw `<% %>` in the note. Visible, not corrupt.

#### Build cautions

- Detect a concurrently-enabled on-create trigger via
  `app.loadLocalStorage('templater-local-settings')`, to avoid double-rendering
  the same new file.
- Register nothing before `onLayoutReady` — Templater's own setup, including its
  WASM parser, is async.

---

### 4.7 Dataview conventions, verified rather than assumed

v1 defined a formatting standard and hoped Dataview would query it. The plugin
can check.

- Formatting rules stand: inline fields, ISO dates, standard tags, standard
  checkboxes.
- **New:** the plugin can query Dataview to confirm dayGLANCE's writes are
  actually indexed and queryable, and surface a problem if not.
- **Also new:** dayGLANCE could consume Dataview results — a saved query
  defining a set of tasks, for instance — though that is a larger idea and
  probably later.

**v1's recommendation to leave the scheduled-task format unchanged still
stands**, and more strongly now: Phase 4 added metadata reading, Phase 2 added
block IDs, and the line format has absorbed a lot of change recently. The
completion log is the queryable record.

---

## 5. Deferred

- **Habits and routines in frontmatter.** From the original Phase 8 list:
  habit and routine completion written to daily-note frontmatter so streaks and
  adherence are queryable. Deferred, possibly permanently — the value isn't
  clear enough to displace anything above it, and habits are arguably just
  another thing the completion log could carry if they matter later.
- **Bases / TaskNotes integration.** Both are moving targets and TaskNotes has
  its own schema. Revisit once Phase 8's foundation exists.
- **Rendered schedule in the daily note.** A generated timeline block under a
  heading, regenerated daily. Greppable and readable in five years. Deferred as
  a generated-content feature that overlaps the completion log's territory.
- **Sidebar write actions** beyond completion.

---

## 6. Scan scope: read-only in Phase 8, read-write is its own phase

Investigated. The answer split.

dayGLANCE reads one folder. An Obsidian user's tasks live in project notes,
meeting notes, and everywhere else. "dayGLANCE only sees my daily notes" is the
most obvious gap a real Obsidian user would name.

### 6.1 The reuse argument fails, and the plugin is a better home anyway

The wikilink walk (`scanVaultNotes`) **never opens a file**. It iterates
directory entries, keeps names, and classifies portability from the name alone —
which is exactly why #1358's single-pass classify worked. It also doesn't run
per sync cycle, only on mount, vault reconnect, and settings connect.

Task classification needs every file's **contents** plus a per-file date, every
cycle. Per-file reads over FSA, IPC, and SAF, versus zero today. The traversal
skeleton is reusable; the cheapness that justified reusing it is not.

**The plugin is the right home, and it changes the answer.** It already receives
modify and create events for every vault file, its observation stores are
path-keyed, and it holds `metadataCache` — where Obsidian has *already parsed*
every file's checkboxes (`getFileCache(file).listItems`, per-item task flags, no
file reads). Event-driven plus cache-backed discovery beats any walk.

The wikilink index stays app-side: names-only is cheap and it serves pluginless
setups. It's vault-scale *task discovery* that belongs plugin-side.

**No Tasks-plugin dependency.** Checkbox parsing is Obsidian core —
`metadataCache.listItems` marks task items natively. Honoring the Tasks plugin's
global filter can be an optional *narrowing* for people who have it, never a
requirement.

### 6.2 Why read-write scope breaks the identity machinery

Not cardinality. **A note's identity key is its date**, and that is woven through
every layer:

- **Minting.** `deriveBlockId(dateStr, rawTitle)` is a frozen algorithm whose
  hash input is the daily note's date. `Projects/House.md` has no date to feed
  it. Inventing a note key — path, path-hash, anything — changes identity
  derivation, which is a hard-stop category, and it must change *unanimously* at
  all three minting sites or unanimity breaks. `isTombstonedRemint` also relies
  on date-plus-title separating identical lines in different notes; a keyless
  scheme collides them.
- **`obsidianFileDate` is the note's only name downstream.** Note-scoped deletion
  inference skips dateless tasks entirely. The revival lift needs a date-to-mtime
  map. The vault-wide detector's window check permanently excludes undatable
  keys, making them *untombstoneable*. The DB tier's `dailyNotes` rows are
  date-keyed with no row shape for a path-named note.
- **The writeback corrupts on fallback.** `sourceDate = task.obsidianFileDate ||
  … || task.date`. A task from a non-daily note would write its completion into
  the daily note for the task's date — the wrong file. There is no
  path-addressed task-line write anywhere; `wiki_note_write` is whole-note only.
- **Ruling 7 breaks on day one.** The plugin's `inScope` already admits any note
  containing `^dg-` or `#obsidian`, but stamping runs only when
  `dailyNoteDate(path)` is non-null. Opening the inbound tap would ship
  *unstamped* task lines — exactly the visible-implies-stamped invariant ruling 7
  exists to hold. Non-daily-note deletions are never reported at all.
- **Guards sized to a folder.** The deletion detector's drop guard,
  `max(5, 25% of last scan)`, grows linearly with vault size — a real mass
  deletion slips under it while one project-folder rename trips it. The
  500-entry outbox cap head-drops entries whose identity moves were already
  committed on enqueue. And initial adoption would stamp **every checkbox in the
  vault at once**, a vault-wide modification burst that Obsidian Sync then
  replays to every device. Ten notes produced five wars; this is that surface
  multiplied by the vault, in one hour.
- **No volume bound.** The 90-day import window is the only thing bounding scan
  size and store growth today, and it is date-derived. Path-keyed notes have no
  window, so `deletedObsidianKeys`, the retired-ids bundle, and the scan
  baselines become grow-only against vault size.

**Verdict: read-write scan scope is its own phase.** It needs a note-key design
ruled explicitly (the frozen-hash question), a path-addressed write route, a DB
row shape, reworked deletion inference, and a re-derived ruling 7. Sequenced
behind the substrate being boring for a while.

### 6.3 What Phase 8 gets: the read-only tier

Genuinely useful and touches none of the above:

- Plugin-side discovery via `metadataCache`.
- Tasks from non-daily notes **displayed** in dayGLANCE.
- Never stamped, never written back, never fed to deletion inference.
- Identity ephemeral per scan — never enters the DB tier or the tombstone
  stores.

It also composes with project notes: **daily notes plus the notes your tasks
already wikilink to** is a natural first scope.

**Write-policy tiers, for the record.** Read-only is safe now and Phase
8-compatible. Complete-by-path needs the path-addressed write route, which
doesn't exist. Full stamping needs everything in 6.2.

**Open:** which scope — all notes, configured subtrees, a tag or filter, or
daily-notes-plus-wikilinked. Leaning the last, as the smallest thing that closes
the real gap.

---

## 7. Sequencing

1. **Completion log.** Safest, highest value, foundation already built,
   establishes the write pattern everything else follows.
2. **Sidebar view.** Independent of everything else; the most visible proof the
   plugin is more than plumbing.
3. **Read-only scan scope.** Plugin-side discovery via `metadataCache`, tasks
   from other notes displayed but never written. Small, safe, and closes the
   most obvious gap.
4. **Project and goal notes**, including vault-structure creation. Highest value
   of the remaining items, and needs the completion log to be worth much
   (backlinks from completions are half the point). Composes with 3 — the
   wikilinked-notes scope and project notes are the same set.
5. **Templater and Dataview delegation.**

Read-write scan scope is not in this phase. See 6.2.

---

## 8. Open decisions, consolidated

| # | Decision | Status |
|---|---|---|
| 1 | Completion log heading fixed or configurable | Leaning configurable |
| 2 | Completion log for direct-access users too | Probably yes, needs costing |
| 3 | What "create the project workspace" produces | Open |
| 4 | Project frontmatter update cadence | Open; `data.json` churn lesson applies |
| 5 | Sidebar refresh mechanism | Leaning SSE, confirm for a passive view |
| 6 | Read-only scan scope: which notes | Leaning daily notes plus wikilinked |
| 7 | Note-key design for read-write scope | Deferred to its own phase; hard-stop category |
