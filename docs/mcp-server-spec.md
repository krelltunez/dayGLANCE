# dayGLANCE MCP Server: Technical Specification

**Status:** Draft for review, revision 7
**Target:** dayGLANCE Electron builds (macOS, Windows, Linux)
**Sequencing:** After the 4.1.2 tray release ships
**Spec baseline:** MCP specification 2026-07-28

**Changes from revision 6:** §4.4 revisited for #2280. The Docker image still gets no MCP server, and GLANCEvault still never holds a key; but the "future headless option" r6 parked as out of scope is now the planned shape: an optional MCP host that is a GLANCEvault client, run by the user with their passphrase, as one more device. GLANCEvault only; the file tier gets none. Its design and sequencing are in `docs/mcp-vault-host.md`. §10's Deferred list gains it.

**Changes from revision 5:** Phase 0.5 ran on hardware (findings in `docs/internal/mcp-phase0.5-findings.md`) and the result was worse than predicted: the TCC container-protection prompt is attributed to `node` — naming neither Claude nor dayGLANCE — with no revocation toggle anywhere in System Settings. §3.4 drops MAS container discovery entirely (was best-effort); MAS is manual token configuration only. §7's matrix and MAS notes updated to match. §10 marks Phase 0.5 done. §11's container-discovery risk row rewritten from contingency to outcome. Discovery on the three unsandboxed platforms is unchanged.

**Changes from revision 4:** Three corrections from the Phase 3 mutation-path trace. §3.1's rule restated as "through the same store layer via a shared pure module" — move and resize have no shared UI mutation function to invoke (inline `setTasks` in drag handlers); converting the UI call sites to the shared module is a follow-up, not part of Phase 3. §5.2's idempotency claim corrected: `transitionId` provides delivery dedup at the GLANCEintents outbox, not mutation-level replay protection; `handleIntent.js:347-389` is the only mutation-level precedent and is create-shaped, so move/resize replay protection is new machinery. §3.6 corrected: the tray debounce is trailing but resets per event, coalescing only bursts closer than 500 ms — at the §4.3 rate limit every write triggers a reload; `electron/trayReloadPolicy.ts` (stretched debounce while MCP writes are recent) is the fix.

**Changes from revision 3:** Closed open question 1 — device calendar events are included, behind a separate consent, read-only. §6.3 splits reads into three tiers (off; dayGLANCE data only; include device calendar) with the rationale; §6.4 adds the calendar tier's own consent copy; §5.1 flags `_native` distinctly in all tool output and requires tool descriptions to state the write limit up front; §5.2 adds the typed `_native` write rejection to the tool contract; §10 Phase 3 gains a verification item on the existing `move_block` mutation path.

**Changes from revision 2:** All changes in this revision come from the Phase 0 spike findings (see `docs/internal/mcp-phase0-findings.md`). Spec baseline moved from 2025-11-25 to 2026-07-28; SDK pinned to v2 (rationale recorded in §10 Phase 1). §3.5 notes what the SDK now provides and closes open question 5 (parallel auth scheme, shared idioms). New §3.7 on main-process state. §3.4 and §7 flip MAS discovery: manual token configuration is primary, container discovery best-effort. New Phase 0.5 (TCC container-protection experiment). Two risks added to §11.

**Changes from revision 1:** Corrected the storage assumption underlying §3.1 (task data is localStorage, not IndexedDB). Replaced §3.3 entirely — the renderer availability problem is resolved, not deferred. Added §3.6 on propagation, which did not exist in r1. Added the test coverage gap to the risk register. Phasing shortened from nine phases to eight.

---

## 1. Summary

Expose dayGLANCE's schedule, task, and goal data over the Model Context Protocol so any MCP client can read and modify the day. All data stays local. No new component ever holds plaintext outside the user's machine, and GLANCEvault is untouched.

The feature ships as two artifacts:

1. **In-process MCP server** inside the dayGLANCE Electron main process, exposed over a loopback Streamable HTTP listener. Serves Claude Code, editor integrations, and any client that accepts an HTTP MCP endpoint.
2. **`@glance-apps/mcp-bridge`**, a standalone stdio-to-HTTP bridge distributed separately (npm plus an unsigned `.mcpb` bundle — see the Phase 6 notes for why unsigned). Serves Claude Desktop, which does not accept HTTP endpoints in its local config.

The second artifact is not optional. See §3.2.

---

## 2. Constraints and non-goals

### Hard constraints

| Constraint | Source |
|---|---|
| No server-side plaintext access to user data | Existing architectural commitment |
| Off by default, explicit opt-in | Privacy gate, blocking requirement |
| Writes must route through the existing renderer mutation path | `@glance-apps/sync` dirty-set tracking and tombstone correctness |
| No downloading or executing code from the MAS build | App Store Guideline 2.5.2 |
| Loopback bind only, never `0.0.0.0` | Threat model |
| MCP-originated writes must emit `tray:data-changed` | Established propagation contract, see §3.6 |

### Non-goals for v1

- Mobile (iOS, Android). Not a mobile feature. Zero revenue impact on the mobile tier.
- Headless Docker variant. The image gets none; a GLANCEvault-client host is a separate component. See §4.4.
- Destructive operations (delete task, delete block). Deliberately absent from the v1 tool surface.
- Resource subscriptions and server-initiated notifications. Deferred.
- lastGLANCE and lifeGLANCE. dayGLANCE only. The pattern generalizes later if it lands well.

---

## 3. Architecture decisions

### 3.1 Process topology: in-process, confirmed

The MCP server runs inside the Electron main process.

**Correction to revision 1:** r1 stated that task data lives in the renderer's IndexedDB. It does not. Task data is in **localStorage** — `day-planner-tasks`, `day-planner-unscheduled`, `day-planner-habits`, and roughly forty related keys. IndexedDB holds the encryption keystore, folder backup, Obsidian sync state, and the GLANCEintents outbox. The conclusion in r1 survives; the stated reasoning was wrong.

The corrected argument, and it is stronger:

**Sync correctness.** `@glance-apps/sync` tracks a dirty set and generates tombstones based on mutations observed through the app's own store layer. `dirtyTracker.js` holds a module-level `dbEngine` reference that is only populated by `registerDbEngine`, called from the main window renderer. A writer outside that path produces records the sync engine never marks dirty — a silent divergence, and one that sidesteps the tombstone guards added in PRs #1146 through #1148.

**Single-writer discipline.** The codebase enforces, by convention and now by guard, that only the main window renderer writes the `day-planner-*` keys. `useSaveOnChange.js:19` bails in tray mode; PR #1299 extended the same guard to `loadData`'s normalization write-back; PR #1302 extended it to `calendarFilter`. Three separate PRs in the 4.1.2 cycle tightened this invariant. The main process introducing a second writer would undo that work directly.

**Rule (restated in r5):** every MCP write goes **through the same store layer via a shared pure module** — renderer-side state setters applying the canonical update shapes, so the save pass, dirty tracking, tombstones, and `tray:data-changed` all engage identically. No direct storage access, no "fast path."

The r4 phrasing was "invokes the same renderer-side mutation function the UI invokes." The Phase 3 trace showed that for move and resize **no such function exists**: the UI performs inline `setTasks` calls inside the drag/resize event handlers (`useDragDrop.js`), and `addTask` is a form-submit handler coupled to modal state, undo, and UI sounds. The canonical update shapes are therefore extracted into `src/utils/taskMutations.js` (pure, state-in/state-out, tested); MCP writes use it as of Phase 3. **Follow-up, not Phase 3:** converting the UI drag/resize call sites to the same module, at which point the letter of the original rule holds too. MCP writes deliberately do not push onto the user's undo stack or play UI sounds — the §4.3 write journal is the undo surface for MCP writes.

**Consequences, all correct behavior:**
- GLANCEintents events fire automatically for MCP-originated mutations.
- `saveData()` runs, so `tray:data-changed` emits and the tray popup and Stream Deck both update. See §3.6.
- Vault sync picks the change up through the normal dirty-set path.

### 3.2 Transport: loopback Streamable HTTP, plus a stdio bridge

The current spec defines two standard transports: stdio and Streamable HTTP. HTTP+SSE is deprecated and should not be implemented.

**Client support is asymmetric, and this determines the design:**

