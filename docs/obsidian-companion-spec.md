# dayGLANCE Obsidian companion — Phase 8

**Status:** Draft for iteration
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
grows has no war potential — **provided the scan-collision constraint below is
designed in. As originally drafted it was not, and the claim was false.**

**Foundation already built.** Phase 4's completion-timestamp work established
the timestamp itself (`completedAt` on scheduled tasks, local-offset ISO), the
Tasks-plugin detection, and the format-selection rule. The log consumes that
directly.

#### Entry format

**Ruled (2026-09-02), as built:** the non-task line shape, with the wall-clock
time up front and the stored completion timestamp verbatim in the field:

```markdown
## Completed

- ✅ 09:45 Update roadmap [completion:: 2026-04-06T09:45:00-05:00] [project:: dayGLANCE]
- ✅ 11:15 Call accountant [completion:: 2026-04-06T11:15:00-05:00] [priority:: 1] #finance
- ✅ 14:32 Review Q2 contract draft [completion:: 2026-04-06T14:32:00-05:00] [project:: Acme migration] [priority:: 2] #legal #review
```

Entries insert at SECTION END, so the section reads chronologically, newest
last. A completion whose stored timestamp is a bare date or absent renders
with no time and the date bucket as the completion field, deterministically
(so two devices independently observing the same vault-originated completion
format the identical line and the exact-line dedupe collapses them).

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

**Multi-user (2026-09-02 amendment, built).** The log is THIS user's
record. The first field test on a two-member account logged the other
member's completions too: her tasks sync into the same state, and the
detector logged every edge it saw. The rule is now the app's own visibility
rule (App.jsx `isVisibleForUser`: unassigned, or assigned to me), applied to
the three lists before the snapshot, so another member's completions are hers
to log from her devices. Unassigned tasks log from every member's device: in
a shared vault the exact-line dedupe collapses the duplicate, in separate
vaults each gets its own line. Single-user accounts are unaffected (every
task is visible).

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

#### The scan-collision constraint (review finding, 2026-09-01)

The safety claim above is only true if the scan and the stamper are made to
ignore the log, and today they would not. Both dayGLANCE's task parser
(`parseTasksFromMarkdown`) and the plugin's stamp-on-sight planner
(`planStampInsertions`) are **heading-blind**: each matches every
`- [x]` line in a daily note with the same regex, whatever section it sits
under (verified in `packages/obsidian-format/src/taskLines.js` — neither
function tracks headings). A log entry shaped `- [x] …` in a daily note would
therefore, on the next observation or scan of that note:

1. be **stamped on sight** by the plugin — an untagged task line in a daily
   note gets a `^dg-` token and a minted identity; and
2. be **imported by the scan as a new completed task** — a duplicate of the
   task it logs, under a different identity (the label plus inline fields hash
   differently), which then flows to the DB tier, deletion inference, and
   every device.

That is war surface, not append-only safety. The exclusion is a design input
for the entry format, not a patch to apply later. Options:

- **A non-task line shape** (leaning). Entries that cannot match the task
  regex at all, e.g. `- ✅ 14:32 Review Q2 contract draft [completion:: …]`.
  Dataview still queries inline fields on any list item; what is lost is the
  literal checkbox rendering and Dataview's TASK-typed queries. No new parser
  machinery anywhere, and safe by construction — the parser cannot import
  what cannot match.
- **Section-aware exclusion.** Teach the parser and the stamper to skip the
  configured log heading's section. Keeps the checkbox shape, but adds heading
  tracking to two hot paths that never had it, on every platform, and fails
  open the moment a user renames the heading by hand.
- **A marker-based skip** — some token on the line that both sides refuse.
  The `^dg-`-anywhere refusal is precedent, but overloading it (or adding a
  sibling marker) leaks identity semantics into a record whose whole point is
  staying out of identity.

Whichever wins, the constraint stands: **the log format is not free to be a
naked `- [x]` line.**

**Ruled (2026-09-02): the non-task line shape.** Safe by construction — the
`- ✅ ` prefix cannot match the parsers' `- [([ xX])]` shape, pinned by a
test that feeds hostile titles through the real parser and stamper. The
applier additionally refuses multi-line entries so nothing task-shaped can
be smuggled past the formatter. The other rulings landed with the build:
heading **configurable, default `## Completed`** (stored in the device-local
`obsidianConfig`, like the task heading); the log is **available to
direct-access users** (one shared formatter and applier; the direct routes
apply the same `completion_log_append` intent shape locally); and **every
single completion logs** — local, vault-originated (the device whose sync
first applies the flip logs it), and recurring instances
(`[recurring:: true]`, bucketed to the instance date). Transitions that
happen while the log is disabled are consumed silently, never retro-logged
on enable. M2 (the outbox cap and all-or-nothing flush) was fixed first, as
the precursor the queue story depends on.

**Hold, never consume (field correction, 2026-09-01).** The first build
copied the notify emitters' echo semantics: a render under the engine's
remote-apply flag consumed the whole snapshot diff, and the enabled gate
included the vault handle, consuming edges while the handle was still
restoring after launch. The first fleet evening falsified both: a
cross-list delete/resupply war kept the remote-apply flag up in wide
windows and silently swallowed local completions made inside them (the
"nothing logs anymore" incident). The corrected detector distinguishes the
user's intent from transient conditions — only *log disabled* consumes;
a remote apply in progress and *no write route yet* (handle restoring,
or a plugin-authoritative device with no local handle, whose emit route
needs none) HOLD the snapshot, so the edge logs on the next viable render.
Consequence, accepted deliberately: completions arriving from other devices
now log on whichever enabled device sees them first, which is what the
every-single-completion ruling wants (the completing device may have the
log toggle off); double-writes collapse because entries are deterministic
and the applier's landed-check scans the whole note, not just the section.

**Offline failure.** v1 recommended failing silently with a status indicator.
Phase 3 built real failure surfacing (latched sync-error state, named causes,
SAF revocation messaging). The log should use it rather than inventing a
parallel story. Failed entries ARE queued: the write goes through the bridge
outbox (`emitBridgeIntent`) like every vault write. The sizing caveat this
paragraph originally carried — a 500-entry FIFO with silent head-drop, audit
finding M2 — was fixed before the log shipped (PR #1510: the outbox refuses at
its cap instead of dropping its head, and flushes in 50-entry chunks), which
is why M2 was sequenced first.

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

#### Open questions (as originally posed)
- Live via SSE, or refreshed on view activation plus a poll? **Leaning SSE, same
  as Phase 7** — the plugin already holds a connection and the constraints are
  similar. Worth confirming that a passive view should hold one, since Phase 7's
  connection exists to apply intents rather than to feed a display. Posture
  note: the SSE gate currently in force is on *dayGLANCE's nudge consumption*
  (buildout §3.10, seventh record); the plugin's own connection was never
  gated, so this view is unaffected by that gate — but the same 429 brake and
  reconnect budget apply.
- **What exactly does completing a task here write?** A task that lives in a
  daily note has the observation path — checking the box in the note is the
  supported action. A dayGLANCE-only task has no vault line, so completing it
  means the plugin writing the account's data plane directly — a **new writer**
  with own-ack and sequence obligations the plugin does not have today. That
  needs its own small design; "completion is already cross-boundary" covers the
  semantics, not the transport.
- What does it show when the credential is missing or the vault unreachable?
- Mobile layout — the sidebar metaphor differs on phones and tablets.

#### Built (2026-09-02) — the decisions of record

Built overnight on accepted defaults, with a standing veto (see the owner
ruling below).

1. **The plugin is a full GLANCEvault READER, never a data-plane writer.** The
   first cut assumed the plugin could not read task rows (they are sealed under
   the account root key; the pairing carries only the HKDF bridge subkey). That
   was wrong by omission: the plugin can derive the root key from the sync
   passphrase exactly like any dayGLANCE client — PBKDF2 over the passphrase and
   the account salt, proven by decrypting the engine's keycheck row. So the
   settings tab gained a **dayGLANCE account** section: enter the sync
   passphrase once per device; the derived key is persisted in IndexedDB under
   the plugin's own database name (`dayglance-bridge-db`), and **neither the
   passphrase nor the root bytes are ever written to `data.json`** — that file
   rides Obsidian Sync to every copy of the vault, and a passphrase-equivalent
   must not travel with it. Unpairing forgets the key with the credentials.
   With the key, the store lists the `dayglance` app namespace, decrypts the
   `tasks:` and `recurringTasks:` rows into an in-memory mirror (cursor-driven;
   a plugin reload re-lists from seq 0, reads only), and the view is built from
   it. The plugin **never** `encryptEntity()`s a data-plane row: dayGLANCE's
   engine stays the single writer, and the own-ack/sequence obligations the
   open question worried about are never taken on.
2. **Completion travels as an ACTION ROW, applied by dayGLANCE.** Checking a box
   seals `{v:1, kind:'action', type:'task_complete', actionId, taskId |
   templateId+instanceDate, completedAt, createdAt}` under the pairing subkey
   into an `act:`-prefixed row on the bridge stream (`BRIDGE_ACTION_PREFIX`).
   dayGLANCE's sync cycle fetches action rows (in BOTH arbitration modes — the
   phone that wrote the row may be asleep, leaving the desktop's heartbeat
   stale), applies them through the ordinary state setters
   (`utils/obsidianBridgeActions.js`: completed + completedAt from the action +
   transitionId + lastModified; recurring instances join `completedDates` with a
   per-date timestamp), and deletes the consumed rows. Because the completion
   is made *in* dayGLANCE, the completion log (4.1), the vault writeback of the
   checkbox, and DB sync all fire exactly as for an in-app completion. Unknown
   targets are **held** — the cursor stops below the oldest held row so a task
   that hasn't synced to this device yet is applied on a later cycle or by
   another device — and consumed as stale after seven days. *(Amended
   2026-09-05: a target this device has tombstoned — a user delete, a
   detector or note-scoped inference, or a recycle-bin entry — will never
   arrive and is consumed as stale at once; a retired id is redirected to its
   successor. The held log names the target, not only the action.)* The view
   marks an emitted completion as pending until the mirror reflects it (a
   15-minute optimistic mark, then the box reverts rather than lie).
   **Maintenance hooks (2026-09-05).** The mirror reads the vault directly,
   so it shows any row dayGLANCE no longer holds. A row past every device's
   pull cursor is unreachable by the ordinary paths; two console hooks reach
   it: `window.__dayglance.purgeVaultRow('tasks:<id>')` marks the entity
   dirty and runs a cycle (absent locally it is pushed as a soft-delete,
   fleet-wide under LWW; present locally it is merely re-upserted), and
   `window.__dayglance.resyncVault()` clears the sync cursors and reloads so
   the next cycle full-pulls and runs every stray through the apply gate,
   which now drops and deletes (buildout spec §3.10, seventh record's
   addendum).
