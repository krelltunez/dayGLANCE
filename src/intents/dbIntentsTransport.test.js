import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { buildEnvelope, buildIntentRow, ACTIONS, TABS } from '@glance-apps/intents';
import { sendIntentsDb, pollDbIntents, DB_CURSOR_KEY, DB_RETRY_KEY, MAX_INTENT_RETRIES } from './dbIntentsTransport.js';

// ─────────────────────────────────────────────────────────────────────────────
// App-owned GLANCEvault DB intents transport. These exercise the REAL codec
// (buildIntentRow/parseIntentRow/parseSince/formatSince) against an in-memory
// GLANCEvault intents server, with the connection injected (no network, no DOM).
// ─────────────────────────────────────────────────────────────────────────────

function memLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

afterAll(() => { delete global.localStorage; });

const CONN = { vaultUrl: 'https://vault.example.com', vaultToken: 'tok-123', accountId: 'acct-1' };

// In-memory GLANCEvault /intents server. Insert-only on eventId, global seq,
// honours the { rows, hasMore } list contract with a page size and an
// expiresAt-driven non-expired filter.
function createMemoryIntentsServer({ pageSize = 500, now = () => Date.now() } = {}) {
  const rows = []; // { eventId, envelope, seq, expiresAt, serverMtime }
  const byEventId = new Map();
  let seq = 0;
  const calls = { batch: [], list: [] };

  const vaultFetch = async (method, url, headers, body) => {
    const u = new URL(url);
    // Auth must be present on every request.
    if (headers?.Authorization !== `Bearer ${CONN.vaultToken}`) {
      return { status: 401, ok: false, body: JSON.stringify({ error: 'unauthorized' }) };
    }

    if (method === 'POST' && u.pathname === '/intents/batch') {
      const parsed = JSON.parse(body);
      calls.batch.push(parsed);
      let written = 0;
      for (const ev of parsed.events) {
        if (byEventId.has(ev.eventId)) continue; // insert-only no-op on re-send
        const row = {
          eventId: ev.eventId,
          envelope: ev.envelope,
          seq: ++seq,
          expiresAt: new Date(ev.expiresAt).toISOString(), // server canonicalizes to UTC ISO
          serverMtime: new Date(now()).toISOString(),
        };
        rows.push(row);
        byEventId.set(ev.eventId, row);
        written++;
      }
      return { status: 200, ok: true, body: JSON.stringify({ written, maxSeq: seq }) };
    }

    if (method === 'GET' && u.pathname === '/intents/list') {
      const accountId = u.searchParams.get('accountId');
      const since = Number(u.searchParams.get('since'));
      const limit = Number(u.searchParams.get('limit')) || pageSize;
      calls.list.push({ accountId, since, limit });
      const nowMs = now();
      const visible = rows
        .filter((r) => r.seq > since)
        .filter((r) => new Date(r.expiresAt).getTime() > nowMs) // only non-expired
        .sort((a, b) => a.seq - b.seq);
      const page = visible.slice(0, limit);
      const hasMore = visible.length > limit;
      return { status: 200, ok: true, body: JSON.stringify({ rows: page, hasMore }) };
    }

    return { status: 404, ok: false, body: '{}' };
  };

  return { vaultFetch, calls, rows, get seq() { return seq; } };
}

// A notify envelope for a foreign task so routeIncoming doesn't loopback-skip it.
function makeForeignNotify(i) {
  return buildEnvelope({
    action: ACTIONS.NOTIFY,
    payload: {
      event_id: `evt-${i}`,
      source_app: 'app.lifeglance',
      source_entity_id: `ext-${i}`,
      event: 'completed',
      task_id: `t-${i}`,
      title: `task ${i}`,
      timestamp: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    },
    emittedBy: 'app.lifeglance',
  });
}

beforeEach(() => {
  global.localStorage = memLocalStorage();
});

