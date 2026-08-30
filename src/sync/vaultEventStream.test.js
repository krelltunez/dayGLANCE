import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseSseFrame,
  drainSseBuffer,
  detectSseTransport,
  openWebSseStream,
  createNudgeCoalescer,
  createVaultEventClient,
  createBridgeSseClient,
  backoffDelayMs,
} from './vaultEventStream.js';

// ─────────────────────────────────────────────────────────────────────────────
// GLANCEvault SSE push client — pure transport core.
//
// CORE INVARIANT under test: push is additive; polling is the correctness
// backstop. These tests exercise the parser, the seq-cursor coalescer, and the
// reconnect client with everything injected (no network, no DOM, fake timers).
//
// What is FAKED vs on-device:
//   • FAKED here: the SSE byte stream (openStream is injected), the drain
//     callbacks (spies standing in for the real dbSyncCycle / drainDbIntents),
//     and timers. This proves the seq/debounce/reconnect/reconcile LOGIC.
//   • ON-DEVICE (not covered here): the real fetch streaming body on web
//     (response.body.getReader) and the fact that the native/electron buffered
//     bridge cannot stream — detectSseTransport() encodes that decision and is
//     unit-tested below by faking window.
// ─────────────────────────────────────────────────────────────────────────────

// Frame-level tests use the server's REAL wire blocks: named events `ready`
// (once per successful connection) and `activity` (seq advanced), data exactly
// {"seq":N}, comment-line heartbeats. There is no kind/scope field on the wire.
describe('parseSseFrame', () => {
  it('parses a real ready frame — the event name is ignored, data is the contract', () => {
    expect(parseSseFrame('event: ready\ndata: {"seq":3}')).toEqual({ seq: 3 });
  });

  it('parses a real activity frame', () => {
    expect(parseSseFrame('event: activity\ndata: {"seq":7}')).toEqual({ seq: 7 });
  });

  it('ignores heartbeat/comment lines (leading colon) → null', () => {
    expect(parseSseFrame(': heartbeat')).toBeNull();
  });

  it('tolerates id:/retry: fields the server never sends today (SSE-spec hygiene)', () => {
    const block = 'event: activity\nid: 9\nretry: 3000\ndata: {"seq":9}';
    expect(parseSseFrame(block)).toEqual({ seq: 9 });
  });

  it('concatenates multiple data: lines before JSON.parse', () => {
    expect(parseSseFrame('data: {"seq":\ndata: 3}')).toEqual({ seq: 3 });
  });

  it('returns null for a block with no data', () => {
    expect(parseSseFrame('event: ready')).toBeNull();
  });

  it('returns null for unparseable data', () => {
    expect(parseSseFrame('data: not-json')).toBeNull();
  });
});

describe('drainSseBuffer', () => {
  it('emits complete frames and returns the partial remainder', () => {
    const events = [];
    const rest = drainSseBuffer(
      'event: ready\ndata: {"seq":1}\n\nevent: activity\ndata: {"seq":2}\n\nevent: activity\ndata: {"seq":3',
      (e) => events.push(e),
    );
    expect(events).toEqual([{ seq: 1 }, { seq: 2 }]);
    expect(rest).toBe('event: activity\ndata: {"seq":3'); // partial frame carried forward
  });

  it('normalizes CRLF frame boundaries', () => {
    const events = [];
    drainSseBuffer('event: activity\r\ndata: {"seq":7}\r\n\r\n', (e) => events.push(e));
    expect(events).toEqual([{ seq: 7 }]);
  });

  it('skips heartbeat frames', () => {
    const events = [];
    const rest = drainSseBuffer(': heartbeat\n\nevent: activity\ndata: {"seq":4}\n\n', (e) => events.push(e));
    expect(events).toEqual([{ seq: 4 }]);
    expect(rest).toBe('');
  });
});

