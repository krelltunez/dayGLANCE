# Notes written to a task that already has a linked Obsidian note

Investigation report, 2026-09-17. No code changed.

Repro on the record: `obsidian-dg-2hnlwrtd` ("NEXT: Prepare for Obsidian
directory submission", dayGLANCE project) holds notes in its local field that
never reached its linked note. Leave it as it is until the fix lands.

## 1. The hypothesis, confirmed

The conversion is the task-notes migration from PR #1659 (companion spec 4.3,
"Task notes in a linked project"). It is planned by `planTaskNoteMigration` in
`src/utils/taskNoteName.js` and run inside the writeback's retitle loop in
`src/hooks/useObsidianSync.js`.

The plan returns null, and nothing runs, whenever the title already carries a
wikilink:

```js
const title = String(task.title || '');
if (extractWikilinks(title).length > 0) return null;
```

That guard was written for one purpose: a task that already carries a link
must never be migrated a second time, because the migration is a retitle (the
link joins the title) plus one note write. The guard is right about the
retitle and wrong about the notes. It treats "has a link" as "has nowhere to
put notes", so notes arriving on a linked task stay in the field forever.

Two things make the strand silent:

- **The notes panel hides the local field.** `NotesSubtasksPanel.jsx` renders
  either the linked-note editors or the local notes editor, never both
  (`wikilinks.length > 0 && onLoadWikiNote ? … : …`). A linked task's local
  notes have no surface at all.
