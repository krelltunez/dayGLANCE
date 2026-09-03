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
   another device — and consumed as stale after seven days. The view marks an
   emitted completion as pending until the mirror reflects it (a 15-minute
   optimistic mark, then the box reverts rather than lie).
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

**Open questions**
- What exactly does "create the workspace" produce — a folder plus index note, a
  configurable template, or something the user defines per project?
- Where do goals differ from projects here?
- Does the frontmatter update on every change, or on a cadence? (The
  `data.json` churn lesson applies: frequent small writes to a synced file have
  costs.)
- **Frontmatter ownership.** dayGLANCE-maintained frontmatter is a new write
  class with no ownership rule yet: what happens when the user hand-edits a
  maintained key (status, task count, percentage)? Reassert (dayGLANCE wins),
  adopt (vault wins), or namespace the keys as explicitly machine-owned?
  This is the what-wins-on-divergence category — it needs a ruling before the
  first write ships, not after the first conflict.
- What happens when the note or folder is deleted but the project remains?

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
re-emit; a note leaving scope emits `withdrawn: true` (ruling C).

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
| 3 | What "create the project workspace" produces | Open |
| 4 | Project frontmatter update cadence | Open; `data.json` churn lesson applies |
| 5 | Sidebar refresh mechanism | **Decided: no second stream.** The mirror refreshes on the transport's 30s tick and the drain success tail, so the existing SSE nudge feeds it (4.2, built) |
| 6 | Vault task scope: which notes | **Decided: opt-in folders and/or tags, union**, chosen in the plugin (§6.2 item 4) |
| 7 | Note-key design for two-way scope | **Decided (ruling A, §6.3)**: the note's path for non-daily notes, the date for daily notes |
| 8 | Completion-log line shape (scan-collision constraint, 4.1) | **Decided: non-task shape** (`- ✅ …`), built |
| 9 | Sidebar completion write path for tasks with no vault line (4.2) | **Decided: action rows** (`act:` on the bridge stream), applied by dayGLANCE as the single data-plane writer; built |
| 10 | Ownership rule for dayGLANCE-maintained frontmatter (4.3) | Open; what-wins-on-divergence category, ruling before first write |
| 11 | Plugin reads the data plane with a device-local root key derived from the sync passphrase (4.2, decision 1) | **Accepted in use** (2026-09-02); the standing veto lapsed |
| 12 | Calendar events in the sidebar (excluded from sync by design) | **Decided: dayGLANCE publishes a per-device projection row** on the bridge stream, merged with per-day authority (4.2, decision 8); built |
| 13 | Multi-user: whose tasks the sidebar, the completion log and the vault writeback handle | **Decided: the vault's viewer**, defaulted from the pairing, overridable in the plugin; first-import assignment to the viewer, writes scoped to the viewer (4.2, decisions 9 and 10); built |

| 14 | Vault task scope rulings B–F (§6.3): schedule-as-metadata, leaving scope, where scope lives, completion window (30 days, configurable 7–90), direct access stays daily-only | **Decided**, 2026-09-02 |

Still open, in sequencing order: 3, 4 and 10 (project notes).