describe('detectSseTransport', () => {
  const orig = { window: global.window };
  afterEach(() => { global.window = orig.window; });

  it('returns web when fetch + ReadableStream exist and no native/electron bridge', () => {
    global.window = { fetch: () => {}, ReadableStream: function () {} };
    // fetch/ReadableStream are read off globalThis, not window — emulate presence.
    global.fetch = () => {};
    global.ReadableStream = global.ReadableStream || function () {};
    expect(detectSseTransport()).toBe('web');
  });

  it('returns native-unsupported when the native bridge lacks the SSE reader (older shell)', () => {
    // Bridge present (httpRequest) but no startVaultSse / capability → polling.
    global.window = { DayGlanceNative: { httpRequest: () => {} } };
    expect(detectSseTransport()).toBe('native-unsupported');
  });

  it('returns native-bridge when the shell advertises a native SSE reader', () => {
    global.window = {
      DayGlanceNative: {
        httpRequest: () => {},
        startVaultSse: () => {},
        stopVaultSse: () => {},
        isVaultSseSupported: () => true,
      },
    };
    expect(detectSseTransport()).toBe('native-bridge');
  });

  it('stays native-unsupported when the shell fabricates methods but the probe is not true (iOS Proxy)', () => {
    // Mirrors the iOS Proxy bridge PATTERN: every method name resolves to a
    // function, so mere presence proves nothing. An unimplemented capability
    // probe replies the string "null" — not true — so a shell without a real
    // reader (an older build, or a stub) stays on polling.
    global.window = {
      DayGlanceNative: new Proxy({ httpRequest: () => {} }, {
        get(target, prop) {
          if (prop in target) return target[prop];
          return () => 'null';
        },
      }),
    };
    expect(detectSseTransport()).toBe('native-unsupported');
  });

  it('returns web on Electron — Chromium renderer on app:// streams via direct fetch (no proxy)', () => {
    global.window = { electronAPI: { isElectron: true } };
    global.fetch = global.fetch || (() => {});
    global.ReadableStream = global.ReadableStream || function () {};
    // Electron is deliberately NOT short-circuited: it uses the same direct
    // streaming fetch as web, so SSE push works on the desktop app.
    expect(detectSseTransport()).toBe('web');
  });
});