3. **Latency.** The mirror refreshes on the transport's cadence: the 30-second
   tick and the drain's success tail (`BridgeHost.onSynced`), so an SSE nudge
   makes the sidebar live without the store holding a second stream. The action
   is consumed on dayGLANCE's side at its poll cadence (five minutes) until SSE
   nudge consumption is re-armed; the owner accepted this, noting it matters
   only if SSE stays off.
4. **Scope.** Projection window of ±35 days around today; scheduled tasks,
   recurring instances (exceptions and completedDates honored via the shared
   expansion), and imported calendar events (shown, but completed in
   dayGLANCE — their completion lives in a different store). **No inbox.** Only
   completion; a completed box stays completed (no un-complete from here).
5. **Shared expansion, one answer.** The recurrence engine moved out of
   `src/utils/recurrenceEngine.js` into a new shared package
   **`@glance-apps/agenda-core`** (`packages/agenda-core`: recurrence +
   `buildAgenda`/`expandRecurringTemplate`), consumed verbatim by the app (the
   old module re-exports it) and bundled into the plugin — so "what does today
   hold" is computed by the same code in both places. Same boundary discipline
   as `@glance-apps/obsidian-format` (buildout §3.11): expansion, never policy.
6. **Missing credential / unreachable.** The view shows a setup line while
   unpaired or keyless, and a status footer (last refreshed, rate-limited,
   unreachable, rows unreadable under this passphrase) once ready.
7. **Mobile.** The same `ItemView` opens in the right sidebar drawer on mobile;
   no separate layout in v1.
8. **Calendar events ride a projection, not the data plane (2026-09-02, owner
   ruling: option 1).** The first field test showed no calendar events: the
   sync payload structurally excludes read-only calendar events
   (`payloadExclusions.js` — subscription feeds are re-fetched per device,
   native device-calendar rows never leave the phone), so no mirror can carry
   them. Three options were weighed: (1) each running dayGLANCE publishes a
   PROJECTION of the events it holds; (2) the plugin fetches the feeds itself
   (feed URLs and credentials leaving the app, a second import pipeline, a
   wider network footprint for directory review); (3) stop excluding the
   events from sync (reopens the glitch-loop and multi-user-leak ground the
   exclusion settled). The owner chose (1), having arrived at it from (2).
   Built: `utils/obsidianCalendarProjection.js` builds `{v:1,
   kind:'projection', type:'calendar', deviceId, from, to, publishedAt,
   events}` for ±35 days from exactly the excluded classes;
   `publishBridgeCalendarProjection` seals it under the bridge subkey into one
   upserted `proj:calendar:<deviceId>` row (`BRIDGE_PROJECTION_PREFIX`) per
   cycle, guarded once-per-(generation, content) so an unchanged calendar
   costs no request and the daily window slide republishes at least daily.
   Derived data authored by the app: NOT a data-plane write, so the
   single-writer boundary is untouched. The plugin keeps a second cursor over
   the bridge namespace for `proj:` rows and unions them
   (`mergeCalendarProjections` in agenda-core: freshest copy per event id,
   projections older than seven days ignored, so a device that stops
   publishing cannot pin stale events). The status footer says "Calendar as
   of N h ago" once the freshest projection is over an hour old. (The
   original known limit — in multi-user mode the plugin showed the union of
   every device's feeds — was closed by decision 9: projections carry their
   device's user and the plugin keeps its viewer's.)

   **Correction (2026-09-02, the disappearing-events field report).** The
   projection was first built from the live task list. On a native-calendar
   device (macOS with EventKit, iOS, Android) that list holds calendar events
   for only the five days around the date being viewed — App.jsx's native
   effect replaces every calendar event, feed events included, with each
   fetch — and holds none between launch and the first fetch. So the
   published projection shrank to the current window on every navigation and
   to nothing at startup, and the sidebar's events vanished and returned with
   it ("only the next couple of days"; "they keep disappearing"). Three fixes
   were weighed: a device-local per-day CACHE fed by the fetches the app
   already makes (chosen); a dedicated 71-day native fetch per sync cycle
   (spawns the EventKit helper every five minutes on the Mac, heavier on
   phones); or widening the app's own view window (changes the app for the
   sidebar's sake). Built: `utils/calendarProjectionCache.js` — never synced,
   keyed by day, each day stamped with its fetch time. The native fetch
   replaces exactly the days it fetched; a feed sync replaces every day of
   the projection window, keeping the days' events of feeds that failed that
   round, and is skipped on native-calendar devices (mirroring the app, which
   drops feed events there). The projection publishes the cache and carries
   the per-day stamps as `days`; the publish hash ignores them so an
   unchanged re-fetch costs no request. The cache is seeded once from the
   live list when empty so the first run after the change never publishes
   less than before. Reader side (`mergeCalendarProjections`): PER-DAY
   AUTHORITY — for each date, the freshest projection declaring that date
   (its `days` stamp, or its whole window at publish time for older payloads)
   supplies all of the date's events and the others supply none, so a device
   that re-fetched a day and found an event gone removes it rather than an
   older copy lingering in a union. The footer reads "Calendar for this day
   as of N ago" once the selected day's stamp is over an hour old. Cost
   accepted: a day not viewed recently shows the events from the last time
   any device fetched it, labelled as such.
9. **User-awareness (2026-09-02, owner ruling).** The sidebar showed another
   member's scheduled task: the mirror holds every task on the account with
   no notion of a viewer. Ruling: one rule everywhere, the app's own —
   tasks and recurring templates by visibility (unassigned, or assigned to
   the viewer), routines by ownership, calendar projections by the
   publishing device's user. The plugin learns its viewer from the PAIRING:
   the dayGLANCE device that mints the offer includes its current user
   (`userSyncId`, null when single-user), so pairing from your own device
   needs no setup; a "Show tasks for" setting (populated from the synced
   users, with "Everyone") overrides it, stored in data.json beside the
   pairing. Owner's assumption of record: people do not share Obsidian
   vaults, so a vault-scoped setting is the right scope. App side: the
   projection carries `userSyncId` (the device's identity when multi-user is
   on) and the completion log applies the visibility rule (4.1 amendment).
10. **Vault scan and writeback user rule (2026-09-02, owner ruling; built).**
   Two shapes were weighed for a task typed into the vault: assign it to
   "me" on import (chosen), or require a designation marker in the note
   with undesignated lines left unassigned. In dayGLANCE "unassigned" means
   shared with every member, and a personal vault is a personal capture
   surface, so shared is the wrong default; a marker would also add grammar
   to the parser and the stamper — where the identity hazards have lived —
   for a case the app already covers (a task meant to be shared is
   unassigned in dayGLANCE after import). Rules, in
   `utils/obsidianUserScope.js`:
   - **Which "me": the vault's viewer, never the importing device's user.**
     On the plugin path every dayGLANCE device on the account applies the
     same observation stream, so the importing device's user is wrong half
     the time. The plugin publishes the viewer in the plaintext pairing-meta
     row (`userSyncId`: the pairing's default or the "Show tasks for"
     override, republished on change) and dayGLANCE reads it from the cached
     meta. On direct access the vault is on this device, so the viewer is
     the device's user. No viewer (single-user, Everyone, or a plugin
     predating the field) means the pre-ruling behavior.
   - **First import only.** A task not known to the app (either live list or
     the recycle bin) and carrying no assignment is assigned to the viewer as
     it enters; known tasks are never touched, so assignment stays app-owned
     (the preserve-app-fields carry already guaranteed that for the merge).
   - **The write side mirrors it.** The writeback effect considers only
     tasks visible to the viewer, on both the direct writer and the intent
     emitter, so another member's tasks never land in this person's notes.
     Lines written before the ruling are not removed.

**Owner ruling (2026-09-02): accepted in use.** The owner expected the plugin
to be "a GLANCEvault client like any other, with full access to dayGLANCE";
decision 1 delivers exactly that. The MECHANISM — the sync passphrase entered
once per device in the plugin's settings, the derived key held device-locally
— was proposed while the owner was away and built under an explicit standing
veto. The veto lapsed unexercised: the owner verified the passphrase, used the
view daily, and commissioned three features on top of it (routines, calendar
projections, the viewer). The design is settled.

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

#### Rulings (2026-09-03; owner: "agree with all recommendations")

The open questions above are closed by the rulings below. A and B are in the
hard-stop category (identity derivation; what-wins-on-divergence); nothing in
this section is built ahead of them.

- **A. Link identity.** Two pieces. The DURABLE identity is one frontmatter
  key in the note, `dayglance-id`, holding the project's (or goal's) existing
  UUID. The CACHED locator is `obsidianNotePath` on the project record,
  synced like any project field so every device shows the link. The plugin
  watches Obsidian's rename event and reports old path → new path as an
  observation; dayGLANCE updates the locator. A rename that happens with the
  plugin off is recovered by scanning the metadata cache for the id key. The
  project analogue of the block-id stamp: the id lives in the vault, the path
  is only a hint. *Amendment (2026-10-04):* a link request naming a
  folder-less path (a bare `[[Name]]`, as typed on a device without the
  plugin, whose own reader finds such a note anywhere in the vault) is
  resolved by the plugin as Obsidian resolves a link; the report carries the
  note's real path and the locator follows it, the rename way. A path with a
  folder is explicit and stays missing when nothing is there.
- **B. Frontmatter ownership.** Namespace and reassert. Every maintained key
  lives under ONE map key, `dayglance:` (status, open task count, next
  scheduled date, completion percentage, updated-at). dayGLANCE wins inside
  the block; nothing outside it is ever read or touched, so the user's own
  frontmatter is safe by construction. The block is a rendered view, not an
  input: a hand edit inside it is overwritten on the next update. (Adopting
  `status` from the vault — archiving a project from Obsidian — was
  considered and deferred; it is a second write channel into project state.)
