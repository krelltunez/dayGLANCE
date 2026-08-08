# dayGLANCE MCP Server: Phase 0 Spike Findings

**Date:** 2026-08-08
**Spec:** `docs/mcp-server-spec.md` (revision 3 applies these findings; the spike ran against revision 2)
**Scope:** the three Phase 0 items from §10. Findings only — no implementation, no dependencies added to the repo. SDK packages were installed in an isolated scratch directory for inspection only.

---

## Item 1 — MCP TypeScript SDK: version and instancing

### The version picture changed underneath the spec

- **v1 line:** `@modelcontextprotocol/sdk` — latest is **1.30.0** (last published 2026-07-27). Node ≥18.
- **v2 line:** on **2026-04-01** the SDK split into scoped packages — `@modelcontextprotocol/server`, `/client`, `/core`, `/node` — all at **2.0.0**, tagged `latest` on npm. Node ≥20 (Electron 43, which the repo is on, satisfies this). v2 shipped alongside the **2026-07-28 spec revision**. The SDK repo README states v2 is the stable release line and **v1.x receives bug fixes and security updates for at least 6 months after v2's release** — i.e., the v1 maintenance window closes around **October 2026**, likely before Phases 1–8 finish. v2 serves 2025-era clients from the same entry point, so the earlier baseline still interoperates, but the pinning decision is now "which major," not "which minor."

### Instancing: fresh instance per request — in both lines, differently

**v1 (1.30.0):** the canonical stateless pattern (v1.x branch, `src/examples/server/simpleStatelessStreamableHttp.ts`) creates a **new `McpServer` and a new `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` per POST request**, and closes both when the response closes. Sharing one instance across stateless requests is concretely unsafe, verified in the 1.30.0 dist:

- The transport routes responses to HTTP response streams via `_requestToStreamMapping`, **keyed by JSON-RPC request id** (`webStandardStreamableHttp.js:589`). Every client numbers its own requests from ~1, so two concurrent (or interleaved) clients on a shared transport collide on ids and a response is written to the **wrong client's stream** — cross-client leakage.
- The "Server already initialized" throw that r2 §10 mentioned still exists (`webStandardStreamableHttp.js:522-524`) but only fires when a session id is set; in stateless mode (`sessionId === undefined`) a second client's `initialize` is **accepted silently**. On current v1 the shared-instance failure mode is silent cross-talk rather than a loud error — worse than the older throw.

**v2 (2.0.0):** per-request instancing is no longer a pattern to follow, it's the API shape. `createMcpHandler(factory)` takes a factory that **builds a fresh `McpServer` per HTTP request**; the docs are explicit: *"Register tools, resources, and prompts inside the factory, never on a shared instance outside it"* and *"the handler holds nothing between requests."* Mounting on plain `node:http` (our case — no Express in the main process) is `toNodeHandler(handler)` from `@modelcontextprotocol/node`, plus the SDK-provided `localhostHostValidation()` / `localhostOriginValidation()` guards, bound to `127.0.0.1`. Notably for §3.5: **Origin and Host validation ship with the SDK in v2**, so the DNS-rebinding defense doesn't need to be hand-rolled — only the bearer-token check does (v2 deliberately verifies no tokens; you verify in front of the handler and pass `authInfo` through).

### What this means for main-process state

- **Nothing app-level may live on the `McpServer` instance.** It's disposable, one per request. All durable state — bearer token, consent tier, rate-limiter buckets, write journal, the renderer IPC/health-check plumbing — lives at module scope in the Electron main process, and the factory (v2) or per-request `getServer()` (v1) **closes over it**. Per-request tool registration is cheap; it's just definitions.
- The only long-lived objects are the `node:http` server (created on enable, torn down on disable/kill-switch) and, in v2, the handler wrapper.
- There are **no sessions** to key anything on: v1 stateless mode has no session id, and the 2026-07-28 era removed `Mcp-Session-Id` entirely. Rate limiting and idempotency must key on the token / `idempotency_key`, which §5.2 already implies (mapping to `transitionId`).
- `MCP-Protocol-Version` enforcement (§3.5 requirement) is handled inside the SDK transport in both lines (verified at `webStandardStreamableHttp.js:731+` for v1; era negotiation in v2) — Phase 1 must not duplicate it.