- **The card icon follows the link.** `isObsidianNoteOnlyTask` returns true
  for any wikilinked title (#1658), so the button shows the open book and
  reads as "notes are in the vault" even while local notes exist.

Task 1 in the repro (`pxmxp4dx`, no link) took the create path and behaved.
Task 2 (`2hnlwrtd`, link present) hit the guard. Nothing about the MCP tool
distinguishes the two; the writeback does.

## 2. Transports

The migration runs only when the writeback is plugin-authoritative:

```js
const migrateNotes = authoritative && blockIdWritesEnabled();
```

It emits `wiki_note_write` intents and rides the placement machinery, which is
plugin-only by ruling F (non-daily notes are the plugin's). On the direct
transports (FSA, Electron, SAF) nothing converts at all, in either direction:
a task's notes stay local there whether or not it has a link, and the panel
shows the linked note through `readWikiNote` while hiding the local field the
same way. So the direct tier has the same visibility gap but no conversion to
extend. The fix belongs in the plugin path only. Extending the migration to
direct-tier writes would be new behaviour there, not a bug fix, and would need
the same per-platform creation paths ruling F deferred.

## 3. The MCP server is not involved

`update_task` writes the notes into the task record through the same mutation
every editor uses (`src/utils/taskMutations.js`); the writeback then decides
what happens on its next pass, seconds later, on whichever device is
plugin-authoritative. The tool's "success with the notes" is true at the
moment it answers, and would still be true after the fix: the notes are in the
record until the pass moves them. Making the tool report "routed to Obsidian"
would have it predict a pass it cannot see, on a device that may not be the
one it is talking to. The read model (`src/utils/mcpReadModel.js`) could show
the linked note's presence alongside the record, which would let a caller
understand why notes vanished from the field after a moment. That is a
separate, optional improvement. The fix is the integration's.

## 4. Other writers of local notes on a linked task

MCP is one of several. Every one of these puts text into `task.notes` without
looking at the title:

- **The local notes editor on any card whose panel does not hide it.** The
  panel hides the field only when the linked-note editor is available
  (`onLoadWikiNote` wired); the SCHED and Planner card panel and the modals
  pass it, but any surface that omits it shows the local editor.
- **A second device syncing an older record.** LWW at the entity grain: a
  device that had notes on the task before the migration cleared them, and
  edited the task later, wins the row with the notes back.
- **The title-conflict record.** `resolveTitleOwnership` appends a durable
  line to `task.notes` when both sides retitled (`appendTitleConflictNote`).
  The 2026-09-16 restore produced exactly that shape on the migrated tasks.
- **The bin-restore record.** Ruling 5 writes a deterministic notice into
  `task.notes` when the vault revives a binned task
  (`src/utils/obsidianBinRestore.js`).
- **Imports.** The share-sheet URL extraction writes a URL into notes on
  creation; a Todoist task carries its description. Both create unlinked
  tasks, so they hit the create path today, but a later re-import onto a
  linked task would strand the same way.

The system records (conflict, bin restore) matter: with the fix, they land in
the linked note as a dated line, which is what they are for. Without it they
are invisible on every linked task.

## 5. Design of the append

**Where.** End of file, after the existing text, separated by one blank line,
no heading, no timestamp. That is what the create path writes (bare notes
under the creation frontmatter), and it is what `wiki_note_write`'s
`create_or_append` mode already does, byte for byte:

```js
if (!body || currentText.includes(body)) return { text: currentText, changed: false };
return { text: `${currentText.replace(/\s+$/, '')}\n\n${body}\n`, changed: true };
```

The mode exists since #1659 and is exercised by the applier's tests. The fix
reuses it unchanged.

**Idempotency.** The mode's guard is the mechanism: text already present in
the note is not appended again, so a retried enqueue, a second device running
the same migration, or an append that landed while the field clear was lost
all converge on one copy. The block-id work (Phase 2) identifies lines, not
note bodies, and the write-safety hardening (Phase 3) protects open buffers;
neither gives a per-append receipt, and none is needed. The clear of the field
commits on enqueue in the same action as the emit, the rule every write on
that path follows, so the "append landed, clear failed" window is a lost
outbox, bounded by the same latch-and-surface discipline. Accepted edge: the
same text written twice on purpose is appended once. If that ever matters, a
hidden marker line carrying the intent id would make appends exact at the
cost of comment noise in source view; not recommended now.

**Missing file.** Confirmed: `create_or_append` on an absent note creates it
with the creation frontmatter, and the plugin resolves a folder-qualified
target to its path (`Projects/dayGLANCE/NEXT- ….md`) and a bare target to the
default new-notes folder, the same resolution the panel's create path uses.
No special case.

**Shared notes.** The concern is real: `[[GLANCE-repo-setup]]` linked from
two tasks is not a task's notebook, and bare appends into it would interleave
two tasks' notes with no attribution. The discriminator is available without
new state. A note is the conversion's own when the link target sits in the
project note's folder and its basename equals the name the conversion derives
from the title (`taskNoteNameFor`), allowing the numeric suffix the collision
rule adds. Everything else is shared or hand-linked. Proposed rule:

- Task-specific note: append bare, as above.
- Any other single link: append under a heading naming the task
  (`## <task title>`), so the text is attributed and a second task's append
  lands in its own section. The idempotency guard still holds on the body.
- More than one link in the title: append to the first, under the heading.
  The first link is the one the panel shows first and the one a reader
  reaches; splitting notes across notes would be worse than choosing.

The alternative, leaving notes local for shared links, keeps the strand: the
panel would still hide them. If the owner prefers it, the panel must change
to show the local field beside the linked note whenever it is non-empty. The
heading rule avoids that second change.

**Conflicts.** Three cases, all already handled by the applier:

- File open in Obsidian with unsaved keystrokes: the dirty-buffer rule defers
  the intent until the buffer is clean (`applyGroup` and `applyOne`).
- File modified moments ago: `create_or_append` runs inside `Vault.process`,
  reading the current text at apply time, so it appends to whatever is there.
- Note lagging on another machine: the lease holder applies to its copy and
  Obsidian Sync carries it; the other copy never applies (#1645).

## 6. Size and tests

Small. Roughly:

- `src/utils/taskNoteName.js`: a second planner, or a branch in the first,
  that for a linked task returns the target (existing link, resolved by the
  rule above), the body (bare or with the heading), and no title change.
  About 40 lines including the task-specific discriminator, which reuses
  `taskNoteNameFor` and `folderOfNotePath`.
- `src/hooks/useObsidianSync.js`: the migration today rides the retitle loop
  because it changes the title; a notes-only migration changes nothing on
  the line, so it needs its own short branch before the "nothing changed,
  continue" check: emit `wiki_note_write` with `create_or_append`, commit
  `notes: ''` on enqueue, done. About 25 lines. The panel already adopts the
  cleared field (#1659).
- No plugin change; no applier change; no locale strings.

Tests:

- Unit, `taskNoteName.test.js`: the task-specific discriminator (own note,
  suffixed own note, shared bare link, folder mismatch, two links), the
  heading body, no title change.
- Harness, `projectNotes.scenarios.test.ts`: (a) the repro, notes patched
  onto a task whose title already links its own note, appended bare, field
  cleared, a second pass writes nothing; (b) a shared link gets the heading
  and a second task's notes land in their own section; (c) link to a missing
  file creates it; (d) the same body patched again is not appended twice.
- The existing scenario 12 stays as the create-path pin.

One field step after merge: task `2hnlwrtd`'s stranded notes migrate on the
first pass, which is also the live check that the fix took.

## Follow-up (2026-09-17): the points to settle before building

### F1. The substring idempotency guard

**Likelihood.** Real but narrow. The writers, in order of exposure:

- MCP bodies are usually a sentence or more; a one-word body ("Done") or a
  bare URL is plausible from an agent summarising status, and a URL in
  particular repeats across notes.
- The conflict record and the bin-restore notice are dated single lines.
  Two restores on the same day produce the same line, and deduping that
  is correct, not a loss.
- Imports write a URL (share sheet) or a description (Todoist) onto a task
  at creation, before any link exists, so they take the create path.
- A stale row from another device carries the pre-migration body, the very
  text the note already holds. Deduping it is the intended outcome.

So the guard is right for the retry, the second device and the system
records, and wrong only for a short deliberate body that happens to equal
text already in the note.

**Options.**

- *Accept.* Cheapest; the loss is silent and the field is cleared, which is
  the one combination the report is about.
- *Block boundary.* Split both texts into paragraphs (runs of non-blank
  lines) and skip only when the body's paragraphs appear as a consecutive
  run in the note. "Done" no longer matches "Done and dusted", and a URL
  inside a sentence no longer matches a bare URL. An exact duplicate block
  still dedupes, which is what a retry needs.
- *Minimum length.* Arbitrary threshold, and the short bodies are exactly
  the ones at risk; below the threshold the retry case is unprotected.
- *Hidden intent-id marker.* Exact, but it leaves `%%dg:…%%` or an HTML
  comment on every appended block in source view, and a user who deletes
  the marker while editing re-arms the duplicate. Too much noise for the
  size of the risk.

**Recommendation: block boundary, plus a console line.** When the guard
skips a non-empty body, log it (`Obsidian: notes for <id> already present in
<target>, not appended`) so nothing vanishes without a trace. The change is
inside `applyBridgeIntent`'s `create_or_append` branch, about 15 lines
(`packages/obsidian-format/src/bridgeStream.js`). Callers affected: exactly
one, the notes migration in `useObsidianSync.js`; the only tests touching
the mode are the applier's append tests and project-notes scenario 12, both
of which pass unchanged under block matching (their bodies are whole
blocks). The console line is on the plugin side, where the apply runs.

### F2. Heading rule details

**What the guard compares.** Body alone, scoped to the task's section. Both
failure modes named are real for the unscoped forms:

- Body alone across the whole note: task B's text already under task A's
  heading blocks B's append, and B's field is cleared. Wrong.
- Heading plus body: a second append from A with new text does not match,
  so a second `## A` section is created. Wrong the other way.

**Preferred behaviour, assessed.** Find the task's heading; if present,
dedupe against and append into that section only (up to the next heading of
equal or higher level, or end of file); if absent, append the heading and
the body at the end. Inside `Vault.process` this is a pure function on the
note's text: split into lines, locate the heading line by exact match on
the cleaned title, scan forward to the section end, block-match the body
against those lines, splice. About 40 lines in the format package next to
`sortTaskLinesInSection`, which already walks sections by heading level and
is the pattern to copy. No new plugin state, no second read.

**Heading text.** The cleaned title: wikilinks stripped, hashtags stripped,
whitespace collapsed. There is no single existing helper: `stripWikilinks`
(`utils/taskUtils.js`) does the first half, `renderTitleWithoutTags`
returns React nodes, and `taskNoteNameFor` does both strips but then applies
the filename rules (`:` becomes `-`). The clean half of `taskNoteNameFor`
should be split out as `plainTaskTitle(title)` and shared; five lines.

**Renamed tasks.** Confirmed: the discriminator compares the link's basename
to the name derived from the current title, so a task renamed after
migration reads its own note as shared and gets a heading. Nothing on the
record names the migrated note: the block id is the line's token, and the
wikilink in the title is the only pointer. The cheap rename-proof fix is a
record field written at migration commit, `obsidianNoteTarget`, holding the
target the migration created. The discriminator then reads: link target
equals the stored target, or (for tasks migrated before the field) the
derived-name rule. It syncs with the row like every task field and costs
one line at the commit. Recommended.

### F3. The clear-then-lost window

**Where the text is, case by case.** The field clears on enqueue; the body
then lives in the intent. The intent's life:

- *Outbox, not yet flushed.* `localStorage` (`dayglance-bridge-outbox`),
  durable across restarts; removed only after the server acknowledges the
  batch. Recoverable by reading the key.
- *On the stream, not yet applied.* The row persists until the lease holder
  applies it; a dirty buffer defers it (the row stays listable under the
  retry floor), an unheld lease waits for the next holder. Delay, not loss.
  Recoverable by reading the row (sealed; the app can decode it).
- *Refused enqueue.* `emitBridgeIntent` returns false for an unpaired vault
  or a full outbox (`OUTBOX_CAP`), and the migration then does not clear
  the field. Not a loss.
- *Refused apply.* The one deterministic loss: a hand-typed link whose name
  fails the portability gate, with the file absent. The applier answers
  `unportable_name`, consumes the row, and the body is gone from both
  places. Fix: validate the target with `validateWikiNoteName` before
  emitting and leave the notes local when it fails (visible under F4).
- *Outbox purged.* Web storage cleared, or the iOS purge of 2026-09-09.
  Gone from both places. The MCP undo journal covers MCP-originated bodies
  only; conflict records, bin notices, UI and sync writes have nothing.

**Clear on confirmation instead of enqueue.** Not safely, for two reasons.
The app has no apply acknowledgement: the server acknowledges the batch
landing, and the only sign of an apply is the note's next observation,
which arrives only for notes in the plugin's scope. The migration's side
notes sit in the project folder, which need not be scoped, so an
observation may never come and the field would never clear. And while the
field holds text and the link exists, every pass would re-plan the same
migration; suppressing that needs a pending marker, which is the same
bookkeeping as the alternative below, with a worse failure mode.

**Smallest safeguard, recommended.** Keep commit-on-enqueue (the path's
rule; the outbox is durable and the stream keeps the row) and add three
things: the pre-emit validation above; a device-local sent-notes journal,
`day-planner-obsidian-notes-sent` `{id → {target, body, at}}`, written in
the same commit and pruned at 30 days, so the last body of every migrated
task is recoverable from storage whatever happens to the outbox; and a
console line naming the journal when an enqueue is refused after a partial
pass. About 25 lines, no new sync field, covers every writer.

### F4. Panel visibility, both tiers

**Panel.** Agreed, and it is a shared-UI bug: the ternary in
`NotesSubtasksPanel.jsx` (`wikilinks.length > 0 && onLoadWikiNote ? … : …`)
predates the migration and assumed a linked task had no local notes. Change:
render the linked-note editors as now, and beneath them, whenever
`task.notes` is non-empty, the existing local notes block with a small
label. The block already exists in the else branch; it moves into a shared
fragment rendered under either condition. The direct tier gets the same
fix, since the panel is the same component and the stranding there has no
conversion to clear it. About 20 lines. One locale string, the label:
`task.localNotes` ("Notes in dayGLANCE"), in all eight bundles;
`locales.test.js` enforces coverage.

**Card icon.** `isObsidianNoteOnlyTask` should return false when local
notes are non-empty. The rule of #1658 is that the icon says where the
notes live; with text in both places the honest answer is the document,
lit, and the panel then shows both. One line plus a test case in
`textFormatting.notesIcon.test.js`. After the fix lands the state is
transient on the plugin tier and steady on the direct tier, and the icon is
right in both.

### F5. Shared-note decision, side by side

**A. Heading append into shared notes** (F2 refinements applied).

- *System records into a hand-written doc.* A conflict record or bin
  notice lands as a dated line under `## <task title>` in, say,
  `GLANCE-repo-setup`. Attributed and dated, but it is dayGLANCE
  bookkeeping inside a document the user wrote for another purpose.
- *What the user sees.* The note gains a section per task that ever had
  notes; the card shows the open book; the panel shows the linked note
  with the section in it. Nothing stays local.
- *Size.* The section-scoped append and heading (F2, about 45 lines), the
  cleaned-title helper, the discriminator with the stored target.
- *Tests.* Scenarios for the heading, the second append into an existing
  section, the renamed task, the system record under a heading.

**B. Bare append for the conversion's own note; shared and hand-linked
notes keep local notes, visible through F4.**

- *System records.* Stay in the field, visible in the panel under the
  local label, exactly where they land today on unlinked tasks. Nothing
  dayGLANCE-shaped enters a hand-written doc.
- *What the user sees.* A task-specific note behaves as the migration
  intended. A hand-linked task shows the linked note and, when it has
  local notes, the local block beneath it; the card shows the document
  icon while local notes exist, per F4.
- *Size.* The discriminator with the stored target, the bare append (the
  existing mode with F1's block guard), no heading code, no section walk.
  Roughly half of A.
- *Tests.* The repro, the missing file, the short body, the renamed task
  (which under B must keep the bare path via the stored target, or fall to
  local when the field is absent), the panel and icon.

**Recommendation.** B. The stranding is fixed by F4 in both tiers whatever
is chosen; A buys the invariant "a linked task has no local notes" at the
price of writing into documents the user did not create for the task, and
the system records are the case that makes that price visible. B keeps the
migration to the notes it created, which is the rule the owner set on
2026-09-14 (notes go beside the project's index note), and leaves
hand-linked notes as the user's. The one cost of B is that a hand-linked
task can hold notes in two places indefinitely; F4 makes that plain rather
than hidden. Owner's choice.

### F6. Test additions

Added to the list in section 6:

- Applier: a short body that already appears inside a longer line is still
  appended; an exact duplicate block is not, and the skip is logged (F1).
- Applier and scenario, if A: a second append from the same task lands in
  its existing section, before the next heading, and dedupes within the
  section only (F2).
- Planner unit test and scenario: a task renamed after migration keeps the
  bare path through the stored target; without the field it falls to the
  derived-name rule (F2).
- Panel render test: a linked task with local notes shows both blocks, in
  the direct-tier shape (no `onLoadWikiNote`) and the plugin shape (F4).
  Icon test: local notes on a linked task show the document, lit.
- Recovery: the sent-notes journal holds the body after a migration commit;
  an unportable hand-typed target leaves the notes local and emits nothing
  (F3).

### F7. Revised estimate

Under B: planner about 50 lines (linked-task branch, stored target,
validation), hook about 35 (notes-only branch, journal, commit), applier
about 20 (block guard, console line), panel about 20 plus one string in
eight bundles, icon one line, `plainTaskTitle` five. Tests: three unit
files touched, one new panel render test, four or five harness scenarios.
Under A add about 45 lines for the section-scoped append and two scenarios.
No plugin source change either way; the applier change ships with the
format package the plugin bundles, so the desktops rebuild once.

## Create-with-notes loses the wikilink (2026-09-17, investigation only)

Symptom: a task created in a linked project with notes in the same call
ends up with its note file in the vault, its local field cleared, and no
wikilink in its title. The affected task's id was not supplied with the
report; the fingerprint to collect is in C1.

### C1. Root cause

**The mechanism, reproduced in the harness.** The migration's retitle rides
`task_retitle`, and the applier's line rewrite (`updateTaskLines`,
`packages/obsidian-format/src/taskLines.js`) carries the write-time title
guard: when the line's current body differs from the app's
`obsidianRawTitle` (the base the intent carries) and from the new title,
the rewrite keeps the line's own title and applies only the state. That
guard exists so a dayGLANCE write never reverts an Obsidian edit. Under it
the migration comes apart in a fixed order:

1. The note write lands (its own intent, unguarded) and the app has already
   committed the title with the link and `notes: ''` on enqueue.
2. The retitle is refused silently: the line keeps its body, without the
   link. The app still shows the link.
3. The note's next observation carries the line without the link;
   `resolveTitleOwnership` sees the line moved off the app's base with no
   pending dayGLANCE rename, and the vault wins one-sidedly. The link is
   gone from the title, the notes are gone from the field, the file exists.

A scratch harness run (not committed) confirms it: placement, then an
Obsidian-side edit of the fresh line before the app observed it, then the
migration pass. Result: title `Epsilon task edited #obsidian`, notes empty,
no link, note file present.

**What is not the cause.** Each candidate from the ask was run in the same
scratch harness, and every one converged with the link in place:

- No vault line or block id on the first pass: placement commits the token
  and the home before the migration can plan, so the migration always runs
  one pass later with both present (inbox task, scheduled task, explicit
  `isAllDay: false`, with and without a drain between the passes).
- The retitle emitted but lost: intent rows persist until applied.
- An observation landing between the append and the retitle: the app's
  title reverts for one round and the retitle restores it on the next.
- Entity-grain LWW against the create row: the create precedes the commits
  on the same device. A second device is discussed under C2.

**Why create-with-notes and not update_task.** The retitle's base is the
app's `obsidianRawTitle`. After `update_task` on an existing task that base
came from an observation of the line itself, so it matched. After
`create_task` with notes the migration runs on the pass right after
placement, before any observation, so the base is placement's own guess of
the line. In the harness that guess is byte-identical to the appended line
and the retitle applies; in the field something changed the line between
the append and the retitle. Candidates, in order of likelihood:

- The line was edited in Obsidian (or by a Sync merge) in that window.
- The plugin copy that applied the append is not the copy whose
  observation the app applied last, and the two copies' lines differed
  (a Sync-lagged follower report). Project notes have no late-observation
  gate: `applyLateObservationGate` judges daily notes only, and scoped
  notes pass through, so a stale follower report is applied as truth.
  This variant does not refuse the retitle; it reverts the app title until
  the note is next observed.

**Fingerprint.** With the task's id: read its vault line. Line without the
link means the guard refused the retitle (the first mechanism). Line with
the link and a title without it means the stale-report variant, which any
edit of the note will heal on its own. Also read the record's
`obsidianRawTitle` (via the MCP read model): equal to the line's body in
either case, since the vault won.

### C2. Atomicity

Not atomic. Three pieces move on the migration pass:

1. `wiki_note_write` (its own intent row, applied without a title guard).
2. `task_retitle` (its own row, applied under the guard above).
3. The app commit on enqueue: `title` with the link, `notes: ''`,
   `obsidianRawTitle` set to the new raw title, in one action.

Ways they come apart, beyond the guard:

- The note-write enqueue refused (outbox cap, unpaired): the code stops
  before the retitle and before the commit, so nothing moves. Safe.
- The retitle enqueue refused after the note write queued: the hook reports
  a write failure and skips the commit; the notes stay local; the next pass
  re-plans, appends idempotently and retitles. Converges.
- A second device in plugin posture pulls the created row before the
  commits: it runs the same placement (same token, same retirement) and the
  same migration, so its intents are duplicates and its commit carries the
  same title. Converges, unless its migration pass also hits the guard.
- The dirty-buffer deferral holds the whole group; all three land later.

### C3. Exposure today

The orphaned task has no link and an empty field, so nothing runs. If it
receives notes again, from any writer, the migration re-plans: the derived
target is the same name (the `taken` set knows only links, not files), the
applier's `create_or_append` finds the existing file and appends to it, and
the retitle now carries an observation-backed base, so the link lands. The
collision suffix applies only if some task already links that name. So
adding any note text to the task repairs it, unless the line diverges again
in the same window. The stranded note's text is not lost: it is in the
file.

### C4. Repair

Manual repair is enough for the one task: add `[[Projects/dayGLANCE/<derived
name>]]` to its title in either place, or add a note and let the migration
reconnect it (C3). A one-time sweep is not warranted. The app cannot list
vault files in plugin posture without a handle, and a sweep that binds a
task to a note by derived name alone would also bind hand-made notes that
happen to share the name. With PR 2's `obsidianNoteTarget` on the record,
future orphans are self-describing: the field is written by the commit that
did happen in this bug, so the record names its note even after the title
lost the link, and the discriminator can treat "target set, title without
the link" as a link to re-assert (C5) rather than a note to guess at.

### C5. Fix proposal, and PR 2

Two parts, both inside PR 2's planner and hook:

1. **An observation-backed base for the retitle.** The migration waits
   until the placed line has been observed once, so `obsidianRawTitle` is
   the line's own body, not placement's guess. The marker to use is
   whatever the observation import stamps on a note task (the field
   console shows `obsidianLegacyId` arriving with the first observation of
   `pxmxp4dx`; confirm at build time, else add a `obsidianPlacedAt` set by
   the placement commit and cleared by the observation refresh). Cost: one
   condition in the planner. Create-with-notes then migrates one
   observation later, seconds in practice.
2. **Re-assert from the stored target.** When `obsidianNoteTarget` is set,
   the title lacks its link, and the base is observation-backed, emit the
   retitle again, once per observation. This heals the guard case and the
   stale-report case alike, and makes the field the recovery anchor the
   ask hoped for. It does not inherit the bug: the commit that writes it
   runs regardless of what the applier later does with the retitle.

The guard itself stays as it is; it is what keeps a dayGLANCE write from
reverting an Obsidian edit, and the fix is to give it a true base rather
than to weaken it.

### C6. Tests

- Harness: create-with-notes in one call, inbox and scheduled shapes,
  migrating after the first observation with the link on the line and the
  notes in the file (pins today's passing variants as regressions).
- Harness: the line edited in Obsidian between placement and migration.
  Today: link lost. After the fix: the migration waits, the retitle carries
  the edited base, the link lands, the notes append once.
- Harness: an observation landing between the append and the retitle
  (today's variant f, converges; pin it).
- Harness: a task with `obsidianNoteTarget` and no link in its title gets
  the link re-asserted once, and a second pass writes nothing.
- Unit: the planner declines to migrate a placed task with no observation
  evidence; the re-assert plan.

### Corrections to earlier sections

- F3's journal: it is device-local storage like the outbox, so it does not
  survive a storage purge. It covers consumed rows, server-side loss and
  debugging.
- Accepted edge, to document with PR 2: a retry that arrives after the user
  edited the appended block in Obsidian re-appends it, since the block
  guard no longer matches.