- **C. Who computes the block, and how often.** The PLUGIN, from the mirror it
  already holds: the mirror gains `projects:` and `goals:` rows, and the
  progress math moves into the shared package so both sides agree. The plugin
  renders on its 30-second tick and writes only when the rendered block
  differs from the one in the file, with a wall-clock floor of five minutes
  between writes to the same note. No new row type on the bridge stream, no
  per-change write from the app; the dirty-buffer and cursor gates apply.
  Direct access does not get the block or the routing (§2; §6 ruling F); it
  does get the link and the section editor (the 2026-10-03 amendment below).
- **D. What "create the workspace" produces.** ONE NOTE by default. A project
  born in dayGLANCE can create its note in a configured projects folder
  (default `Projects`), named after the project, from an optional user
  template rendered through the §4.4 ladder (Templater delegation when
  installed and the template has no interactive calls; otherwise the subset
  renderer with unsupported variables left visible). The note gets the id key
  and the block. Workspace LAYOUT is a plugin setting with three values:
  *note only* (default), *folder per project* (a folder plus an index note of
  the same name), or *folders nested under the goal* (see E).
- **E. Goals.** Same machinery, built second: a goal links to a note by the
  same id key and locator; its block carries goal progress and a list of
  wikilinks to its linked projects' notes. *Amendment (owner, 2026-09-03):*
  nested folders are supported, opt-in via the layout setting — a goal born in
  dayGLANCE gets a folder plus index note under the goals folder (default
  `Goals`), and a project with a goal gets its folder INSIDE the goal's folder
  (`Goals/dayGLANCE Development/iOS App/iOS App.md`); standalone projects stay
  under the projects folder. Two rules keep this from becoming folder
  management: placement happens at CREATION TIME ONLY (moving a project to
  another goal in dayGLANCE never moves a folder; a user moving folders by hand
  is a rename the link follows under A), and linking an EXISTING note never
  creates or moves anything.
- **F. Note or folder deleted while the project remains.** Unlink and say so.
  On an observed delete of a linked note the locator is cleared and the
  project card shows "Obsidian note missing" with a relink action. The project
  is never deleted and the note is never recreated on its own. A trash restore
  relinks by the id key on the next scan. A deleted folder is the same case
  through its index note.
- **G. Where the link appears in vault writes.** The completion log ONLY, for
  now: an entry for a linked project writes `[project:: [[Note name]]]`
  instead of the bare name, so the note's backlinks pane becomes the record of
  everything completed toward it. Task lines in daily notes are unchanged —
  writing project metadata onto every task line would retitle every line of
  every linked project, and daily-note retitle churn is the cost Phase 7 spent
  itself driving down.
- **H. Tasks found inside a linked project note.** Assigned to that project on
  FIRST IMPORT: if a linked note is also in the §6 vault task scope, its task
  lines import with the project's id set, so a checklist in the project note
  is that project's task list in dayGLANCE. First import only; a later
  reassignment in the app is not undone by the note. (The composition §6
  promised with this section; cheap because the path-keyed import exists.)

Two defaults set without a ruling: renaming the project in dayGLANCE does not
rename the note, and vice versa (the link is by id; names decouple after
creation); and the project card carries a note badge with an open-in-Obsidian
action, matching the task badge from §6 step 3.

#### Build order

1. **Link.** `obsidianNotePath` on projects (synced); the `dayglance-id` key;
   the plugin's rename and delete observations and the id-key rescan; link,
   relink and unlink in the app; the missing-note state (F); the badge.
2. **The block and the backlinks.** `projects:`/`goals:` rows in the plugin
   mirror; shared progress math; the `dayglance:` block rendered on the tick
   with the five-minute floor (B, C); completion-log wikilinks (G); first-import
   project assignment for scoped lines in a linked note (H).
3. **Workspace creation and goals.** The layout setting (note only / folder per
   project / nested under goal); creation from dayGLANCE through a plugin
   intent, template via the §4.4 ladder (D, E); goal links and blocks.

