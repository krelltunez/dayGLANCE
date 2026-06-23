import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { buildEncryptedEnvelope, deriveIntentsRootKey, deriveEnvelopeKey } from '@glance-apps/intents';

// Mock the handler so a decrypted+routed row is observable without app context.
vi.mock('./handleIntent.js', () => ({ handleIntent: vi.fn(async () => ({ success: true })) }));

import {
  sendIntentsDb,
  pollDbIntents,
  routeIncoming,
  DB_CURSOR_KEY,
  DB_RETRY_KEY,
  MAX_INTENT_RETRIES,
} from './dbIntentsTransport.js';
import { handleIntent } from './handleIntent.js';
import { getActivityLog } from './intentLog.js';

// ─────────────────────────────────────────────────────────────────────────────
// Vault RECEIVE: key-not-ready folds into the bounded-retry three-way model.
// A row that fails to decrypt because the key is ABSENT (transient) must be HELD
// + bounded-retried, NEVER advanced past (lost). A decrypt failure with the key
// PRESENT (wrong key / bad ciphertext) stays permanent (advance + log).
//
// Drives the REAL routeIncoming through the REAL drain (pollDbIntents) against an
// in-memory GLANCEvault server, with the vault key flipped via the loadKey seam.
// ─────────────────────────────────────────────────────────────────────────────

const CONN = { vaultUrl: 'https://vault.example.com', vaultToken: 'tok-123', accountId: 'acct-1' };

function memLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

// In-memory /intents server: insert-only on eventId, global seq, { rows, hasMore }.
function createMemoryIntentsServer({ pageSize = 500, now = () => Date.now() } = {}) {
  const rows = [];
  const byEventId = new Map();
  let seq = 0;
  const vaultFetch = async (method, url, headers, body) => {
    const u = new URL(url);
    if (headers?.Authorization !== `Bearer ${CONN.vaultToken}`) {
      return { status: 401, ok: false, body: JSON.stringify({ error: 'unauthorized' }) };
    }
    if (method === 'POST' && u.pathname === '/intents/batch') {
      const parsed = JSON.parse(body);
      let written = 0;
      for (const ev of parsed.events) {
        if (byEventId.has(ev.eventId)) continue;
        const row = { eventId: ev.eventId, envelope: ev.envelope, seq: ++seq, expiresAt: new Date(ev.expiresAt).toISOString(), serverMtime: new Date(now()).toISOString() };
        rows.push(row); byEventId.set(ev.eventId, row); written++;
      }
      return { status: 200, ok: true, body: JSON.stringify({ written, maxSeq: seq }) };
    }
    if (method === 'GET' && u.pathname === '/intents/list') {
      const since = Number(u.searchParams.get('since'));
      const limit = Number(u.searchParams.get('limit')) || pageSize;
      const nowMs = now();
      const visible = rows.filter((r) => r.seq > since).filter((r) => new Date(r.expiresAt).getTime() > nowMs).sort((a, b) => a.seq - b.seq);
      const page = visible.slice(0, limit);
      return { status: 200, ok: true, body: JSON.stringify({ rows: page, hasMore: visible.length > limit }) };
    }
    return { status: 404, ok: false, body: '{}' };
  };
  return { vaultFetch, rows };
}

function validPayload() {
  return {
    event_id: 'evt-1', source_app: 'app.lifeglance', source_entity_id: 'se-1',
    event: 'completed', task_id: 'task-1', title: 'inbound', timestamp: '2026-01-01T00:00:00.000Z', entity_type: 'task',
  };
}

async function encryptedRow(rootKey, eventId) {
  return buildEncryptedEnvelope(
    { action: 'notify', payload: validPayload(), emittedBy: 'app.lifeglance', eventId },
    (salt) => deriveEnvelopeKey(rootKey, salt),
  );
}

const poll = (server, route) =>
  pollDbIntents({}, { connection: CONN, vaultFetch: server.vaultFetch, routeIncoming: route });