| Client | Local HTTP endpoint | stdio |
|---|---|---|
| Claude Code | Yes, `"type": "http"` with a URL | Yes |
| Claude Desktop | **No.** The local config schema validates stdio only. A `url` field causes the app to silently rewrite `claude_desktop_config.json` and drop the `mcpServers` section entirely. | Yes |
| Claude Desktop Custom Connectors | **No.** Connectors are brokered through Anthropic's infrastructure; the connection originates from Anthropic's servers, not the local machine. A `127.0.0.1` URL is structurally unreachable. | n/a |
| Editor integrations | Varies | Yes |

Serving Claude Desktop therefore requires a stdio server it can spawn. dayGLANCE itself cannot be that server: Electron holds a single-instance lock, and spawning a second Electron instance per MCP session to relay stdio is not viable.

**Decision:** ship `@glance-apps/mcp-bridge`, a small Node process that speaks stdio to the client and Streamable HTTP to the dayGLANCE listener. Distribute it three ways:

- **Bundled inside the direct-download app.** The "Set up Claude Desktop" button writes a config entry pointing at the bundled binary's path. No network call, no Node requirement, no download. See §7.
- **npm** (`npx @glance-apps/mcp-bridge`) for the manual path and for MAS users.
- **`.mcpb` bundle** for one-click install through Claude Desktop's Extensions pane.

Source in the repo, MIT, consistent with the rest of the suite.

The bridge is stateless and contains no business logic. It is a pipe. All tool definitions and data handling stay in the Electron main process.

### 3.3 Renderer availability: resolved

**This section replaces r1 §3.3 entirely.** r1 treated renderer availability as the feature's largest unsolved constraint and proposed a hidden background renderer as a Phase 7 candidate. Investigation during the 4.1.2 cycle established that the problem does not exist.

**On macOS**, `main.ts:188-205` intercepts window close and hides rather than destroys while `!isQuitting`. There is no `mainWindow = null` anywhere in `main.ts`. The main window renderer is live for the entire app session, with the full store, the vault engine, and sync.

**On Windows and Linux**, `startupQuit.ts:25` quits when the last window closes after startup. If anything is listening, a window exists.

**Therefore, one rule on all three platforms: if the MCP listener answers, the main window renderer is alive.** No hidden renderer, no projection store, no tray involvement.

**Throttling: measured, not a problem.** The macOS main window is hidden most of the time and `backgroundThrottling` is unset on both windows, so both run at Chromium's default. Measured on hardware:

- Activity Monitor shows the main window renderer **not** App Napped while hidden. The SSE connection to GLANCEvault appears to keep it awake. (The tray renderer, which has no network connections, does nap.)
- Stream Deck buttons with time-derived displays continued updating after the main window had been hidden for fifteen minutes, confirming that timers fire and that IPC into the hidden renderer dispatches and completes real work.

`backgroundThrottling: false` is **not** required and should not be set. The battery cost would be unnecessary.

**The tray is not a data source and is not involved.** It runs the full App tree, but the vault engine is guarded off (`App.jsx:2038`), the file-tier engine is constructed and never driven, and it is forbidden from persisting. It holds a snapshot as of its last reload. MCP never talks to it.

**Remaining error case, narrowed:** a renderer crash. `render-space-gone` at `main.ts:234` only writes a log line and does not recreate the window, so a crashed renderer leaves a `mainWindow` object that `live()` still considers healthy — `isDestroyed()` will not catch it. MCP must therefore perform a **health check, not an existence check**: send a ping over IPC with a short timeout and treat non-response as unavailable.

When unavailable, every tool returns a structured error with `isError: true` and a message the model can act on. Never return empty results. An empty result set is indistinguishable from an empty day and will cause the model to confidently report a clear schedule.

This shares a root cause with open item "tray mutations silently dropped when no main window exists," which is also blocked on crash recovery. Fixing `render-process-gone` to recreate or reload the window would close both.

### 3.4 Port, discovery, and collision

- **Default port: 7893.** Adjacent to the Stream Deck listener on 7892.
- **Endpoint path: `/mcp`.** Single endpoint supporting POST and GET.
- **On bind failure: fail loudly.** Do not auto-scan for the next free port. Client configs are static text files; silently moving the port breaks every configured client with no signal. Surface the collision in settings and let the user pick a port explicitly.
- **Discovery file:** write the resolved port and auth token to a platform-appropriate location so the bridge can find them without user configuration:
  - Windows: `%APPDATA%\dayGLANCE\mcp.json`
  - Linux: `$XDG_CONFIG_HOME/dayglance/mcp.json`, falling back to `~/.config/dayglance/mcp.json`
  - macOS (direct download): `~/Library/Application Support/dayGLANCE/mcp.json`
  - macOS (MAS): **none — no discovery file is written, and the bridge never attempts a container read.** See below.
- **Manual configuration:** the bridge accepts `--port` and `--token`, and reads `DAYGLANCE_MCP_TOKEN`. On Windows, Linux, and macOS direct-download this is the fallback; **on MAS it is the only path** (Phase 0.5 finding).
- **MAS container discovery is dropped entirely — not retained as best-effort** (Phase 0.5, run on hardware: `docs/internal/mcp-phase0.5-findings.md`). The file would land at `~/Library/Containers/com.dayglance/Data/Library/Application Support/dayGLANCE/mcp.json`, and on macOS 15+ TCC container protection gates the read behind a one-time consent prompt. Revision 5 predicted the prompt would name the responsible client app; the hardware run showed it is attributed to the spawned runtime instead — **"node would like to access data from other apps," naming neither Claude nor dayGLANCE**, fired twice, with **no corresponding toggle anywhere in System Settings** and no safe reset (`tccutil reset SystemPolicyAppData` is system-wide and crashed the test machine once). The happy path therefore requires the user to allow a prompt from an unnamed runtime with no mention of either product — a prompt a security-conscious user **correctly denies** — and the resulting failure is confusing rather than clean. A feature that fails this way is worse than an honestly manual one. Discovery is retained on direct-download macOS, Windows, and Linux, which are unsandboxed and hit no TCC path at all.
- File permissions `0600` on POSIX. It contains a bearer token.

### 3.5 Authentication and origin validation

**Yes, the loopback listener needs a token.** "Any local process can reach it anyway" is true but incomplete. Two distinct threats:

1. **Other local processes.** A token does not stop a process that can read the discovery file, but it does stop every process that cannot, which is most of them.
2. **Browser-originated requests.** Any web page the user visits can issue requests to `127.0.0.1`. The MCP spec requires Origin header validation on local servers as a DNS rebinding defense.

**Required:**

- Bearer token, generated on first enable, rotatable from settings, displayed for manual copy
- `Origin` header validation; reject anything not absent or explicitly allowlisted, with 403
- Bind to `127.0.0.1` explicitly
- Enforce the `MCP-Protocol-Version` header on requests after initialization

**What the SDK provides (Phase 0 finding):** SDK v2 ships `localhostOriginValidation()` and `localhostHostValidation()` (from `@modelcontextprotocol/node`), so Origin and Host validation are configuration, not hand-rolled code. Protocol-version enforcement (`MCP-Protocol-Version` in the 2025 era, the `_meta` envelope in the 2026-07-28 era) is handled inside the SDK transport — Phase 1 must not duplicate it. Only the bearer token check is ours, verified in front of the handler; v2 deliberately verifies no tokens itself and takes the result as pass-through `authInfo`.