**Step 1 record (2026-09-03, built).** The record carries `obsidianNotePath`
(synced locator) and `obsidianNoteMissingAt` (ruling F's mark; the path is
KEPT while set so a relink can prefill, and every reader treats the link as
absent). The plugin owns the vault side: it writes and removes the
`dayglance-id` key through Obsidian's frontmatter API under the same
dirty-buffer rule as every other write; watches metadata changes, renames
and deletes; walks the whole vault's frontmatter at layout-ready and every
five minutes (how a rename made while the plugin was off is re-found by
key); and reports LINK observations — one row per target id, upserted, so a
rename replaces the row's path and a deletion replaces it with a deleted
mark — reconciled against a persisted path→id map so a reload re-emits
nothing. Two palette commands (link the current note, picking from the
mirror's active projects and goals; unlink it) and two intents from
dayGLANCE (`project_note_link`, `project_note_unlink`; a link to a note
that does not exist reports it missing). dayGLANCE's project form links by
path (the record updates only once the intent is durably queued), opens,
relinks and unlinks; the project card carries the note badge, or a warning
while the note is missing. Goals ride the same machinery in the record and
the plugin; their form row is step 3. *Judgment calls:* the missing mark
keeps the path rather than clearing it (the ruling's intent — nothing reads
a missing link — holds; the relink prefills); linking from dayGLANCE takes
a typed path rather than a vault picker, since the vault index lives in the
plugin, whose picker is the primary way to link.

**Step 2 record (2026-09-03, built).** The progress math moved into
`@glance-apps/agenda-core` (`progress.js`; the app's utils re-export it), so
the plugin's numbers and the app's are one function. `noteBlock.js` renders
the `dayglance:` map (ruling B: one namespaced key, nothing outside it is
touched): for a project `status, open, done, total, percent, next`; for a
goal `status, projects` (wikilinks to linked project notes, bare titles
otherwise) plus the same counts and percent; `updated` is the time of the
last CHANGE, carried forward when nothing changed, so an unchanged block is
byte-identical. The plugin's `NoteBlockWriter` (ruling C) runs after every
successful drain's mirror refresh and on the 30-second tick, over the linked
map, from the mirror (which now carries the inbox and projects and goals
rows; the block counts every user's tasks, not the viewer's share), writes
through Obsidian's frontmatter API only when the block differs from the
file's, with a five-minute wall-clock floor per note and the dirty-buffer
rule. Completion log (ruling G): a linked project is written as
`[project:: [[Note|Title]]]` (aliased only when the note's basename differs
from the title), the bare title while the note is missing. Ruling H: a task
line that imports FRESH from a scoped note whose path is a present project
link starts with that project; a known task keeps whatever the app gave it.

**Step 3 record (2026-09-03, built).** `projectNotes.js` in the shared
package decides placement (rulings D and E): `note` (default,
`Projects/House.md`), `folder` (`Projects/House/House.md`), `nested`
(`Goals/Home/House/House.md` for a project with a goal — under the goal's
linked note's own folder wherever that is, else the folder the goal would
get; a standalone project falls back to the folder layout); a portable note
name from any title; a bounded ` 2`, ` 3` suffix past a taken path; and the
§4.4 pieces (the `tp.system.` guard, the `{{title}}`/`{{date}}`/`{{goal}}`
subset). The plugin's settings section holds the layout, both folders and
the two template paths (plugin-local, like the scope). A `project_note_create`
intent from dayGLANCE (the "Create a note in Obsidian" checkbox on a NEW
project or goal, and since 2026-10-19 the "Create in Obsidian" button on an
existing unlinked one's note row; the fields ride the intent either way, so
the plugin needs no list) creates the note with dayGLANCE's creation frontmatter and a
title heading, renders the template through the ladder (Templater's
`create_running_config` + `read_and_parse_template` when both feature-detect
and the template is non-interactive, else the subset), then links it —
which is the same key write, map update and link observation as step 1, so
the record learns its locator through the observation stream. Idempotent:
an already-linked target is a no-op. A note already named for the entity is
ADOPTED when it carries no id key, stepped past when it is another's.
Goals: the form row and the goal-card badge land here; the record and
plugin machinery were already shared. *Judgment calls:* adopting an
unowned note that already sits at the computed path (it is named for the
project, in the projects folder; suffixing would leave the obvious note
unlinked); the subset renderer is three variables rather than v1's fuller
set (nothing in the repo implements the fuller set, and Templater covers
the rest when present).

**Templates and the maintained map (2026-09-04, owner rulings; built).**
The design principle: dayGLANCE writes as little into these notes as
possible, and anything Dataview can produce live beats a maintained copy.
Three rulings and a verification:

- **Ruling G, amended: the project rides daily-note task lines as a
  Dataview field**, `[project:: [[Projects/House|House]]]` for a project
  with a linked note and `[project:: House]` otherwise, written by the same
  metadata writer as the schedule. It is written at creation (a task born
  under a project carries it from its first line, and its identity derives
  from the line as written) and on a task's NEXT write for any other reason
  (title, state, date, schedule) or on a reassignment in the app, which is
  its own trigger. Never by a sweep: adoption is piecemeal by ruling, and
  the backfill of existing lines is a separate decision (below). Only a
  block-tagged task carries it: on a legacy id the raw title IS the
  identity and the segment would move it. Never inside the project's own
  note, where the note is the project (ruling H). On the way in, the field
  resolves by note path for a link and by unique title for a bare name; a
  line first seen with it imports under that project, a vault edit of it
  reassigns or (removed) unassigns through the per-field adoption rule, and
  an unresolvable name leaves the assignment alone. The field grammar now
  nests one level of `[[ ]]` inside a Dataview field value, which it did
  not before (a wikilink value was title text). *Considered and deferred:
  routing a project-assigned task to the project note instead of the daily
  note.* It would make the open-tasks query need no link at all, but it
  moves the working surface: the daily note stops showing that part of the
  day, and the task's date becomes line metadata. Recorded here so it is not
  rediscovered; it stays available as a later ruling if the link turns out
  not to be enough.
- **Ruling C, amended: the maintained map shrinks to `kind`, `status` and,
  on a project note, `goal`** (a wikilink to the goal's note when it is
  linked, the goal's title otherwise; absent for a standalone project).
  `open`, `done`, `total`, `percent`, `next`, `updated` and the goal's
  `projects` list are gone. The deciding fact: the map was write-only,
  nothing in dayGLANCE read it, so the counts were never a cache anyone
  depended on but output that cost a synced-file write every time a task
  moved; `updated` was the key that turned any change into a write. The map
  now changes only when a status or a goal assignment changes. `goal` is the
  one new key: it is what lets a goal note query its projects live. The
  first tick after upgrading rewrites each linked note's map once.
- **The default note bodies, chosen once at creation by whether Dataview is
  installed, never maintained.** A project note: the title, a one-line
  prompt, `## Tasks` (the section IS the project's open list, by ruling H;
  no query), `## Done` (the completions query, or one sentence saying what
  would be there with Dataview), `## Notes`, `## Decisions`, `## Log` seeded
  with the creation date. A goal note: the title, a prompt, `## Projects`
  (the table of its projects with status and live open counts computed from
  each project note's own tasks), `## Progress` (completions across its
  projects by month), `## Notes`, `## Log`. Without Dataview a plain
  sentence stands where each query would be, so the note reads as finished
  either way. A configured template note still overrides the default and
  renders through the §4.4 ladder.
- **Dataview, verified at source (0.5.68 lib, master importer) before the
  queries shipped:** inline fields on list items parse with bracket nesting
  (`[project:: [[Projects/House|House]]]` is one field); every link in a
  list item's fields is canonicalized at index time to the resolved file
  path, and `=` on links compares paths ignoring the alias, so
  `item.project = this.file.link` holds for the aliased form; indexing into
  a link value resolves the linked page's fields, so
  `item.project.dayglance.goal` traverses; quoted wikilink strings in
  frontmatter parse as links. Not run in a live vault (none here); the
  harness pins the note bodies, not Dataview's rendering.

*Considered and declined (owner, 2026-09-04): a backfill of existing
lines.* Recorded beside the routing deferral so it is read later as a
deliberate omission, not an obvious missing piece. A backfill would be one
retitle intent per block-tagged, project-assigned daily-note task, once,
idempotent (a line already carrying the right field skipped). Its costs:
every touched daily note rewritten and re-observed; the outbox refusing
past 500 queued intents and flushing 50 per request; the plugin applying a
drain's intents note by note under the dirty-buffer rule; every device
running the writeback, so two devices could emit the same retitle
(idempotent on apply, doubled traffic); and, given this project's history,
a burst of retitle intents across the vault is exactly the shape that has
started wars, so it would have needed pacing (about 25 per sync cycle, one
device, one-shot) to be safe at all. Legacy-id tasks would have been
excluded regardless: on those the raw title is the identity. Declined
because new lines and any line touched for another reason pick the field
up on their own, and the old lines it would reach are the ones least
likely to matter in a Done query.

#### Editor hiding (2026-09-05; display only)

Two cosmetic rules, one plugin extension, no writes and nothing touching
identity. Both add CSS classes and let a stylesheet hide; both exempt the
cursor line through Obsidian's `.cm-active`, because seeing the token or
the line when the cursor is on it has been the diagnostic window every
time something went wrong.

- **dayGLANCE's own block ids** (`^dg-` plus eight base-36 characters, in
  block-id position: whitespace before, end of line) are hidden in Live
  Preview. Default on: it can only ever hide our tokens. A token anywhere
  else on a line is a damaged line (the stamper refuses those) and stays
  visible, deliberately. Reading view already strips block ids.
  *Considered and rejected:* the vault-wide CSS snippet behind a toggle. It
  hides every block id including the user's own, and CSS cannot match on
  text; a CodeMirror mark decoration is the same effort and scoped by
  construction.
- **Checked task lines in linked notes** (the transport's linked map, not
  the id key alone: a stale key can outlive its project) are hidden in
  Live Preview and, through a post-processor on the source path, in
  Reading view. Daily notes untouched. Default off: without Dataview a
  linked note has no Done list, so a hidden line would be visible only in
  dayGLANCE. *Considered and rejected:* scoping to the `## Tasks` section.
  A Templater override need not carry that heading, and the rule would
  need a scan from the top of the note on every change; any checked line
  in a linked note behaves the same.

The costs, accepted: a hidden line cannot be clicked to un-check (arrow
onto it, un-complete in dayGLANCE, or flip the toggle); its indented
children stay visible; find-in-note can match invisible text. The settings
ride data.json, so Obsidian's settings sync carries a flip to every copy of
the vault (§3.2's recorded dependency, harmless here). The line rules are
pure and pinned (`editorHidingRules.test.ts`); rendering stays a manual
check.

#### Project routing (owner, 2026-09-05): a project's tasks live in its note

*The deferral above is closed.* The owner's requirement, verbatim in
substance: it is critical that the task list in a linked Obsidian project
note matches the project card in dayGLANCE. Until this round it did not:
dayGLANCE wrote a task into the vault only when its import source was
Obsidian (a scanned line, or a task created with the `#obsidian` tag), so
a project task born in dayGLANCE reached the vault only as a completion-log
entry. The rule now:

- **A task assigned to a project with a linked note lives in that note.**
  Born in dayGLANCE, its line is created there (at the end of the `## Tasks`
  section, or under a new heading at the end of the note; never sorted, the
  note is the user's document; never created if the note is missing). Typed
  in the note, it imports assigned (ruling H, unchanged). Reassigned
  between linked projects, the line moves. Unassigned, or reassigned to a
  project without a note, **the line is removed** and the task stays in
  dayGLANCE, app-only: a task is in the vault because something puts it
  there, and membership in a linked project is the second such reason
  after the tag; remove the reason and the line goes, exactly as if the
  task had been created as a plain inbox or scheduled task. A line the user
  typed in the note and later unassigns in dayGLANCE is removed too; the
  list matches the card. A scheduled project task keeps its date as line
  metadata (ruling B) and no longer occupies the daily note; the daily
  note shows its completion-log entry. Open tasks only: a completed task's
  record is the completion log and the Done query.
- **Identity.** A vault task's app id is `obsidian-dg-` plus its token, and
  the scanner matches lines by that id, so a dayGLANCE-born task's id
  switches to the derived form when its line is written: the stamping
  identity move (gate (a), commit on enqueue, the retirement record, the
  re-mint refusal), applied to a native task. The token is derived in the
  note's namespace (ruling A) from the line as written. **A token is for
  life**: unassignment clears the vault fields but keeps the token and the
  id, so a later reassignment writes the same token and no second move
  happens.
- **The link is the scope.** A linked note is observed and stamped whether
  or not its folder is in the §6 scope: the plugin adopts a note when it
  becomes linked and withdraws it (ruling C) when the link goes and no
  folder or tag holds it. Without a scope setting the completion window
  is the default. This closes the setup trap of a linked note whose folder
  was never scoped, found in the field on 2026-09-05.
- **Where it runs.** A placement step at the head of the writeback pass
  reconciles each task's home (its `obsidianNotePath`) against what its
  assignment implies, so every assignment site in the app (task editor,
  project card, planner, archive cascade) is covered without knowing the
  step exists. The old line's removal is emitted before the new line's
  append (`task_remove`, a new intent; `task_append` with `noteTask`);
  the two notes' observations may arrive in either order, the cross-note
  case the wall-clock confirmation hold exists for. Removal clears the
  task's vault fields in the same action, so the note's next observation
  finds no task claiming the missing line and tombstones nothing. Paced at
  25 placements per pass: a fresh link fills its note over a few passes
  (the declined-backfill cost, bounded to one note). Plugin-authoritative
  only: the direct tier reads and writes by date, so it follows in its own
  PR once the plugin round is field-tested (desktop has path read and
  write already; each mobile bridge needs two methods).
- **Creation.** A task created under a linked project, tagged or not, is
  created as a plain task and placed by the next pass; the tagged
  daily-note path is used only when the project has no note.

*Considered and rejected:* returning an unassigned task to the daily note
of its date. Every imported task carries the display tag, so a tag-based
carve-out could not distinguish a daily-born task from a note-born one,
and the owner's rule is the simpler one: no reason, no line. The one
consequence accepted with it: a task typed in a daily note, assigned to a
linked project and later unassigned, leaves the vault. Pinned by
`projectNotes.scenarios.test.ts` 5 through 8 (creation, the daily-note
move and the app-only unassignment across both notes' observations, the
link as scope with a move between two linked notes, the pacing).

#### Task notes in a linked project (owner, 2026-09-14): the notes become a vault note

The notes button on a task card follows one rule (fixed the same day,
#1658): the open book means the note is in the vault, reached through a
`[[wikilink]]` in the title; notes typed in dayGLANCE get the regular icon
whatever the task's origin. Under project routing that left a gap the
owner named: a task in a linked project lives in the note, but its notes,
typed in dayGLANCE, stayed in the app record with no vault counterpart.
The owner could already put a note in the vault by hand, by typing a new
title in a wikilink and editing the note, which creates the file under the
default new-notes folder. The ruling makes that automatic for one case and
one case only: notes added to a task in a linked project.

- **What happens.** The first time a placed project task (its line in the
  linked note, under a token) has notes in the app and no wikilink in its
  title, the writeback creates a note in the project note's folder, named
  after the task, holding the notes; inserts the wikilink into the title
  before the display tag; and clears the app notes. From then on the task
  is a wikilinked task like any hand-linked one: the card shows the open
  book, the panel edits the vault note, the line carries the link.
- **The name.** Derived from the title once, at creation, through the same
  portability rules project notes use (`noteNameFromTitle`), wikilinks and
  hashtags dropped, capped at 80 characters, and never following a later
  retitle: the link is the identity, and a rename in Obsidian updates the
  link like any other. Folder-qualified (`[[Projects/Fix the gutter]]`) so
  the link resolves by path, bare only when the project note sits at the
  vault root.
- **Collisions.** The app suffixes against every name it knows: the
  targets and basenames of every task's wikilinks (Obsidian resolves a
  bare link by basename anywhere), the projects' and goals' own notes, and
  the project note itself. For a note the app cannot know about, the
  applier's `create_or_append` mode appends the notes to the existing note
  and never replaces it; the append is idempotent, so a second device's
  copy of the same migration, or a retried enqueue, changes nothing.
- **Migrate later.** The step runs only where a pass can write to the
  vault: plugin-authoritative, like placement. Notes typed on a phone
  without the plugin, or offline, stay in the app with the regular icon
  and migrate on the next pass that can write, on any device. A task that
  is not yet home (not placed, or still moving between notes) waits too.
  Open tasks only.
- **Where it runs.** Inside the writeback's retitle loop: the migration is
  a retitle (the link joins the title) plus one `wiki_note_write`, emitted
  ahead of the line write in stream order, committed on enqueue like every
  write on that path (title, notes, snapshot). The notes panel adopts the
  clearing when it holds no unsaved edit, so a panel left open across the
  migration switches to the vault note instead of re-saving the old text;
  with an edit in flight the local text still wins and simply stays in the
  app, since a task that already carries a wikilink never migrates again.

*Considered and rejected:* letting the plugin choose the name and edit the
line itself, with the app adopting the link from the observation. That
puts a retitle into the observation path, which §3.6 forbids, and leaves
the app clearing notes it cannot yet match to a note. Also rejected: the
default new-notes folder for these notes; the owner wants them beside the
project's index note. Pinned by `projectNotes.scenarios.test.ts` 12
(creation in the folder, the link on the line, the emptied record, the
round trip, the same-title suffix, the quiet second pass), the
`taskNoteName` unit tests and the applier's append tests.

#### The notes box of a project or goal is its note's description (owner, 2026-10-03)

**Ruling.** A project's or goal's notes box in dayGLANCE and the paragraph under its linked note's title (the text between the H1 and the first heading below it, where the default templates put "One line on what done looks like." and "Why this matters, and what finished looks like.") are one thing. The field report behind it: a user kept project hub notes in Obsidian and a structured summary in each project's notes box, and the two had no connection.

**Shape, as built.** An editor over the file, exactly as the task panel edits a wikilinked note; not a sync, and nothing is merged.

- **At creation**, `project_note_create` carries the notes box as `description`; the plugin puts it in the description slot of the default note, and a user template may place it with `{{description}}` beside `{{title}}`, `{{date}}` and `{{goal}}`. The record empties on enqueue, the body journaled (the sent-notes journal, keyed `project:<id>` or `goal:<id>`).
- **On link**, and on the first authoritative pass for an entity linked before this ruling, the notes box is merged into the section by a `project_note_description` intent in `merge` mode: a blank or placeholder section is replaced; text the user already has stays, the dayGLANCE text goes below it; a body already present as whole blocks changes nothing. The record empties on enqueue, journaled.
- **From then on the box is the section.** Opening the project planner, or the goal form, loads the section from the vault through the same reader the task panel uses; the user edits it in place; saving writes it back by `project_note_description` in `replace` mode. The rest of the note is never touched by this write. Beside the box: the note's name and Open in Obsidian. A device that cannot read the vault shows "Notes live in the linked note in Obsidian" and leaves the record alone, unless the plugin has reported the note (below).
- **Refuse on change** (ruled with the shape, and extended to task notes). The save carries `base`, the hash of the section (for task notes, of the whole note) as loaded. dayGLANCE reads the note again before sending and, when the text moved, writes nothing: the newer text is loaded into the editor with the unsaved text below it, and the panel says so. The applier checks the same hash at apply time; a section that moved since is kept and the dayGLANCE text appended beneath it as a dated `[!note]` callout, never overwritten and never dropped; a whole task note that moved is left as it is, said in the console. The unmount flush writes without a base, as the task panel always has.
- **Direct access** gets the same editor over the file where a link exists (the write replaces the section in a whole-note write). Links on direct access are made by the user, per the next section.
- **Without the folder, from the plugin's report** (owner, #2291). The plugin already reports every linked note as an observation row with its content and file mtime; a paired device reads the one row for the note's path on demand (`fetchReportedNoteDescription`, behind the same key gate as the stream) and the shared reader (`noteObservations.js`) extracts and hashes the section exactly as a file read does. Nothing is stored: no copy of the text, nothing on the record. The rules: with no folder, or a read that fails or finds nothing, the box shows the reported section and says when Obsidian reported it; with both, the newer wins, the report's file mtime against the local file's (a copy behind the report, the holding posture, shows the report; a tie, or a time missing on either side, keeps the file); a report that the note was deleted or withdrawn is not found, over a copy that still has it; a path never reported is no information, so the box keeps "Notes live in the linked note in Obsidian". The save re-reads by the same rule before sending, so a text edited from the report is checked against the report, and goes out as the `replace` intent under the base of the shown text, also on a device with no folder whose posture was never recorded; the applier's check stands behind it. An unpaired device without the folder is unchanged. The MCP's goal tree reads through the same loader (`description_reported_at` marks a reported section). Rule: `src/utils/linkedNoteDescription.js`.
- **A task's linked note without the folder** (#2291 follow-up). The task panel shows the whole note a task's `[[wikilink]]` names, so it reads the plugin's report of the note (`fetchReportedNote`, the same gates, limiter and budget) when it cannot read the folder. A link names a note by NAME and reports are keyed by a hash of the PATH, so the stream cannot be asked which notes exist; the device keeps an **index of reported note paths** instead (`src/utils/reportedNotePaths.js`, stored by `src/utils/reportedNoteIndexStore.js`): the paths only, never content, with each row's seq and whether it is a note, deleted or withdrawn. It is device-local (IndexedDB, localStorage where there is none), not synced, not in the payload or a task, and keyed to the pairing (server, account, generation, salt), so a re-pair rebuilds it. It keeps a cursor of its own: the cycle hands it the paths its pull already decrypted (applied only where they continue the index; the cycle's cursor and commit are untouched), and its own lister (`listReportedNotePaths`) reads from the index's seq, or once from zero while it has never been completed, when the panel resolves a name (a device without the folder runs no cycle) and, holding, from the cycle. It is complete only after a listing from zero read every page; an unreadable or foreign stored value is incomplete, never empty. Against a complete index a link resolves as Obsidian resolves it, case-insensitive and NFC-folded: a link with a folder is that path when reported, else the reported notes whose path ends with it on a segment boundary (`[[Alpha/Plan]]` finds `Work/Alpha/Plan.md`); a bare name is matched by basename among every reported note, so a note shared by a scope tag in any folder, a daily note and a linked note are all found. One note found is shown; two or more are **ambiguous** and none is shown, which is exact among shared notes; a deleted or withdrawn path does not count, and with no note found it says deleted or not shared. When the index could not be brought up within its budget, the link's own path is also read directly. Until the index is complete the name is guessed as before: a link with a folder is that path alone; a bare name is matched among the paths synced state says exist (imported tasks' notes, migration targets, linked project and goal notes) and at most eight likely homes asked for directly (the vault root, the new-notes folder, the daily-notes folder, the scope folders the pairing meta publishes), where a request that failed leaves it unknown. A note the plugin does not report cannot be seen; a save goes out under the PATH that was shown, so it writes the note the user saw. A scoped note moved within the scope has its old path reported gone (`deleted`, `moved`, deliberately not `scoped`, so the note-scoped deletion inference never sees it and the merge leaves it unapplied), so the index does not see it twice. With a folder, the report weighed is the one for the path the folder read (a native vault does not say where it found a bare name, so its file stands), by the newest-wins rule above; in the `plugin` posture the folder answers alone, found or not. A deletion report is deleted, over a copy too; a withdrawal (the note left the scope) is not shared, never "not found", since the note still exists. The save re-reads by the same rule and sends `wiki_note_write` under the reported path and the shown text's base; the applier refuses there if the note moved. Where nothing can be shown the panel says why: the integration is not set up here; this device cannot read the folder and the plugin does not share the note (and, when the new-notes folder is outside the scope, that notes dayGLANCE creates land there); ambiguous; deleted; or the report could not be fetched. A folder that is there keeps "Note not found in vault" and its create-on-type editor. No note text is stored.

Pure halves in `noteDescription.js` (split, extract, replace, merge, the conflict callout, the hash); pinned by its unit tests, the applier tests in `bridgeStream.test.js`, the hook tests in `useObsidianSync.noteDescription.test.js`, and `projectNotes.scenarios.test.ts` 22 to 24 (26 to 28 for the report, 29 for a task's note).

#### An existing project or goal can have its note created from the note row (owner, 2026-10-19)

**The gap.** Creation lived only on the new-entity form. A project made before the vault was connected, or before the plugin was paired, had to have its note made by hand in Obsidian and then linked, although the plugin already knew how to create one in the chosen layout.

**Ruling.** The note row of an existing, unlinked project or goal carries a **Create in Obsidian** button that emits the same `project_note_create` intent the checkbox does, with the title, the project's goal and the description read from the record (`noteCreateFields`). Everything downstream is unchanged: the plugin creates by title under its layout and template, links by the target id, and the record learns its locator through the link observation. The description moves into the note's description slot and leaves the record on enqueue, as it does at creation. Plugin only, like the checkbox: without a stream posture the button is disabled and says why. A missing-link entity keeps Relink and Unlink and gets no Create, since a fresh note beside a dangling locator is a second decision.

#### A wikilink in the title is the link, and the record may hold a link alone (owner, 2026-10-03)

**Ruling.** Typing a note's `[[wikilink]]` into a project's or goal's title tells dayGLANCE that is its note. The link leaves the title (a title that was nothing but the link keeps the note's name) and the entity is linked to the note the link names, exactly as the note row would link it. Linking an existing note never creates one: when a new entity has both the title link and "Create a note in Obsidian", the link wins. The idea came from the direct-access case (a user whose vault is a folder, with no plugin, has notes for their projects and no way to say so); it is the §2 clause in action, a Phase 8 feature extended to direct access because the cost was one rule and one field.

**The field.** Without a stream to carry the id key, `linkProjectNote` sets the locator on the record alone and marks it `obsidianNoteLinkPending` (an ISO time). Every reader treats the entity as linked: the section editor over the note (through the device's own reader and writer), the open-book badge, Open in Obsidian, the project field on completion-log entries, the planner's notes box. What a pending link does not have is the key, so a rename in Obsidian breaks it until the plugin comes; the note row says so. The notes box moves into the section on link here too, through a direct whole-note write where the device can read and write the note, and otherwise waits on the record for the first pass that can.

**Promotion.** On the first authoritative pass with a stream, the writeback asks the plugin for the key (`project_note_link`) for every pending entity and clears the mark on enqueue. From there the plugin's own report settles it: the key lands and the link observation confirms the path; a note that is not there comes back as missing (ruling F), path kept for a relink. `planNoteLinkUpdates` clears the mark on any report about the entity, so a key the plugin finds on its own (the same note linked from another device) ends the pending state too. Unlinking a pending link sends no unlink: the vault never carried the key. The mark is a project field like the locator, synced whole with the record.

**Where a missing note shows.** The planner's notes box and the goal form distinguish a note the reader could not find ("The linked note was not found in the vault") from a vault the device cannot read ("Notes live in the linked note in Obsidian"), since a typed link's main failure is a typo.

Pinned by `obsidianProjectNotes.test.js` (the title rule, the pending mark and its clearing), `useObsidianSync.noteDescription.test.js` and `useObsidianSync.projectNotes.test.js` (the stream-less link, the direct merge, the unlink), and `projectNotes.scenarios.test.ts` 25 (the promotion, the missing case, the second pass writing nothing).

#### Linked-task notes and the record's note target (owner, 2026-09-17, option B)

The 2026-09-14 migration converted notes only for a task with no link in
its title; notes arriving on a task that already carried its link stayed
in the local field, which the panel hid (fixed the same day: the panel
shows local notes beneath the linked note, and the card shows the
document icon while any exist). The rule now, from the report in
PR #1690 (https://github.com/krelltunez/dayGLANCE/pull/1690, closed
unmerged; the report lives on that PR's branch):

- **The record names its note.** A migration writes the target it created
  onto the record as `obsidianNoteTarget`. Later notes on that task, from
  any writer, are appended to that note (`wiki_note_write`,
  `create_or_append`) and the field clears again, committed on enqueue
  like the migration itself. The discriminator is the stored target or,
  for a task migrated before the field, a link in the project note's
  folder whose basename is the name the current title derives (collision
  suffix allowed); a task renamed since and carrying no stored target
  reads as hand-linked.
- **Hand-linked and shared notes are never appended to.** Their local
  notes stay local and visible. Option A (append under a task heading)
  was considered and declined: it writes dayGLANCE bookkeeping into
  documents the user wrote for other purposes.
- **A fresh migration is unchanged**, including the append into a
  derived-name file that already exists (option D). Creating a suffixed
  note instead needs the plugin to choose the name and report it back,
  since the app commits the link on enqueue and has no cheap existence
  oracle; that design (a `task_note_create` intent with a link-style
  report) is parked.
- **The re-assert.** The migration's retitle rides the applier's
  write-time title guard: a line whose body moved off the app's base (an
  Obsidian edit before the fresh line was observed, the create-with-notes
  bug) keeps its own title while the note lands and the field clears, and
  the next observation reverts the app's title. With the record naming
  its note, the writeback puts the link back once per observation, on
  the line's own base, until an observation shows the line carrying it
  (`obsidianNoteLinkSeen`). After that, a NEWER observation without the
  link is the user's unlink and clears the target; a report no newer than
  the one that showed the link (`obsidianNoteLinkSeenAt`, the note mtime)
  is a lagging plugin copy and clears nothing. Removing the link from the
  title in dayGLANCE clears the target too.
- **Idempotency on block boundaries.** `create_or_append` skips a body
  whose paragraphs are already present as a consecutive run, and logs the
  skip; a short body that merely occurs inside a longer line is appended.
  Accepted edge: a retry arriving after the user edited the appended
  block in Obsidian re-appends it.
- **The sent-notes journal** (`day-planner-obsidian-notes-sent`) keeps the
  last body each migration sent, per task, for 30 days. Device-local like
  the outbox: it does not survive a storage purge; it covers consumed
  rows, server-side loss and debugging.

Pinned by `projectNotes.scenarios.test.ts` 14 to 20 (the append, the
hand-linked task, the existing derived-name file, the re-assert, the
unlink in Obsidian and in dayGLANCE, create with notes in one call), the
`taskNoteName`, `mergeObsidianTasks` and journal unit tests, and the
applier's block-guard tests.

#### The re-append (owner, 2026-09-16): a record that wins existence gets its line back

Ruling 6 (§3.10) decides existence between a note and a record by the
newer side: a line confirmed removed from a note tombstones its task at
the note's mtime, and a record edited after that mtime keeps the task.
For a daily-note task the next scan settles the rest. For a task in a
linked project note nothing did: placement writes only a task whose home
is elsewhere, and the write path treats a missing line as reconciled by
the next observation. The 2026-09-13 wipe (buildout 2.8) left six open
tasks in that state for three days.

- **The rule.** A task that survives the existence rule because its
  record is newer than the note has its line re-appended on the next
  pass, under its own token, at the end of the Tasks section like any
  placement. The record won existence; the vault reflects it. A record
  older than the wipe follows the vault and is dropped, exactly as
  before: this completes ruling 6, it does not change what wins.
- **Once per wipe.** The tombstone stamp is the note mtime at which the
  line was confirmed absent. A device remembers the stamps it has acted
  on (`day-planner-obsidian-line-reappends`, pruned to stamps the
  tombstone map still carries), so the append is emitted once; a later
  wipe stamps a newer tombstone and fires again. The applier's append is
  idempotent regardless, so the memory saves intents, not correctness.
- **Scope.** Open tasks only, plugin-authoritative only, like placement.
  A completed task's record is the completion log.
- **The accepted edge.** A line deleted in Obsidian on purpose, then the
  task edited in the app before the hold commits, comes back: the record
  is newer, so the edit wins over the delete. That is ruling 6 applied
  consistently, and the same answer the daily-note path already gives.

Pinned by `projectNotes.scenarios.test.ts` 13: two lines wiped, one task
edited after the wipe returns to the note and settles under its id with
its app fields; the untouched one is dropped; a second pass writes
nothing.

---

### 4.4 Templater, via guarded delegation

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


#### Build record (2026-09-06): daily notes on the ladder

Project and goal notes shipped with the ladder; daily notes had a separate,
older mechanism — a plain-text template typed into a textarea in dayGLANCE
settings, written verbatim at creation, no Templater, no substitution, not
even the date — and six creation points across three code paths, one of
which (the native direct-tier append) applied no template at all. This
record closes that.

**What was built.**

1. **A daily-note template path in the plugin's settings**, beside the
   project and goal ones (`dailyTemplate`, `normalizeProjectNoteSettings`).
   The plugin renders it through the existing ladder at its creation point
   for the two daily-note-creating intents, `task_append` (daily notes only;
   a note task never creates) and `completion_log_append`. The pre-scan
   covers it for free. Subset variables: `{{date}}`, and `{{title}}` as the
   note's name. *Ruling: plugin settings, not a synced app setting.* Only the
   plugin can render, so a synced setting pointing at a vault path would be
   one some devices could act on and others could not — the split-brain
   shape the posture ruling exists to eliminate.
2. **The app's text template stays as the fallback body** when no path is
   configured, now with the subset filled on both tiers
   (`dailyNoteCreationBody`, one function under every creation point: the
   FSA and native appends, the two intents, the completion log's direct
   path, and the editor's seed). Nothing changes for anyone who never sets a
   path except that `{{date}}` now works.
3. **The native direct-tier gap is closed.** `""` is absent-or-empty under
   the native read contract; it now reads as absent, and the note is created
   from the template as the FSA append does. *Ruling, the accepted cost:* a
   genuinely empty existing note gets the template prepended — small and
   recoverable, the user deletes it. The alternative was every native
   direct-tier daily note bare forever, which is not recoverable because
   nobody knows it happened. Recorded at the site
   (`appendTaskToDailyNoteNative`; the completion log's native branch).
4. **Templater's on-create trigger is detected**, for daily, project and
   goal notes alike, since it is one mechanism and one exposure. THE SECOND
   DOOR: the pre-scan guards the render *we* perform, but with "trigger
   Templater on new file creation" on, Templater renders every new file
   itself whether we delegated or not, and an interactive call in it hangs
   invisibly outside our guard — the sharp edge arriving through a door the
   guard did not cover. The rule: a non-interactive template is delegated as
   before, trigger or no trigger (Templater's second pass over rendered
   output has nothing left to render); an interactive template under the
   trigger is refused outright — the subset would leave the interactive call
   visible for the trigger to run — and the fallback body stands, itself
   pre-scanned under the trigger (an interactive app text template drops to
   the bare note). Both homes of the setting are read: the device-local
   `templater-local-settings` (2.21+) and the synced plugin settings of
   older builds. Refusals, a missing template note, and a failed render
   surface in the plugin's settings tab as a template line, the way the
   stamping tri-state does.

**Two things worth writing down.**

- **The rendering context is whichever Obsidian applies the intent.** If a
  desktop's plugin drains a phone's intent, the daily note is created by the
  desktop's Obsidian, and Templater's context — `tp.file`, `tp.date`, the
  machine's clock and locale, anything reading that machine — is that
  desktop. Fine for date variables, arbitrary for anything
  machine-specific. A user with a machine-dependent daily template should
  expect the note to reflect whichever Obsidian was open, not the device
  that made the edit.
- **The posture ruling fixed the unattended case as a side effect.** The
  worry was a daily note created by dayGLANCE with no plugin present,
  untemplated, at any hour. Since the posture ruling (build-out spec §3.2,
  2026-09-06) a paired device with Obsidian closed queues an intent rather
  than creating anything, so the note is created by a running Obsidian at
  apply time. Render at apply time, in the plugin, never in the app — the
  shape the ladder wanted, and it arrived by way of a different ruling.
  What remains untemplated by the ladder is confined to the direct tier
  (unpaired vaults), where the text fallback applies on both shells now.

**Creation points after the build**, for the record:

| Creation point | Tier | Body |
|---|---|---|
| Plugin `task_append`, `completion_log_append` | stream | template note through the ladder; else the text fallback, subset filled |
| Task append, FSA desktop | direct | the text fallback, subset filled |
| Task append and completion log, Android and iOS | direct | the text fallback, subset filled (was: nothing) |
| Daily note editor in the app | both | the text fallback seeded into the editor, subset filled, for the user to edit |

Harness scenarios 9, 9b, 10 and 11 in `projectNotes.scenarios.test.ts` pin
the ladder at the creation point, the fallback, the interactive refusal
under the trigger, and delegation against a fake Templater.

---

### 4.5 Dataview conventions, verified rather than assumed

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

## 6. Vault task scope: two-way, plugin-only

**Ruled (2026-09-02).** The read-only tier this section originally proposed
is dropped: "I don't have any interest in dayGLANCE showing tasks that can't
be manipulated in any way." Two-way scope — tasks in any in-scope note,
completable, renamable and schedulable from dayGLANCE, with the vault kept in
step — is a Phase 8 feature, built plugin-only (§2: direct access is frozen
at feature-complete, which here means daily notes). The original §6 text
(the reuse argument, the identity concerns, the read-only tier) is
superseded by this section; the concerns it raised are answered below one by
one rather than deferred.

### 6.1 What the date was doing

The earlier analysis listed every layer keyed on the note's date as if each
needed a redesign. It does not. In a daily note the note's name is the
task's date, so ONE field did three jobs:

1. the **minting namespace** — what keeps "Call the plumber" in two notes
   from hashing to the same block id;
2. the **note locator** — the file the writeback opens to find the line;
3. the **schedule** — the day the task sits on in dayGLANCE.

A project note breaks only the coincidence. Each job gets its own field, and
the machinery on top is plumbing.

**The part the earlier analysis got wrong.** The `^dg-` stamp is written
into the file. The date matters only at the moment a line is FIRST stamped;
after that, identity travels with the line. Using the path as the namespace
for non-daily notes changes no existing daily-note id (the frozen algorithm
keeps the date as its first argument for daily notes), and a renamed or
moved note keeps its stamped ids intact.

### 6.2 The design

1. **Identity: the minting namespace is the note key.** `deriveBlockId(noteKey,
   rawTitle)`, same frozen algorithm, at the same three minting sites (the
   app's stamp-on-sight, the plugin's stamper, the writeback's re-mint). The
   note key is the note's date for a daily note (unchanged) and its
   vault-relative path (NFC, forward slashes, `.md` included) for any other
   note. The tombstoned-remint refusal keys on the same value. **Hard-stop
   ruling A**, requested below.
2. **Locator: a task carries its note's path.** New task field
   `obsidianNotePath`. Daily-note tasks keep `obsidianFileDate`; when both
   are present the path wins. The direct writer gains a path-addressed sibling
   of `writeTaskStateToFile`; the plugin needs NO new intent types — the
   `task_state`, `task_retitle` and `task_append` intents already carry the
   target `path` (audit fix H1 made the file resolution explicit), with
   `date` used only for section sorting and the line's date prefix.
3. **Schedule: from line metadata, never from the note.** A non-daily task's
   date comes only from `⏳ YYYY-MM-DD` / `[scheduled:: …]` (and its deadline
   from `📅` / `[due:: …]`), which Phase 4's metadata parser already reads. No
   scheduled date means the task is an inbox item. Scheduling it in dayGLANCE
   WRITES the scheduled field onto the line, plus the existing leading time
   prefix for a timed slot, in the vault's detected metadata format (the
   completion-marker rule already picks Tasks emoji versus Dataview brackets).
   The line never moves between notes. **Ruling B.**
4. **Discovery and scope: plugin-only, opt-in, folders and tags.** The user
   picks folders and/or tags to include; a note is in scope when it sits
   under an included folder OR carries an included tag (frontmatter or
   inline). Both are offered on equal footing — "they are two separate ways
   to organize a vault and neither is right or wrong" (owner, 2026-09-02).
   Daily notes stay in scope regardless. Configured in the plugin's settings,
   published to dayGLANCE in the `meta:config` row so both sides classify a
   path identically. Candidates come from `metadataCache` (Obsidian has
   already parsed every checkbox; no file reads); in-scope notes then flow
   through the SAME path-keyed observation stream as daily notes.
5. **Adoption without the burst.** Ruling 7 (visible implies stamped) holds
   per note: a note is reported only after its stamping settled. Stamping is
   confined to OPEN task lines plus lines completed within the window
   (below), and throttled to a few notes per drain, so bringing a large
   folder into scope spreads its edits over minutes instead of one Obsidian
   Sync burst. Ten daily notes produced five wars; this is the same surface
   and gets the same discipline: the settle rule, the cursor gate and the
   buffer-safe write path all apply unchanged.
6. **Bounds without a date window.** Non-daily notes have no ninety-day
   window. The bound is instead: open tasks, plus tasks completed within the
   completion window (proposal: 14 days). Older completed lines are neither
   stamped nor imported. **Ruling E** on the window.
7. **Leaving scope.** When a note leaves scope (folder or tag removed from
   the setting, tag removed from the note) its tasks are WITHDRAWN from
   dayGLANCE — not deleted anywhere, and the stamps stay in the file. A note
   re-entering scope re-imports under the same stamped ids, so nothing is
   minted twice. This is a new tombstone class ("out of scope"), distinct
   from a deletion. **Ruling C.**
8. **Moves and deletions.** The plugin sees renames: a moved note updates
   `obsidianNotePath` on every task carrying the old path, by id, with no
   tombstones. A deleted note, or a line removed from a note, flows through
   note-scoped deletion inference exactly as a daily note does (path-keyed
   already; the wall-clock hold applies). The direct-access path does not
   participate (§2), so the "moved note looks like a deletion" hazard of a
   file scan never arises.
9. **Multi-user.** Decision 10 applies as written: first import assigns to
   the vault's viewer; writes are scoped to the viewer.
10. **In dayGLANCE.** A non-daily task appears wherever its schedule puts it —
    the timeline when scheduled, the inbox otherwise — carrying a note badge
    (the note's name, opening the note via the existing open-in-Obsidian
    route). The sidebar needs nothing: the tasks are ordinary rows in the
    mirror.
11. **DB tier.** Task rows carry the new field; nothing else changes. Note
    bodies of non-daily notes are NOT mirrored (the daily-note editor stays a
    daily-note feature).

### 6.3 Rulings (hard-stop category; owner, 2026-09-02: "yes to all")

| | Ruling | Decided |
|---|---|---|
| A | Minting namespace for non-daily notes | The note's vault-relative path; daily notes keep the date. |
| B | How a schedule is written to a non-daily line | Scheduled-date metadata in the vault's detected format, plus the leading time prefix for a slot; the line never moves. |
| C | A note leaving scope | Tasks withdrawn from dayGLANCE ("out of scope" tombstone class), stamps untouched; re-entry re-imports under the same ids. |
| D | Where the scope lives | Plugin settings (folders + tags, union), published in `meta:config`. |
| E | Completion window for non-daily notes | **30 days, user-configurable in the plugin's scope settings, bounded to 7–90** (a year-long window would re-create the adoption burst the throttle exists to prevent); published beside the scope in `meta:config`. A completed line with no completion date counts as older than the window. |
| F | Direct access | Stays daily-notes-only (§2); non-daily scope is plugin-only. |

### 6.4 Build order

1. **Identity and locator.** `noteKey` threaded to the three minting sites;
   `obsidianNotePath`; the path-addressed direct write; pins: same title in
   two notes mints two ids, a renamed note keeps its ids, a daily-note id is
   byte-identical before and after.
2. **Plugin discovery.** Scope settings (folders, tags), published in the
   config row; `inScope` and the stamping gate extended from "is a daily
   note" to "is a daily note or in scope"; throttled adoption.
3. **App import, with the scheduling write.** The observation classifier
   admits in-scope non-daily notes; parse under the path key; schedule from
   metadata, inbox otherwise; the note badge; moves; the out-of-scope
   withdrawal; AND the metadata write for a reschedule (ruling B) — folded
   in here so no non-daily task ever exists in the app without its full
   write path.
4. **Field test** on a real project folder before widening defaults.

**Step 1 record (2026-09-02, built).** `deriveBlockId` takes a note key
(`noteKeyForPath` normalizes a path: NFC, forward slashes, no leading
slash); `noteTaskId` is the provisional id of an untagged non-daily line.
`parseTasksFromMarkdown` gains `{ notePath }`: the note's own date is never
a task date, lines carry `obsidianNotePath` instead of `obsidianFileDate`,
dateless lines are inbox. The writeback resolves its target through
`writebackTargetFor` — path and date-as-schedule for a note task, with no
section sort and the path as the minting key; unchanged for daily notes —
and admits note tasks only while the plugin is authoritative (ruling F).
Pinned: same title in two notes mints two ids; the stamp planner mints
under whatever key it is given; a daily-note derivation is byte-identical
before and after.

**Step 2 record (2026-09-02, built).** The shared package gains the scope
classifier (`normalizeScope`, `noteInScope`, `scopeIsActive`,
`completedSinceFor`; window clamped to 7–90, default 30) and the stamper
and parser take `completedSince` for non-daily notes. Plugin: a "Vault task
scope" settings section (folders, tags, window) stored in data.json and
published in the pairing-meta row as `scope` (ruling D, amended: the
plugin's own row rather than the app-authored config row, since the plugin
is the author); `inScope` admits scoped notes (tags from `metadataCache`);
the stamp key is the note date or `noteKeyForPath(path)` (ruling A) with
the window applied to scoped notes only; observations of scoped notes carry
`scoped: true`, deletions of reported scoped paths report; adoption walks
the metadata cache once per scope change and reports three notes per 30s
tick, the adopted set persisted beside the cursor so a reload does not
re-emit; a note leaving scope emits `withdrawn: true` (ruling C). (Since
#2291's task notes: a scoped note moved WITHIN the scope replaces its old
path's row with `deleted: true, moved: true` and no `scoped` flag, so the
app's merge leaves it unapplied and the index of reported note paths no
longer sees the note at the old path.)

**Step 3 record (2026-09-02, built).** App import: `applyBridgeObservations`
parses a `scoped` observation under its path with the completion window
from the pairing meta's `scope`, returns `scopedNotes` (path → evidence
time; a deleted scoped note is complete knowledge that none of its lines
exist) and `withdrawn` paths. Note-scoped deletion inference judges a task
by the observation of the note it names — `obsidianNotePath` for a scoped
task, the date for a daily one — and revival stamping reads the same
path-keyed evidence. Withdrawal (ruling C) tombstones the note's tasks
through the vault-origin channel at the withdrawal time, so every device
drops them while the vault and its stamps are untouched; the path is
remembered device-locally so the note's next scoped observation counts as
fresh evidence and revival re-admits the same ids. Schedule (ruling B):
`withScheduledMetadata` replaces, appends or removes the ⏳ /
`[scheduled::]` segment on a line, in the vault's detected format; the
writeback routes a non-daily task's date change (including to and from the
inbox) through the retitle path, so the raw title changes and the display
title does not, and the parser reads the date back. Task cards carry a note
badge naming the note. Direct access is untouched (ruling F).

**Field-test record (2026-09-04): moves.** A note moved OUT of the scope
and back did not revive its tasks. Two causes, both in the plugin's rename
handling: a rename reported the old path as a deleted scoped note (so the
app's note-scoped inference tombstoned the tasks at observation time, the
deletion channel rather than ruling C's withdrawal), and a move does not
touch a file's mtime, so the note's return reported content OLDER than
those tombstones and ruling 6's existence LWW kept it dead until someone
edited it. Fixed: the rename handler re-classifies the scope — old path
scoped and new path out is a WITHDRAWAL (the app's path store then lifts
the re-entry), new path in is an adoption on the spot, both in carries the
adoption — and every scoped note carries a memory-only ARRIVAL time (create
or rename) that its observations report as the later of mtime and arrival,
so a note that reappears anywhere in the scope is evidence as of its
arrival. Daily notes are untouched. *Remaining gap, recorded:* an arrival is
memory-only, so a note moved back while the plugin is closed and then left
unedited reports its old mtime after the reload; an edit revives it.

**Tag-removal record (2026-11-05, built; owner ruling).** Removing the
scope tag from a note in scope only by that tag withdrew nothing: the
metadata-change handler reconciled the project link and no more, so the
note stayed adopted and its tasks stayed in dayGLANCE, frozen, while every
other way of leaving (a settings change, a move out, a link removed)
withdrew under ruling C. Now a note's own metadata change re-classifies its
scope. Entering (a scope tag added) adopts it on the spot. Leaving withdraws
it through the same withdrawal, **after a hold**: only once it has been out
of scope continuously for two minutes, re-checked when the hold runs out;
coming back in (a later change, or an observation that finds it scoped)
cancels the hold, and a second removal starts a fresh one. *Why the hold:*
Obsidian re-parses tags as the user types (renaming `#work` to
`#work-projects` passes through `#wor`, and a half-typed frontmatter edit
parses as no tags at all), and a withdrawal drops the note's tasks on every
device, so a transient must never cause one. What still keeps a note in
scope is unchanged: a folder or a project/goal link (`scopedNote`); daily
notes are never withdrawn. A deleted note is reported deleted, never
withdrawn, and its adoption goes with it, so a new note at the path inherits
nothing; a rename's own re-classification decides both paths. The holds are
memory-only: the first adoption walk after a load arms one for every adopted
note found out of scope (a hold, never a withdrawal on the spot), and a note
whose metadata is not parsed yet waits rather than reading as untagged.
The settings path is held to the same standard: the plugin calls
`scopeChanged` on every synced data.json change, most of which leave the
scope as it was, and it used to withdraw every adopted note that looked out
of scope at that moment, a tag mid-retype or a note whose metadata Obsidian
had not parsed yet (startup) included, with no hold. It now acts only when
the scope itself changed, and even then a note with unparsed metadata waits
out the hold rather than reading as untagged.
**The sticky withdrawal (owner ruling, 2026-11-06).** A note that keeps
its `^dg-` stamps after leaving the scope is still reported on every edit
(the observe path admits it by content), and that unflagged report replaced
its withdrawal row: a device that had not pulled in between never saw the
withdrawal and kept the tasks. Now the plugin remembers the notes it
withdrew (`withdrawnScope`, persisted beside the adopted set, per copy), and
while one stays out of scope every report of it goes out as the withdrawal
again, through the normal report's send, so the row keeps saying
"withdrawn" whatever order devices pull in, and the index of reported note
paths reads it as not shared. A path is remembered only while a note is at
it (a move out leaves nothing there to report), never for a daily note.
Re-entry (any way: its tag, a link, the scope setting, a move in) reports it
scoped and forgets it; so does a deletion, and a rename forgets the old path
without carrying the withdrawal to the new one, so no note at either path
inherits it. On the app a repeated withdrawal tombstones nothing new; it
only re-stamps the device-local withdrawn-notes time. Scenarios T1 to T17 in
`scope.scenarios.test.ts`. *Gaps, recorded:* a withdrawal row is still
best-effort when no later report follows it (the same for every way of
leaving). A scope cleared while Obsidian was closed still withdraws nothing
until the settings next change.

**The scenario harness (2026-09-04, built).** The field-test checklist is
now scripted: `dayglance-obsidian-plugin/test/` holds a stub of the
`obsidian` module (an in-memory vault with the plugin's events, a metadata
cache that parses frontmatter and tags, editors the test opens on purpose),
an in-memory GLANCEvault serving the row endpoints, and a scenario runner
that stands up the REAL plugin transport and any number of dayGLANCE
"devices" running the REAL sync hook through the real bridge modules, under
fake time. `scope.scenarios.test.ts` covers adoption and stamping, rename,
move out and back (the field bug above, pinned), deletion with the hold,
schedule-as-metadata and its removal, a second device, the completion
window, ten idle minutes with no churn, retitle and completion in both
directions, and the reload republish. What stays manual, by design:
Obsidian Sync replication timing, real editor buffers, the metadata cache's
own latency, Templater. *Three findings on the first run, all fixed:* the
drain republished the pairing-meta row BARE after every plugin reload,
dropping the viewer override and the task scope until the settings were
touched; a scoped note was reported while the config row was still unknown
(the fragment factory one scope over — the config-null hold now covers
scoped notes); and **ruling E is amended in implementation**: the
completion window governs ADOPTION only — a line already carrying a block
id is tracked, so a tracked task checked off by hand in Obsidian with no
completion date is adopted as completed instead of vanishing from the
parse and being inferred deleted. *Harness caveat, recorded:* both sides
share one process, so module singletons (the root key, the brake, the
own-write ring) are one instance; the plugin's own copy of the sync package
is aliased to the app's for tests.

**The TaskForge reference point** stands from the earlier text: discovery
was never the hard part; identity is what buys cross-device durability
through retitles, deletes and revivals, and it is what this section pays for.

---

## 7. Sequencing

1. **Completion log.** Safest, highest value, foundation already built,
   establishes the write pattern everything else follows.
2. **Sidebar view.** Independent of everything else; the most visible proof the
   plugin is more than plumbing.
3. **Vault task scope, two-way, plugin-only (§6).** Tasks in any in-scope
   note (folders and tags the user picks), completable, renamable and
   schedulable from dayGLANCE. Ahead of project notes because the wikilinked
   notes and the project notes are the same set, and this gives project
   notes something to link to.
4. **Project and goal notes**, including vault-structure creation. Highest value
   of the remaining items, and needs the completion log to be worth much
   (backlinks from completions are half the point). Composes with 3 — the
   wikilinked-notes scope and project notes are the same set.
5. **Templater and Dataview delegation.**

(The 2026-09-02 ruling brought two-way scope into this phase; the read-only tier is gone. See §6.)

---

## 8. Open decisions, consolidated

| # | Decision | Status |
|---|---|---|
| 1 | Completion log heading fixed or configurable | **Decided: configurable, default `## Completed`** |
| 2 | Completion log for direct-access users too | **Decided: yes** (shared formatter/applier, both routes) |
| 3 | What "create the project workspace" produces | **Decided (ruling D, 4.3)**: one note by default, from an optional template through the 4.4 ladder; layout setting adds folder-per-project and nested-under-goal (E amendment) |
| 4 | Project frontmatter update cadence | **Decided (ruling C, 4.3)**: the plugin renders from its mirror on the 30s tick, writes only on change, five-minute wall-clock floor per note |
| 5 | Sidebar refresh mechanism | **Decided: no second stream.** The mirror refreshes on the transport's 30s tick and the drain success tail, so the existing SSE nudge feeds it (4.2, built) |
| 6 | Vault task scope: which notes | **Decided: opt-in folders and/or tags, union**, chosen in the plugin (§6.2 item 4) |
| 7 | Note-key design for two-way scope | **Decided (ruling A, §6.3)**: the note's path for non-daily notes, the date for daily notes |
| 8 | Completion-log line shape (scan-collision constraint, 4.1) | **Decided: non-task shape** (`- ✅ …`), built |
| 9 | Sidebar completion write path for tasks with no vault line (4.2) | **Decided: action rows** (`act:` on the bridge stream), applied by dayGLANCE as the single data-plane writer; built |
| 10 | Ownership rule for dayGLANCE-maintained frontmatter (4.3) | **Decided (ruling B, 4.3)**: one namespaced `dayglance:` map, dayGLANCE wins inside it, nothing outside is touched |
| 11 | Plugin reads the data plane with a device-local root key derived from the sync passphrase (4.2, decision 1) | **Accepted in use** (2026-09-02); the standing veto lapsed |
| 12 | Calendar events in the sidebar (excluded from sync by design) | **Decided: dayGLANCE publishes a per-device projection row** on the bridge stream, merged with per-day authority (4.2, decision 8); built |
| 13 | Multi-user: whose tasks the sidebar, the completion log and the vault writeback handle | **Decided: the vault's viewer**, defaulted from the pairing, overridable in the plugin; first-import assignment to the viewer, writes scoped to the viewer (4.2, decisions 9 and 10); built |

| 14 | Vault task scope rulings B–F (§6.3): schedule-as-metadata, leaving scope, where scope lives, completion window (30 days, configurable 7–90), direct access stays daily-only | **Decided**, 2026-09-02 |
| 15 | Project and goal notes rulings A–H (4.3): link identity (id key + locator), frontmatter ownership, block cadence, workspace shape, goals and nested folders, deletion, where links appear, in-note task adoption | **Decided**, 2026-09-03 |
| 16 | Project notes, templates round (4.3): the project as a Dataview field on daily-note task lines (G amended), the maintained map shrunk to kind/status/goal (C amended), Dataview-presence note bodies chosen at creation; routing project tasks to the project note considered and deferred | **Decided**, 2026-09-04; the backfill of existing lines **declined** (owner, 2026-09-04; cost recorded in 4.3); the routing deferral **closed** by row 17 |
| 17 | Project routing (4.3): a task assigned to a linked project lives in that note (created there, moved on reassignment, removed on unassignment, the token for life, the link as scope); direct tier to follow | **Decided**, 2026-09-05 (owner); plugin tier built |

Nothing in this table is open. The SSE re-arm sequence (buildout spec status note) runs alongside the project-notes build, not ahead of it (owner, 2026-09-03).
