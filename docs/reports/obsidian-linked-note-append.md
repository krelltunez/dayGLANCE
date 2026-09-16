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