**Conclusion:** pin v2. Pinning v1 (1.30.0) means adopting a line whose maintenance window closes mid-project and whose stateless mode fails silently when misused; v2 makes the correct instancing structural and bundles the localhost hardening §3.5 requires. The spec baseline should move to the 2026-07-28 revision.

---

## Item 2 — The Stream Deck token handshake, and whether MCP should reuse it

### How it actually works (`electron/ws-server.ts`, `electron/protocol.ts`)

- **Issuance is server→client, post-connect, per-connection.** On a WebSocket connection with **no Origin header**, the server treats the peer as a native local process, registers it immediately **without any authentication**, generates a 32-byte hex token (`randomBytes(32)`, `ws-server.ts:69`), adds it to an in-memory `validTokens` set, and sends it to that client as a `day:token` frame. The rationale (`protocol.ts:14-18`, `ws-server.ts:64-68`): browsers always send Origin on a WS handshake, so Origin-less ⇒ not a drive-by web page ⇒ trusted.
- **`AUTH_TIMEOUT_MS` (5000ms) applies only to Origin-present connections** — browser contexts, which include both malicious pages and the legitimate Stream Deck property inspector webview. They are trusted on nothing: a timer starts at connect (`ws-server.ts:83`); the first frame must be `day:auth` carrying a valid token; the timer is cleared on that first message; wrong token, malformed frame, or 5 seconds of silence ⇒ `ws.terminate()`. Its purpose is to close the "connect and sit idle to hold a slot" vector.
- **The token's whole job is delegation, not gating.** The Origin-less plugin backend relays its token to the PI over Stream Deck's own IPC (`stream-deck-plugin/src/plugin.ts:38-54`), letting the browser-context PI inherit the native connection's trust. The API itself is open to any Origin-less local process.
- **Storage: memory only, everywhere.** Server side, the `validTokens` set inside the `createWsServer` closure, with the token **revoked when the issuing native client disconnects** (`ws-server.ts:71`). Plugin side, a module variable (`client.ts:87`). Never written to disk, never shown in settings, no rotation — lifetime is the connection's lifetime.

### Assessment: the code makes literal reuse a bad idea

The two mechanisms solve different problems and are incompatible on three axes:

1. **Inverted trust model.** Stream Deck trusts *every* Origin-less local process with zero authentication; its token exists only so a browser-context PI can piggyback. §3.5's threat 1 explicitly wants to stop arbitrary local processes — the population the Stream Deck scheme deliberately admits. Reusing the handshake verbatim would mean any local process reaches the MCP endpoint tokenlessly, nullifying §3.5's own first requirement.
2. **Token lifetime and direction.** Stream Deck: server→client, issued after connect, ephemeral, dies with the socket. MCP needs client→server, **pre-shared before any connection** (discovery file, pasted config), persistent across app restarts, rotatable from settings. None of the existing issuance/revocation code transfers; there is also no existing persistence or rotation code to reuse — that machinery is new either way.
3. **Transport shape.** The 5-second auth window is a stateful-connection concept: one handshake, then a trusted stream. Streamable HTTP is per-request — every request carries `Authorization: Bearer …` and is independently authenticated; there is nothing to time out and no "first frame." `AUTH_TIMEOUT_MS` has no analog.

What genuinely carries over, and is worth carrying for consistency:

