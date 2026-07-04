// GLANCEvault SSE push client (Phase 9, client step 1).
//
// The glance-vault server emits authenticated per-account Server-Sent Events at
// GET {vaultUrl}/events: an initial {seq, kind:'connected'} on connect, then
// {seq, kind:'sync'|'intents'} nudges when the account's seq advances, plus ~25s
// heartbeat comments. A nudge carries ONLY the latest account seq — no payload.
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
//     streaming SSE is structurally impossible. detectSseTransport() reports this
//     and the client does not open — the device degrades cleanly to polling.

// ─── SSE frame parsing ────────────────────────────────────────────────────────

/**
 * Parse ONE SSE event block (the text between blank-line boundaries) into the
 * nudge object {seq, kind}, or null if the block carries no usable data.
 *
 * Ignores comment lines (leading ':', used for heartbeats) and non-data fields
 * (event:, id:, retry:). Concatenates multiple data: lines per the SSE spec, then
 * JSON-parses. Returns null on a heartbeat-only block or unparseable data so the
 * caller can skip it.
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
 *   'native-unsupported' — Android/iOS WebView: buffered synchronous bridge.
 *   'none'               — no window / no streaming fetch (e.g. tests, SSR).
 * Only 'web' opens a stream; every other value degrades cleanly to polling.
 */
export function detectSseTransport() {
  if (typeof window === 'undefined') return 'none';
  // The native WebView bridge (window.DayGlanceNative.httpRequest) is synchronous
  // and returns the whole body as one string — it cannot stream frames.
  if (window.DayGlanceNative?.httpRequest) return 'native-unsupported';
  // Electron is intentionally NOT special-cased here: its renderer fetch streams
  // like any Chromium fetch. The buffering IPC proxy is only for request/response
  // vault/WebDAV/CalDAV calls; SSE uses the direct fetch below (openWebSseStream).
  if (typeof fetch === 'function' && typeof ReadableStream !== 'undefined') return 'web';
  return 'none';
}

// ─── web streaming reader ─────────────────────────────────────────────────────

/**
 * Open the vault /events SSE stream over a fetch streaming body (WEB path) and
 * pump parsed {seq, kind} nudges to onEvent until the stream ends or the signal
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
 * The account seq is a single unified monotonic counter on the server (a sync
 * write and an intent landing both advance it), so ONE cursor across kinds is
 * correct: an event is "behind" (worth acting on) only when its seq exceeds the
 * highest we've already reacted to. A nudge whose seq is <= the cursor is a
 * duplicate/stale signal and is ignored.
 *
 * On acting, we schedule the drain implied by kind: 'sync' -> sync drain,
 * 'intents' -> intents drain, anything else (incl. the 'connected' reconcile) ->
 * BOTH, since we can't tell which side advanced. Rapid nudges within debounceMs
 * coalesce into a single drain per kind.
 *
 * onDrain(kind) is called with 'sync' or 'intents' (never 'both' — 'both' fans
 * out to one 'sync' + one 'intents' call). It is invoked inside a try/catch so a
 * throwing drain can never break the debounce timer or the SSE loop.
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
  let pending = new Set();

  const runDrain = (kind) => {
    try {
      onDrain?.(kind);
    } catch (err) {
      onDrainError?.(`vault-sse drain (${kind}) failed`, err);
    }
  };

  const flush = () => {
    timer = null;
    const kinds = pending;
    pending = new Set();
    // Deterministic order: sync before intents.
    if (kinds.has('sync')) runDrain('sync');
    if (kinds.has('intents')) runDrain('intents');
  };

  // Coalesce a micro-burst of nudges into a single drain (debounce ONLY — no
  // throttle). The self-nudge loop that once needed a 5s throttle is fixed at the
  // root: a sync cycle with no content change no longer pushes anything, so it no
  // longer advances the account seq or nudges (see utils/tombstoneHorizon.js).
  // Drains therefore fire near-instantly on real changes, which is the point of
  // SSE. Polling remains the backstop for any coalesced nudge.
  const schedule = (kind) => {
    if (kind === 'both') { pending.add('sync'); pending.add('intents'); }
    else pending.add(kind);
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
    if (evt.kind === 'sync') schedule('sync');
    else if (evt.kind === 'intents') schedule('intents');
    else schedule('both'); // 'connected' reconcile or unknown kind → drain both
    return true;
  };

  return {
    handleEvent,
    getCursor: () => lastSeq,
    // Flush any pending debounce immediately (used on teardown if desired).
    cancel: () => { if (timer) { clearTimeoutFn(timer); timer = null; } pending = new Set(); },
  };
}

// ─── connection client (reconnect + backoff) ──────────────────────────────────

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
      const delay = Math.min(backoffMaxMs, backoffBaseMs * 2 ** attempt);
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
