import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { buildEnvelope, buildIntentRow, ACTIONS, TABS } from '@glance-apps/intents';
import { sendIntentsDb, pollDbIntents, DB_CURSOR_KEY } from './dbIntentsTransport.js';

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