describe('createNudgeCoalescer — seq cursor + debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('drains on a seq-ahead nudge and IGNORES one that is not behind', () => {
    const onDrain = vi.fn();
    const c = createNudgeCoalescer({ onDrain, debounceMs: 100 });

    expect(c.handleEvent({ seq: 5 })).toBe(true); // ahead → act
    expect(c.handleEvent({ seq: 5 })).toBe(false); // equal → ignore
    expect(c.handleEvent({ seq: 4 })).toBe(false); // behind → ignore

    vi.advanceTimersByTime(100);
    // The wire carries no scope, and the shared account counter means none could
    // safely narrow a drain → every accepted nudge drains BOTH sides.
    expect(onDrain.mock.calls.map((a) => a[0])).toEqual(['sync', 'intents']);
  });

  it('coalesces a rapid burst of nudges into a single drain pair', () => {
    const onDrain = vi.fn();
    const c = createNudgeCoalescer({ onDrain, debounceMs: 100 });

    c.handleEvent({ seq: 1 });
    c.handleEvent({ seq: 2 });
    c.handleEvent({ seq: 3 });
    vi.advanceTimersByTime(50); // still within debounce
    c.handleEvent({ seq: 4 });
    vi.advanceTimersByTime(100);

    expect(onDrain).toHaveBeenCalledTimes(2); // ONE sync + ONE intents for the whole burst
    expect(c.getCursor()).toBe(4);
  });

  it('NO THROTTLE: a real nudge drains after the light debounce (near-instant, not capped at 5s)', () => {
    const onDrain = vi.fn();
    const c = createNudgeCoalescer({ onDrain, debounceMs: 400 });

    c.handleEvent({ seq: 1 });
    vi.advanceTimersByTime(400);
    expect(onDrain).toHaveBeenCalledTimes(2); // fired at the debounce, no 5s throttle

    // A second real change a moment later drains again promptly — not withheld for
    // any multi-second throttle window.
    c.handleEvent({ seq: 2 });
    vi.advanceTimersByTime(400);
    expect(onDrain).toHaveBeenCalledTimes(4);
  });

  it('drains sync BEFORE intents on every flush (deterministic order)', () => {
    const onDrain = vi.fn();
    const c = createNudgeCoalescer({ onDrain, debounceMs: 100 });
    c.handleEvent({ seq: 10 });
    vi.advanceTimersByTime(100);
    expect(onDrain.mock.calls.map((a) => a[0])).toEqual(['sync', 'intents']);
  });

  it('the kinds option adds the obsidian drain AFTER sync and intents (Phase 7 groundwork) — one drain each per flush, own echoes suppress ALL of them', () => {
    const onDrain = vi.fn();
    const c = createNudgeCoalescer({
      onDrain, debounceMs: 100,
      kinds: ['sync', 'intents', 'obsidian'],
      isOwnSeq: (seq) => seq === 7,
    });
    c.handleEvent({ seq: 5 });
    vi.advanceTimersByTime(100);
    // Ordering matters: DB state lands before the Obsidian cycle reads it.
    expect(onDrain.mock.calls.map((a) => a[0])).toEqual(['sync', 'intents', 'obsidian']);

    // An own-write echo (our stamp intent's ack seq) wakes NOTHING — the
    // obsidian drain included; exactly the same damping the DB drains have.
    onDrain.mockClear();
    c.handleEvent({ seq: 7 });
    vi.advanceTimersByTime(200);
    expect(onDrain).not.toHaveBeenCalled();
  });

  it('the ready reconcile frame is just a nudge — an advanced seq drains both sides', () => {
    const onDrain = vi.fn();
    const c = createNudgeCoalescer({ onDrain, debounceMs: 100 });
    c.handleEvent({ seq: 20 }); // ready delivers {"seq":N} like any activity frame
    vi.advanceTimersByTime(100);
    expect(onDrain.mock.calls.map((a) => a[0])).toEqual(['sync', 'intents']);
  });

  it('a throwing drain does not break the coalescer (invariant: SSE is additive)', () => {
    const onDrain = vi.fn(() => { throw new Error('boom'); });
    const onDrainError = vi.fn();
    const c = createNudgeCoalescer({ onDrain, onDrainError, debounceMs: 50 });
    c.handleEvent({ seq: 1 });
    expect(() => vi.advanceTimersByTime(50)).not.toThrow();
    expect(onDrainError).toHaveBeenCalledTimes(2); // both throwing drains surfaced
    // A later nudge still acts — the coalescer self-heals.
    c.handleEvent({ seq: 2 });
    vi.advanceTimersByTime(50);
    expect(onDrain).toHaveBeenCalledTimes(4);
  });
});

// ─── reconnect client ─────────────────────────────────────────────────────────

// A controllable fake stream: resolves/rejects on command and exposes hooks to
// push events / simulate the server closing the connection.
function makeControllableStream() {
  const calls = [];
  let current = null;
  const openStream = ({ connection, signal, onOpen, onEvent }) =>
    new Promise((resolve, reject) => {
      const handle = { connection, signal, onOpen, onEvent, resolve, reject };
      calls.push(handle);
      current = handle;
      onOpen?.(); // confirm connection open (resets backoff)
    });
  return {
    openStream,
    calls,
    push: (evt) => current?.onEvent(evt),
    close: () => current?.resolve(),   // server closed the stream cleanly
    fail: (err) => current?.reject(err || new Error('network')),
  };
}