describe('DB intents — SEND (batch wrapper + idempotency)', () => {
  it('wire body is { accountId, events: [...] } and re-sent eventId is idempotent', async () => {
    const server = createMemoryIntentsServer();
    const env = buildEnvelope({ action: ACTIONS.OPEN, payload: { tab: TABS.TODAY }, emittedBy: 'app.dayglance' });

    const first = await sendIntentsDb(env, { connection: CONN, config: { ttlMs: 3600_000 }, vaultFetch: server.vaultFetch });
    const second = await sendIntentsDb(env, { connection: CONN, config: { ttlMs: 3600_000 }, vaultFetch: server.vaultFetch });

    // Wire body shape.
    expect(server.calls.batch).toHaveLength(2);
    const body = server.calls.batch[0];
    expect(Object.keys(body).sort()).toEqual(['accountId', 'events']);
    expect(body.accountId).toBe(CONN.accountId);
    expect(Array.isArray(body.events)).toBe(true);
    expect(Object.keys(body.events[0]).sort()).toEqual(['envelope', 'eventId', 'expiresAt']);
    expect(typeof body.events[0].envelope).toBe('string'); // opaque base64

    // Same eventId both times.
    expect(server.calls.batch[1].events[0].eventId).toBe(body.events[0].eventId);

    // Insert-only: first writes 1, the re-send is a server no-op.
    expect(first.written).toBe(1);
    expect(second.written).toBe(0);
    expect(server.rows).toHaveLength(1);
  });

  it('does not advance the receive cursor', async () => {
    const server = createMemoryIntentsServer();
    localStorage.setItem(DB_CURSOR_KEY, '7'); // pre-existing receive cursor

    const env = buildEnvelope({ action: ACTIONS.OPEN, payload: { tab: TABS.TODAY }, emittedBy: 'app.dayglance' });
    await sendIntentsDb(env, { connection: CONN, config: { ttlMs: 3600_000 }, vaultFetch: server.vaultFetch });

    // Sending must NEVER touch the receive cursor.
    expect(localStorage.getItem(DB_CURSOR_KEY)).toBe('7');
  });
});

describe('DB intents — RECEIVE (pagination loop drains a >500 backlog)', () => {
  it('drains ~1200 rows across multiple pages, with an expiry gap, and advances the cursor', async () => {
    // Freeze "now" so expiry is deterministic.
    const NOW = 1_700_000_000_000;
    const server = createMemoryIntentsServer({ pageSize: 500, now: () => NOW });

    const TOTAL = 1200;
    const EXPIRED_INDEX = 600; // one row in the middle is already expired on the server

    // Seed the server directly via batch (insert-only). Most rows live; one is expired.
    for (let i = 0; i < TOTAL; i++) {
      const env = makeForeignNotify(i);
      const expiresAt = i === EXPIRED_INDEX
        ? new Date(NOW - 1000).toISOString()       // already expired
        : new Date(NOW + 3600_000).toISOString();  // valid for an hour
      const row = buildIntentRow(env, { expiresAt: new Date(expiresAt) });
      await server.vaultFetch(
        'POST', `${CONN.vaultUrl}/intents/batch`,
        { Authorization: `Bearer ${CONN.vaultToken}`, 'Content-Type': 'application/json' },
        JSON.stringify({ accountId: CONN.accountId, events: [{ eventId: row.eventId, envelope: row.envelope, expiresAt: row.expiresAt }] }),
      );
    }

    // Server only ever returns non-expired rows → 1199 visible across pages.
    const VISIBLE = TOTAL - 1;

    // Count how many envelopes reach the handler.
    let handled = 0;
    const context = {
      tasks: [], unscheduledTasks: [], recurringTasks: [],
      setTasks: () => {}, setUnscheduledTasks: () => {}, setRecurringTasks: () => {},
      // handleIntent's COMPLETE path looks up by source ids; with empty state it
      // returns a (failed) result either way — we only care that it was reached.
    };
    const handleSpy = vi.fn(async () => { handled++; });

    // Drive the real pagination loop. We assert on cursor + the number of list
    // pages requested rather than mocking handleIntent: a >500 backlog MUST take
    // multiple list calls (ceil(1199/500) = 3).
    await pollDbIntents(context, { connection: CONN, vaultFetch: server.vaultFetch });
    void handleSpy; void handled;

    // Multiple pages were fetched (3 pages: 500 + 500 + 199), then a final empty
    // page is NOT requested because hasMore is false on the third.
    expect(server.calls.list.length).toBe(3);
    expect(server.calls.list[0].since).toBe(0);
    expect(server.calls.list[1].since).toBeGreaterThan(0);
    expect(server.calls.list[2].since).toBeGreaterThan(server.calls.list[1].since);

    // Cursor advanced to the max visible seq (the last non-expired row's seq).
    // The expired row's seq is legitimately skipped (TTL), so the cursor can sit
    // PAST it — that is intended, not a cursor-skip bug.
    const maxSeq = server.seq; // last assigned seq overall
    expect(Number(localStorage.getItem(DB_CURSOR_KEY))).toBe(maxSeq);

    // A second poll from the advanced cursor returns nothing new (single empty page).
    server.calls.list.length = 0;
    await pollDbIntents(context, { connection: CONN, vaultFetch: server.vaultFetch });
    expect(server.calls.list).toHaveLength(1);
    expect(server.calls.list[0].since).toBe(maxSeq);
    void VISIBLE;
  });

  it('does not call list when no connection is available', async () => {
    const server = createMemoryIntentsServer();
    await pollDbIntents({}, { connection: null, vaultFetch: server.vaultFetch });
    expect(server.calls.list).toHaveLength(0);
  });
});

