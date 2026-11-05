// GLANCEvault SSE push client (Phase 9, client step 1).
//
// WIRE CONTRACT (verified against the glance-vault server source — routes/events.ts
// frame(), realtime/hub.ts Nudge): the server emits authenticated per-account
// named SSE events at GET {vaultUrl}/events:
//   • `event: ready`    — once per successful connection, data {"seq":N}: the
//     account's latest seq (0 for a never-written account); the reconnect
//     reconcile point. Seq-only, no app tag.
//   • `event: activity` — whenever the account seq advances, data
//     {"seq":N,"app":"<tag>"} since the 2026-09-05 server change: sync batch
//     and soft-delete tag their route namespace (e.g. "dayglance",
//     "dayglance-bridge"), intents inserts tag "intents".
// plus comment-line heartbeats (`: ...`) every ~20s. No `id:`, no `retry:`
// (reconnect timing is entirely client-owned; the server never reads
// Last-Event-ID). The seq is the one per-account counter every app draws
// from; the tag says which namespace advanced it. THE MISSING-TAG CONTRACT:
// a frame without `app` (an older server) means "unknown" and is handled
// exactly as before the tag existed — drain everything. Consumers that
// filter on the tag do so only when it is present.
//
// The transport-agnostic client (the fetch-streaming reader openWebSseStream,
// the reconnecting createVaultEventClient, the nudge coalescer, the kind
// filter and the backoff) moved verbatim to @glance-apps/dayglance-vault
// (vaultEvents.js, #2280), so a Node host consumes the stream with the same
// code. What stays here is bound to the browser or the native shells:
// transport detection (window.DayGlanceNative), the bridge-fed client the
// shells feed, and the per-device nudge flag (localStorage). It exists to let
// dayGLANCE drain INSTANTLY on a nudge instead of waiting for the poll, while the
// existing polling stays untouched as the correctness backstop. See
// useVaultEventStream.js for the React lifecycle wrapper and App wiring.
//
// CORE INVARIANT: push is an optimization; POLLING IS THE CORRECTNESS BACKSTOP.
// Nothing here ever stops, slows, or references polling. A nudge only ADDS an
// instant drain on top; if any of this throws or the stream drops, polling (a
// separate effect) keeps delivering. Everything is idempotent — a nudge triggers
// the SAME existing drain the poll triggers; the drain re-reads its own cursor
// and no-ops when there is nothing new.
//
// WEB vs NATIVE vs ELECTRON consumption:
//   • WEB (browser/PWA): EventSource cannot set an Authorization header, and the
//     vault authenticates with a device-token Bearer — so we use a fetch-based
//     streaming reader (response.body.getReader()) that sets the Bearer header.
//     See openWebSseStream (@glance-apps/dayglance-vault).
//   • ELECTRON: the renderer is Chromium and, since it now loads from the custom
//     app://dayglance origin (not file://), its direct fetch() streams
//     text/event-stream natively exactly like the web path — so Electron uses the
//     SAME openWebSseStream (direct fetch), NOT the IPC proxy (which buffers the
//     whole body and cannot stream). The direct fetch presents Origin:
//     app://dayglance to the vault, which must allowlist that exact origin in its
//     CORS config; until it does, the SSE fetch is CORS-rejected and the client
//     falls back to polling (SSE is additive, polling is the backstop).
//   • NATIVE (Android/iOS WebView): the vault HTTP path is the synchronous,
//     fully-BUFFERED bridge (window.DayGlanceNative.httpRequest) — it returns the
//     whole body as one string and cannot deliver incremental frames, so
//     streaming SSE INSIDE THE WEBVIEW is structurally impossible. Instead the
//     NATIVE SHELL opens the /events stream itself (a Kotlin/Swift SSE reader,
//     over a native HTTP client — no browser origin, so NO vault CORS change) and
//     pushes each raw SSE block into the renderer via a bridge callback
//     (window.__glanceVaultSseReceive). The renderer reuses the SAME parseSseFrame
//     + coalescer + drains — only the transport INPUT differs. This is the
//     "bridge-fed" transport (see createBridgeSseClient). A shell that advertises
//     the capability (DayGlanceNative.isVaultSseSupported() === true) reports
//     'native-bridge'; an older shell without it stays 'native-unsupported' and
//     degrades cleanly to polling.
//
// BRIDGE CONTRACT (renderer ↔ native shell), used by the 'native-bridge' path:
//   JS → native (methods on window.DayGlanceNative):
//     • isVaultSseSupported() → boolean   capability probe (detectSseTransport).
//     • startVaultSse(vaultUrl, token, accountId)   "SSE desired ON" + connection
//       params. The native reader owns the socket: it connects when foreground,
//       drops on background, and reconnects with backoff — all transparent to JS.
//     • stopVaultSse()                    "SSE desired OFF" — native tears down.
//   native → JS (native invokes window.__glanceVaultSseReceive(msg), msg an object
//   or JSON string):
//     • {type:'open'}                     a native (re)connection was established.
//     • {type:'frame', block:'<raw SSE event block>'}   one SSE event; the renderer
//       runs it through the EXISTING parseSseFrame → {seq} → coalescer. On a
//       native reconnect the server's `ready` frame (latest account seq) arrives
//       as a frame here, so reconnect-reconcile is automatic (an advanced seq
//       drains everything).
//     • {type:'closed'}                   the native stream dropped (native will
//       reconnect); informational for diagnostics.
//     • {type:'error', message}           a native connect/read error; native owns
//       the retry, so this is informational only.
//   POLLING stays the correctness backstop on native exactly as on web/Electron —
//   bridge-fed nudges only ADD instant drains on top.

