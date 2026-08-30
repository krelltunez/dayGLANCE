// BRIDGE SSE — the pure half of the plugin's live-sync transport (Phase 7).
//
// THE INVARIANT (the whole credential story rests on this sentence):
// **SSE IS ARMED BY PROOF AND DISARMED BY REFUTATION — the stream opens only
// after a successful authenticated drain, closes on auth failure or a
// vanished pairing, and makes ZERO reconnect attempts in between. A
// de-paired plugin burns nothing.** Between refutation and the next proof,
// the 30-second drain timer is the only thing running — exactly today's
// polling posture — and the first drain that succeeds is what re-arms the
// stream. The observed failure this is built for: Obsidian Sync's
// plugin-settings toggle flipping off (2026-08-31), which silently strips
// the plugin's credentials out of data.json.
//
// This module is deliberately PURE — no sockets, no timers of its own
// (injectable), no Obsidian imports — so every decision the transport makes
// is pinnable: the SSE wire parsers, the arm/disarm state machine, the
// own-ack skip, the debounce/cursor gate, and the backoff schedule. The
// impure remainder (Node https plumbing, connection lifecycle) lives in the
// plugin's bridge.ts as thin wiring. Same split, same reason, as
// normalize-then-observe: plugin-side code has no test infra, so anything
// that must not regress lives here.
//
// The frame parsers are the SAME functions dayGLANCE's vault event stream
// has used since its SSE landed — moved here verbatim so both consumers of
// the one wire format share one parser (dayGLANCE re-exports them from
// src/sync/vaultEventStream.js).

// ─── Wire constants ──────────────────────────────────────────────────────────

export const SSE_BACKOFF_BASE_MS = 5_000;
export const SSE_BACKOFF_MAX_MS = 60_000;
// The server writes a `: heartbeat` comment every ~20s specifically to
// survive idle proxies (glance-vault routes/events.ts). Three missed
// heartbeats = the socket is dead even if TCP never said so (laptop sleep,
// silent network loss on the weeks-open Pi) — the wiring destroys the
// request and takes the reconnect path.
export const SSE_READ_TIMEOUT_MS = 60_000;

/**
 * Reconnect backoff: 5s doubling to a 60s cap — 5, 10, 20, 40, 60, 60, …
 * The wiring resets the failure count on any received frame, so an
 * established stream that later drops starts back at 5s.
 * @param {number} consecutiveFailures  1-based
 */
export function sseBackoffMs(consecutiveFailures) {
  const n = Math.max(1, Math.floor(consecutiveFailures) || 1);
  return Math.min(SSE_BACKOFF_BASE_MS * 2 ** (n - 1), SSE_BACKOFF_MAX_MS);
}

// ─── SSE frame parsing (moved verbatim from dayGLANCE vaultEventStream.js) ──

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

// ─── Arm/disarm state machine ────────────────────────────────────────────────

/**
 * The armed-by-proof / disarmed-by-refutation decision, as a tiny pinned
 * state machine. PROOF is a successful authenticated drain (the 30s tick
 * runs drains regardless, so proof arrives within one tick of credentials
 * working). REFUTATION is an auth failure (401/403 at connect or from a
 * drain) or a vanished pairing. Between refutation and the next proof,
 * shouldConnect is false for every input — the wiring makes no connection
 * or reconnection attempt at all, so a dead credential's total cost is
 * today's one failed drain per tick and an unpaired plugin's cost is zero.
 * Desktop-ness and pairedness are inputs, not state: they are re-read at
 * every decision so a mid-session unpair gates instantly.
 */
export function createSseArming() {
  let proven = false;
  return {
    noteDrainSuccess() { proven = true; },
    noteAuthFailure() { proven = false; },
    noteUnpaired() { proven = false; },
    isProven() { return proven; },
    shouldConnect({ desktop, paired }) {
      return desktop === true && paired === true && proven;
    },
  };
}

// ─── Nudge gate (cursor + own-ack skip + debounce) ───────────────────────────

/**
 * Decide which received nudges become drains. Three layers, each pinned:
 *  • SEQ-MONOTONIC CURSOR — a nudge at or behind the highest seen seq is
 *    stale/coalesced and ignored;
 *  • OWN-ACK SKIP — the plugin's own writes (observation batches, intent-row
 *    soft-deletes) produce nudges too; the server sends one nudge per write
 *    operation carrying that operation's own resulting seq, and both write
 *    paths return it, so exact identity says "this is our echo" with no
 *    heuristic (the same principle as dayGLANCE's ownWrites registry,
 *    miniaturized). Without this, every own write costs one idle drain;
 *    with it, zero.
 *  • DEBOUNCE — a micro-burst of peer nudges collapses into one onDrain.
 *
 * LOOP SAFETY IS BY CONSTRUCTION, NOT ONLY BY THIS SKIP: even a nudge that
 * slips through to drain() cannot sustain a cycle, because the drain's idle
 * path performs no writes — tombstoned rows are CURSOR-MOVEMENT-ONLY (the
 * #1485 rule; if that rule ever changes, THIS ARGUMENT CHANGES WITH IT),
 * own observation rows fail the int: prefix test, and the one write a drain
 * can emit (deleting an already-applied live intent row) tombstones its own
 * cause. The skip is an efficiency layer on top of that argument, not a
 * substitute for it.
 */
export function createSseNudgeGate({
  onDrain,
  debounceMs = 400,
  ackCapacity = 64,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  let lastSeq = -Infinity;
  let timer = null;
  const ackRing = [];
  const ackSet = new Set();

  return {
    /** Record a write ack's seq as our own. Ignores non-numbers. */
    recordOwnSeq(seq) {
      if (typeof seq !== 'number' || !Number.isFinite(seq) || seq <= 0) return;
      if (ackSet.has(seq)) return;
      ackRing.push(seq);
      ackSet.add(seq);
      while (ackRing.length > ackCapacity) ackSet.delete(ackRing.shift());
    },
    /** Feed one nudge. Returns true when a drain was scheduled. */
    handleEvent(evt) {
      if (!evt || typeof evt.seq !== 'number' || Number.isNaN(evt.seq)) return false;
      if (evt.seq <= lastSeq) return false; // stale/coalesced
      lastSeq = evt.seq;
      if (ackSet.has(evt.seq)) return false; // our own write's echo
      if (timer !== null) clearTimeoutFn(timer);
      timer = setTimeoutFn(() => { timer = null; onDrain?.(); }, debounceMs);
      return true;
    },
    cancel() {
      if (timer !== null) { clearTimeoutFn(timer); timer = null; }
    },
    getCursor() { return lastSeq; },
  };
}