describe('createVaultEventClient — lifecycle, reconnect, reconcile', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does NOT open when unsupported (native/electron) — degrades to polling', () => {
    const s = makeControllableStream();
    const client = createVaultEventClient({
      supported: false,
      getConnection: () => ({ vaultUrl: 'u', vaultToken: 't', accountId: 'a' }),
      openStream: s.openStream,
      onEvent: () => {},
    });
    client.start();
    expect(s.calls).toHaveLength(0); // never opened → polling is the only path
    expect(client.isRunning()).toBe(false);
  });

  it('does NOT open when there is no vault connection (vault disabled)', () => {
    const s = makeControllableStream();
    const client = createVaultEventClient({
      supported: true,
      getConnection: () => null, // vault disabled / not configured
      openStream: s.openStream,
      onEvent: () => {},
    });
    client.start();
    expect(s.calls).toHaveLength(0);
  });

  it('opens once when supported and connected, forwarding nudges to onEvent', async () => {
    const s = makeControllableStream();
    const events = [];
    const client = createVaultEventClient({
      supported: true,
      getConnection: () => ({ vaultUrl: 'https://v', vaultToken: 't', accountId: 'a' }),
      openStream: s.openStream,
      onEvent: (e) => events.push(e),
    });
    client.start();
    expect(s.calls).toHaveLength(1);
    s.push({ seq: 1 });
    expect(events).toEqual([{ seq: 1 }]);
    client.stop();
  });

  it('reconnects with backoff after a drop and RECONCILES via the connected seq', async () => {
    const s = makeControllableStream();
    // Drive the coalescer through the client so we observe the real reconcile path.
    const onDrain = vi.fn();
    const coalescer = createNudgeCoalescer({ onDrain, debounceMs: 10 });
    const client = createVaultEventClient({
      supported: true,
      getConnection: () => ({ vaultUrl: 'https://v', vaultToken: 't', accountId: 'a' }),
      openStream: s.openStream,
      onEvent: coalescer.handleEvent,
      backoffBaseMs: 1000,
      backoffMaxMs: 30000,
      // Equal jitter's upper edge recovers the pre-jitter ladder, keeping
      // this test's exact timer arithmetic (and its comments) true.
      randomFn: () => 1,
    });

    client.start();
    // First connect: the server's `ready` frame reports account seq 5 →
    // reconcile drains both.
    s.calls[0].onEvent({ seq: 5 });
    vi.advanceTimersByTime(10);
    expect(onDrain).toHaveBeenCalledTimes(2); // sync + intents
    onDrain.mockClear();

    // Connection drops.
    s.fail(new Error('network gone'));
    await Promise.resolve(); await Promise.resolve();

    // While disconnected the account advanced to 7 (a change we missed). Backoff
    // elapses and the client reconnects.
    vi.advanceTimersByTime(1000);
    await Promise.resolve(); await Promise.resolve();
    expect(s.calls.length).toBeGreaterThanOrEqual(2);
    const reconnected = s.calls[s.calls.length - 1];
    reconnected.onEvent({ seq: 7 }); // fresh ready seq catches the missed change
    vi.advanceTimersByTime(10);
    expect(onDrain).toHaveBeenCalledTimes(2); // reconcile drain on reconnect

    client.stop();
  });

  it('FLAP GUARD: a connection that opens then drops fast does NOT reset backoff (no 1s reconnect storm)', async () => {
    const s = makeControllableStream();
    const client = createVaultEventClient({
      supported: true,
      getConnection: () => ({ vaultUrl: 'https://v', vaultToken: 't', accountId: 'a' }),
      openStream: s.openStream,
      onEvent: () => {},
      backoffBaseMs: 1000,
      backoffMaxMs: 60000,
      minStableMs: 5000,
      randomFn: () => 1, // upper edge = pre-jitter ladder; see jitter tests below
    });
    client.start();
    expect(s.calls).toHaveLength(1);

    // Open→close instantly (duration 0 < minStableMs): backoff must GROW, not reset.
    s.close();                                   // attempt 0 → delay 1000, attempt→1
    await Promise.resolve(); await Promise.resolve();
    vi.advanceTimersByTime(1000);
    await Promise.resolve(); await Promise.resolve();
    expect(s.calls).toHaveLength(2);             // reconnected after 1s

    s.close();                                   // still flapping → delay 2000, attempt→2
    await Promise.resolve(); await Promise.resolve();
    vi.advanceTimersByTime(1000);                // only 1s of the 2s elapsed
    await Promise.resolve(); await Promise.resolve();
    expect(s.calls).toHaveLength(2);             // NOT yet — backoff grew to 2s (no storm)
    vi.advanceTimersByTime(1000);
    await Promise.resolve(); await Promise.resolve();
    expect(s.calls).toHaveLength(3);             // reconnects only after the full 2s

    client.stop();
  });

  it('a STABLE connection (open past minStableMs) resets backoff so a later drop reconnects fast', async () => {
    const s = makeControllableStream();
    const client = createVaultEventClient({
      supported: true,
      getConnection: () => ({ vaultUrl: 'https://v', vaultToken: 't', accountId: 'a' }),
      openStream: s.openStream,
      onEvent: () => {},
      backoffBaseMs: 1000,
      minStableMs: 5000,
      randomFn: () => 1, // upper edge = pre-jitter ladder
    });
    client.start();
    vi.advanceTimersByTime(5000);                // healthy: stayed open 5s
    s.close();                                   // duration ≥ minStableMs → attempt resets to 0
    await Promise.resolve(); await Promise.resolve();
    vi.advanceTimersByTime(1000);                // so it reconnects after just 1s
    await Promise.resolve(); await Promise.resolve();
    expect(s.calls).toHaveLength(2);
    client.stop();
  });

  it('a stream error does NOT throw and does NOT stop the client from recovering', async () => {
    const s = makeControllableStream();
    const client = createVaultEventClient({
      supported: true,
      getConnection: () => ({ vaultUrl: 'https://v', vaultToken: 't', accountId: 'a' }),
      openStream: s.openStream,
      onEvent: () => {},
      backoffBaseMs: 500,
    });
    client.start();
    expect(() => s.fail(new Error('boom'))).not.toThrow();
    await Promise.resolve(); await Promise.resolve();
    // It schedules a reconnect rather than dying.
    vi.advanceTimersByTime(500);
    await Promise.resolve(); await Promise.resolve();
    expect(s.calls.length).toBeGreaterThanOrEqual(2);
    client.stop();
    expect(client.isRunning()).toBe(false);
  });

  it('BACKSTOP: while SSE is permanently down, an independent poll still drains', async () => {
    // The poll cadence is a SEPARATE effect the client never references. Model it
    // as its own timer-driven drain and prove SSE churn cannot stop it.
    const drain = vi.fn();
    let pollTimer = null;
    const schedulePoll = () => { pollTimer = setTimeout(() => { drain('poll'); schedulePoll(); }, 1000); };
    schedulePoll();

    const s = {
      openStream: () => Promise.reject(new Error('SSE unreachable')), // never connects
    };
    const client = createVaultEventClient({
      supported: true,
      getConnection: () => ({ vaultUrl: 'https://v', vaultToken: 't', accountId: 'a' }),
      openStream: s.openStream,
      onEvent: () => {},
      backoffBaseMs: 1000,
    });
    client.start();

    // Let time pass: SSE keeps failing + backing off, poll keeps delivering.
    for (let n = 0; n < 5; n++) {
      vi.advanceTimersByTime(1000);
      await Promise.resolve(); await Promise.resolve();
    }
    expect(drain).toHaveBeenCalled(); // polling delivered despite SSE being down
    expect(drain.mock.calls.every((c) => c[0] === 'poll')).toBe(true);

    clearTimeout(pollTimer);
    client.stop();
  });

  it('stop() aborts the current stream and prevents further reconnects', async () => {
    const s = makeControllableStream();
    const client = createVaultEventClient({
      supported: true,
      getConnection: () => ({ vaultUrl: 'https://v', vaultToken: 't', accountId: 'a' }),
      openStream: s.openStream,
      onEvent: () => {},
      backoffBaseMs: 500,
    });
    client.start();
    const openedBefore = s.calls.length;
    client.stop();
    s.fail(new Error('drop after stop'));
    await Promise.resolve(); await Promise.resolve();
    vi.advanceTimersByTime(10000);
    await Promise.resolve(); await Promise.resolve();
    expect(s.calls.length).toBe(openedBefore); // no reconnect after stop
  });
});

