# dayGLANCE MCP Server: Technical Specification

**Status:** Draft for review, revision 4
**Target:** dayGLANCE Electron builds (macOS, Windows, Linux)
**Sequencing:** After the 4.1.2 tray release ships
**Spec baseline:** MCP specification 2026-07-28

**Changes from revision 3:** Closed open question 1 — device calendar events are included, behind a separate consent, read-only. §6.3 splits reads into three tiers (off; dayGLANCE data only; include device calendar) with the rationale; §6.4 adds the calendar tier's own consent copy; §5.1 flags `_native` distinctly in all tool output and requires tool descriptions to state the write limit up front; §5.2 adds the typed `_native` write rejection to the tool contract; §10 Phase 3 gains a verification item on the existing `move_block` mutation path.

**Changes from revision 2:** All changes in this revision come from the Phase 0 spike findings (see `docs/mcp-phase0-findings.md`). Spec baseline moved from 2025-11-25 to 2026-07-28; SDK pinned to v2 (rationale recorded in §10 Phase 1). §3.5 notes what the SDK now provides and closes open question 5 (parallel auth scheme, shared idioms). New §3.7 on main-process state. §3.4 and §7 flip MAS discovery: manual token configuration is primary, container discovery best-effort. New Phase 0.5 (TCC container-protection experiment). Two risks added to §11.

**Changes from revision 1:** Corrected the storage assumption underlying §3.1 (task data is localStorage, not IndexedDB). Replaced §3.3 entirely — the renderer availability problem is resolved, not deferred. Added §3.6 on propagation, which did not exist in r1. Added the test coverage gap to the risk register. Phasing shortened from nine phases to eight.

---

## 1. Summary

Expose dayGLANCE's schedule, task, and goal data over the Model Context Protocol so any MCP client can read and modify the day. All data stays local. No new component ever holds plaintext outside the user's machine, and GLANCEvault is untouched.

The feature ships as two artifacts:

1. **In-process MCP server** inside the dayGLANCE Electron main process, exposed over a loopback Streamable HTTP listener. Serves Claude Code, editor integrations, and any client that accepts an HTTP MCP endpoint.
2. **`@glance-apps/mcp-bridge`**, a standalone stdio-to-HTTP bridge distributed separately (npm plus a signed `.mcpb` bundle). Serves Claude Desktop, which does not accept HTTP endpoints in its local config.

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
- Headless Docker variant. Resolved as "no." See §4.4.
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

**Rule:** every MCP write invokes the same renderer-side mutation function the UI invokes. No exceptions, no direct storage access, no "fast path."

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
  - macOS (MAS): inside the app container — **best-effort only, see below**
