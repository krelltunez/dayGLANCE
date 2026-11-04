// GLANCEvault change nudges: the transport-agnostic client for the vault's
// /events stream (moved verbatim from the dayGLANCE app's
// src/sync/vaultEventStream.js, #2280). The app's browser and native-shell
// pieces (transport detection, the bridge-fed client the Android and iOS
// shells feed, the per-device nudge flag, the React hook) stay in the app;
// this is what a Node host shares with it.
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
// CORE INVARIANT: push is an optimization; POLLING IS THE CORRECTNESS BACKSTOP.
// Nothing here ever stops, slows, or references polling. A nudge only ADDS an
// instant drain on top; if any of this throws or the stream drops, polling (a
// separate effect) keeps delivering. Everything is idempotent — a nudge triggers
// the SAME existing drain the poll triggers; the drain re-reads its own cursor
// and no-ops when there is nothing new.
//
// The stream is read with fetch streaming (response.body.getReader()), not
// EventSource: EventSource cannot set an Authorization header, and the vault
// authenticates with a device-token Bearer. Browsers, Electron's renderer and
// Node 20+ (undici) all stream a fetch body this way.

// The frame parsers live in @glance-apps/obsidian-format (bridgeSse.js), the
// one parser for the one wire format, shared with the bridge plugin's client.
import { drainSseBuffer } from '@glance-apps/obsidian-format';

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
 * callback is the seam where routing slots in now that the server tags its
 * activity frames: `kindFilter(kind, evt)` decides, per received nudge, which
 * kinds that nudge wakes; a flush runs a kind if ANY coalesced nudge wanted
 * it. Without a filter every nudge wakes every kind (the pre-tag behavior,
 * and the behavior for an untagged frame under any filter that honors the
 * missing-tag contract). It is invoked inside a try/catch so a throwing
 * drain can never break the debounce timer or the SSE loop.
 *
 * OWN-ECHO DAMPING (#1455): the server stamps each nudge with the WRITING
 * OPERATION'S own resulting seq (glance-vault routes/sync.ts,
 * `emit(accountId, {seq: result.maxSeq})`), so "this nudge is the echo of a
 * write this device made" is decidable by EXACT IDENTITY against the acks
 * our own writers recorded (ownWrites.js) — not by seq comparison,
 * which would swallow a peer write that landed between our pull and our
 * push (the #1450 freshness trap; a peer's nudge carries the PEER's seq,
 * never one of ours, so it always drains). A suppressed echo still
 * advances the cursor — it IS the newest seq we know — it just triggers no
 * drain: a drain caused solely by our own just-acked write has nothing to
 * fetch that the acking cycle didn't already hold, and removing that
 * self-trigger is what takes a delete/resupply war from SSE speed down to
 * poll cadence.
 *
 * @param {object} p
 * @param {(kind:'sync'|'intents') => void} p.onDrain
 * @param {number} [p.debounceMs]     coalesce a micro-burst before draining
 * @param {(kind:string, evt:object) => boolean} [p.kindFilter]  which kinds a nudge wakes (default: all)
 * @param {(seq:number) => boolean} [p.isOwnSeq]  exact-identity own-echo test
 * @param {(seq:number) => void} [p.onOwnEcho]    diagnostic hook for a suppressed echo
 * @param {typeof setTimeout}  [p.setTimeoutFn]
 * @param {typeof clearTimeout}[p.clearTimeoutFn]
 * @param {(msg:string, err:any) => void} [p.onDrainError]
 */
/**
 * The standard kind filter for a tagged frame: each fan-out kind names the
 * server namespace whose writes it reads, and a tagged nudge wakes exactly
 * the kinds whose namespace it names. An untagged frame (an older server,
 * or the seq-only `ready`) wakes every kind — THE MISSING-TAG CONTRACT — and
 * a kind with no namespace entry wakes on every nudge.
 *
 * @param {Record<string, string>} namespaces  kind → server app tag
 */
export function createKindFilter(namespaces) {
  return (kind, evt) => {
    if (typeof evt?.app !== 'string') return true;
    const ns = namespaces?.[kind];
    return typeof ns !== 'string' || evt.app === ns;
  };
}

export function createNudgeCoalescer({
  onDrain,
  debounceMs = 400,
  // Which drains one coalesced nudge fans out to, in order. The default is
  // the original pair; the app wiring adds 'obsidian' (the observation
  // cycle — Phase 7 groundwork) after them, so DB state lands before the
  // Obsidian cycle reads it.
  kinds = ['sync', 'intents'],
  kindFilter = null,
  isOwnSeq,
  onOwnEcho,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  onDrainError,
} = {}) {
  let lastSeq = -Infinity;
  let timer = null;
  // Kinds the coalesced burst has asked for so far (reset on flush).
  let wanted = new Set();

  const runDrain = (kind) => {
    try {
      onDrain?.(kind);
    } catch (err) {
      onDrainError?.(`vault-sse drain (${kind}) failed`, err);
    }
  };

  const flush = () => {
    timer = null;
    const want = wanted;
    wanted = new Set();
    // Deterministic order: sync before intents (before obsidian, when wired).
    for (const kind of kinds) if (want.has(kind)) runDrain(kind);
  };

  // Coalesce a micro-burst of nudges into a single drain (debounce ONLY — no
  // throttle). The self-nudge loop that once needed a 5s throttle is fixed at the
  // root: a sync cycle with no content change no longer pushes anything, so it no
  // longer advances the account seq or nudges (see tombstoneHorizon.js).
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
    if (isOwnSeq?.(evt.seq)) {
      // Our own write's echo (exact ack identity — see the header): cursor
      // advanced, no drain. A pending drain for an earlier PEER nudge keeps
      // its timer; only the self-trigger is removed.
      onOwnEcho?.(evt.seq);
      return false;
    }
    // Which kinds this nudge wakes (the app tag, when present, decides for
    // the kinds that filter on it). A nudge that wakes nothing advances the
    // cursor and neither schedules nor cancels a pending flush.
    let any = false;
    for (const kind of kinds) {
      if (!kindFilter || kindFilter(kind, evt)) { wanted.add(kind); any = true; }
    }
    if (!any) return false;
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