// ─── web streaming reader ─────────────────────────────────────────────────────

describe('openWebSseStream — web fetch-stream path', () => {
  it('sets the Bearer header + accountId, and pumps parsed frames', async () => {
    const chunks = [
      'event: ready\ndata: {"seq":1}\n\n',
      ': heartbeat\n\n',
      'event: activity\ndata: {"seq":2}\n\n',
    ];
    let i = 0;
    const reader = {
      read: async () => (i < chunks.length
        ? { done: false, value: new TextEncoder().encode(chunks[i++]) }
        : { done: true, value: undefined }),
      releaseLock: () => {},
    };
    let capturedUrl, capturedInit;
    const fetchImpl = async (url, init) => {
      capturedUrl = url; capturedInit = init;
      return { ok: true, status: 200, body: { getReader: () => reader } };
    };
    const events = [];
    const onOpen = vi.fn();
    await openWebSseStream({
      connection: { vaultUrl: 'https://vault.example.com/', vaultToken: 'tok-9', accountId: 'acct-42' },
      onOpen,
      onEvent: (e) => events.push(e),
      fetchImpl,
    });

    expect(capturedUrl).toBe('https://vault.example.com/events?accountId=acct-42');
    expect(capturedInit.headers.Authorization).toBe('Bearer tok-9');
    expect(capturedInit.headers.Accept).toBe('text/event-stream');
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(events).toEqual([{ seq: 1 }, { seq: 2 }]);
  });

  it('throws on a non-OK response so the client reconnects (never a silent hang)', async () => {
    const fetchImpl = async () => ({ ok: false, status: 401, body: null });
    await expect(openWebSseStream({
      connection: { vaultUrl: 'https://v', vaultToken: 't', accountId: 'a' },
      onEvent: () => {},
      fetchImpl,
    })).rejects.toThrow();
  });
});

