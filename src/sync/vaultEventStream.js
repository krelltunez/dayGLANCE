// GLANCEvault SSE push client (Phase 9, client step 1).
//
// WIRE CONTRACT (verified against the glance-vault server source — routes/events.ts
// frame(), realtime/hub.ts Nudge): the server emits authenticated per-account
// named SSE events at GET {vaultUrl}/events whose data is exactly {"seq":N}:
//   • `event: ready`    — once per successful connection, carrying the account's
//     latest seq (0 for a never-written account); the reconnect reconcile point.
//   • `event: activity` — whenever the account seq advances.
// plus comment-line heartbeats (`: ...`) every ~20s. Nothing else is on the wire:
// no kind/scope discriminator, no `id:`, no `retry:` (reconnect timing is entirely
// client-owned; the server never reads Last-Event-ID). A nudge carries ONLY the
// latest account seq — no payload, and no hint of WHAT advanced: sync writes,
// intent landings, and blob bookkeeping all draw from the one per-account counter
// (blob bookkeeping without even emitting), so the only correct response to any
// nudge is to drain everything.
//
// This module is the PURE, transport-level core (no React). It exists to let
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
//     See openWebSseStream.
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

/**
 * Parse ONE SSE event block (the text between blank-line boundaries) into the
 * nudge object {seq}, or null if the block carries no usable data.
 *
 * The event NAME (`ready` | `activity`) is deliberately not surfaced: both carry
 * the same instruction — the account seq advanced past what we knew — so the
 * data line is the whole contract. Ignores comment lines (leading ':', used for
 * heartbeats) and non-data fields (event:, id:, retry: — the server sends only
 * event: and data: today; tolerating the rest is plain SSE-spec hygiene).
 * Concatenates multiple data: lines per the SSE spec, then JSON-parses. Returns
 * null on a heartbeat-only block or unparseable data so the caller can skip it.
 */
export function parseSseFrame(block) {
  if (!block) return null;
  const dataLines = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line || line.startsWith(':')) continue; // blank or comment (heartbeat)
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1); // SSE strips one leading space
    if (field === 'data') dataLines.push(value);
  }
  if (dataLines.length === 0) return null;
  try {
    return JSON.parse(dataLines.join('\n'));
  } catch {
    return null;
  }
}

/**
 * Feed a growing SSE text buffer, emitting each COMPLETE event (delimited by a
 * blank line) via onEvent and returning the unconsumed remainder to carry into
 * the next chunk. Normalizes CRLF/CR to LF first.
 */