// ─── SSE frame parsing ────────────────────────────────────────────────────────
//
// The parsers moved VERBATIM to @glance-apps/obsidian-format (bridgeSse.js)
// when Phase 7 gave the wire format a second consumer — the bridge plugin's
// desktop SSE client. One wire format, one parser; re-exported here so this
// module's API (and its tests, which double as the parser's pins) is
// unchanged.
import { parseSseFrame, drainSseBuffer } from '@glance-apps/obsidian-format';
export { parseSseFrame, drainSseBuffer };

// ─── the SSE nudge gate (2026-08-31 — the tripwire, exercised) ───────────────
//
// Phase 7's post-build assessment set an explicit tripwire on SSE-speed
// syncing: "if a speed-revealed incident shows a NEW CLASS rather than a
// named leftover, disabling SSE is a one-line retreat." The 2026-08-31 night
// produced three wars in succession — the buffer-merge corruption, the
// premature-identity stamp split, and the db-tier retire/tombstone
// oscillation — each a composition of individually-correct rules that only
// trigger cadence turned pathological. The breakers for the third (re-mint
// refusal, delete-propagation latch, polarity reassert) ship in the same
// commission as this gate, UNPROVEN against live traffic. So: dayGLANCE's
// nudge consumption defaults OFF until they are proven, reverting the
// effective cadence to exactly the pre-Phase-7 posture — the 5-minute sync
// poll, the 2-minute intents poll, the plugin's 30-second drain (the
// plugin's own SSE stays: it only speeds the dayGLANCE→Obsidian intent leg,
// and every war cycle has to pass through dayGLANCE's drain, which now runs
// at poll cadence).
//
// The escape hatch is a localStorage flag, not a build: 'on' re-arms a
// device ahead of the default, 'off' pins the gate closed on one device
// after it. The flag is read once per stream open (app load / foreground),
// like the vault-enabled gate beside it.
//
// RE-ARMED FLEET-WIDE (2026-09-07). The sequence the assessment asked for
// ran: a day's soak with the phones on the stream under the polling posture
// (2026-09-05/06), then a supervised single-machine flip on the Mac
// (2026-09-06, the flag set by hand) that surfaced one incident — the lost
// sidebar completion — whose root cause was the phantom re-stamp on a
// stale-copy direct scan (#1551, #1552), not SSE speed: the breakers held,
// and nothing on the nudge path was implicated. The default flips here so a
// phone gets live nudges by installing the build, with no console; 'off'
// remains the per-device retreat, and flipping this constant back remains
// the one-line fleet retreat the tripwire promised.
export const SSE_NUDGES_DEFAULT_ON = true;
export const SSE_NUDGES_FLAG_KEY = 'dayglance-sse-nudges';

/** Should this app session open the SSE stream and act on nudges? */
export function sseNudgesEnabled() {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(SSE_NUDGES_FLAG_KEY) : null;
    if (v === 'on') return true;
    if (v === 'off') return false;
  } catch { /* storage unavailable → default */ }
  return SSE_NUDGES_DEFAULT_ON;
}

// ─── transport detection ──────────────────────────────────────────────────────

/**
 * Which SSE consumption path this runtime supports:
 *   'web'                — fetch streaming with a Bearer header (works). Covers
 *                          browsers/PWA AND Electron: Electron's renderer is
 *                          Chromium loading from app://dayglance, so its direct
 *                          fetch streams text/event-stream just like a browser.
 *   'native-bridge'      — Android/iOS WebView whose native shell advertises a
 *                          native SSE reader (isVaultSseSupported() === true): the
 *                          shell opens the stream and pushes frames in via the
 *                          bridge (see createBridgeSseClient). No vault CORS change.
 *   'native-unsupported' — a native WebView whose shell has the buffered bridge but
 *                          NOT the SSE reader (older build) — degrade to polling.
 *   'none'               — no window / no streaming fetch (e.g. tests, SSR).
 * 'web' and 'native-bridge' open a stream; every other value degrades to polling.
 */
export function detectSseTransport() {
  if (typeof window === 'undefined') return 'none';
  // Native WebView: the vault HTTP path is the synchronous, whole-body bridge
  // (window.DayGlanceNative.httpRequest) — it cannot stream frames. But the native
  // SHELL can, and pushes them in. Use the bridge-fed transport when the shell
  // advertises the capability; otherwise (older shell) fall back to polling.
  const bridge = window.DayGlanceNative;
  if (bridge?.httpRequest) {
    return nativeSseSupported(bridge) ? 'native-bridge' : 'native-unsupported';
  }
  // Electron is intentionally NOT special-cased here: its renderer fetch streams
  // like any Chromium fetch. The buffering IPC proxy is only for request/response
  // vault/WebDAV/CalDAV calls; SSE uses the direct fetch (openWebSseStream).
  if (typeof fetch === 'function' && typeof ReadableStream !== 'undefined') return 'web';
  return 'none';
}