// Seed n valid (non-expired) foreign notify rows into the server.
async function seedRows(server, n, nowFn = () => Date.now()) {
  for (let i = 0; i < n; i++) {
    const env = makeForeignNotify(i);
    const row = buildIntentRow(env, { expiresAt: new Date(nowFn() + 3600_000) });
    await server.vaultFetch(
      'POST', `${CONN.vaultUrl}/intents/batch`,
      { Authorization: `Bearer ${CONN.vaultToken}`, 'Content-Type': 'application/json' },
      JSON.stringify({ accountId: CONN.accountId, events: [{ eventId: row.eventId, envelope: row.envelope, expiresAt: row.expiresAt }] }),
    );
  }
}

const retries = () => JSON.parse(localStorage.getItem(DB_RETRY_KEY) || '{}');
const cursor = () => localStorage.getItem(DB_CURSOR_KEY);
const CTX = {}; // the injected router ignores context

describe('DB intents — RECEIVE bounded-retry model', () => {
  it('(a) a handler that THROWS once then succeeds is retried, not lost', async () => {
    const server = createMemoryIntentsServer();
    await seedRows(server, 1); // one row at seq 1

    let calls = 0;
    const route = async () => {
      calls++;
      if (calls === 1) throw new Error('transient db error');
      return 'ok';
    };

    // First poll: handler throws → HOLD. Cursor must NOT advance; counter persisted.
    await pollDbIntents(CTX, { connection: CONN, vaultFetch: server.vaultFetch, routeIncoming: route });
    expect(cursor()).toBeNull();
    expect(retries()).toEqual({ 1: 1 });

    // Second poll: same row redelivered (cursor held), handler now succeeds → advance + clear.
    await pollDbIntents(CTX, { connection: CONN, vaultFetch: server.vaultFetch, routeIncoming: route });
    expect(Number(cursor())).toBe(1);
    expect(retries()).toEqual({}); // counter cleared on success
    expect(calls).toBe(2); // delivered twice: failed, then succeeded — never dropped
  });

  it('a HOLD stops the entire drain — no further pages this poll', async () => {
    const server = createMemoryIntentsServer({ pageSize: 500 });
    await seedRows(server, 600); // two pages

    const route = async () => { throw new Error('boom'); };
    await pollDbIntents(CTX, { connection: CONN, vaultFetch: server.vaultFetch, routeIncoming: route });

    // Threw on the very first row → held immediately; page 2 never fetched.
    expect(server.calls.list).toHaveLength(1);
    expect(cursor()).toBeNull();          // cursor unadvanced
    expect(retries()).toEqual({ 1: 1 });  // only the first row's seq is counted
  });

  it('(b) a row that throws >= MAX_INTENT_RETRIES is given up, logged, and skipped (no wedge)', async () => {
    const server = createMemoryIntentsServer();
    await seedRows(server, 2); // seq 1 (poison) then seq 2 (good)

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // seq 1 always throws; seq 2 succeeds. Key off the decoded envelope's task id.
    const route = async (envelope) => {
      if (envelope.payload?.task_id === 't-0') throw new Error('always fails');
      return 'ok';
    };

    // Polls 1..(MAX-1): each throws on seq 1 → HOLD, cursor stays null, counter climbs.
    for (let n = 1; n < MAX_INTENT_RETRIES; n++) {
      await pollDbIntents(CTX, { connection: CONN, vaultFetch: server.vaultFetch, routeIncoming: route });
      expect(cursor()).toBeNull();
      expect(retries()).toEqual({ 1: n });
    }

    // Poll MAX: count reaches MAX_INTENT_RETRIES → give up on seq 1, advance past it,
    // then seq 2 succeeds → cursor lands at 2. Channel did not wedge.
    await pollDbIntents(CTX, { connection: CONN, vaultFetch: server.vaultFetch, routeIncoming: route });
    expect(Number(cursor())).toBe(2);
    expect(retries()).toEqual({}); // poison counter cleared on give-up; no leak

    // Give-up was logged loudly.
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('Giving up on intent'),
      expect.anything(),
    );

    // A subsequent poll re-delivers nothing (single empty page from the advanced cursor).
    server.calls.list.length = 0;
    await pollDbIntents(CTX, { connection: CONN, vaultFetch: server.vaultFetch, routeIncoming: route });
    expect(server.calls.list).toHaveLength(1);
    expect(server.calls.list[0].since).toBe(2);

    errSpy.mockRestore();
  });

  it('(c) the failure counter persists across a simulated reload', async () => {
    const server = createMemoryIntentsServer();
    await seedRows(server, 1);

    const route = async () => { throw new Error('still failing'); };

    // First poll on "session 1": counter → 1, held.
    await pollDbIntents(CTX, { connection: CONN, vaultFetch: server.vaultFetch, routeIncoming: route });
    expect(retries()).toEqual({ 1: 1 });

    // Simulate an app reload: brand-new localStorage seeded ONLY from what was
    // persisted (retry counter; cursor was never advanced so it's absent). If the
    // counter were in-memory it would reset to 0 here and never reach the cap.
    const persistedRetry = localStorage.getItem(DB_RETRY_KEY);
    global.localStorage = memLocalStorage();
    localStorage.setItem(DB_RETRY_KEY, persistedRetry);

    // First poll on "session 2": same row redelivered, throws again → counter 2,
    // proving it accumulated across the reload rather than restarting.
    await pollDbIntents(CTX, { connection: CONN, vaultFetch: server.vaultFetch, routeIncoming: route });
    expect(retries()).toEqual({ 1: 2 });
    expect(cursor()).toBeNull();
  });

  it('(d) a SOFT failure (result.success===false → permanent) advances past, no retry', async () => {
    const server = createMemoryIntentsServer();
    await seedRows(server, 1);

    let calls = 0;
    const route = async () => { calls++; return 'permanent'; }; // handler refuses this intent

    await pollDbIntents(CTX, { connection: CONN, vaultFetch: server.vaultFetch, routeIncoming: route });
    expect(Number(cursor())).toBe(1);  // advanced past — permanent, not retried
    expect(retries()).toEqual({});     // no counter created for a permanent failure
    expect(calls).toBe(1);

    // Not redelivered on the next poll.
    server.calls.list.length = 0;
    await pollDbIntents(CTX, { connection: CONN, vaultFetch: server.vaultFetch, routeIncoming: route });
    expect(server.calls.list).toHaveLength(1);
    expect(server.calls.list[0].since).toBe(1);
    expect(calls).toBe(1); // route NOT called again
  });
});