**Resolved (Phase 0): parallel scheme, shared idioms.** This closes former open question 5 (whether MCP reuses the Stream Deck token handshake). The Stream Deck handshake (`ws-server.ts`, `AUTH_TIMEOUT_MS`) trusts every Origin-less local process with zero authentication and issues its token only so a browser-context property inspector can inherit that trust; the first requirement above is stopping arbitrary local processes, so reusing the handshake would nullify it. Token direction is inverted — server-to-client, ephemeral, socket-lifetime versus client-to-server, pre-shared, persistent, rotatable — and per-request HTTP auth has no analog to the 5-second first-frame window. What carries over is the idioms: `randomBytes(32).toString('hex')` token generation, the Origin posture (reject browser origins; expect Origin-less native clients), the explicit `127.0.0.1` bind, the `EADDRINUSE` handling posture (handle the error, don't crash the app — but surfaced loudly per §3.4, not log-only), and `protocol.ts` as the model for a single-definition contract file.

### 3.6 Propagation: `tray:data-changed`

**New in revision 2.** This mechanism did not exist when r1 was written.

PR #1297 established a channel that fires from the persistence path after `saveData()` completes, guarded so only the main window emits, consumed by the main process to schedule a debounced tray reload. PR #1300 extracted the emit into `src/utils/trayNotify.js` as the single definition.

Because MCP writes route through the renderer mutation path (§3.1), they trigger `saveData()`, which fires the emit, which updates the tray popup. **No MCP-specific propagation work is required.** This is the design being coherent rather than lucky, and it is an additional argument for the §3.1 rule.

**Verified in Phase 3 (r5), and the answer was the bad case:**

1. **Debounce coalescing.** The reload debounce (`main.ts` `tray:data-changed` handler) is a **trailing debounce that resets per event** — it coalesces only bursts closer together than 500 ms. That is the wrong shape for agent load: at the §4.3 rate limit (one write every 2 s), no two events are within 500 ms of each other, so **every write triggers a tray popup reload** — 30 reloads/minute, 1800/hour against the 4.1.2 cycle's hard-won near-zero. (For user-originated saves the shape is right: a drag gesture fires per mousemove tick and coalesces to one reload after release.)
2. **The fix, per this section's own rule — a longer debounce on the MCP path specifically, never a bypass of the emit:** `electron/trayReloadPolicy.ts`. While an MCP write has landed within the last 10 s, the handler arms a 5 s debounce (longer than the 2 s write cadence, so a sustained agent session coalesces to zero reloads until it goes quiet, then exactly one); otherwise the historical 500 ms. The emit itself is untouched.

### 3.7 Main-process state

**New in revision 3, from Phase 0.** Nothing app-level may live on the `McpServer` instance: it is disposable and per-request (see the SDK pin rationale in §10 Phase 1). The bearer token, consent tier, rate-limiter buckets, write journal, and the renderer IPC and health-check plumbing live at module scope in the main process and are closed over by the `createMcpHandler` factory. The only long-lived objects are the `node:http` server (created on enable, torn down on disable or the kill switch) and the handler wrapper.

There are no sessions — v2's 2026-07-28 era has no `Mcp-Session-Id`, and 2025-era clients are served statelessly from the same factory — so rate limiting keys on the token and idempotency keys on `idempotency_key` (§5.2), never on a session.

This shape favors the pure-function extraction pattern already used by `startupQuit.ts` and `calendarCache.ts`: the module-scope state and the functions that operate on it are exactly the pieces Phase 1 extracts and unit-tests.

---

## 4. Resolved open questions

### 4.1 Port collision with Stream Deck

Resolved: distinct fixed default (7893), explicit user override, loud failure on collision. See §3.4.

### 4.2 Auth on the loopback listener

Resolved: yes. Token plus Origin validation, modeled on the existing Stream Deck handshake. See §3.5.

### 4.3 Write confirmation

**Resolved: no per-write in-app modal in v1.**

- The client already has an approval flow. A second modal is redundant friction.
- An in-app modal assumes the user is looking at the dayGLANCE window. They are looking at the client. A modal that appears behind another app is worse than no modal, because it hangs the agent loop with no visible cause.

**Instead, four cheaper controls:**

1. **Read-only mode as the default consent tier.** Enabling writes is a second, separate toggle.
2. **No destructive tools in v1.** No delete. `set_task_completion` is reversible by the agent itself.
3. **Write journal.** Every MCP-originated mutation tagged with its origin and logged to a session view, with a bulk undo for the current session. The tray is the natural surface for this — see §6.4.
4. **Rate limit.** Cap writes (suggested: 30/minute, configurable) to bound damage from a runaway loop. Exceeding it returns a tool error and, if it recurs, auto-disables writes with a notification. This also bounds tray reload volume per §3.6.

Revisit if a delete tool is ever proposed. Delete would require in-app confirmation.

**The journal read back over MCP (#2321, owner-approved, Tier 1).** The journal had one surface,
the tray and bolt button, for the user. `dayglance_list_mcp_writes` gives it a second, for the
client: an agent can see what it or another client already changed this session before it changes
the same thing again. It is a read (the dayGLANCE-data read tier, §6.3, so it answers in read-only
mode too), registered beside the read tools (`electron/mcpJournalRead.ts`), and it reads the same
module-scope journal the tray reads, per call.

- **Named for what it is, not "history".** It lists only MCP writes since the last start, newest
  first. Edits made in the app, on other devices or by sync are not in it, and its description says
  so, so a model cannot mistake it for a task's history.
- **The op never reaches tool output**, as before. A row is built from `at` (the wire stamp form),
  `tool`, `summary`, the entity ids the op touched under the read tools' names, and, where the op's
  before-state allows, `changes: [{ field, before }]` in the values the read tools show. The op,
  its internal fields and the idempotency key are not read into it. The generic half (newest first,
  the id filter, the page, building the row) is `journalPage` in `@glance-apps/mcp-host`, so a
  GLANCEvault-client host reuses it with its own op description; which ids and fields each of
  dayGLANCE's ops names is dayGLANCE's.
- **No `after`.** An op keeps what its undo needs, the value before. The value after is not derived
  from live state: anything that edited the entity since would make that answer wrong. The client
  reads the entity for its current value.
- **Not trimmed.** The tray's display trims to 50; the read pages over the whole session list with
  the read tools' cursor and cap (default 50, max 200), so nothing older is dropped. Entries leave
  only when the user undoes them.

### 4.4 Headless variant for the Docker image

**Resolved: not in the image. Revised in r7 (#2280): a GLANCEvault-client MCP host, as a separate component.**

The Docker image serves the PWA. Task data lives in the visiting browser's localStorage, not on the server, so there is still nothing in the image for an MCP server to read, and the image does not gain one.

Running the MCP server *inside* GLANCEvault stays disqualified. GLANCEvault stores per-entity ciphertext and has no key. Giving it decryption capability would break "no server access to user data," which is load-bearing in the privacy policy, the store listings, and the positioning of the entire suite. An opt-in does not change that: the promise is about the vault server, not about one user's choice.

What r6 called "a future headless option" is now the planned shape: **an MCP host that is a GLANCEvault client.** It is a process the user runs, on a machine they control, holding their passphrase, and it is one more device: it pulls rows, decrypts them locally, answers the same tools and resources as the desktop server (§5, `docs/mcp-tools-reference.md`), and pushes its writes as timestamped rows through the same adapter and tombstone rules. The vault stays zero-knowledge.

The constraints that make that acceptable:

- **GLANCEvault only.** The `/events` stream is what makes reads current, and per-row encryption with cursor pulls means the host never reads and merges a whole file. The file tier (WebDAV, iCloud, Direct Access) is left as it is and gets no MCP host.
- **A separate component.** Its own repository and package, never part of the PWA image or the GLANCEvault server.
- **Shared code, not copied code.** It is built on packages extracted from this repo: the MCP transport and safety layer, the vault engine with injectable storage, and the vault read path. A second implementation of merge or conflict rules is exactly the divergence §3.1 exists to prevent.
- **Safety parity with the desktop server.** Read-only first. Writes only behind the consent tiers (§6.3, minus the device calendar tier, which a server has no calendar for), the write journal with undo, the rate limit, and a kill switch.

The design, the extraction inventory and the open questions are in `docs/mcp-vault-host.md`.

---

## 5. Tool and resource surface

### 5.1 Tools

| Tool | Signature | Notes |
|---|---|---|
| `get_day` | `(date: string)` | ISO 8601 **local** calendar date, `YYYY-MM-DD`, no time component. Response echoes the resolved date and IANA timezone. See §5.3. |
| `get_today` | `()` | Separate tool, not a special date value. Models are unreliable about the current date and will pass stale ones. |
| `list_unscheduled_tasks` | `(limit?, cursor?)` | Cap the default (suggested 50) and return a truncation flag plus cursor. An unbounded dump wastes the client's context. |
| `create_task` | `(title, notes?, project_id?, assignee_id?, priority?, deadline?, start?, duration_minutes?, all_day?, repeat?)` | Split from r1's `create_block`. Two shapes: without `start` an unscheduled task, inbox or project (may carry `priority` 0-3 and a `deadline` date; an unscheduled project task is an inbox task and the UI gives it both controls); with `start` a scheduled task placed directly on the calendar in ONE transition (never inbox-then-schedule — §5.2 atomicity by construction, and the schedule transition's field strip is never in the path). `all_day` takes a bare `YYYY-MM-DD` in `start` and contradicts `duration_minutes`. By-design typed rejections (copy says design, never "unsupported"): priority/deadline with `start`; `repeat` without `start`; a `repeat.interval` (the app has no general "every N", so it is never approximated). `repeat` with `start` creates a repeating series (#2066, superseding the v1 exclusion): one template in `recurringTasks`, the shape the app's own editor writes, with no new template field; undo removes it and writes the series-delete tombstone. `assignee_id` EXISTS in the schema only while multi-user mode is on (renderer pushes the per-device flag to main at mount and on change; the §3.7 per-request factory re-evaluates it, so a mid-session toggle updates the schema on the next request). Returns the created task or block. |
| `schedule_task` | `(task_id, start, duration_minutes)` | The other half. r1's `task` argument was ambiguous between an existing id and a new title. When the inbox task carried a priority or deadline, the response lists them in `dropped_fields` with a note — the by-design strip must never be silent. |
| `list_users` | `()` | Multi-user only, gated like `assignee_id`. Active members as `{ id, name }`, `id` being the syncId assignment matches on. The roster stays renderer-side; main gates existence but never holds a copy. Models resolve names through this list, never by guessing ids. |
| `move_block` | `(block_id, new_start)` | |
| `resize_block` | `(block_id, duration_minutes)` | Separate from move. Combining them invites partial-argument calls. |
| `set_task_completion` | `(task_id, completed: boolean)` | Setter, not action. Gives the agent its own undo without a delete-shaped tool. |
| `update_task` | `(task_id, title?, notes?, priority?, deadline?, assignee_id?, clear_fields?)` | Field editor for existing tasks (post-v1 addition). Absent leaves a field alone, present sets it, and a field named in `clear_fields` is removed — clearing is only ever the explicit list (models emit `null` when they have no value, so `null`-clears invite silent accidental loss; a field name must be typed into a list on purpose). Only fields that can meaningfully be empty are clearable (`notes`, `deadline`, `assignee`); naming `title` or anything else is a typed validation error. By-design typed rejections: priority/deadline (set or clear) on scheduled tasks (same rule as `create_task`); `_native` events; recurring instances (synthetic per-date ids, a dedicated error, never generic not-found); CalDAV task-calendar tasks (the `set_task_completion` precedent — a local-only edit desyncs the server). `project_id` is not editable, and date/time/duration/completion keep their dedicated tools. `assignee_id` and `assignee` in `clear_fields` are multi-user-gated like `create_task`'s argument. Title edits are supported, which makes journal group labels latest-entry-wins by contract (a rename updates the label; the journal in `@glance-apps/mcp-host` documents the one-quoted-span summary rule that keeps `summaryTitle` extraction correct). Undo captures per-field before-state (`restore_task_fields`), including deleting fields the edit added. Recurring occurrences are edited by `update_recurring_task`. |
| `update_recurring_task` | `(task_id, scope, title?, start_time?, duration_minutes?, all_day?, notes?, project_id?, repeat?, assignee_id?, clear_fields?)` | #2066. Writes through the app's own occurrence save (`applyRecurringInstanceEdit`, #2049) with a REQUIRED scope, the question the app asks: `occurrence` writes that date's exception, `series` writes the template and clears the field from every exception. Notes, project and the pattern are series-only by design. Completions are never touched. Undo (`restore_series_fields`) restores the template fields and the exception dates the edit changed; series ops group per series in the journal. |
| `get_goal_progress` | `(goal_id?, window?)` | Needs scope arguments. Unscoped, it returns either too little or an unbounded tree. |
| `list_project_tasks` | `(project_id, include_completed?, limit?, cursor?)` | #2392, #2393. One project's tasks wherever they sit: scheduled on any date, in the inbox, on the Bucket List. Before it, a project's scheduled tasks were one `get_day` per date away, and nothing listed what `tasks_done` / `tasks_total` count. The list IS that set (one predicate, `inProject`, behind both), so `total` equals `tasks_total`. Items keep the shape of the tool that already lists them and add `placement`. Recurring series are not listed, as they are not counted: they have no end to enumerate. A date-range read of blocks was the other shape on the table and is not built: each day also carries recurring occurrences, routines, frames, the daily note and the device-calendar tier, and the question asked was about a project. Paginated like `list_unscheduled_tasks`, the cursor bound to the project and the filter. |
| `list_mcp_writes` | `(task_id?, subtask_id?, series_id?, goal_id?, project_id?, limit?, cursor?)` | #2321. The §4.3 session write journal read back: MCP writes since the last start, newest first, never the app's own edits. A read on the dayGLANCE-data tier. Rows carry `at`, `tool`, `summary`, the ids touched and, where the undo op allows, `changes: [{ field, before }]`; the op never reaches output. Paginated like `list_unscheduled_tasks`. |

**Naming:** MCP namespaces tools per server, so a `dayglance_` prefix is not required for collision avoidance, but it helps model disambiguation when many servers are connected. Recommend the prefix.

**Calendar events — resolved (was open question 1):** `_native` tasks (device calendar events surfaced via EventKit on macOS) appear in `tasks` alongside dayGLANCE tasks and are included in `todayAgenda`. They **are included** in `get_day` and the rest of the read surface — they are part of the user's actual day, and omitting them gives the model a false picture — but **behind a separate consent tier** (§6.3) with its own copy (§6.4), and **read-only always** (§5.2). They were deliberately never persisted (`useDataPersistence.js:195`), and that stays true.

Two requirements on the tool surface:

- `_native` events carry a **distinct type flag in all tool output** — every tool and resource that can return them, not just `get_day` — so neither the model nor a human reading a transcript can mistake calendar data for dayGLANCE data.
- Tool descriptions for `move_block`, `resize_block`, and `set_task_completion` must **state that dayGLANCE cannot modify device calendar events**, so the model knows the limit before attempting a call rather than discovering it through a rejection.

### 5.2 Cross-cutting tool contract

- **Writes return the resulting entity state.** Saves a follow-up read.
- **Errors are tool errors, not protocol errors.** Return `isError: true` with a content block the model can read and recover from. Distinguish at minimum: renderer unavailable, consent revoked, read-only mode, not found, validation failure, rate limited.
- **`_native` events are rejected by every write tool with a typed error.** `move_block`, `resize_block`, and `set_task_completion` refuse device calendar events regardless of the consent tier. Why: dayGLANCE holds EventKit **read** access only, and the existing `day-planner-native-time-overrides` mechanism shifts local display without touching the actual event — so a "successful" write would create a silent discrepancy between what dayGLANCE shows and what the user's calendar says, which is worse than the refusal.
- **Idempotency (corrected in r5).** Agents retry. Every write accepts an optional `idempotency_key`. The r4 text said to map it onto "the existing `transitionId` pattern" — the Phase 3 trace showed that overstates what exists: `transitionId` is read in exactly one place (`useNotifyEmitter.js`, as the outbound intent's `event_id`) and provides **delivery dedup at the outbox**, not mutation-level replay protection; no local mutation dedups on it. The only mutation-level precedent is `handleIntent.js:347-389` (deterministic task id from the key + existence/tombstone check), and it is create-shaped. So the design is: the key still travels into the emit path as `transitionId` (reusing the delivery dedup that does exist), `create_task` derives a deterministic task id from the key per the `handleIntent` precedent (reuse), and replayed **move/resize/completion** calls are absorbed by a bounded main-process replay store returning the first attempt's result — which is **new machinery, acknowledged as such**, because nothing reusable exists for mutating operations.
- **Routine blocks are rejected by every write tool with a typed error** (`routine_readonly`). Routines are reported by the read surface so a model can see the time is occupied, and a model that can see a block will try to act on it. The refusal names the reason rather than falling through to `not_found`, which would tell the model the block does not exist and invite it to recreate the routine as a task. Both the `routine-<id>` block id and the bare routine id are detected.
- **No partial success.** A tool call either applies fully or not at all.

### 5.3 Date and timezone semantics

dayGLANCE is a day planner, so date handling is the correctness core and the likeliest source of silent wrongness.

- All dates in the tool surface are local calendar dates. No UTC, no offsets, no `Z`.
- All times are local wall-clock times.
- Every response includes the IANA timezone the server resolved.
- The server never infers the current date from the client. `get_today` exists precisely so the client does not have to guess.
- DST: a `schedule_task` call landing in a nonexistent or ambiguous local hour returns a validation error rather than silently picking one.

### 5.4 Resources (read-only)

| URI | Contents |
|---|---|
| `dayglance://schedule/today` | Today's blocks and completion state |
| `dayglance://schedule/week/current` | Current week |
| `dayglance://goals/tree` | Goal and project hierarchy |

Resource subscriptions are technically straightforward given the existing store change events, but add a stateful session dimension to the HTTP transport. Deferred.

---

### 5.5 Routine occupancy on write: reject, never adjust

`create_task` (with a start), `schedule_task`, `move_block`, and `resize_block` all check whether the time they are writing to is covered by a routine, and refuse with a typed `routine_conflict` error naming the routine and its span.

**Why reject rather than slide.** The app's own drag-and-drop resolver slides a dropped task past a routine, and mirroring that here was the alternative on the table. It is the wrong behaviour for an agent. A model that asked for 10:00 and received a success will tell the user "scheduled at 10:00"; the silent twenty-minute shift then surfaces only when the user next looks at the timeline, and by then the model's account of what it did is wrong. A human dragging a block watches it land somewhere else and takes the adjustment as feedback. A model has no such channel, so the adjustment has to be an error it can read.

**Why routines and not general overlap.** Task-on-task overlap stays legal, exactly as in the UI: users double-book on purpose and the timeline renders conflict columns for it. A routine is different in kind, because the write surface cannot move it (§5.2). A caller that lands on a routine has no recovery from either side, and the user is left with two things claiming the same minutes and no gesture that separates them.

**No force flag, deliberately.** The app offers no gesture that drops a task onto a routine either, so an escape hatch here would make the agent surface more permissive than the UI it stands in for. If a user genuinely wants to double-book a routine, that is a request to change what routines mean, not a parameter.

**Ordering against idempotency.** Each conflict check sits AFTER its replay branch. A retried write that already landed must stay a no-op replay even if a routine has since been placed over the time, because failing the retry would tell a crashed agent that its own successful write never happened.

Half-open intervals throughout: a task ending exactly when a routine starts does not conflict, or back-to-back scheduling would be impossible. All-day placements never conflict, having no span.

### 5.6 Frames on the read surface

`get_day`, `get_today`, and both schedule resources return a `frames` array beside `blocks`.

**Beside, not inside.** A block is work on the day; a frame is a window set aside for a kind of work. Folding frames into `blocks` would make every existing caller that iterates blocks start treating windows as work, and the useful part of a frame is not the window but what is still empty in it.

**Availability is computed, not left to the caller.** Each frame carries `available_slots` and `available_minutes`, already net of tasks and recurring occurrences (the rows `blocks` lists, a piece running on from the night before included), routines, today's elapsed time, and the frame's own buffer. A caller cannot reliably derive this from `blocks`: the buffer merging is non-obvious, and a caller that re-subtracts what it can already see double-counts.

**Affinity is reported, not applied.** `tag_affinity` goes out as data and the model matches candidate tasks itself. A `suggest_tasks_for_frame` tool was the alternative and is deliberately not built: it would bake one ranking rule into the wire protocol, and choosing which open tasks suit a two-hour deep-work window is exactly what a model is good at. `filterFrameScheduleTasks` remains the app's own rule for the app's own modal.

**The task list is unfiltered, as the UI's now is.** Over MCP an assistant's view of the day must not depend silently on a view preference it cannot see, so the renderer passes the whole day. The app's frame availability once came from a tag-filtered read, so hiding a tag reported more free time than existed; the calendar filter (tags and hidden projects) is now display-only there too, and `getTasksForDate` reads the unfiltered day (`src/hooks/useDayReads.js`). See §5.5's sibling note in `dayOccupancy.js`.

**Device calendar events follow the consent tier.** A `_native` event genuinely occupies a window, but without the calendar tier it is excluded from availability as well as from `blocks`. Counting it either way would leak the shape of the user's calendar: `available_minutes` would shrink around meetings the caller cannot see, and comparing free time against visible blocks would reveal both their existence and their spans. Availability describes exactly the data the tier permits.

Frames are rule-based and resolve for any date, so unlike routines they need no date guard. They are read-only; there are no frame write tools.

## 6. Consent and privacy model

### 6.1 The exposure, stated plainly

The local server leaks nothing. The client does. Anything read through MCP becomes context in a request to whatever model provider the client uses. This is not a bug to mitigate, it is the feature working as designed, and the consent wording must say so without hedging.

### 6.2 Settings structure

A "Local integrations" section with **two independent toggles**:

| Toggle | Default (fresh install) | Default (upgrade) |
|---|---|---|
| Stream Deck (`127.0.0.1:7892`) | Off | **On** |
| MCP server (`127.0.0.1:7893`) | Off | Off |

**Migration rule, blocking:** the Stream Deck listener currently ships unconditionally enabled. Introducing a toggle that defaults to off would silently break every existing Stream Deck user's buttons on auto-update, with no error — just dead keys. Existing installs must be migrated to on via a one-time flag. Fresh installs get off.

Keep the toggles independent. Coupling them means a Stream Deck user must enable MCP to keep their buttons working. And the consent copy cannot be shared: Stream Deck's exposure is a piece of hardware on the desk; MCP's is a third-party AI provider. One dialog covering both either under-warns for MCP or absurdly over-warns for Stream Deck.

### 6.3 MCP consent tiers

Reads are split into **three tiers rather than two** (this closes open question 1):

| Tier | Default | Meaning |
|---|---|---|
| Off | **Default** | Listener not bound. No port open. |
| Read: dayGLANCE data only | Opt-in | Scheduled blocks, the unscheduled inbox, goals and projects, today's routine blocks (read-only, `type: "routine"`), and the day's frames with their free time. `_native` device calendar events are excluded from every tool and resource, AND from frame availability, so free time never reveals a calendar the user has not shared. Writes return a consent error. |
| Read: include device calendar | **Separate opt-in with its own consent copy** (§6.4) | Adds `_native` events to the read surface, flagged per §5.1. Always read-only — writes to them are rejected with a typed error regardless of the write tier (§5.2). |

**Habits are not exposed, and this row once said they were.** As written in r1 this line read "Tasks, blocks, goals, habits, routines", which was wrong on both of the last two: neither crossed the renderer bridge. Routines were added to the read surface later (§5.1); habits remain out of scope deliberately, being a daily count with no time span, so they cannot affect scheduling. The in-app consent copy never inherited the error and has always described the real surface.

Writes remain a second, independent opt-in on top of either read tier:

| Tier | Default | Meaning |
|---|---|---|
| Read-write | Second opt-in | Full write surface, dayGLANCE data only (§5.2). |

Reads are the exposure; writes are comparatively low-risk. Not per-tool — nine checkboxes nobody reads is worse than a clear tier. The dayGLANCE/device-calendar split earns its place where per-tool consent does not because it maps onto a distinction users actually hold: their own data versus data that is substantially other people's — often their employer's — which they hold in trust rather than own.

### 6.4 Consent copy

The enable dialog must state, without euphemism, that:

- Enabling this allows other applications on this computer to read the schedule, tasks, and goals
- Those applications typically send what they read to an AI provider over the internet
- dayGLANCE cannot see or control what those applications do with the data
- dayGLANCE has no relationship with those providers, and this is not covered by dayGLANCE's own privacy guarantees

**The device calendar tier (§6.3) gets its own dialog, and its copy must name what it actually exposes:** event titles, attendees, and other people's information — data the user did not create and that those people did not consent to share. "Include device calendar events" alone under-describes a meeting invite that carries a client's name, a candidate's interview, or a colleague's dial-in.

Model the structure on the existing OpenAI feature disclosure, but the substance differs: that discloses a provider dayGLANCE chose; this discloses a provider **the user** chooses, which dayGLANCE cannot name in advance. The copy has to carry that distinction.

One shared setup guide, two sections (Stream Deck and MCP), linked from both toggles.

### 6.5 Visible state

The listener state must be visible without opening settings. A network listener that runs invisibly is the wrong default for a privacy-first app regardless of how the consent was obtained.

**The canonical surface is in the app, not the tray** (revised after the Phase 5b implementation shipped tray-first): `createTray()` was darwin-gated at the time (Windows gained the tray later; Linux still has none), so Windows and Linux had no tray at all — a tray-only surface left the majority of platforms with no ambient indication that a listener was bound and no reachable kill switch or bulk undo outside settings, contradicting this section's own premise. The surface is a lightning-bolt icon button:

- **Settings-cluster button in the main window** (canonical, all platforms): rendered while the listener is bound, and also while it is off with undoable session writes remaining. This section requires a BOUND listener to be visible — not an unbound one to be invisible: the kill switch is most likely used because an agent misbehaved, which is exactly when bulk undo is needed, so the bolt must not vanish with the port. Status dot per the settings-cluster convention: green (enabled, no undoable writes), blue (undoable MCP writes exist), red (writes auto-disabled after repeated rate-limit violations, §4.3), amber (server off, undoable writes remain — deliberately not green or blue so it cannot read as enabled). Clicking opens the app's standard modal (the backup/help chrome — dimmed backdrop, centered card) with server status, current tier, the one-click kill switch, and the session journal: entries grouped per task (labels from the write summaries, counts always over the full journal even when the row list is display-trimmed), each group with an undo that reverses that one task to its pre-MCP state, plus bulk undo for everything at once (still the right answer for a runaway loop); the tray popup keeps its INLINE expansion, which fits that host (an inline push below the desktop header read as layout breakage); in the amber state the panel shows the journal, bulk undo, and a clear server-off indication, with no kill switch (nothing to kill). The bolt disappears once the journal is empty, whether emptied by undo or by restart (the journal is session-scoped). The narrow-viewport variant (the same layout renders in Electron windows under 721px wide, not only on Capacitor) splits status from configuration. The status bolt sits in the GLANCE tab's utility row beside the filter, voice, and bucket buttons — the closest mobile analog of the desktop settings cluster, and a row whose neighbors already open overlays — and opens the same modal. Configuration lives in a **Local Integrations** row card in the mobile Settings tab, under GLANCE Integrations and above Multi-user, opening a full settings page in the standard row-card style. Status and bulk undo deliberately do NOT live in settings — the kill switch and undo matter most when an agent has misbehaved, which is not the moment to dig through a settings page — and the bolt deliberately does NOT sit in the date-nav header, the layout's most contended row.
- **The same bolt in the macOS tray popup's input row** (convenience mirror): identical states and panel, always opening collapsed.
- **The tray icon's right-click menu** (macOS): tier label plus the kill switch — the one path that needs no window at all.

**Removed, deliberately:**

- *The menu-bar tier glyph.* It competed with focus-countdown and reminder state in a cramped, macOS-only surface, and duplicated a signal the bolt now carries on every platform.
- *The persistent tray-popup banner.* Two always-visible rows taxed a 320px popup whose purpose is the day's tasks; the collapsed bolt carries the same ambient signal in one icon's footprint, and the expansion carries the rest on demand.

---

## 7. Platform matrix

| | Windows | Linux | macOS (direct) | macOS (MAS) |
|---|---|---|---|---|
| Listener bind | Trivial | Trivial | Trivial | Needs `network.server`, already held |
| Renderer alive when listening | Yes (app quits otherwise) | Yes | Yes (hidden, not destroyed) | Yes |
| Discovery file | `%APPDATA%` | XDG | App Support | **None — manual token configuration only** (§3.4, Phase 0.5) |
| Bridge | Bundled + button | Bundled, npx/docs (no button) | Bundled + button | **Documentation link only** |
| Claude Desktop available | Yes | No | Yes | Yes |
| Claude Code available | Yes | Yes | Yes | Yes |
| Review friction | None | None | None | Moderate, see §8 |

**Direct-download builds** bundle the bridge and offer a setup button that writes the Claude Desktop config entry pointing at the bundled copy. No download, no Node requirement: the entry runs dayGLANCE's own Electron binary with `ELECTRON_RUN_AS_NODE=1` against the bundled `bridge.js` — the already-installed, already-signed binary doubles as the Node runtime, so no second binary ships and nothing new needs signing. The config edit must read, modify the one key, and write back with a backup — never rewrite the whole file, and never write a file that fails to parse (report and show manual instructions instead). Claude Desktop is known to silently rewrite that file when it dislikes an entry; treat it as contested territory. **The setup button exists on macOS and Windows only.** Linux still bundles the bridge, but Claude Desktop does not exist there, and an AppImage mounts at a different path every launch, so any absolute path written into a config file would go stale by the next run — Linux users get the `npx` path and the docs.

**MAS builds** link to documentation. Nothing else. See §8.2. The documented MAS setup is manual token configuration only — container discovery is dropped, per §3.4. This costs less than it sounds: MAS users already install the bridge by hand, because the setup path is compiled out of the MAS binary for Guideline 2.5.2, so one token copy-paste is a small addition to an already manual process — and it replaces a consent prompt that names neither product and cannot be found again in System Settings.

**Build-time separation, not runtime gating.** The download/install path must be compiled out of the MAS binary, not hidden behind `if (isMAS)`. Dormant capability in a shipped App Store build is its own violation (hidden or undocumented functionality) independent of 2.5.2. A Phase 6 correction to this paragraph's earlier claim: the China-locale suppression (`electron/storefront.ts`) is **runtime** locale gating, not a compile-out precedent — nothing in the repo did per-target dead-code elimination before Phase 6, so the mechanism is new, and it is two mechanisms because the two processes build differently: the renderer's setup button is eliminated by the `__MAS_BUILD__` vite define (set only by `build:electron:mas`; rollup drops the dead branch), and the main-process setup modules (`mcpDesktopSetup.ts`, `mcpDesktopConfig.ts`) are excluded from MAS packaging by the electron-builder `mas.files` filter, with `main.ts` loading them dynamically so absence is a no-op. `scripts/verify-mas-compileout.mjs` asserts both absences (plus the bundled bridge's absence and the button string's absence) against the BUILT artifact, and the same presences in a direct build — the requirement is an artifact property, so it is verified on artifacts, never on source.

**MAS cannot write the config file anyway.** `~/Library/Application Support/Claude/` is outside the container. The only sandbox-legal route is an open panel where the user explicitly selects their config file, granting access to that one file, which needs `files.user-selected.read-write`. Whether that is worth building for a two-line JSON edit is a judgment call. Ship the documentation link first.

**MAS documentation must link to the feature docs, not to "download the direct build for the easy installer."** Apple is inconsistently touchy about App Store apps funneling users to non-App-Store versions. The docs page can say whatever it wants.

Linux has fewer clients and a better-matched audience. Claude Code and editor integrations cover it, and the self-hosted overlap means those users are most likely to configure an HTTP endpoint by hand. Linux may be the best-served platform in practice despite having no Claude Desktop, because it is where the bridge is least necessary.

---

## 8. Mac App Store review plan

### 8.1 What is already in hand

`com.apple.security.network.server` is held, with a reviewer explanation on file from the Stream Deck submission (WebSocket server on `127.0.0.1:7892`, Guideline 2.4.5(i), resolved with an ASC reply and the Elgato demo video). A second loopback listener for a second local integration is the same argument, and the precedent is recent.

### 8.2 The new risk, and it is not the entitlement

**Guideline 2.5.2.** The MAS build must not download, install, or execute the bridge:

- No "Install bridge" button that fetches from npm or GitHub
- No bundled bridge binary that the app writes outside its container
- No shelling out to `npx`

The app links to documentation. The user installs the bridge themselves.

Shipping the bridge inside the signed MAS bundle for an external process to execute is also a bad idea independent of 2.5.2: bundle contents are signed and immutable, and an unsandboxed third party executing code from inside a sandboxed app's bundle invites scrutiny for no benefit.

### 8.3 Guideline 5 and China region

The macOS OpenAI feature required CN device region detection to suppress it. **MCP should not need the same treatment.** MCP is a transport protocol with no provider baked in; dayGLANCE integrates with no named service and transmits nothing itself. The suppression was about the specific service, not AI features generally.

Prepare the explanation; do not preemptively implement suppression. If review pushes back, the suppression code exists and can be pointed at the MCP toggle in a point release.

### 8.4 Privacy nutrition labels

Apple's questions ask what **the developer** collects. dayGLANCE collects nothing, and enabling MCP does not change that: the transmission is performed by a third-party application the user installed and configured. The labels should not change.

That is the correct answer for the labels and not the correct answer for the privacy policy. Disclose fully there. See §9.

### 8.5 Reviewer testing

The reviewer cannot test this without an MCP client. Provide in the review notes:

- A statement that the feature is off by default and requires two explicit opt-ins
- A screen recording of the enable flow, the consent copy, the listener indicator, and one tool call from Claude Code
- A link to the bridge repo and the `.mcpb`
- An explicit note that the app never installs or executes the bridge

Same shape as the Elgato video that resolved 2.4.5(i). Reuse the pattern.

---

## 9. Legal and store listing deltas

### 9.1 dayGLANCE per-app privacy policy

New section covering:

- What the MCP server is and that it is off by default
- That enabling it allows local applications to read schedule, task, goal, **and device calendar** data
- That those applications commonly transmit that data to third-party AI providers
- That dayGLANCE has no relationship with, and no visibility into, those providers
- That this is outside the scope of dayGLANCE's own encryption and no-server-access guarantees
- That the data leaving the device is a consequence of the user's choice of client, not of dayGLANCE's design

Keep it on the per-app subdomain, consistent with the pattern that avoids Google re-review on URL changes.

### 9.2 GLANCE Apps umbrella policy

One paragraph noting that per-app integrations may expose data to user-selected third parties, pointing to per-app policies. Do not duplicate the detail.

### 9.3 Unified Terms of Use

Likely no change. Confirm the existing third-party integration language covers a user-configured local protocol endpoint. If written around named services only, generalize it.

### 9.4 Store listings

- **Mac App Store:** feature mention in the description; note in the privacy section distinguishing this from the encryption claims, in the same way the iCloud carve-out was handled
- **Google Play:** no change, mobile is out of scope
- **glance-apps.com:** feature page with the three OS config snippets and bridge install paths. Following the GLANCEvault precedent, frame it as capability for people who already know what MCP is, not a headline feature.

---

## 10. Phasing

Each phase lands on a feature branch off `main`, committed and pushed so state can be synced. Note the repo convention established during the 4.1.2 cycle: follow-up work goes on a fresh branch off `main` rather than stacking on merged history.

### Phase 0: Spike
**Repo:** dayGLANCE

Verify, do not assume:
- Streamable HTTP server in the Electron main process using the current MCP TypeScript SDK. Confirm the SDK version and that per-request server instancing is handled correctly — sharing one server instance across stateless requests has caused cross-request leakage in recent SDK versions.
- Whether the MAS container discovery path is readable by an unsandboxed process spawned by another app. If not, manual token paste becomes the primary MAS path rather than the fallback.
- Read `electron/protocol.ts` and the Stream Deck token handshake. Decide whether MCP reuses it or implements a parallel scheme.

**Exit:** written findings. No implementation.

*(r1 had a third spike item on renderer liveness. Resolved — see §3.3.)*

**Done.** Findings in `docs/internal/mcp-phase0-findings.md`; the revision-3 changes to this spec apply them.

### Phase 0.5: TCC container-protection experiment
**Repo:** none (hardware experiment, findings only)

Runnable in parallel with Phase 1 — nothing in Phase 1 depends on it. A `mas-dev` signed build is sufficient; App Store distribution is not required, because container creation and TCC container protection key off the app being sandboxed, not off App Store distribution.

Method:
1. On macOS 15 or 26: build the existing `mas` target dev-signed (`mas-dev` provisioning, already supported by `electron-builder.config.cjs`), launch it once so `~/Library/Containers/com.dayglance` exists, and place a test `mcp.json` at the §3.4 userData path.
2. Configure Claude Desktop with a stdio entry running a trivial node script that `readFileSync`s that path and logs contents or `errno` — this reproduces the exact responsible-process chain the real bridge would have. The script exists: `scripts/tcc-container-probe.mjs` (dependency-free; serves as the stdio entry, and `--once` covers the Terminal and second-GUI-app runs; usage in its header).
3. Observe: whether a prompt appears, its wording and which app it names, that Allow → read succeeds, Deny → the specific error code, and where the toggle lands in System Settings.
4. Re-run the same script from Terminal and from a second GUI app to confirm attribution follows the responsible process.
5. Repeat on macOS 14 to confirm the unprotected baseline.

**Exit:** written findings. The outcome shapes Phase 6 (whether the bridge attempts container discovery on MAS at all) and the Phase 7 docs (what the MAS setup page tells users to expect).

**Done.** Findings in `docs/internal/mcp-phase0.5-findings.md`. Result in one line: the prompt is attributed to `node` — naming neither Claude nor dayGLANCE, with no System Settings toggle to revisit the choice — so §3.4 (r6) drops MAS container discovery entirely; the bridge never attempts it, and Phase 7's MAS docs lead with the token copy-paste.

### Phase 1: Listener skeleton
**Repo:** dayGLANCE

**SDK: pin v2 — the scoped `@modelcontextprotocol/*` packages at 2.0.0** (`server`, `node`; `client` for tests). Why, from Phase 0: v1's maintenance window closes around October 2026, mid-project. v1's stateless mode accepts a second client's `initialize` silently and routes responses by JSON-RPC request id (`_requestToStreamMapping`), producing cross-client leakage with no error when an instance is shared. v2 makes per-request instancing structural via `createMcpHandler(factory)` — a fresh server per request is the API shape, not a convention to remember. v2 also supplies the localhost Origin/Host guards and protocol-version enforcement per §3.5.

Main-process Streamable HTTP listener on 7893, `/mcp` endpoint, `initialize` and `tools/list` handshake, one hardcoded tool returning static data. Token auth, Origin validation, `MCP-Protocol-Version` enforcement. Bound only when explicitly started; dev flag only, no UI.

Extract auth, Origin validation, and port resolution as pure functions in the style of `startupQuit.ts` and `calendarCache.ts`, and unit-test them. This is the established pattern for main-process logic in this codebase and the only way any of it gets test coverage.

**Exit:** MCP Inspector connects and lists the stub tool. Claude Code connects with a static `"type": "http"` config entry.

### Phase 2: IPC bridge and read tools
**Repo:** dayGLANCE

Main-to-renderer IPC channel with a health check (ping plus timeout, not an existence check — see §3.3). `get_today`, `get_day`, `list_unscheduled_tasks`, `get_goal_progress`. Full date and timezone semantics per §5.3. Pagination on the inbox. Typed unavailable error.

**Exit:** real data from Claude Code with the main window hidden; correct across a DST boundary; correct typed error when the renderer is killed.

### Phase 3: Write tools
**Repo:** dayGLANCE

`create_task`, `schedule_task`, `move_block`, `resize_block`, `set_task_completion`. All routed through existing renderer mutation functions. Idempotency keys mapped to `transitionId`. Write rate limiter.

**Verify during implementation:** whether the existing `move_block` mutation path distinguishes `_native` tasks or would silently write a `day-planner-native-time-overrides` entry. Either way, the `_native` rejection (§5.2) must be **explicit in the MCP write path** — a typed error the MCP layer itself returns — not assumed from the existing code's behavior.

**Exit criteria, all required:**
1. A write made through MCP syncs correctly to a second device.
2. It emits the expected GLANCEintents event.
3. It survives a tombstone cycle.
4. It fires `tray:data-changed` and the tray popup reflects it (§3.6).
5. Sustained writes at the rate limit do not produce pathological tray reload volume.

Given the sync history in #1146 through #1148, criteria 1 and 3 need a real two-device test, not a local write test.

### Phase 4: Resources
**Repo:** dayGLANCE

Three read-only resources per §5.4. No subscriptions.

### Phase 5: Consent gate and settings UI
**Repo:** dayGLANCE

Two-toggle "Local integrations" section. **Stream Deck migration flag (§6.2) — this is the blocking item, not the MCP toggle.** MCP tiers, consent copy, token display and rotation, port override and collision surfacing, tray indicator and kill switch, write journal with session undo.

**Exit:** feature is off on a fresh install with no port bound; cannot be enabled without passing the consent copy; **an upgraded install with Stream Deck configured continues working with no user action.**

### Phase 6: Bridge and distribution
**Repo:** new, `glance-apps/mcp-bridge`

stdio-to-HTTP bridge. Discovery file reading with `--port`, `--token`, and env var fallbacks. Publish to npm. Build the `.mcpb` (unsigned; see notes). Declare platform and runtime requirements in `manifest.json`. Bundle into the direct-download builds with the setup button; compile that path out of MAS.

Notes from implementation: dayGLANCE's side of §3.4 (writing the discovery file) also landed here — no earlier phase had implemented it; it is written on bind with mode 0600, rewritten on token rotation, and removed on unbind, never on MAS. The `.mcpb` ships **unsigned**, a change from the original self-signed plan. Two findings forced it: `@anthropic-ai/mcpb` 2.1.2's `sign` appends its PKCS#7 block after the zip end-of-central-directory record without updating the comment-length field, so every signed bundle fails strict zip readers and Claude Desktop refuses to install it (reproduced on a minimal bundle; reported upstream); and the signature bought nothing anyway, since `mcpb verify` reports any certificate absent from the OS trust store — self-signed included — as "not signed". Patching the archive ourselves was rejected: it would ship a layout produced by a workaround around a bug in the tool that produced it. Every `.mcpb` build is instead gated on a strict zip parse (`scripts/check-mcpb.mjs` in the bridge repo, yauzl — the same parser family Claude Desktop uses); signing returns to the build chain when upstream fixes the bug. Enterprise policies may block unsigned bundles — the npm path is the managed-environment alternative. The bundle's `user_config` presents Token and Port as Claude Desktop form fields, which is what makes MAS setup a paste into a form rather than a JSON edit.

**Exit:** one-click install into Claude Desktop on macOS and Windows; tools appear; a read and a write both succeed. Direct-download setup button works without network access.

### Phase 7: Docs and site
**Repo:** glance-apps.com

Three OS config snippets. Bridge install paths per build type. Troubleshooting for the failure modes that will actually occur: port collision, stale token after rotation, wrong transport type in the client config, renderer crash.

**Exit:** a self-hoster can go from zero to a working tool call without asking a question.

Notes from implementation: division of labor decided and enforced — the bridge README (glance-apps/mcp-bridge) is the canonical how-to covering every install path (setup button for direct-download macOS/Windows; unsigned `.mcpb` with the mcpb-CLI signing bug noted; `npx` manual entry, the only Linux path; other stdio clients such as ChatGPT, which register the same command through their own MCP settings rather than `claude_desktop_config.json`; Claude Code direct HTTP with no bridge), plus a ten-item troubleshooting section and the renderer requirement; the site page (glance-apps-dotcom, dayGLANCE app page) is an "AI Assistants" capability card in the GLANCEvault-precedent stack that explains the capability for someone who does not know MCP, leads with the decision-making facts (assistant reads go to the assistant's model provider; local-only; off by default with reads/writes/device-calendar as separate opt-ins), and links to the README rather than restating any setup. The app links there too: Settings, Local Integrations, "setup guide" points at the README directly, so it is the page a user lands on straight from the consent screen rather than one they reach through the site. The MAS manual-token path is stated with its reason (a container read would trigger a macOS consent prompt attributed to "node" naming neither product). One documentation landmine made a hard rule: no `url` field may appear in any `claude_desktop_config.json` example, even as a counterexample — Claude Desktop silently rewrites the file and drops the whole `mcpServers` block when it sees one; the only `url` in the README sits in a block explicitly labeled as Claude Code's `.mcp.json`.

### Phase 8: Legal and store
**Repos:** legal docs, ASC

Privacy policy updates per §9. Umbrella paragraph. ToU confirmation. MAS description and privacy section. Review notes and demo video per §8.5.

### Deferred
- Resource subscriptions and change notifications
- lastGLANCE and lifeGLANCE equivalents (the host kit extracted for §4.4 is meant to serve them)
- The GLANCEvault-client MCP host (§4.4, `docs/mcp-vault-host.md`)
- Delete tools with in-app confirmation
- MAS config-file writing via open panel

---

## 11. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| MCP writes bypass sync tracking and produce silent divergence | Low if §3.1 is enforced, catastrophic if not | High | Mutations only through renderer store functions. Phase 3 exit requires a two-device sync test. Three PRs in the 4.1.2 cycle tightened single-writer discipline; do not undo it. |
| **`useElectronBridge.js` has zero test coverage** | Certain, it is a current fact | Medium | A syntax error there passes the full suite and is caught only by lint and build; a semantic regression is caught by nothing. If MCP's renderer half lands there, a dropped field is invisible. Either add coverage first or put the MCP IPC in a new tested module, as PR #1302 did with `useTrayPopupVisible`. |
| **Stream Deck regression from the new toggle** | High without the migration flag | High | Existing installs migrate to on. This breaks the most engaged users silently, with no error. Blocking exit criterion on Phase 5. |
| Renderer crash leaves a `mainWindow` that `live()` considers healthy | Low | Medium | Health check, not existence check. Shares a root cause with the open tray-mutation-dropped item; fixing `render-process-gone` closes both. |
| MAS rejection on 2.5.2 for bridge distribution | Low if the app only links | High if it happens | App never fetches or executes the bridge. Path compiled out, not runtime-gated. Review notes state it explicitly. |
| MAS container read prompt-gated by TCC container protection — **resolved by Phase 0.5** (`docs/internal/mcp-phase0.5-findings.md`): the prompt is attributed to `node`, names neither product, and has no System Settings toggle | Was Medium; now retired | Was Medium; now none | Container discovery **dropped** on MAS (§3.4 r6): the bridge never attempts the read, so the prompt never fires. Manual token configuration is the only MAS path. Unsandboxed platforms keep discovery and hit no TCC path. |
| SDK v1 maintenance window closes mid-project (~October 2026) | Certain if v1 is pinned | Medium | Pin SDK v2 (§10 Phase 1). |
| Client transport confusion (users pasting a URL into Claude Desktop's config and losing their `mcpServers` block) | High | Medium, and it is someone else's bug arriving as a dayGLANCE support request | Docs lead with the bridge for Claude Desktop and never show a `url` field in a `claude_desktop_config.json` example, not even as a counterexample. |
| Tray reload volume under agent load | Medium | Low | Rate limiter bounds it. Verify debounce coalescing per §3.6. Fix is a longer debounce on the MCP path, never a bypass of the emit. |
| Device calendar data exposed without the user connecting it to MCP | Medium | Medium | Name device calendar events explicitly in the consent copy (§6.4) and flag them distinctly in tool output (§5.1). |
| Runaway agent loop mangles a day | Low | Medium | Rate limit, write journal, session undo, read-only default tier. |
| Spec churn (transport and session rules have moved twice) | Medium | Low | Pin the SDK, note the targeted spec revision in the repo, treat the bridge as the compatibility shim if a client lags. |

---

## 12. Open questions

1. **Naming.** `GLANCEmcp` fits the `GLANCEintents` / `GLANCEvault` pattern, but MCP is already an acronym and the doubling reads awkwardly. "dayGLANCE MCP server" is plain and searchable. Weak preference for plain.
2. **Should the `.mcpb` be submitted to the Connectors Directory?** Discoverable to a well-matched audience, but it is a listed artifact that assumes dayGLANCE is installed and running, which is a poor first experience for anyone who finds it cold. Probably defer past v1.
3. **Does the write journal persist across restarts?** Session-scoped is simpler and covers the runaway-loop case. Persistent is better for "what changed my schedule last Tuesday," but that is arguably a general audit-log feature rather than an MCP one.

   *Still open, with one part decided (#2321).* The journal is now readable over MCP
   (`dayglance_list_mcp_writes`, §4.3), session-scoped as before. Persisting it across restarts
   (Tier 2 of #2321) is declined for now: a saved MCP-only log would look like an audit log while
   missing every edit made in the app, on other devices or by sync, so "what changed my schedule
   last Tuesday" would get a confidently partial answer. Revisit if a general change history that
   records every source is built; MCP writes would be one source in it, not a log of their own.

*(r2 had two further questions. Its question 5 — reuse the Stream Deck token handshake or build a parallel scheme? — was resolved by Phase 0: parallel scheme, shared idioms; see §3.5. Its question 1 — does `get_day` include `_native` device calendar events? — was resolved in r4: included, behind a separate consent tier, read-only; see §5.1, §6.3.)*

---

## 13. References

1. MCP transports specification, revision 2026-07-28 (the spec baseline per the header). stdio and Streamable HTTP are the two standard transports; HTTP+SSE deprecated as of 2025-03-26.
2. Claude Desktop local MCP configuration accepts stdio servers only; `url` and `type: "http"` entries are dropped and the config is silently rewritten.
3. Claude Desktop Custom Connectors are brokered through Anthropic infrastructure and cannot reach loopback addresses.
4. MCPB (`.mcpb`) bundle format for single-click local MCP server installation in Claude Desktop.
5. dayGLANCE Stream Deck WebSocket listener, `127.0.0.1:7892`, Guideline 2.4.5(i) precedent.
6. dayGLANCE 4.1.2 tray cycle: PRs #1297 (reload trigger split), #1299 (`loadData` write-back guard), #1300 (single tray predicate), #1301 (calendar helper spawn cache), #1302 (visibility-gated fetch, `calendarFilter` guard).