/**
 * True only when the native shell exposes a working native SSE reader. Both
 * shells ship one today (Android VaultSseClient.kt, iOS VaultSseBridge.swift),
 * but the probe stays strict because a bridge's mere method presence proves
 * nothing:
 *   • an OLDER Android shell (bridge present, no startVaultSse) → false → polling;
 *   • the iOS bridge is a Proxy that fabricates EVERY method name — an
 *     unimplemented probe there replies the string "null", not true — so only a
 *     shell whose handler genuinely implements the reader can probe true.
 * Only a literal boolean true (or the string 'true') counts as supported.
 */
function nativeSseSupported(bridge) {
  if (typeof bridge.startVaultSse !== 'function') return false;
  try {
    const v = typeof bridge.isVaultSseSupported === 'function' ? bridge.isVaultSseSupported() : false;
    return v === true || v === 'true';
  } catch {
    return false;
  }
}

// ─── bridge-fed client (native shell owns the socket) ─────────────────────────

/**
 * The renderer half of the 'native-bridge' transport. Unlike createVaultEventClient
 * (which owns a fetch stream + JS-side reconnect/backoff), here the NATIVE SHELL
 * owns the socket and its whole lifecycle: it connects when foreground, drops on
 * background, and reconnects with backoff — all invisible to JS. This client's job
 * is only to (a) tell native "SSE desired on/off" with the connection params, and
 * (b) funnel the raw SSE blocks native pushes back through the SAME parseSseFrame +
 * onEvent (→ coalescer → drain) the web path uses. There is deliberately NO JS
 * reconnect loop here — reconnect belongs to exactly ONE owner per transport, and
 * for native that owner is the shell (see Stage 2). Polling remains the backstop.
 *
 * `receive` is the function the native shell invokes (as window.__glanceVaultSseReceive)
 * — see the BRIDGE CONTRACT at the top of this file for the message shapes.
 *
 * @param {object} p
 * @param {() => ({vaultUrl:string,vaultToken:string,accountId:string}|null)} p.getConnection
 * @param {(c:object) => void} p.startNative  tell the shell to open (given the connection)
 * @param {() => void}         p.stopNative   tell the shell to tear down
 * @param {(evt:object) => void} p.onEvent    parsed {seq} frame → coalescer.handleEvent
 * @param {(state:string, detail?:any) => void} [p.onStateChange]
 * @param {boolean} [p.supported]
 * @param {(block:string, onEvent:(e:object)=>void) => void} [p.parseFrame] injectable (tests)
 */
export function createBridgeSseClient({
  getConnection,
  startNative,
  stopNative,
  onEvent,
  onStateChange,
  supported = true,
} = {}) {
  let running = false;

  // The native shell pushes messages here. Accepts a parsed object OR a JSON
  // string (evaluateJavascript with an object literal delivers an object; a shell
  // that stringifies is handled too). Never throws — a malformed push is ignored
  // so it can't break the bridge.
  const receive = (msg) => {
    if (typeof msg === 'string') {
      try { msg = JSON.parse(msg); } catch { return; }
    }
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'open':
        onStateChange?.('open');
        break;
      case 'frame': {
        // Reuse the EXISTING parser: native did transport + frame boundary
        // detection; {seq} extraction stays in ONE place (parseSseFrame).
        if (typeof msg.block === 'string') {
          const evt = parseSseFrame(msg.block);
          if (evt) onEvent?.(evt);
        }
        break;
      }
      case 'closed':
        onStateChange?.('closed');
        break;
      case 'error':
        // A native error may carry a terminal `code` (e.g. 'auth' for a revoked
        // token, 'insecure' for a refused cleartext URL). Native stops reading and
        // will NOT reconnect on a terminal code, so this surfaces exactly once —
        // pass the code through so the consumer can distinguish it. Non-terminal
        // errors keep the legacy string-detail shape (native owns the retry).
        onStateChange?.('error', msg.code ? { message: msg.message, code: msg.code } : msg.message);
        break;
      default:
        break;
    }
  };

  return {
    receive,
    start() {
      if (!supported || running) return false;
      const connection = getConnection?.();
      if (!connection) return false; // nothing to connect to → polling covers it
      running = true;
      onStateChange?.('connecting');
      try { startNative?.(connection); } catch (err) { onStateChange?.('error', err?.message || String(err)); }
      return true;
    },
    stop() {
      if (!running) return;
      running = false;
      try { stopNative?.(); } catch { /* ignore — teardown must not throw */ }
      onStateChange?.('stopped');
    },
    isRunning: () => running,
    isSupported: () => supported,
  };
}
