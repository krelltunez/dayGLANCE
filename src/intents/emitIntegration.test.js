import { describe, it, expect, vi } from 'vitest';
import { deriveIntentsRootKey } from '@glance-apps/intents';
import { enqueue, flush, pendingCount, list, PENDING, DELIVERED, GIVEN_UP } from './outbox.js';
import { enqueueAndFlush } from './outboxEmit.js';
import { vaultDeliverer } from './deliverers.js';

// ─────────────────────────────────────────────────────────────────────────────
// emit -> outbox -> flush(deliverers) integration (stage 2b-ii). Uses the REAL
// outbox and an injected in-memory store (the repo has no fake-indexeddb), plus
// real / fake deliverers. Covers delivery + removal, the held-vault-no-loss case,
// the snapshot-advance gate, and a real-vault-deliverer encrypted-row roundtrip.
// ─────────────────────────────────────────────────────────────────────────────

function createMemoryStore() {
  const m = new Map();
  const clone = (v) => JSON.parse(JSON.stringify(v));
  return {
    async getAll() { return [...m.values()].map(clone); },
    async get(id) { return m.has(id) ? clone(m.get(id)) : undefined; },
    async put(e) { m.set(e.id, clone(e)); },
    async delete(id) { m.delete(id); },
  };
}

// A raw intent exactly as the emit sites build it.
function rawNotify(eventId = '20260101T000000Z-aaa111', title = 'SECRET-TITLE') {
  return {
    event_id: eventId,
    action: 'notify',
    emitted_by: 'app.dayglance',
    payload: {
      event_id: eventId, source_app: 'app.testglance', source_entity_id: 'se-1',
      event: 'completed', task_id: 'task-1', title, timestamp: '2026-01-01T00:00:00.000Z', entity_type: 'task',
    },
  };
}

// (b) after enqueue, a flush delivers via the deliverers and the entry is removed.
describe('(b) enqueue → flush delivers and removes on success', () => {
  it('removes the entry once the (only) target delivers', async () => {
    const store = createMemoryStore();
    await enqueue(rawNotify(), ['webdav'], { store });
    expect(await pendingCount({ store })).toBe(1);

    const webdav = vi.fn(async () => DELIVERED);
    await flush({ webdav }, { store });

    expect(webdav).toHaveBeenCalledTimes(1);
    expect(await list({ store })).toHaveLength(0);
  });
});

// (c) vault enabled but key absent → vault target stays pending (transient) and
//     is retried, while webdav delivers — no loss.
describe('(c) held vault target does not lose the intent', () => {
  it('keeps the entry with webdav delivered + vault pending, then removes when vault delivers', async () => {
    const store = createMemoryStore();
    await enqueue(rawNotify(), ['webdav', 'vault'], { store });

    // First flush: webdav delivers; vault has no key yet → transient.
    await flush({ webdav: async () => DELIVERED, vault: async () => 'transient' }, { store });

    let [entry] = await list({ store });
    expect(entry.targets.webdav).toBe(DELIVERED);
    expect(entry.targets.vault).toBe(PENDING);   // held, not lost
    expect(await pendingCount({ store })).toBe(1);

    // Later flush (key now present): vault delivers; webdav must NOT be re-sent.
    const webdav2 = vi.fn(async () => DELIVERED);
    await flush({ webdav: webdav2, vault: async () => DELIVERED }, { store });
    expect(webdav2).not.toHaveBeenCalled();
    expect(await list({ store })).toHaveLength(0);
  });
});

// (d) the snapshot does not advance on a failed enqueue.
describe('(d) snapshot-advance gate (enqueueAndFlush return value)', () => {
  it('returns false when an enqueue fails (caller must NOT advance the snapshot)', async () => {
    const flushSpy = vi.fn(async () => {});
    const enqueueSpy = vi.fn(async () => { throw new Error('IDB write failed'); });
    const onError = vi.fn();

    const allEnqueued = await enqueueAndFlush(
      [{ intent: rawNotify(), onError }],
      ['vault'],
      { enqueue: enqueueSpy, flush: flushSpy, deliverers: {} },
    );

    expect(allEnqueued).toBe(false);   // → the hook leaves prevRef unadvanced
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('returns true when every enqueue succeeds (caller advances the snapshot)', async () => {
    const allEnqueued = await enqueueAndFlush(
      [{ intent: rawNotify('e1'), onOk: vi.fn() }, { intent: rawNotify('e2'), onOk: vi.fn() }],
      ['webdav'],
      { enqueue: vi.fn(async () => {}), flush: vi.fn(async () => {}), deliverers: {} },
    );
    expect(allEnqueued).toBe(true);
  });
});

// (e) end-to-end through the REAL vault deliverer: emit-shaped raw intent →
//     enqueue → flush → vault deliverer builds an ENCRYPTED row and POSTs it.
describe('(e) end-to-end: real vault deliverer builds an encrypted row', () => {
  it('flushes a queued intent through vaultDeliverer producing ciphertext', async () => {
    const store = createMemoryStore();
    const CONN = { vaultUrl: 'https://vault.example.com', vaultToken: 'tok-123', accountId: 'acct-1' };
    const rootKey = await deriveIntentsRootKey('pw', new Uint8Array(16).fill(5));

    const captured = [];
    const vaultFetch = async (method, url, headers, body) => {
      captured.push({ url, body });
      return { status: 200, ok: true, body: JSON.stringify({ written: 1, maxSeq: 1 }) };
    };

    // Wrap the REAL vault deliverer, injecting the connection/key/fetch that the
    // production deliverer would read from config + IndexedDB.
    const deliverers = {
      vault: (intent) => vaultDeliverer(intent, { connection: CONN, config: { ttlMs: 1000 }, loadKey: async () => rootKey, vaultFetch }),
    };

    await enqueue(rawNotify('20260101T000000Z-enc999', 'SECRET-TITLE'), ['vault'], { store });
    await flush(deliverers, { store });

    // Delivered → entry removed.
    expect(await list({ store })).toHaveLength(0);

    // The POSTed row is ciphertext — no plaintext leak.
    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe('https://vault.example.com/intents/batch');
    const sent = JSON.parse(captured[0].body);
    const env = JSON.parse(Buffer.from(sent.events[0].envelope, 'base64').toString('utf8'));
    expect(env.encrypted).toBe(true);
    expect(env.payload_ciphertext).toBeDefined();
    expect(env).not.toHaveProperty('payload');
    expect(Buffer.from(sent.events[0].envelope, 'base64').toString('utf8')).not.toContain('SECRET-TITLE');
  });
});

// Defensive: GIVEN_UP is exported and distinct (sanity that imports resolved).
it('outbox status constants are present', () => {
  expect(PENDING).toBe('pending');
  expect(DELIVERED).toBe('delivered');
  expect(GIVEN_UP).toBe('given-up');
});