const cursor = () => localStorage.getItem(DB_CURSOR_KEY);
const retries = () => JSON.parse(localStorage.getItem(DB_RETRY_KEY) || '{}');

beforeEach(() => { global.localStorage = memLocalStorage(); handleIntent.mockClear(); });
afterAll(() => { delete global.localStorage; });

describe('vault receive — key-not-ready is transient (bounded retry)', () => {
  it('(a) key ABSENT does not advance; once the key is present it decrypts, advances, clears counter', async () => {
    const server = createMemoryIntentsServer();
    const rootKey = await deriveIntentsRootKey('pw', new Uint8Array(16).fill(7));
    await sendIntentsDb(await encryptedRow(rootKey, '20260101T000000Z-aaa111'), { connection: CONN, config: { ttlMs: 3600_000 }, vaultFetch: server.vaultFetch });

    let keyPresent = false;
    const route = (envelope, ctx) => routeIncoming(envelope, ctx, { loadKey: async () => (keyPresent ? rootKey : null) });

    // Poll 1: key absent → HELD. Cursor not advanced; per-seq counter bumped.
    await poll(server, route);
    expect(cursor()).toBeNull();
    expect(retries()['1']).toBe(1);
    expect(handleIntent).not.toHaveBeenCalled();

    // Key becomes available → decrypts, processes, advances, clears the counter.
    keyPresent = true;
    await poll(server, route);
    expect(cursor()).toBe('1');
    expect(localStorage.getItem(DB_RETRY_KEY)).toBeNull(); // counter cleared
    expect(handleIntent).toHaveBeenCalledTimes(1);
  });

  it('(b) decrypt fails with the key PRESENT (wrong key) is permanent: advances + logs, handler not called', async () => {
    const server = createMemoryIntentsServer();
    const keyA = await deriveIntentsRootKey('A', new Uint8Array(16).fill(1));
    const keyB = await deriveIntentsRootKey('B', new Uint8Array(16).fill(2));
    await sendIntentsDb(await encryptedRow(keyA, '20260101T000000Z-bad222'), { connection: CONN, config: { ttlMs: 3600_000 }, vaultFetch: server.vaultFetch });

    // Wrong key, but PRESENT → WrongKeyError → permanent.
    const route = (envelope, ctx) => routeIncoming(envelope, ctx, { loadKey: async () => keyB });
    await poll(server, route);

    expect(cursor()).toBe('1');                       // advanced past the bad row
    expect(localStorage.getItem(DB_RETRY_KEY)).toBeNull(); // not held for retry
    expect(handleIntent).not.toHaveBeenCalled();
    expect(getActivityLog().some((e) => e.error === 'WrongKeyError')).toBe(true);
  });

  it('(c) a persistently key-absent row gives up at the bound (advance + loud log), no wedge', async () => {
    const server = createMemoryIntentsServer();
    const rootKey = await deriveIntentsRootKey('pw', new Uint8Array(16).fill(9));
    await sendIntentsDb(await encryptedRow(rootKey, '20260101T000000Z-ccc333'), { connection: CONN, config: { ttlMs: 3600_000 }, vaultFetch: server.vaultFetch });

    const route = (envelope, ctx) => routeIncoming(envelope, ctx, { loadKey: async () => null }); // never available

    // Each poll holds + bumps; below the cap the cursor stays put.
    for (let i = 1; i < MAX_INTENT_RETRIES; i++) {
      await poll(server, route);
      expect(cursor()).toBeNull();
      expect(retries()['1']).toBe(i);
    }
    // The MAX_INTENT_RETRIES-th failure gives up: advance + clear + loud log.
    await poll(server, route);
    expect(cursor()).toBe('1');
    expect(localStorage.getItem(DB_RETRY_KEY)).toBeNull();
    expect(handleIntent).not.toHaveBeenCalled();
    expect(getActivityLog().some((e) => String(e.error).startsWith('gave_up_after'))).toBe(true);
  });
});