// ─── bridge-fed client (native shell owns the socket) ─────────────────────────

describe('createBridgeSseClient — native bridge-fed transport', () => {
  const conn = { vaultUrl: 'https://v', vaultToken: 't', accountId: 'a' };

  it('start() hands the connection to native; stop() tears native down', () => {
    const startNative = vi.fn();
    const stopNative = vi.fn();
    const client = createBridgeSseClient({
      getConnection: () => conn, startNative, stopNative, onEvent: () => {},
    });

    expect(client.start()).toBe(true);
    expect(startNative).toHaveBeenCalledWith(conn);
    expect(client.isRunning()).toBe(true);
    // Idempotent: a second start does not re-open.
    expect(client.start()).toBe(false);
    expect(startNative).toHaveBeenCalledTimes(1);

    client.stop();
    expect(stopNative).toHaveBeenCalledTimes(1);
    expect(client.isRunning()).toBe(false);
  });

  it('does not start when there is no connection (nothing to connect to)', () => {
    const startNative = vi.fn();
    const client = createBridgeSseClient({
      getConnection: () => null, startNative, stopNative: () => {}, onEvent: () => {},
    });
    expect(client.start()).toBe(false);
    expect(startNative).not.toHaveBeenCalled();
    expect(client.isRunning()).toBe(false);
  });

  it('a pushed {type:frame,block} is parsed by the SHARED parseSseFrame and reaches onEvent', () => {
    const events = [];
    const client = createBridgeSseClient({
      getConnection: () => conn, startNative: () => {}, stopNative: () => {},
      onEvent: (e) => events.push(e),
    });
    // native pushes a raw SSE block (its transport did frame-boundary detection).
    client.receive({ type: 'frame', block: 'event: activity\ndata: {"seq":11}' });
    // heartbeat/comment block → parseSseFrame returns null → ignored.
    client.receive({ type: 'frame', block: ': heartbeat' });
    client.receive({ type: 'frame', block: 'event: activity\ndata: {"seq":12}' });
    expect(events).toEqual([{ seq: 11 }, { seq: 12 }]);
  });

  it('END-TO-END: a pushed frame drives the EXISTING coalescer → drain (reconnect-reconcile too)', () => {
    vi.useFakeTimers();
    const onDrain = vi.fn();
    const coalescer = createNudgeCoalescer({ onDrain, debounceMs: 10 });
    const client = createBridgeSseClient({
      getConnection: () => conn, startNative: () => {}, stopNative: () => {},
      onEvent: coalescer.handleEvent,
    });
    client.start();

    // A real change nudged in from native → both drains (nudges carry no scope).
    client.receive({ type: 'frame', block: 'event: activity\ndata: {"seq":1}' });
    vi.advanceTimersByTime(10);
    expect(onDrain.mock.calls.map((a) => a[0])).toEqual(['sync', 'intents']);
    onDrain.mockClear();

    // Native reconnects → the server's `ready` frame arrives here → reconcile
    // drains BOTH (catches anything missed while the socket was down).
    client.receive({ type: 'open' }); // informational
    client.receive({ type: 'frame', block: 'event: ready\ndata: {"seq":5}' });
    vi.advanceTimersByTime(10);
    expect(onDrain).toHaveBeenCalledTimes(2); // sync + intents
    vi.useRealTimers();
  });

  it('accepts a JSON-STRING push (shell that stringifies) and ignores malformed pushes', () => {
    const events = [];
    const client = createBridgeSseClient({
      getConnection: () => conn, startNative: () => {}, stopNative: () => {},
      onEvent: (e) => events.push(e),
    });
    client.receive(JSON.stringify({ type: 'frame', block: 'event: activity\ndata: {"seq":3}' }));
    // Malformed pushes must never throw.
    expect(() => client.receive('not json')).not.toThrow();
    expect(() => client.receive(null)).not.toThrow();
    expect(() => client.receive({ type: 'frame' })).not.toThrow(); // no block
    expect(events).toEqual([{ seq: 3 }]);
  });

  it('routes lifecycle messages to onStateChange (open/closed/error)', () => {
    const states = [];
    const client = createBridgeSseClient({
      getConnection: () => conn, startNative: () => {}, stopNative: () => {},
      onEvent: () => {}, onStateChange: (s, d) => states.push([s, d]),
    });
    client.start(); // 'connecting'
    client.receive({ type: 'open' });
    client.receive({ type: 'closed' });
    client.receive({ type: 'error', message: 'boom' });
    client.stop(); // 'stopped'
    expect(states.map((s) => s[0])).toEqual(['connecting', 'open', 'closed', 'error', 'stopped']);
    expect(states.find((s) => s[0] === 'error')[1]).toBe('boom');
  });

  it('passes a terminal error CODE through as a detail object (auth token revoked)', () => {
    const states = [];
    const client = createBridgeSseClient({
      getConnection: () => conn, startNative: () => {}, stopNative: () => {},
      onEvent: () => {}, onStateChange: (s, d) => states.push([s, d]),
    });
    // Native stops the reader on 401/403 and pushes a terminal, coded error ONCE.
    client.receive({ type: 'error', code: 'auth', message: 'vault SSE auth failed: 401' });
    const err = states.find((s) => s[0] === 'error');
    expect(err[1]).toEqual({ message: 'vault SSE auth failed: 401', code: 'auth' });
  });

  it('passes an insecure-URL terminal code through the same way', () => {
    const states = [];
    const client = createBridgeSseClient({
      getConnection: () => conn, startNative: () => {}, stopNative: () => {},
      onEvent: () => {}, onStateChange: (s, d) => states.push([s, d]),
    });
    client.receive({ type: 'error', code: 'insecure', message: 'vault SSE refused: insecure http URL' });
    expect(states.find((s) => s[0] === 'error')[1]).toEqual({
      message: 'vault SSE refused: insecure http URL', code: 'insecure',
    });
  });
});