- **Manual configuration:** the bridge accepts `--port` and `--token`, and reads `DAYGLANCE_MCP_TOKEN`. On Windows, Linux, and macOS direct-download this is the fallback; **on MAS it is the primary path** (Phase 0 finding).
- **MAS container discovery is best-effort, not primary.** The file lands at `~/Library/Containers/com.dayglance/Data/Library/Application Support/dayGLANCE/mcp.json` (derived from the `userData` pin in `main.ts:37` and the container-home shape confirmed by `icloud.ts:31-33`). The App Sandbox does not block outside readers and POSIX permissions pass for same-user processes, but macOS 15 introduced TCC app container protection: a process reading another app's container triggers a one-time consent prompt attributed to the responsible process. For a bridge spawned by Claude Desktop, the user sees a prompt naming Claude Desktop, about dayGLANCE's data, with no context; a denial is sticky and subsequent reads fail silently. The same-Team-ID exemption keys off the requester (Anthropic's team, not GLANCE Apps) and does not apply. macOS 14 and earlier are unaffected. Phase 0.5 confirms the exact behavior on hardware.
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

Two things to verify during implementation:

1. **Debounce coalescing.** The main process reload is debounced at 500ms. Confirm it is a true trailing debounce that coalesces rather than a leading-edge fire. At 30 writes per minute from an agent this matters; at the tray's historical rate it did not.
2. **Reload volume under agent load.** Every MCP write produces a tray popup reload. The 4.1.2 work reduced idle reloads from roughly 240/hour to near zero, and the write rate limiter (§4.3) bounds the MCP contribution, but the interaction should be measured rather than assumed.

If reload volume proves problematic, the fix is a longer debounce on the MCP path specifically, not a bypass of the emit.

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

### 4.4 Headless variant for the Docker image

**Resolved: no.**

The Docker image serves the PWA. Task data lives in the visiting browser's localStorage, not on the server. There is nothing for a headless MCP server to read.

The apparent workaround, running the MCP server against GLANCEvault, is architecturally disqualified. GLANCEvault stores per-entity ciphertext and has no key. Giving it decryption capability would break "no server access to user data," which is load-bearing in the privacy policy, the store listings, and the positioning of the entire suite.

A future headless option exists in principle: a CLI that runs the sync client locally with a user-supplied passphrase, decrypts in that process, and serves MCP. That is a separate product with its own threat model. Out of scope.

---

## 5. Tool and resource surface

### 5.1 Tools

| Tool | Signature | Notes |
|---|---|---|
| `get_day` | `(date: string)` | ISO 8601 **local** calendar date, `YYYY-MM-DD`, no time component. Response echoes the resolved date and IANA timezone. See §5.3. |
| `get_today` | `()` | Separate tool, not a special date value. Models are unreliable about the current date and will pass stale ones. |
| `list_unscheduled_tasks` | `(limit?, cursor?)` | Cap the default (suggested 50) and return a truncation flag plus cursor. An unbounded dump wastes the client's context. |
| `create_task` | `(title, notes?, project_id?)` | Split from r1's `create_block`. Returns the created task. |
| `schedule_task` | `(task_id, start, duration_minutes)` | The other half. r1's `task` argument was ambiguous between an existing id and a new title. |
| `move_block` | `(block_id, new_start)` | |
| `resize_block` | `(block_id, duration_minutes)` | Separate from move. Combining them invites partial-argument calls. |
| `set_task_completion` | `(task_id, completed: boolean)` | Setter, not action. Gives the agent its own undo without a delete-shaped tool. |
| `get_goal_progress` | `(goal_id?, window?)` | Needs scope arguments. Unscoped, it returns either too little or an unbounded tree. |

**Naming:** MCP namespaces tools per server, so a `dayglance_` prefix is not required for collision avoidance, but it helps model disambiguation when many servers are connected. Recommend the prefix.

**Calendar events — resolved (was open question 1):** `_native` tasks (device calendar events surfaced via EventKit on macOS) appear in `tasks` alongside dayGLANCE tasks and are included in `todayAgenda`. They **are included** in `get_day` and the rest of the read surface — they are part of the user's actual day, and omitting them gives the model a false picture — but **behind a separate consent tier** (§6.3) with its own copy (§6.4), and **read-only always** (§5.2). They were deliberately never persisted (`useDataPersistence.js:195`), and that stays true.

Two requirements on the tool surface:

- `_native` events carry a **distinct type flag in all tool output** — every tool and resource that can return them, not just `get_day` — so neither the model nor a human reading a transcript can mistake calendar data for dayGLANCE data.
- Tool descriptions for `move_block`, `resize_block`, and `set_task_completion` must **state that dayGLANCE cannot modify device calendar events**, so the model knows the limit before attempting a call rather than discovering it through a rejection.

### 5.2 Cross-cutting tool contract

- **Writes return the resulting entity state.** Saves a follow-up read.
- **Errors are tool errors, not protocol errors.** Return `isError: true` with a content block the model can read and recover from. Distinguish at minimum: renderer unavailable, consent revoked, read-only mode, not found, validation failure, rate limited.
- **`_native` events are rejected by every write tool with a typed error.** `move_block`, `resize_block`, and `set_task_completion` refuse device calendar events regardless of the consent tier. Why: dayGLANCE holds EventKit **read** access only, and the existing `day-planner-native-time-overrides` mechanism shifts local display without touching the actual event — so a "successful" write would create a silent discrepancy between what dayGLANCE shows and what the user's calendar says, which is worse than the refusal.
- **Idempotency.** Agents retry. Every write accepts an optional `idempotency_key`, mapped onto the existing `transitionId` pattern from GLANCEintents. Reuse the mechanism rather than inventing a second one.
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
| Read: dayGLANCE data only | Opt-in | Tasks, blocks, goals, habits, routines. `_native` device calendar events are excluded from every tool and resource. Writes return a consent error. |
| Read: include device calendar | **Separate opt-in with its own consent copy** (§6.4) | Adds `_native` events to the read surface, flagged per §5.1. Always read-only — writes to them are rejected with a typed error regardless of the write tier (§5.2). |

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

The listener state must be visible without opening settings. The tray is the right surface: a distinct indicator when the MCP server is bound, the current mode, a one-click kill switch that does not require opening a window, and recent MCP activity (the §4.3 write journal).

A network listener that runs invisibly is the wrong default for a privacy-first app regardless of how the consent was obtained.

---

## 7. Platform matrix

| | Windows | Linux | macOS (direct) | macOS (MAS) |
|---|---|---|---|---|
| Listener bind | Trivial | Trivial | Trivial | Needs `network.server`, already held |
| Renderer alive when listening | Yes (app quits otherwise) | Yes | Yes (hidden, not destroyed) | Yes |
| Discovery file | `%APPDATA%` | XDG | App Support | Container path, best-effort — **manual token is the primary path** (§3.4) |
| Bridge | Bundled + button | Bundled + button | Bundled + button | **Documentation link only** |
| Claude Desktop available | Yes | No | Yes | Yes |
| Claude Code available | Yes | Yes | Yes | Yes |
| Review friction | None | None | None | Moderate, see §8 |

**Direct-download builds** bundle the bridge and offer a setup button that writes the Claude Desktop config entry pointing at the bundled binary's path. No download, no Node requirement. The config edit must read, modify the one key, and write back with a backup — never rewrite the whole file. Claude Desktop is known to silently rewrite that file when it dislikes an entry; treat it as contested territory.

**MAS builds** link to documentation. Nothing else. See §8.2. The documented MAS setup leads with manual token configuration — container discovery is best-effort, per §3.4.

**Build-time separation, not runtime gating.** The download/install path must be compiled out of the MAS binary, not hidden behind `if (isMAS)`. Dormant capability in a shipped App Store build is its own violation (hidden or undocumented functionality) independent of 2.5.2. The existing China-locale suppression establishes the per-build pattern; this is stricter.

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

**Done.** Findings in `docs/mcp-phase0-findings.md`; the revision-3 changes to this spec apply them.

### Phase 0.5: TCC container-protection experiment
**Repo:** none (hardware experiment, findings only)

Runnable in parallel with Phase 1 — nothing in Phase 1 depends on it. A `mas-dev` signed build is sufficient; App Store distribution is not required, because container creation and TCC container protection key off the app being sandboxed, not off App Store distribution.

Method:
1. On macOS 15 or 26: build the existing `mas` target dev-signed (`mas-dev` provisioning, already supported by `electron-builder.config.cjs`), launch it once so `~/Library/Containers/com.dayglance` exists, and place a test `mcp.json` at the §3.4 userData path.
2. Configure Claude Desktop with a stdio entry running a trivial node script that `readFileSync`s that path and logs contents or `errno` — this reproduces the exact responsible-process chain the real bridge would have.
3. Observe: whether a prompt appears, its wording and which app it names, that Allow → read succeeds, Deny → the specific error code, and where the toggle lands in System Settings.
4. Re-run the same script from Terminal and from a second GUI app to confirm attribution follows the responsible process.
5. Repeat on macOS 14 to confirm the unprotected baseline.

**Exit:** written findings. The outcome shapes Phase 6 (whether the bridge attempts container discovery on MAS at all) and the Phase 7 docs (what the MAS setup page tells users to expect).

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

stdio-to-HTTP bridge. Discovery file reading with `--port`, `--token`, and env var fallbacks. Publish to npm. Build and sign the `.mcpb`. Declare platform and runtime requirements in `manifest.json`. Bundle into the direct-download builds with the setup button; compile that path out of MAS.

**Exit:** one-click install into Claude Desktop on macOS and Windows; tools appear; a read and a write both succeed. Direct-download setup button works without network access.

### Phase 7: Docs and site
**Repo:** glance-apps.com

Three OS config snippets. Bridge install paths per build type. Troubleshooting for the failure modes that will actually occur: port collision, stale token after rotation, wrong transport type in the client config, renderer crash.

**Exit:** a self-hoster can go from zero to a working tool call without asking a question.

### Phase 8: Legal and store
**Repos:** legal docs, ASC

Privacy policy updates per §9. Umbrella paragraph. ToU confirmation. MAS description and privacy section. Review notes and demo video per §8.5.

### Deferred
- Resource subscriptions and change notifications
- lastGLANCE and lifeGLANCE equivalents
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
| MAS container read denied or prompt-gated (macOS 15+ TCC container protection; consent prompt attributed to the client app, sticky denial) | Medium | Medium | Manual token paste is the **primary** MAS path (§3.4); container discovery is best-effort. Phase 0.5 confirms the behavior on hardware. |
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

*(r2 had two further questions. Its question 5 — reuse the Stream Deck token handshake or build a parallel scheme? — was resolved by Phase 0: parallel scheme, shared idioms; see §3.5. Its question 1 — does `get_day` include `_native` device calendar events? — was resolved in r4: included, behind a separate consent tier, read-only; see §5.1, §6.3.)*

---

## 13. References

1. MCP transports specification, revision 2025-11-25. stdio and Streamable HTTP are the two standard transports; HTTP+SSE deprecated as of 2025-03-26.
2. Claude Desktop local MCP configuration accepts stdio servers only; `url` and `type: "http"` entries are dropped and the config is silently rewritten.
3. Claude Desktop Custom Connectors are brokered through Anthropic infrastructure and cannot reach loopback addresses.
4. MCPB (`.mcpb`) bundle format for single-click local MCP server installation in Claude Desktop.
5. dayGLANCE Stream Deck WebSocket listener, `127.0.0.1:7892`, Guideline 2.4.5(i) precedent.
6. dayGLANCE 4.1.2 tray cycle: PRs #1297 (reload trigger split), #1299 (`loadData` write-back guard), #1300 (single tray predicate), #1301 (calendar helper spawn cache), #1302 (visibility-gated fetch, `calendarFilter` guard).