export function drainSseBuffer(buffer, onEvent) {
  let buf = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let idx;
  while ((idx = buf.indexOf('\n\n')) !== -1) {
    const block = buf.slice(0, idx);
    buf = buf.slice(idx + 2);
    const evt = parseSseFrame(block);
    if (evt) onEvent(evt);
  }
  return buf;
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
  // vault/WebDAV/CalDAV calls; SSE uses the direct fetch below (openWebSseStream).
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

// ─── web streaming reader ─────────────────────────────────────────────────────

/**
 * Open the vault /events SSE stream over a fetch streaming body (WEB path) and
 * pump parsed {seq} nudges to onEvent until the stream ends or the signal
 * aborts. Authenticates with the same device-token Bearer the other vault calls
 * use and scopes to accountId (query param, mirroring the sync/intents endpoints).
 *
 * Resolves when the server closes the stream (a clean disconnect the caller will
 * reconnect from). Rejects on connect failure / network error / abort — the
 * caller treats both the same way: keep polling, reconnect with backoff.
 *
 * @param {object}   p
 * @param {{vaultUrl:string, vaultToken:string, accountId:string}} p.connection
 * @param {AbortSignal} [p.signal]
 * @param {() => void}  [p.onOpen]   called once the response is confirmed OK
 * @param {(evt:object) => void} p.onEvent
 * @param {typeof fetch} [p.fetchImpl] injectable for tests
 */
export async function openWebSseStream({ connection, signal, onOpen, onEvent, fetchImpl }) {
  const doFetch = fetchImpl || globalThis.fetch;
  const base = connection.vaultUrl.replace(/\/+$/, '');
  const url = `${base}/events?accountId=${encodeURIComponent(connection.accountId)}`;
  const res = await doFetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${connection.vaultToken}`,
      Accept: 'text/event-stream',
    },
    signal,
  });
  if (!res || !res.ok || !res.body) {
    throw new Error(`vault SSE connect failed: ${res ? res.status : 'no response'}`);
  }
  onOpen?.();

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = drainSseBuffer(buffer, onEvent);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
}

// ─── nudge coalescer (seq cursor + debounce) ──────────────────────────────────

/**
 * Turns a stream of nudge events into debounced drain calls, with a seq cursor so
 * stale/duplicate nudges are ignored.
 *
 * The account seq is a single unified monotonic counter on the server — sync
 * writes, intent landings, and blob bookkeeping all advance it — so ONE cursor is
 * correct: an event is "behind" (worth acting on) only when its seq exceeds the
 * highest we've already reacted to. A nudge whose seq is <= the cursor is a
 * duplicate/stale signal and is ignored.
 *
 * Every accepted nudge drains BOTH sides. The wire carries no scope (data is
 * exactly {"seq":N}), and the shared counter means a scope couldn't safely
 * narrow a drain even if one existed — the client can never tell which side
 * advanced, and blob bookkeeping advances the seq while emitting nothing at all.
 * Rapid nudges within debounceMs coalesce into a single drain pair.
 *
 * onDrain(kind) is called with 'sync' then 'intents' on each flush. The split
 * callback is kept deliberately: it is the ONE seam where routing would slot in
 * if a future server ever scoped its nudges — no such protocol exists or is
 * planned today. It is invoked inside a try/catch so a throwing drain can never
 * break the debounce timer or the SSE loop.
 *
 * @param {object} p
 * @param {(kind:'sync'|'intents') => void} p.onDrain
 * @param {number} [p.debounceMs]     coalesce a micro-burst before draining
 * @param {typeof setTimeout}  [p.setTimeoutFn]
 * @param {typeof clearTimeout}[p.clearTimeoutFn]
 * @param {(msg:string, err:any) => void} [p.onDrainError]
 */
export function createNudgeCoalescer({
  onDrain,
  debounceMs = 400,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  onDrainError,
} = {}) {
  let lastSeq = -Infinity;
  let timer = null;

  const runDrain = (kind) => {
    try {
      onDrain?.(kind);
    } catch (err) {
      onDrainError?.(`vault-sse drain (${kind}) failed`, err);
    }
  };

  const flush = () => {
    timer = null;
    // Deterministic order: sync before intents.
    runDrain('sync');
    runDrain('intents');
  };

  // Coalesce a micro-burst of nudges into a single drain (debounce ONLY — no
  // throttle). The self-nudge loop that once needed a 5s throttle is fixed at the
  // root: a sync cycle with no content change no longer pushes anything, so it no
  // longer advances the account seq or nudges (see utils/tombstoneHorizon.js).
  // Drains therefore fire near-instantly on real changes, which is the point of
  // SSE. Polling remains the backstop for any coalesced nudge.
  const schedule = () => {
    if (timer) clearTimeoutFn(timer);
    timer = setTimeoutFn(flush, debounceMs);
  };

  /**
   * Feed one nudge event. Returns true if it was acted on (seq advanced), false
   * if ignored (not behind / malformed).
   */
  const handleEvent = (evt) => {
    if (!evt || typeof evt.seq !== 'number' || Number.isNaN(evt.seq)) return false;
    if (evt.seq <= lastSeq) return false; // not behind — coalesced/stale, ignore
    lastSeq = evt.seq;
    schedule();
    return true;
  };

  return {
    handleEvent,
    getCursor: () => lastSeq,
    // Cancel any pending debounce (used on teardown).
    cancel: () => { if (timer) { clearTimeoutFn(timer); timer = null; } },
  };
}

// ─── connection client (reconnect + backoff) ──────────────────────────────────

/**
 * Reconnect delay for `attempt` (0-based): capped exponential with EQUAL
 * JITTER. The exponential's lower half is kept as a floor that still grows
 * with the attempt count — the politeness the flap guard (minStableMs)
 * exists to protect — and the upper half is spread uniformly, so the many
 * clients (or tabs behind one IP) dropped by a single vault restart
 * reconnect scattered instead of in aligned 1s/2s/4s… waves against the
 * vault's per-IP rate limiter. Full jitter (random(0, delay)) would
 * decorrelate harder but can retry almost immediately after a failure,
 * which undoes the backoff's purpose. The cap applies to the exponential
 * BEFORE jitter, so every sample is < maxMs and ≥ baseMs/2 (never zero).
 *
 * Mirrored by SseBackoff.nextDelayMs
 * (dayglance-android/.../sse/SseBackoff.kt) — change both together.
 *
 * @param {{attempt:number, baseMs:number, maxMs:number, random:() => number}} p
 */
export function backoffDelayMs({ attempt, baseMs, maxMs, random }) {
  const exp = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.floor(exp / 2 + random() * (exp / 2));
}

/**
 * Manages the SSE connection lifecycle: connect, pump events through onEvent,
 * and on any drop reconnect with capped exponential backoff. It NEVER touches
 * polling — polling is a separate effect and remains the backstop for every gap
 * this client leaves (backoff waits, background, permanent failure).
 *
 * start() opens the stream (no-op when unsupported or no connection). stop()
 * aborts the current stream and cancels any pending reconnect. Both are
 * idempotent and safe to interleave (e.g. visibility toggles).
 *
 * @param {object} p
 * @param {() => ({vaultUrl:string,vaultToken:string,accountId:string}|null)} p.getConnection
 * @param {(args:{connection:object,signal:AbortSignal,onOpen:()=>void,onEvent:(e:object)=>void}) => Promise<void>} p.openStream
 * @param {(evt:object) => void} p.onEvent
 * @param {boolean} [p.supported]      false → never opens (native/electron/none)
 * @param {number}  [p.backoffBaseMs]
 * @param {number}  [p.backoffMaxMs]
 * @param {number}  [p.minStableMs]    connection must stay open ≥ this to reset backoff
 * @param {typeof setTimeout}  [p.setTimeoutFn]
 * @param {typeof clearTimeout}[p.clearTimeoutFn]
 * @param {() => number} [p.now]       clock (injectable for tests)
 * @param {() => number} [p.randomFn]  uniform [0,1) source for the backoff
 *                                     jitter (injectable so tests stay deterministic)
 * @param {(state:string, detail?:any) => void} [p.onStateChange]
 */
export function createVaultEventClient({
  getConnection,
  openStream,
  onEvent,
  supported = true,
  backoffBaseMs = 1000,
  backoffMaxMs = 30000,
  minStableMs = 5000,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  now = () => Date.now(),
  randomFn = Math.random,
  onStateChange,
} = {}) {
  let stopped = true;
  let looping = false;
  let attempt = 0;
  let abortController = null;
  let reconnectTimer = null;

  const makeAbort = () => (typeof AbortController !== 'undefined' ? new AbortController() : { signal: undefined, abort() {} });

  const loop = async () => {
    if (looping) return;
    looping = true;
    while (!stopped) {
      const connection = supported ? getConnection?.() : null;
      if (!connection) break; // nothing to connect to → let polling cover it
      abortController = makeAbort();
      onStateChange?.('connecting');
      const startedAt = now();
      try {
        await openStream({
          connection,
          signal: abortController.signal,
          // NOTE: do NOT reset the backoff here. A connection that OPENS then drops
          // immediately (server closes fast, proxy timeout, CORS-accepted-then-reset)
          // would otherwise reset attempt→0 every cycle and reconnect every
          // backoffBaseMs (~1s) forever — a reconnect STORM that also re-fires the
          // connected-seq reconcile drain, flickering sync and re-rendering the app.
          // Backoff is reset below only after a connection proves STABLE (open long
          // enough). See minStableMs.
          onOpen: () => onStateChange?.('open'),
          onEvent,
        });
        // Stream ended cleanly (server closed / heartbeat gap) — reconnect soon.
        onStateChange?.('closed');
      } catch (err) {
        // Connect/network/abort error — SSE is additive, so we swallow it and
        // reconnect. Polling keeps delivering in the meantime.
        if (!stopped) onStateChange?.('error', err);
      }
      if (stopped) break;
      // Reset backoff ONLY for a connection that stayed open long enough to be
      // healthy; a flapping open/close keeps backing off (up to backoffMaxMs) so a
      // broken endpoint can't storm.
      if (now() - startedAt >= minStableMs) attempt = 0;
      const delay = backoffDelayMs({
        attempt, baseMs: backoffBaseMs, maxMs: backoffMaxMs, random: randomFn,
      });
      attempt += 1;
      await new Promise((resolve) => { reconnectTimer = setTimeoutFn(resolve, delay); });
      reconnectTimer = null;
    }
    looping = false;
  };

  return {
    start() {
      if (!supported) { onStateChange?.('unsupported'); return; }
      stopped = false;
      if (!looping) { attempt = 0; loop(); }
    },
    stop() {
      stopped = true;
      if (abortController) { try { abortController.abort(); } catch { /* ignore */ } abortController = null; }
      if (reconnectTimer) { clearTimeoutFn(reconnectTimer); reconnectTimer = null; }
      onStateChange?.('stopped');
    },
    isRunning: () => !stopped,
    isSupported: () => supported,
  };
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