- The **Origin posture** — reject browser origins outright, expect Origin-less native clients — with two deltas: MCP answers 403 (HTTP) rather than terminating a socket, and on SDK v2 the `localhostOriginValidation`/`localhostHostValidation` guards implement it as configuration.
- Token **generation** (`randomBytes(32).toString('hex')`).
- The explicit `127.0.0.1` bind and the `EADDRINUSE` posture of `ws-server.ts:30-32` (handle the error, don't crash the app) — though §3.4 correctly demands *louder* surfacing than the WS server's log-line-only behavior.
- `protocol.ts` as a canonical single-definition contract file is a style precedent worth imitating for the MCP surface, not a mechanism to share.

**Conclusion:** §3.5's instinct ("consistency worth more than novelty") is right at the level of idiom and code style, wrong at the level of mechanism. Open question 5 resolves to **parallel scheme, shared idioms**.

---

## Item 3 — MAS container discovery file

### The path, settled from the code

- The MAS build's bundle id is `com.dayglance` (`electron-builder.config.cjs`, `isMasBuild`/`appId` override) and it is fully sandboxed (`com.apple.security.app-sandbox` in `electron/entitlements.mas.plist`).
- `electron/main.ts:37` pins `userData` to `<appData>/dayGLANCE`. Under the App Sandbox, Electron's `appData` (`NSApplicationSupportDirectory`) resolves **inside the container**, and the repo's own code confirms the container-home shape: `electron/icloud.ts:31-33` recovers the real home by stripping `/Library/Containers/<id>/Data` from `app.getPath('home')` under MAS.
- Therefore the discovery file would land at:

  ```
  ~/Library/Containers/com.dayglance/Data/Library/Application Support/dayGLANCE/mcp.json
  ```

Also settled from the sandbox rules: the MAS app **cannot** write it anywhere nicer. Writes outside the container require user-selected file access (§7 already concedes this for the Claude config file), so "just write it to the real `~/Library/Application Support`" is not an option.

### Can an unsandboxed process spawned by another app read it?

- **The App Sandbox itself is not the barrier.** It constrains the sandboxed process, not outside readers. POSIX permissions don't block either: the bridge runs as the same user, and the file's own `0600` is same-user readable.
- **The barrier is TCC "app container protection," introduced in macOS 15 Sequoia** (announced WWDC 2024): a process accessing *another* app's container under `~/Library/Containers` triggers a one-time consent prompt — "*X* would like to access data from other apps" — attributed to the **responsible process**. For a node bridge spawned by Claude Desktop, that's Claude Desktop; the user sees a prompt naming Claude, about dayGLANCE's data, with no context. Deny ⇒ the read fails (EPERM-style) and the denial is sticky per-app in Privacy & Security. There is a same-developer (Team ID) exemption, but it keys off the *requesting* side — Anthropic's team, not GLANCE Apps — so it does not apply here. On macOS 14 and earlier there is no such protection and the read plainly succeeds.
- **Consequence:** MAS container discovery is at best "works after a mis-attributed, alarming prompt," and at worst silently dead after one past denial. That is not a primary path. §3.4's manual configuration (`--port`/`--token`/`DAYGLANCE_MCP_TOKEN`, manual token paste) becomes the **primary** MAS path.

### What could not be settled from here, and exactly what would settle it

The path derivation is code-verified. The TCC behavior is from Apple's documentation of Sequoia's container protection, not from an execution run during this spike — prompt-vs-silent-deny, exact attribution, stickiness across bridge updates, and macOS 26 behavior all need hardware confirmation.

**A signed App Store build is not required.** Container creation and TCC container protection depend on the app being sandboxed, not on App Store distribution. The settling experiment (now §10 Phase 0.5):

1. On macOS 15 or 26: build the existing `mas` target dev-signed (`mas-dev` provisioning, already supported by the repo's config), launch it once so `~/Library/Containers/com.dayglance` exists, and place a test `mcp.json` at the userData path above.
2. Configure Claude Desktop with a stdio entry running a trivial node script that `readFileSync`s that path and logs contents or `errno` — this reproduces the exact responsible-process chain the real bridge would have.
3. Observe: whether a prompt appears, its wording and which app it names, that Allow ⇒ read succeeds, Deny ⇒ the specific error code, and where the toggle lands in System Settings.
4. Re-run the same script from Terminal and from a second GUI app to confirm attribution follows the responsible process.
5. Repeat on macOS 14 to confirm the unprotected baseline.

If the prompt-then-allow flow proves acceptable, container discovery survives as a best-effort optimization; if denial is silent or the prompt is as confusing as expected, the docs should lead MAS users straight to manual token configuration.

---

## Cross-cutting observation

Items 1 and 3 both move risk in the same direction the spec already leans: the SDK landscape post-dates the r2 spec baseline (v2 + the 2026-07-28 revision), and MAS discovery is likely prompt-gated. Neither invalidates the architecture; both sharpen decisions r2 left soft — the §10 pin choice, §3.4's "fallback" becoming primary for MAS, and open question 5 resolving to a parallel scheme.