describe('backoffDelayMs — equal jitter (mirrored by SseBackoff.kt; change both together)', () => {
  // Seeded LCG so every assertion is deterministic — the injected-source
  // pattern this codebase uses for clocks, applied to randomness.
  const lcg = (seed) => () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };

  it('spreads same-attempt delays instead of one aligned value (the anti-wave property)', () => {
    // Many clients dropped by the same vault restart must not share a
    // schedule. Without jitter every attempt-3 delay is exactly 8000 and the
    // distinct-count assertion fails — that is the negative control.
    const random = lcg(42);
    const samples = Array.from({ length: 500 }, () =>
      backoffDelayMs({ attempt: 3, baseMs: 1000, maxMs: 30000, random }));
    expect(new Set(samples).size).toBeGreaterThan(100);
    expect(samples.every((d) => d >= 4000)).toBe(true); // floor: exp/2
    expect(samples.every((d) => d < 8000)).toBe(true);  // range: < exp
  });

  it('the cap still caps and the floor holds at high attempt counts', () => {
    const random = lcg(7);
    const samples = Array.from({ length: 500 }, () =>
      backoffDelayMs({ attempt: 20, baseMs: 1000, maxMs: 30000, random }));
    expect(samples.every((d) => d < 30000)).toBe(true);  // never exceeds max
    expect(samples.every((d) => d >= 15000)).toBe(true); // floor at cap: max/2
  });

  it('no delay is ever zero or negative, from the very first attempt', () => {
    const random = lcg(3);
    const samples = Array.from({ length: 200 }, () =>
      backoffDelayMs({ attempt: 0, baseMs: 1000, maxMs: 30000, random }));
    expect(samples.every((d) => d >= 500)).toBe(true); // attempt-0 floor: base/2
  });

  it('deterministic with a seeded source — same seed, same sequence', () => {
    const seq = (seed) => {
      const random = lcg(seed);
      return Array.from({ length: 6 }, (_, i) =>
        backoffDelayMs({ attempt: i, baseMs: 1000, maxMs: 30000, random }));
    };
    expect(seq(99)).toEqual(seq(99));
  });

  it('the client waits at least the floor before reconnecting (behavioural floor check)', async () => {
    // randomFn () => 0 pins every delay to its floor exp/2: after the first
    // instant drop the reconnect must NOT fire before 500ms, and must at 500.
    vi.useFakeTimers();
    const calls = [];
    const client = createVaultEventClient({
      supported: true,
      getConnection: () => ({ vaultUrl: 'https://v', vaultToken: 't', accountId: 'a' }),
      openStream: async (args) => { calls.push(args); throw new Error('refused'); },
      onEvent: () => {},
      backoffBaseMs: 1000,
      backoffMaxMs: 30000,
      minStableMs: 5000,
      randomFn: () => 0,
    });
    client.start();
    await Promise.resolve(); await Promise.resolve();
    expect(calls).toHaveLength(1);
    vi.advanceTimersByTime(499);                 // just under the attempt-0 floor
    await Promise.resolve(); await Promise.resolve();
    expect(calls).toHaveLength(1);               // no early retry
    vi.advanceTimersByTime(1);                   // 500ms: the floor
    await Promise.resolve(); await Promise.resolve();
    expect(calls).toHaveLength(2);
    client.stop();
    vi.useRealTimers();
  });
});
